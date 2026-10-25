// Voxel models -> GPU meshes (flat-shaded cubes with per-vertex ambient occlusion), plus procedural
// trees, fish, sea life and a per-frame builder for thin dynamic parts (oars, rod, fishing line).
import { Vox, RGB, EMISSIVE, mat, type Vec3 } from '../voxel';
import { M, decorate, eqSig, CRATE, type Fit } from '../models';
import { HARBOURS, LIGHTHOUSES, WRECKS, cottage, L as LK, gable, walls, barrel, crate, basket, lampPost, coil, netRack, skiff } from '../landmarks';
import { SPECIES } from '../econ';
import { schoolLook } from '../species';
import { FISH_T } from '../fishart';
import { hash01 } from '../noise';
import { hex, toHex } from '../config';
import type { BoatId } from '../types';

/** Vertex layout: position xyz, normal xyz, colour rgb (pre-multiplied by AO), glowable flag; 10 floats, 40 bytes. */
const VERT = 10;
/** Instance layout (12 floats, 48 bytes), shared by every mesh: x, y, yaw, scale | z, pitch, roll, glow | r, g, b, clear. */
export const INST = 12;
/** Voxel models are indexed (4 vertices per face, shared by its two triangles); the per-frame dynamic mesh is not. */
export interface Mesh { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer | null; count: number; itype: GLenum }
interface Geometry { verts: Float32Array; idx: Uint16Array | Uint32Array }

let gl: WebGL2RenderingContext, instBuf: WebGLBuffer;
const AOL = [0.52, 0.7, 0.86, 1.0];              // brightness by number of open neighbours at a corner
const FACES: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// noBottom: skip downward faces, which the camera (looking down from the south) never sees on a model that only
// turns about the vertical, and which never catch the sun for its shadow
function voxGeometry(V: Vox, noBottom = false): Geometry {
  const out: number[] = [], idx: number[] = [], solid = (u: number, v: number, z: number) => V.get(u, v, z) ? 1 : 0;
  V.each((u, v, z, m) => {
    const rgb = RGB[m][1], em = EMISSIVE.has(m) ? 1 : 0;
    for (const n of FACES) {
      if (solid(u + n[0], v + n[1], z + n[2]) || (noBottom && n[2] < 0)) continue;
      const t1 = n[0] ? [0, 1, 0] : [1, 0, 0], t2 = n[2] ? [0, 1, 0] : [0, 0, 1];
      const cx = u + n[0] * 0.5, cy = v + n[1] * 0.5, cz = z + 0.5 + n[2] * 0.5, cs: number[][] = [];
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        // ambient occlusion from the two edge neighbours and the corner neighbour in front of this face
        const a = solid(u + n[0] + s1 * t1[0], v + n[1] + s1 * t1[1], z + n[2] + s1 * t1[2]);
        const b = solid(u + n[0] + s2 * t2[0], v + n[1] + s2 * t2[1], z + n[2] + s2 * t2[2]);
        const c = solid(u + n[0] + s1 * t1[0] + s2 * t2[0], v + n[1] + s1 * t1[1] + s2 * t2[1], z + n[2] + s1 * t1[2] + s2 * t2[2]);
        const ao = em ? 3 : a && b ? 0 : 3 - a - b - c;
        cs.push([cx + (s1 * t1[0] + s2 * t2[0]) * 0.5, cy + (s1 * t1[1] + s2 * t2[1]) * 0.5, cz + (s1 * t1[2] + s2 * t2[2]) * 0.5, AOL[ao]]);
      }
      // split the quad along the diagonal that keeps the AO gradient smooth
      const tri = cs[0][3] + cs[2][3] > cs[1][3] + cs[3][3] ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0], base = out.length / VERT;
      for (const c of cs) out.push(c[0], c[1], c[2], n[0], n[1], n[2], rgb[0] / 255 * c[3], rgb[1] / 255 * c[3], rgb[2] / 255 * c[3], em);
      for (const i of tri) idx.push(base + i);
    }
  });
  return { verts: new Float32Array(out), idx: out.length / VERT > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

// ---------- GPU plumbing ----------
export function init(g: WebGL2RenderingContext, ib: WebGLBuffer): void { gl = g; instBuf = ib; }
// vertices, with triangle indices (voxel models) or without (the dynamic mesh: plain triangles)
function upload(data: Float32Array, idx: Uint16Array | Uint32Array | null, dynamic = false): Mesh {
  const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = idx && gl.createBuffer();
  gl.bindVertexArray(vao);
  if (idx) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW); }
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERT * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERT * 4, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, VERT * 4, 24);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  for (let k = 0; k < 3; k++) {
    gl.enableVertexAttribArray(3 + k);
    gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, INST * 4, k * 16);
    gl.vertexAttribDivisor(3 + k, 1);
  }
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, count: idx ? idx.length : data.length / VERT, itype: idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}
// replace a dynamic mesh's vertices with the first n floats of data
function refill(mesh: Mesh, data: Float32Array, n: number): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  if (n) gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW, 0, n);
  mesh.count = n / VERT;
}
/** Uploads a frame's instances once (INST floats each), for drawInstances to draw slices of. */
export function uploadInstances(inst: Float32Array, n: number): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STREAM_DRAW, 0, n * INST);
}
/** Draws n instances starting at instance `first` of the frame's upload: the mesh's instance attributes are pointed
 *  at that slice (WebGL2 has no base-instance draw), so a frame uploads once instead of once per mesh and pass. */
export function drawInstances(mesh: Mesh, first: number, n: number): void {
  if (!n || !mesh.count) return;
  gl.bindVertexArray(mesh.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  for (let k = 0; k < 3; k++) gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, INST * 4, (first * INST + k * 4) * 4);
  if (mesh.ibo) gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.itype, 0, n);
  else gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
  gl.bindVertexArray(null);
}
const cache = new Map<string, Mesh>();
let gen = 0;                                      // bumped when a lost GL context comes back and every mesh must rebuild
// dz lowers the geometry so a creature pivots (pitch/roll) about its spine instead of its belly
function cached(key: string, build: () => Vox, dz = 0, noBottom = false): Mesh {
  let m = cache.get(key);
  if (m) return m;
  const g = voxGeometry(build(), noBottom);
  if (dz) for (let i = 2; i < g.verts.length; i += VERT) g.verts[i] -= dz;
  m = upload(g.verts, g.idx);
  cache.set(key, m);
  return m;
}

// ---------- boats (rebuilt when the fitted equipment changes) ----------
const boatCache = new Map<string, Mesh>();      // signature -> mesh, most recently used last
// the player's boat plus other players' boats nearby (up to 12 shown, each with its own look), with room to spare
// so a full harbour never rebuilds meshes every frame
export function boatMesh(id: BoatId, eq: Fit): Mesh {
  const sig = eqSig(id, eq);
  let m = boatCache.get(sig);
  if (m) { boatCache.delete(sig); boatCache.set(sig, m); return m; }
  const g = voxGeometry(decorate(id, eq));
  m = upload(g.verts, g.idx);
  boatCache.set(sig, m);
  while (boatCache.size > 24) {
    const [k, old] = boatCache.entries().next().value!;
    gl.deleteBuffer(old.vbo); gl.deleteBuffer(old.ibo); gl.deleteVertexArray(old.vao); boatCache.delete(k);
  }
  return m;
}
// A family of meshes by key (tree kind, wingbeat pose, species...), each built on first use. Every family is
// registered so reset() forgets them all; a hand-kept list let one slip through after a lost context.
const families: Map<unknown, Mesh>[] = [];
function family<K>(name: (k: K) => string, build: (k: K) => () => Vox, dz = 0, noBottom = false): (k: K) => Mesh {
  const memo = new Map<K, Mesh>();
  families.push(memo);
  return k => { let m = memo.get(k); if (!m) memo.set(k, m = cached(name(k), build(k), dz, noBottom)); return m; };
}
// a mesh built on first use and kept: the accessor allocates nothing per call
function lazy(key: string, build: () => Vox, dz = 0): () => Mesh {
  let m: Mesh | null = null, g = -1;
  return () => { if (g !== gen) { m = cached(key, build, dz); g = gen; } return m!; };
}
export const lighthouseMesh = family((k: number) => 'lighthouse' + k, k => LIGHTHOUSES[k]);
export const harbourMesh = family((k: number) => 'harbour' + k, k => HARBOURS[k]);
export const wreckMesh = family((k: number) => 'wreck' + k, k => WRECKS[k]);
export const crateMesh = lazy('crate', () => CRATE);

// ---------- procedural voxel trees ----------
const TM = {
  needle: mat(['#24382a', '#33503a', '#4a6a48']), needle2: mat(['#2c4430', '#3f5f3a', '#577a48']), leaf: mat(['#3f6034', '#5a8040', '#78a050']),
  leaf2: mat(['#4a7038', '#6a9446', '#8ab45a']), palm: mat(['#3f6a28', '#5e8e34', '#80b048']), trunk: mat(['#3e2c1e', '#5a4028', '#765638']),
  ptrunk: mat(['#7a5e3a', '#a2804e', '#c4a06a']), snow: mat(['#c8d2d6', '#eef2f4', '#ffffff']), coco: mat(['#3a2818', '#5e4024', '#7a5530']),
  berry: mat(['#7e2c3a', '#c0405a', '#e8708a']), bloom: mat(['#a08a30', '#e8c84a', '#fff0a0']), moss: mat(['#3a5230', '#527040', '#6e8c50']),
};
function sphere(V: Vox, cx: number, cy: number, cz: number, r: number, m1: number, m2: number, seed: number): void {
  for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let v = Math.floor(cy - r); v <= cy + r; v++) for (let u = Math.floor(cx - r); u <= cx + r; u++) {
    const d = Math.hypot(u - cx, v - cy, (z - cz) * 1.15); if (d > r - hash01(u * 7 + seed, v * 13 + z, 5) * 0.9) continue;
    V.set(u, v, z, hash01(u + seed, v * 3 + z * 7, 9) < 0.35 ? m2 : m1);
  }
}
function pine(big: boolean, snowy: boolean): Vox {
  const hgt = big ? 17 : 12, V = new Vox(-5, 5, -5, 5, hgt + 2), base = big ? 3 : 2;
  V.box(0, 0, 0, 0, 0, base, TM.trunk);
  for (let z = base; z <= hgt; z++) {
    const k = (hgt - z) / (hgt - base), r = 0.6 + k * (big ? 4.4 : 3.4) * (0.75 + 0.25 * ((z - base) % 3 === 0 ? 1.25 : 1));
    for (let v = -5; v <= 5; v++) for (let u = -5; u <= 5; u++) if (Math.hypot(u, v) <= r) V.set(u, v, z, (u + v + z) % 4 === 0 ? TM.needle2 : TM.needle);
  }
  V.set(0, 0, hgt + 1, TM.needle);
  if (snowy) V.each((u, v, z, m) => { if (m !== TM.trunk && !V.get(u, v, z + 1) && hash01(u, v * 5 + z, 3) < 0.7) V.set(u, v, z, TM.snow); });
  return V.finalize();
}
function round(big: boolean): Vox {
  const r = big ? 4.6 : 3.6, V = new Vox(-6, 6, -6, 6, 16), cz = big ? 9 : 7;
  V.box(0, 0, 0, 0, 0, cz - 2, TM.trunk); sphere(V, 0, 0, cz, r, TM.leaf, TM.leaf2, big ? 3 : 1);
  return V.finalize();
}
function palm(): Vox {
  const V = new Vox(-8, 8, -8, 8, 16); let x = 0, y = 0;
  for (let z = 0; z <= 11; z++) { V.set(Math.round(x), Math.round(y), z, TM.ptrunk); x += 0.22; y += 0.08; }
  const tx = Math.round(x), ty = Math.round(y);
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + 0.3; for (let d = 1; d <= 6; d++) V.set(tx + Math.round(Math.cos(a) * d), ty + Math.round(Math.sin(a) * d), 12 - Math.floor(d * d / 9), TM.palm); }
  V.set(tx, ty, 12, TM.palm); V.set(tx + 1, ty, 11, TM.coco); V.set(tx, ty + 1, 11, TM.coco);
  return V.finalize();
}
function rock(): Vox { const V = new Vox(-3, 3, -3, 3, 4); sphere(V, 0, 0, 1, 2.4, M.stone, M.ironp, 7); return V.finalize(); }
// a low shrub, flowering or in berry
function bush(fruit: number): Vox {
  const V = new Vox(-3, 3, -3, 3, 5); sphere(V, 0, 0, 1.6, 2.3, TM.leaf2, TM.leaf, 11);
  V.each((u, v, z) => { if (!V.get(u, v, z + 1) && hash01(u * 5 + 3, v + z * 7, 13) < 0.22) V.set(u, v, z, fruit); });
  return V.finalize();
}
// a few weathered stones heaped together, moss on top
function boulders(): Vox {
  const V = new Vox(-5, 5, -5, 5, 6);
  sphere(V, -1, 0, 1.5, 2.9, M.stone, M.ironp, 3); sphere(V, 2.2, 1.4, 0.8, 1.9, M.stone, M.ironp, 5); sphere(V, 0.6, -2.4, 0.6, 1.6, M.ironp, M.stone, 9);
  V.each((u, v, z) => { if (!V.get(u, v, z + 1) && z >= 3 && hash01(u, v * 3, 17) < 0.5) V.set(u, v, z, TM.moss); });
  return V.finalize();
}
// biome trees: a birch for the kelp coasts, a burnt snag and an ashy shrub for the ember isles, a fern for both coasts
const BM = {
  bark: mat(['#9a9488', '#d6d0c2', '#f2eee4']), char: mat(['#1c1a1a', '#2e2a28', '#463e38']), ash: mat(['#5a5a3e', '#7a7650', '#9a9466']),
};
function birch(): Vox {
  const V = new Vox(-4, 4, -4, 4, 15);
  V.box(0, 0, 0, 0, 0, 9, BM.bark);
  for (let z = 2; z <= 8; z += 3) V.set(0, 0, z, TM.trunk);                   // the dark bands on the bark
  sphere(V, 0, 0, 10, 2.8, TM.leaf2, TM.palm, 21); sphere(V, 1, 0, 7.5, 1.8, TM.palm, TM.leaf2, 22);
  return V.finalize();
}
function deadtree(): Vox {
  const V = new Vox(-4, 4, -4, 4, 12);
  V.box(0, 0, 0, 0, 0, 8, BM.char);
  V.line([0, 0, 5], [-3, 1, 8], BM.char); V.line([0, 0, 7], [2, -2, 10], BM.char); V.line([0, 0, 3], [2, 1, 5], BM.char);
  return V.finalize();
}
function ashbush(): Vox { const V = new Vox(-3, 3, -3, 3, 4); sphere(V, 0, 0, 1.2, 2.0, BM.ash, TM.moss, 23); return V.finalize(); }
// a low fan of fronds
function fern(): Vox {
  const V = new Vox(-4, 4, -4, 4, 5);
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283 + 0.4; V.line([0, 0, 0], [Math.round(Math.cos(a) * 3.6), Math.round(Math.sin(a) * 3.6), 2 + (k % 2)], k % 2 ? TM.palm : TM.leaf2); }
  V.set(0, 0, 1, TM.leaf);
  return V.finalize();
}
// a mangrove: a low dark crown on a short trunk, held up out of the water on arching stilt roots
const MG = {
  leaf: mat(['#1e3a1e', '#2e5428', '#467038']), root: mat(['#4a4032', '#6e604a', '#8e7e62']),
};
function mangrove(): Vox {
  const V = new Vox(-6, 6, -6, 6, 12);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * 6.283 + 0.5, r = 4 + (k % 3) * 0.7, fx = Math.round(Math.cos(a) * r), fy = Math.round(Math.sin(a) * r);
    const mx = Math.round(Math.cos(a) * r * 0.7), my = Math.round(Math.sin(a) * r * 0.7);
    V.line([fx, fy, 0], [mx, my, 3], MG.root); V.line([mx, my, 3], [0, 0, 5], MG.root);
  }
  V.box(0, 0, 0, 0, 3, 7, MG.root);
  sphere(V, 0, 0, 8.5, 3.6, MG.leaf, TM.leaf, 51); sphere(V, 2, 1, 7.5, 2.4, MG.leaf, TM.needle, 52); sphere(V, -2, -1, 7.8, 2.2, TM.leaf, MG.leaf, 53);
  return V.finalize();
}
// ---------- island-theme flora: blossom, maple, birch clumps, willows, bamboo, giant fungi, flower patches, reeds, cacti ----------
const TT = {
  blossom: mat(['#b4587a', '#e88aa8', '#ffc2d4']), blossom2: mat(['#c87c9a', '#f6b6ca', '#ffe4ee']), darkbark: mat(['#2a1c1e', '#3e2a2a', '#584040']),
  maple: mat(['#7a2018', '#b83a2a', '#e05e40']), maple2: mat(['#a04a14', '#e07c2a', '#ffac54']), maple3: mat(['#9a7618', '#dcae30', '#fcd860']),
  birchLeaf: mat(['#7a9440', '#a8c25a', '#d4e682']), willow: mat(['#4e6e2e', '#729440', '#98b85a']), willow2: mat(['#62843a', '#8aac4e', '#b2cc6c']),
  bamboo: mat(['#4a7a2c', '#6aa03a', '#96c85a']), bambooN: mat(['#34561e', '#466e28', '#5a8434']),
  stem: mat(['#a89a88', '#d8ccb8', '#f2eadc']), capTeal: mat(['#1e5e62', '#2e8a8a', '#4ab8b0']), capPurple: mat(['#4a2a66', '#6e4292', '#9668c0']),
  gillTeal: mat(['#147a68', '#1ea890', '#5ad8c0'], true), gillPurple: mat(['#4a1a8a', '#7434c8', '#a870f0'], true),
  petal: mat(['#b8841a', '#f0bc2c', '#ffe274']), seedhead: mat(['#3a2410', '#5a3818', '#7a5028']), lavender: mat(['#4e3a7c', '#7a5ab2', '#a88ade']),
  reed: mat(['#6a763a', '#8e9a4a', '#b0ba64']), cattail: mat(['#3e2616', '#5c3c22', '#7a5432']), snag: mat(['#55514c', '#7a766e', '#a09c92']),
  cactus: mat(['#2e5a34', '#3e7a44', '#5a9a5a']), cactusD: mat(['#24482a', '#30623a', '#46804a']), cactusF: mat(['#a8405a', '#e0607a', '#ff98aa']),
};
/** An ellipsoid of leaves rx across and rz tall, ragged at the edge; m2 speckled through m1. */
function blob(V: Vox, cx: number, cy: number, cz: number, rx: number, rz: number, m1: number, m2: number, seed: number, mix = 0.3): void {
  for (let z = Math.floor(cz - rz); z <= cz + rz; z++) for (let v = Math.floor(cy - rx); v <= cy + rx; v++) for (let u = Math.floor(cx - rx); u <= cx + rx; u++) {
    if (Math.hypot((u - cx) / rx, (v - cy) / rx, (z - cz) / rz) > 1 - hash01(u * 7 + seed, v * 13 + z, 5) * 0.22) continue;
    V.set(u, v, z, hash01(u + seed, v * 3 + z * 7, 9) < mix ? m2 : m1);
  }
}
/** A scatter of fallen leaves or petals on the ground around the trunk. */
function litter(V: Vox, n: number, r0: number, a: number, b: number, seed: number): void {
  for (let k = 0; k < n; k++) { const t = k * 2.4 + seed, r = r0 + (k % 3) * 0.8; V.set(Math.round(Math.cos(t) * r), Math.round(Math.sin(t) * r), 0, k % 3 ? a : b); }
}
// cherry blossom: a dark forked trunk under a broad, flat pink crown, petals drifting down and lying round it
function blossom(big: boolean): Vox {
  const V = new Vox(-8, 8, -8, 8, 15), s = big ? 1.3 : 1, cz = big ? 10 : 9;
  V.box(0, 0, 0, 0, 0, 5, TT.darkbark); V.set(1, 0, 0, TT.darkbark); V.set(0, -1, 0, TT.darkbark);
  V.line([0, 0, 4], [-3, big ? 1 : -1, cz - 1], TT.darkbark); V.line([0, 0, 5], [3, big ? -1 : 1, cz], TT.darkbark);
  blob(V, -2.6, 0, cz, 3.6 * s, 2.4, TT.blossom, TT.blossom2, 61); blob(V, 2.6, 0.5, cz + 0.5, 3.8 * s, 2.6, TT.blossom, TT.blossom2, 62);
  blob(V, 0, -0.5, cz + 2, 3 * s, 1.9, TT.blossom2, TT.blossom, 63);
  for (const [u, v, z] of big ? [[-5, 3, 5], [6, 2, 4]] : [[5, 3, 5]]) V.set(u, v, z, TT.blossom2);           // petals drifting down
  litter(V, big ? 8 : 6, 2, TT.blossom2, TT.blossom, big ? 2 : 0);
  return V.finalize();
}
// autumn maple: a tall rounded crown of red (or orange and gold), leaves fallen round the foot
function maple(gold: boolean): Vox {
  const V = new Vox(-7, 7, -7, 7, 17), a = gold ? TT.maple2 : TT.maple, b = gold ? TT.maple3 : TT.maple2, cz = gold ? 10 : 9;
  V.box(0, 0, 0, 0, 0, cz - 3, TM.trunk); V.line([0, 0, 4], [-2, 1, 7], TM.trunk); V.line([0, 0, 5], [2, -1, 8], TM.trunk);
  blob(V, 0, 0, cz, gold ? 4.2 : 4.6, gold ? 4.6 : 4, a, b, gold ? 65 : 64, 0.28);
  blob(V, gold ? 1.5 : -1.5, 0.5, cz + (gold ? 3.5 : 3), 2.6, 2.2, a, b, 66, 0.4);
  litter(V, 6, 2, a, b, gold ? 1 : 3);
  return V.finalize();
}
// a clump of three white birches with small, light yellow-green crowns
function birchClump(): Vox {
  const V = new Vox(-5, 5, -5, 5, 16);
  for (const [u, v, h, seed] of [[0, 0, 12, 1], [2, 2, 9, 2], [-2, 1, 10, 3]]) {
    V.box(u, u, v, v, 0, h - 2, BM.bark);
    for (let z = 1 + seed % 2; z < h - 2; z += 3) V.set(u, v, z, TM.trunk);          // the dark marks on the bark
    blob(V, u, v, h, 2.4, 2.6, TT.birchLeaf, TM.leaf2, 67 + seed, 0.25);
  }
  return V.finalize();
}
// weeping willow: a thick low trunk, a dome of leaves and a curtain of strands hanging nearly to the ground
function willow(): Vox {
  const V = new Vox(-7, 7, -7, 7, 13);
  V.box(0, 1, 0, 1, 0, 6, TM.trunk); V.line([0, 0, 5], [-3, 0, 8], TM.trunk); V.line([1, 1, 5], [4, 1, 8], TM.trunk);
  blob(V, 0.5, 0.5, 9.5, 5, 2.4, TT.willow, TT.willow2, 71);
  for (let k = 0; k < 30; k++) {
    const a = k / 30 * 6.283, r = 5.3 + hash01(k, 1, 72) * 0.6, u = Math.round(0.5 + Math.cos(a) * r), v = Math.round(0.5 + Math.sin(a) * r);
    for (let z = 1 + Math.floor(hash01(k, 3, 73) * 4); z <= 9; z++) V.set(u, v, z, (z + k) % 3 ? TT.willow : TT.willow2);
  }
  return V.finalize();
}
// bamboo: a grove of segmented stalks leaning a little outward, sprigs of leaves at the upper nodes
function bamboo(): Vox {
  const V = new Vox(-5, 5, -5, 5, 20);
  for (const [u, v, h] of [[0, 0, 17], [2, 1, 14], [-1, 2, 12], [1, -2, 15], [-2, -1, 18], [3, -1, 10], [-3, 1, 9]]) {
    let x = u, y = v;
    for (let z = 0; z <= h; z++) {
      x = u + Math.round(z * u * 0.035); y = v + Math.round(z * v * 0.035);
      V.set(x, y, z, z % 4 === 3 ? TT.bambooN : TT.bamboo);
      if (z % 4 === 3 && z > h - 9) { const d = (z + u) % 2 ? 1 : -1; V.line([x, y, z], [x + d * 2, y + (v >= 0 ? 1 : -1), z + 1], TM.palm); }
    }
    V.set(x, y, h + 1, TM.palm);
  }
  return V.finalize();
}
/** A giant mushroom: stem, domed cap with pale spots, and a glowing gill band under the rim (lit at night). */
function fungus(V: Vox, cu: number, cv: number, stemH: number, R: number, cap: number, gill: number): void {
  const sr = R > 3 ? 1.3 : 0.7;
  for (let z = 0; z <= stemH; z++) for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) if (Math.hypot(u, v) <= sr + (z < 2 ? 0.6 : 0)) V.set(cu + u, cv + v, z, TT.stem);
  const z0 = stemH + 1, hc = Math.max(2, Math.round(R * 0.55)), Ri = Math.ceil(R);
  for (let v = -Ri; v <= Ri; v++) for (let u = -Ri; u <= Ri; u++) {
    const d = Math.hypot(u, v);
    if (d <= R - 0.4) V.set(cu + u, cv + v, z0, d <= sr ? TT.stem : gill);
    for (let k = 0; k <= hc; k++) if (d <= R * Math.sqrt(1 - (k / (hc + 0.6)) ** 2)) V.set(cu + u, cv + v, z0 + 1 + k, cap);
  }
}
/** Glowing spots (the gill material) over a cap's top, so giant mushrooms read at night from above. */
function capSpots(V: Vox, cap: number, seed: number, spot: number): void {
  V.each((u, v, z, m) => { if (m === cap && !V.get(u, v, z + 1) && hash01(u * 3 + seed, v * 5 + z, 74) < 0.14) V.set(u, v, z, spot); });
}
function mushroom(purple: boolean): Vox {
  const V = new Vox(-7, 7, -7, 7, 15), cap = purple ? TT.capPurple : TT.capTeal, gill = purple ? TT.gillPurple : TT.gillTeal;
  if (purple) { fungus(V, -2, -1, 6, 4.4, cap, gill); fungus(V, 4, 3, 3, 2.6, cap, gill); fungus(V, -4, 5, 1, 1.6, cap, gill); }
  else { fungus(V, 0, 0, 8, 5.6, cap, gill); fungus(V, 4, 3, 2, 2.4, cap, gill); }
  capSpots(V, cap, purple ? 2 : 1, gill);
  return V.finalize();
}
// a patch of sunflowers, their heads turned to the south (toward the camera)
function sunflowers(): Vox {
  const V = new Vox(-7, 7, -4, 5, 14);
  for (const [u, v, h] of [[-4, 0, 9], [0, -1, 11], [4, 1, 8], [1, 3, 6]]) {
    V.box(u, u, v, v, 0, h - 1, TM.leaf); V.set(u - 1, v, 3, TM.leaf2); V.set(u + 1, v, 5, TM.leaf2);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (Math.abs(a) + Math.abs(b) < 4) V.set(u + a, v + 1, h + b, Math.abs(a) <= 1 && Math.abs(b) <= 1 ? TT.seedhead : TT.petal);
  }
  return V.finalize();
}
// lavender in three low rows of rounded bushes
function lavender(): Vox {
  const V = new Vox(-7, 7, -5, 5, 5);
  for (const [v, o] of [[-3, 0], [0, 2], [3, 0]]) for (let cu = -5 + o; cu <= 5; cu += 4) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { V.set(cu + a, v + b, 0, TM.leaf); if (Math.abs(a) + Math.abs(b) < 2) V.set(cu + a, v + b, 1, TM.leaf2); }
    for (const [a, b, z] of [[0, 0, 3], [-1, 0, 2], [1, 0, 2], [0, -1, 2], [0, 1, 2], [-1, -1, 1], [1, 1, 1]]) V.set(cu + a, v + b, z, TT.lavender);
    V.set(cu, v, 2, TM.leaf);
  }
  return V.finalize();
}
// cattails: a clump of reeds, a few carrying brown heads, a couple of blades bent over
function reeds(): Vox {
  const V = new Vox(-4, 4, -4, 4, 10);
  for (let k = 0; k < 14; k++) {
    const a = k * 2.39, r = (k % 5) * 0.8, u = Math.round(Math.cos(a) * r), v = Math.round(Math.sin(a) * r), h = 4 + Math.floor(hash01(k, 5, 75) * 5);
    V.box(u, u, v, v, 0, h, TT.reed);
    if (k % 3 === 0) V.box(u, u, v, v, h - 2, h - 1, TT.cattail);
  }
  V.line([0, 0, 2], [3, 1, 5], TT.reed); V.line([0, 0, 2], [-3, -1, 4], TT.reed);
  return V.finalize();
}
// a bare grey snag, broken-topped, with forked dead limbs
function snag(): Vox {
  const V = new Vox(-5, 5, -5, 5, 14);
  V.box(0, 0, 0, 0, 0, 11, TT.snag); for (const [u, v] of [[1, 0], [-1, 0], [0, 1]]) V.set(u, v, 0, TT.snag);
  V.line([0, 0, 6], [-3, 1, 9], TT.snag); V.line([-3, 1, 9], [-4, 1, 11], TT.snag); V.line([-3, 1, 9], [-2, 2, 11], TT.snag);
  V.line([0, 0, 8], [3, -1, 11], TT.snag); V.line([3, -1, 11], [4, -1, 13], TT.snag); V.line([0, 0, 4], [2, 1, 6], TT.snag);
  return V.finalize();
}
// saguaro: a ribbed column with two upturned arms, a pink flower on top, a barrel cactus at its foot
function cactus(): Vox {
  const V = new Vox(-5, 5, -3, 4, 15), rib = (u: number, v: number) => (u + v) % 2 ? TT.cactus : TT.cactusD;
  for (let z = 0; z <= 12; z++) for (let u = 0; u <= 1; u++) for (let v = 0; v <= 1; v++) V.set(u, v, z, rib(u, v));
  V.box(-2, -1, 0, 1, 5, 5, TT.cactus); for (let z = 5; z <= 10; z++) for (let v = 0; v <= 1; v++) V.set(-2, v, z, rib(-2, v));
  V.box(2, 3, 0, 1, 7, 7, TT.cactus); for (let z = 7; z <= 11; z++) for (let v = 0; v <= 1; v++) V.set(3, v, z, rib(3, v));
  V.set(0, 1, 13, TT.cactusF); V.set(1, 0, 13, TT.cactus);
  V.box(-4, -3, 3, 4, 0, 1, TT.cactusD); V.set(-3, 3, 2, TT.cactusF);
  return V.finalize();
}
// (append new kinds: tiles cache trees by index into this list)
export const TREE_KINDS = ['pine', 'pineB', 'round', 'roundB', 'palm', 'snowpine', 'snowpineB', 'rock', 'bush', 'berrybush', 'boulders',
  'birch', 'deadtree', 'ashbush', 'fern', 'mangrove',
  'blossom', 'blossomB', 'maple', 'mapleB', 'birchW', 'willow', 'bamboo', 'mushroom', 'mushroomB', 'sunflower', 'lavender', 'reeds', 'snag', 'cactus'] as const;
export type TreeKind = typeof TREE_KINDS[number];
export const TREE_BUILD: Record<TreeKind, () => Vox> = { pine: () => pine(false, false), pineB: () => pine(true, false), round: () => round(false), roundB: () => round(true), palm, snowpine: () => pine(false, true), snowpineB: () => pine(true, true), rock,
  bush: () => bush(TM.bloom), berrybush: () => bush(TM.berry), boulders, birch, deadtree, ashbush, fern, mangrove,
  blossom: () => blossom(false), blossomB: () => blossom(true), maple: () => maple(false), mapleB: () => maple(true), birchW: birchClump, willow, bamboo,
  mushroom: () => mushroom(false), mushroomB: () => mushroom(true), sunflower: sunflowers, lavender, reeds, snag, cactus };

// ---------- the sea floor: coral, kelp, urchins and stones, drawn under the water by the seabed pass ----------
const SB = {
  pink: mat(['#a8364e', '#e8607a', '#ff9aac']), orange: mat(['#b0501e', '#ee8034', '#ffb46a']), purple: mat(['#5a3a8a', '#8a62c4', '#b898ea']),
  yellow: mat(['#a88a1e', '#e8c446', '#fff08a']), teal: mat(['#1e7a6c', '#3cb4a0', '#7ae8d4']),
  kelp: mat(['#3a3a14', '#5e5a20', '#868232']), urchin: mat(['#24142e', '#3e2650', '#5e3e74']), basalt: mat(['#1e1e22', '#323238', '#4a4a52']),
  shell: mat(['#a89a80', '#e2d6bc', '#fff6e2']), vent: mat(['#a8401a', '#ff8a3a', '#ffd08a'], true),
};
function coralBranch(m: number, seed: number): Vox {
  const V = new Vox(-4, 4, -4, 4, 8);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7 + seed, tx = Math.round(Math.cos(a) * 2.6), ty = Math.round(Math.sin(a) * 2.6), top = 4 + ((k + seed) % 3);
    V.line([0, 0, 0], [tx, ty, top], m); V.line([tx, ty, top], [tx + Math.sign(tx), ty, top + 2], m);
  }
  return V.finalize();
}
function coralDome(m: number): Vox { const V = new Vox(-3, 3, -3, 3, 4); sphere(V, 0, 0, 0.6, 2.6, m, SB.yellow, 31); return V.finalize(); }
function coralTubes(m: number): Vox {
  const V = new Vox(-3, 3, -3, 3, 7);
  for (let k = 0; k < 5; k++) { const u = Math.round(Math.cos(k * 2.4) * 1.6), v = Math.round(Math.sin(k * 2.4) * 1.6); V.box(u, u, v, v, 0, 2 + (k * 3) % 5, m); }
  return V.finalize();
}
// a sea fan: a lacy sheet one voxel thick
function seaFan(m: number): Vox {
  const V = new Vox(-4, 4, 0, 0, 9);
  for (let z = 0; z <= 8; z++) for (let u = -4; u <= 4; u++) if (Math.hypot(u, (z - 4) * 0.9) < 4.4 && (z === 0 ? u === 0 : hash01(u + 9, z, 33) < 0.62)) V.set(u, 0, z, m);
  V.box(0, 0, 0, 0, 0, 3, m);
  return V.finalize();
}
function anemone(): Vox {
  const V = new Vox(-2, 2, -2, 2, 4);
  V.box(-1, 1, -1, 1, 0, 1, SB.teal);
  for (let u = -2; u <= 2; u++) for (let v = -2; v <= 2; v++) if ((u + v) % 2 === 0 && Math.hypot(u, v) < 2.6) V.set(u, v, 2 + ((u * v) & 1), SB.pink);
  return V.finalize();
}
function starfish(m: number): Vox {
  const V = new Vox(-3, 3, -3, 3, 1);
  for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; V.line([0, 0, 0], [Math.round(Math.cos(a) * 2.6), Math.round(Math.sin(a) * 2.6), 0], m); }
  return V.finalize();
}
function clam(): Vox { const V = new Vox(-2, 2, -2, 2, 2); sphere(V, 0, 0, 0, 1.9, SB.shell, SB.purple, 35); return V.finalize(); }
function kelpStrand(tall: number): Vox {
  const V = new Vox(-3, 3, -3, 3, tall + 1);
  for (let z = 0; z <= tall; z++) {
    const u = Math.round(Math.sin(z * 0.45) * 1.2);
    V.set(u, 0, z, SB.kelp);
    if (z > 2 && z % 3 === 0) { V.set(u + 1, 0, z, TM.moss); V.set(u - 1, 0, z + 1, TM.moss); }
  }
  return V.finalize();
}
function urchin(): Vox {
  const V = new Vox(-2, 2, -2, 2, 3);
  sphere(V, 0, 0, 1, 1.3, SB.urchin, SB.urchin, 37);
  for (const [u, v, z] of [[2, 0, 1], [-2, 0, 1], [0, 2, 1], [0, -2, 1], [0, 0, 3], [1, 1, 2], [-1, -1, 2]]) V.set(u, v, z, SB.urchin);
  return V.finalize();
}
function seagrass(): Vox {
  const V = new Vox(-2, 2, -2, 2, 5);
  for (let k = 0; k < 6; k++) { const u = (k % 3) - 1, v = Math.floor(k / 3) * 2 - 1; V.box(u, u, v, v, 0, 2 + (k * 7) % 3, k % 2 ? TM.leaf2 : TM.palm); }
  return V.finalize();
}
function basalt(): Vox {
  const V = new Vox(-3, 3, -3, 3, 7);
  for (let u = -2; u <= 2; u += 2) for (let v = -2; v <= 2; v += 2) if (hash01(u + 5, v + 5, 39) < 0.75) V.box(u, u + 1, v, v + 1, 0, 1 + Math.floor(hash01(u, v, 40) * 6), SB.basalt);
  return V.finalize();
}
function vent(): Vox {
  const V = new Vox(-3, 3, -3, 3, 4);
  sphere(V, 0, 0, 0, 2.6, SB.basalt, M.stone, 41);
  V.box(0, 0, 0, 0, 0, 3, SB.vent); V.set(1, 0, 2, SB.vent);
  return V.finalize();
}
// mangrove channels: a tangle of fallen roots in the mud, a clump of oysters, drifts of fallen leaves
const MS2 = { oyster: mat(['#5e5a54', '#8a867c', '#b4b0a4']), leafy: mat(['#5e4a1a', '#8a6e28', '#b49440']) };
function rootTangle(): Vox {
  const V = new Vox(-4, 4, -4, 4, 3);
  V.line([-4, -1, 0], [0, 0, 2], MG.root); V.line([0, 0, 2], [4, 2, 0], MG.root); V.line([-1, 3, 0], [1, -3, 1], MG.root);
  return V.finalize();
}
function oysters(): Vox {
  const V = new Vox(-2, 2, -2, 2, 2);
  for (const [u, v, z] of [[0, 0, 0], [1, 0, 0], [-1, 1, 0], [0, -1, 0], [0, 0, 1], [1, 1, 1]]) V.set(u, v, z, MS2.oyster);
  return V.finalize();
}
function leaves(): Vox {
  const V = new Vox(-3, 3, -3, 3, 1);
  for (let k = 0; k < 7; k++) V.set(Math.round(Math.cos(k * 2.3) * (1 + k % 3)), Math.round(Math.sin(k * 2.3) * (1 + k % 3)), 0, k % 2 ? MS2.leafy : TM.palm);
  return V.finalize();
}
function pebble(): Vox { const V = new Vox(-2, 2, -2, 2, 2); sphere(V, 0, 0, 0.4, 1.6, M.stone, M.ironp, 43); return V.finalize(); }
function shell(): Vox { const V = new Vox(-1, 1, -1, 1, 1); V.box(-1, 1, 0, 0, 0, 0, SB.shell); V.set(0, 1, 0, SB.shell); V.set(0, 0, 1, SB.shell); return V.finalize(); }
// (append new kinds: tiles cache props by index into this list)
export const BED_KINDS = ['coralPink', 'coralOrange', 'coralPurple', 'domeYellow', 'domePink', 'tubesTeal', 'tubesOrange', 'fanPurple', 'fanPink',
  'anemone', 'starOrange', 'starPink', 'clam', 'kelp', 'kelpTall', 'urchin', 'seagrass', 'basalt', 'vent', 'pebble', 'shell',
  'roots', 'oyster', 'leaves'] as const;
export type BedKind = typeof BED_KINDS[number];
const BED_BUILD: Record<BedKind, () => Vox> = {
  coralPink: () => coralBranch(SB.pink, 1), coralOrange: () => coralBranch(SB.orange, 2), coralPurple: () => coralBranch(SB.purple, 3),
  domeYellow: () => coralDome(SB.yellow), domePink: () => coralDome(SB.pink), tubesTeal: () => coralTubes(SB.teal), tubesOrange: () => coralTubes(SB.orange),
  fanPurple: () => seaFan(SB.purple), fanPink: () => seaFan(SB.pink), anemone, starOrange: () => starfish(SB.orange), starPink: () => starfish(SB.pink),
  clam, kelp: () => kelpStrand(9), kelpTall: () => kelpStrand(14), urchin, seagrass, basalt, vent, pebble, shell,
  roots: rootTangle, oyster: oysters, leaves,
};
export const bedMesh = family<BedKind>(k => 'bed:' + k, k => BED_BUILD[k], 0, true);
// ---------- ice floes: flat rafts of sea ice and the odd small berg, drifting on the far northern sea ----------
const ICE = { top: mat(['#b4cbd6', '#dbe8ee', '#f2f7fa']), side: mat(['#3f7896', '#6aa2bc', '#9ccbdc']) };   // bluish tops, a cold cyan rim
function floe(r: number, seed: number): Vox {
  const R = Math.ceil(r) + 1, V = new Vox(-R, R, -R, R, 2);
  for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
    const a = Math.atan2(v, u), edge = r * (0.75 + 0.35 * hash01(Math.round(a * 3) + seed, seed, 57));
    if (Math.hypot(u, v) <= edge) { V.set(u, v, 0, ICE.side); V.set(u, v, 1, hash01(u + seed, v, 58) < 0.12 ? ICE.side : ICE.top); }
  }
  return V.finalize();
}
function berg(): Vox {
  const V = new Vox(-6, 6, -6, 6, 9);
  for (let z = 0; z <= 8; z++) {
    const r = 5.6 - z * 0.55 + (z % 3 === 1 ? 0.4 : 0), cx = Math.round(Math.sin(z * 0.7) * 0.8);
    for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) if (Math.hypot(u - cx, v * 1.2) <= r - hash01(u * 3 + z, v, 59) * 0.8) V.set(u, v, z, z < 2 ? ICE.side : ICE.top);
  }
  return V.finalize();
}
export const ICE_KINDS = ['floeS', 'floeM', 'floeL', 'berg'] as const;
export type IceKind = typeof ICE_KINDS[number];
const ICE_BUILD: Record<IceKind, () => Vox> = { floeS: () => floe(3, 1), floeM: () => floe(5, 2), floeL: () => floe(7.5, 3), berg };
export const iceMesh = family<IceKind>(k => 'ice:' + k, k => ICE_BUILD[k], 0, true);
export const treeMesh = family<TreeKind>(k => 'tree:' + k, k => TREE_BUILD[k], 0, true);   // trees only turn about the vertical

// ---------- island-theme props: rocks and ruins, flotsam, ice, crystals and fishers' huts ----------
// Built with z = 0 at the ground (or the waterline); PROP_Z gives the instance height each wants. Props only turn about the vertical.
const PM = {
  basalt: mat(['#22242a', '#34363e', '#4c505a']), basaltT: mat(['#4a4e58', '#6c707c', '#8e929c']),
  mesa: mat(['#7a3420', '#a84a2c', '#cc6a40']), mesa2: mat(['#9a5a2a', '#c87c42', '#e8a464']), mesa3: mat(['#a8805a', '#d4a878', '#f0c898']),
  chalk: mat(['#aeaa9e', '#dcd8cc', '#f8f6ee']), flint: mat(['#2e3236', '#464c52', '#62686e']), bone: mat(['#b8b4a6', '#e8e4d8', '#fffcf2']),
  pad: mat(['#2a5428', '#3e7436', '#5a9446']), lily: mat(['#c06a8a', '#f0a0bc', '#ffd4e2']), weed: mat(['#4a4418', '#6e6624', '#948a36']),
  bladder: mat(['#8a6a1e', '#c09a32', '#e8c45a']), sulphur: mat(['#9a8a1e', '#d6c43a', '#f4e47a']),
  crystal: mat(['#126a88', '#1a90b0', '#5ac8e0'], true), crystal2: mat(['#3e1688', '#6a2ac0', '#a068e8'], true),
  tar: mat(['#1e1a18', '#2e2824', '#443a32']), tin: mat(['#5a6268', '#7c868c', '#a0aab0']), tinD: mat(['#465056', '#646e74', '#848e94']),
  ice2: mat(['#2e5e80', '#4a86a8', '#78b0cc']), wood: mat(['#8a6236', '#b4874a', '#d3a868']), sailOld: mat(['#8a8676', '#b0aa98', '#d0cab6']),
  glyph: mat(['#0e4a4a', '#16625e', '#2a8a84'], true), lantern: mat(['#801a10', '#b02a18', '#e05030'], true), flame: mat(['#a04010', '#e07020', '#f8b050'], true),
  adobe: mat(['#a8885a', '#d0b07a', '#ecd09a']), adobeR: mat(['#9a5a3a', '#c07a52', '#dc9a70']), dark: mat(['#0e1418', '#141c22', '#1e282e']),
  nest: mat(['#4a3a22', '#6a5430', '#8a7044']), water: mat(['#1e4a66', '#2a6a8a', '#3a8aaa']), spring: mat(['#14706e', '#1e9090', '#40c0b8'], true), wetsand: mat(['#6e5e42', '#8a7856', '#a6946c']), sandbar: mat(['#8a7652', '#ae9868', '#cab486']),
};
/** Fills everything within w of the segment a-b (in plan) from z0 to z1: lintels, fallen stones. */
function slab(V: Vox, a: readonly number[], b: readonly number[], w: number, z0: number, z1: number, m: number): void {
  const du = b[0] - a[0], dv = b[1] - a[1], L2 = du * du + dv * dv || 1;
  for (let v = Math.floor(Math.min(a[1], b[1]) - w); v <= Math.max(a[1], b[1]) + w; v++) for (let u = Math.floor(Math.min(a[0], b[0]) - w); u <= Math.max(a[0], b[0]) + w; u++) {
    const t = Math.max(0, Math.min(1, ((u - a[0]) * du + (v - a[1]) * dv) / L2));
    if (Math.hypot(u - a[0] - du * t, v - a[1] - dv * t) <= w) V.box(u, u, v, v, z0, z1, m);
  }
}
/** A line two voxels thick (masts, bowsprits), so it still reads zoomed out. */
function thick(V: Vox, a: readonly number[], b: readonly number[], m: number): void { V.line(a, b, m); V.line([a[0] + 1, a[1], a[2]], [b[0] + 1, b[1], b[2]], m); }
/** The model mirrored across u = v: what was built along +u now runs along +v (south, toward the camera). */
function transpose(V: Vox): Vox {
  const T = new Vox(V.v0, V.v0 + V.nv - 1, V.u0, V.u0 + V.nu - 1, V.nz);
  V.each((u, v, z, m) => T.set(v, u, z, m));
  return T;
}
/** Height of the highest voxel in a column, or -1. */
function topAt(V: Vox, u: number, v: number): number { for (let z = V.nz - 1; z >= 0; z--) if (V.get(u, v, z)) return z; return -1; }
/** Mosses over the exposed tops of the given materials. */
function mossOver(V: Vox, mats: readonly number[], p: number, seed: number): void {
  V.each((u, v, z, m) => { if (mats.includes(m) && !V.get(u, v, z + 1) && hash01(u * 3 + seed, v * 5 + z, 160) < p) V.set(u, v, z, LK.moss); });
}

// hexagonal basalt columns, tallest in the middle, their joints a step lower
function basaltCols(): Vox {
  const V = new Vox(-8, 8, -8, 8, 12), C: number[][] = [];
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const x = (i + (j & 1) * 0.5) * 3, y = j * 2.6, d = Math.hypot(x, y);
    if (d < 7.2 && hash01(i + 9, j + 9, 91) < 0.95 - d * 0.06) C.push([x, y, Math.max(1, Math.round(10 - d * 1.1 - hash01(i, j, 92) * 3))]);
  }
  for (let v = -8; v <= 8; v++) for (let u = -8; u <= 8; u++) {
    let b1 = 99, b2 = 99, h = 0;
    for (const [x, y, hh] of C) { const d = Math.hypot(u - x, v - y); if (d < b1) { b2 = b1; b1 = d; h = hh; } else if (d < b2) b2 = d; }
    if (b1 > 1.75) continue;
    if (b2 - b1 < 0.7) V.box(u, u, v, v, 0, h - 2, PM.basalt);       // the joints between columns sit two steps lower
    else { V.box(u, u, v, v, 0, h - 1, PM.basalt); V.set(u, v, h, PM.basaltT); }
  }
  return V.finalize();
}
// a tall sea stack: banded rock cut back by the waves, droppings streaking its sides, a gull on her nest on top
function seastack(): Vox {
  const V = new Vox(-7, 7, -7, 7, 25), top = 20;
  for (let z = 0; z <= top; z++) {
    const r = z < 3 ? 4.8 - z * 0.3 : 3.4 + Math.sin(z * 0.45) * 0.5 + (z > top - 4 ? 0.6 : 0), cx = Math.sin(z * 0.21) * 0.8;
    for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) {
      if (Math.hypot(u - cx, v * 1.1) > r - hash01(u + z * 3, v, 93) * 0.9) continue;
      if (z >= 3 && z <= 5 && v > 1 && Math.abs(u - cx) < 1.5) continue;              // a notch the sea has cut in its south face
      V.set(u, v, z, z < 2 ? M.wetp : z === top ? TM.moss : Math.floor(z / 3) % 2 ? LK.stone2 : M.stone);
    }
  }
  for (const u of [-1, 2]) for (let z = top - (u > 0 ? 4 : 6); z < top; z++) for (let v = 6; v >= 0; v--) if (V.get(u, v, z)) { V.set(u, v, z, M.white); break; }   // droppings streaking the south face
  for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; V.set(Math.round(Math.cos(a) * 1.8), Math.round(Math.sin(a) * 1.8), top + 1, PM.nest); }
  V.box(-1, 0, 0, 0, top + 1, top + 1, LM.gull); V.set(-1, 0, top + 2, LM.wing); V.set(0, 0, top + 2, LM.gull); V.set(1, 0, top + 2, LM.gull); V.set(2, 0, top + 2, LM.beak);
  return V.finalize();
}
// a desert butte: sheer banded cliffs on a flat top, a skirt of fallen rock at its foot
const BANDS = [PM.mesa, PM.mesa, PM.mesa2, PM.mesa, PM.mesa3, PM.mesa, PM.mesa, PM.mesa2, PM.mesa2, PM.mesa, PM.mesa3, PM.mesa];
function mesaRock(): Vox {
  const V = new Vox(-11, 11, -9, 9, 13), top = 11;
  for (let v = -9; v <= 9; v++) for (let u = -11; u <= 11; u++) {
    const a = Math.atan2(v, u), d = Math.hypot(u / 9.5, v / 7.5) * (0.9 + 0.2 * hash01(Math.round(a * 4) + 20, 0, 96));
    if (d > 1.15) continue;
    const h = d < 0.75 ? top : Math.round((1.15 - d) * 8 * (0.8 + 0.4 * hash01(u >> 1, v >> 1, 98)));
    for (let z = 0; z <= h; z++) V.set(u, v, z, z === top ? PM.mesa3 : BANDS[z] ?? PM.mesa);
  }
  return V.finalize();
}
// a chunk of white chalk cliff with turf on top, flints in its seams, two fallen boulders
function chalkRock(): Vox {
  const V = new Vox(-9, 9, -7, 7, 10);
  for (let v = -6; v <= 6; v++) for (let u = -8; u <= 8; u++) {
    const d = Math.max(Math.abs(u) / 7.5, Math.abs(v) / 5) * 0.6 + Math.hypot(u / 7.5, v / 5) * 0.4 + hash01(u, v >> 1, 100) * 0.08;
    if (d > 1) continue;
    const h = Math.round(d < 0.7 ? 7 + (u < 0 ? 1 : 0) : 7 * (1 - d) / 0.3);
    for (let z = 0; z <= h; z++) V.set(u, v, z, z === h && d < 0.72 ? M.grassm : z % 3 === 1 && hash01(u, v + z * 7, 101) < 0.12 ? PM.flint : PM.chalk);
  }
  sphere(V, 6.5, 5, 0.6, 1.7, PM.chalk, PM.chalk, 102); sphere(V, -7.5, 4, 0.3, 1.3, PM.chalk, PM.flint, 103);
  return V.finalize();
}
/** A standing stone: a slab wt wide and wr deep turned to face angle a, its top rough, moss at its foot. */
function stone(V: Vox, cu: number, cv: number, a: number, h: number, seed: number, wt = 1.6, wr = 0.9): void {
  const c = Math.cos(a), s = Math.sin(a), R = Math.ceil(wt) + 1;
  for (let v = Math.floor(cv) - R; v <= cv + R; v++) for (let u = Math.floor(cu) - R; u <= cu + R; u++) {
    const r = (u - cu) * c + (v - cv) * s, t = -(u - cu) * s + (v - cv) * c;
    if (Math.abs(r) > wr || Math.abs(t) > wt) continue;
    const top = h - (Math.abs(t) > wt - 1 ? 1 : 0) - (hash01(u, v, 105 + seed) < 0.3 ? 1 : 0);
    for (let z = 0; z <= top; z++) V.set(u, v, z, z === 0 && hash01(u, v, 106) < 0.6 ? LK.moss : z === top && hash01(u + 3, v, 107) < 0.35 ? LK.moss : (z >> 1) % 2 ? LK.stone2 : M.stone);
  }
}
function standingStones(): Vox {
  const V = new Vox(-9, 9, -9, 9, 10);
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * 6.283 + 0.3, cu = Math.cos(a) * 6, cv = Math.sin(a) * 6;
    if (k === 3) slab(V, [cu - Math.sin(a) * 2.5, cv + Math.cos(a) * 2.5], [cu + Math.sin(a) * 2.5, cv - Math.cos(a) * 2.5], 1, 0, 1, M.stone);   // one has fallen
    else stone(V, cu, cv, a, 5 + Math.floor(hash01(k, 0, 104) * 4), k);
  }
  V.box(-1, 1, -1, 0, 0, 0, LK.stone2);
  return V.finalize();
}
const course = (u: number, z: number) => (z + (u >> 1)) % 2 ? LK.stone2 : M.stone;
// a mossy arch, its east half fallen
function ruinArch(): Vox {
  const V = new Vox(-8, 8, -4, 4, 14);
  V.box(-7, -4, -2, 2, 0, 0, LK.stone2); V.box(3, 6, -2, 2, 0, 0, LK.stone2);
  for (const u0 of [-6, 4]) for (let z = 1; z <= 8; z++) for (let u = u0; u <= u0 + 1; u++) V.box(u, u, -1, 1, z, z, course(u, z));
  for (let z = 8; z <= 13; z++) for (let u = -6; u <= 5; u++) {
    const d = Math.hypot(u + 0.5, (z - 8) * 1.1);
    if (d < 3.6 || d > 6 || (u > 1 && z > 9)) continue;
    V.box(u, u, -1, 1, z, z, course(u, z));
  }
  for (const [u, v, z] of [[6, 3, 0], [7, 2, 0], [2, -3, 0], [7, 3, 1], [-1, 3, 0]]) V.set(u, v, z, M.stone);
  mossOver(V, [M.stone, LK.stone2], 0.4, 1);
  for (const [u, z0] of [[-6, 3], [5, 2]]) for (let z = z0; z <= z0 + 4; z++) V.set(u, 2, z, TM.leaf);   // ivy trailing down the south face
  return V.finalize();
}
// a fluted column snapped off on its plinth, a fallen drum beside it
function ruinColumn(): Vox {
  const V = new Vox(-5, 6, -5, 6, 13);
  V.box(-2, 2, -2, 2, 0, 0, LK.stone2); V.box(-2, 2, -2, 2, 1, 1, M.stone);
  for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) {
    if (Math.hypot(u, v) > 1.9) continue;
    const top = 8 + Math.floor(hash01(u + 5, v + 5, 109) * 4), flute = Math.floor((Math.atan2(v, u) + 4) * 1.6) % 2 ? M.stone : LK.stone2;
    for (let z = 2; z <= top; z++) V.set(u, v, z, flute);
  }
  for (let u = 2; u <= 5; u++) for (let v = 3; v <= 5; v++) for (let z = 0; z <= 2; z++) if (Math.hypot(v - 4, z - 1) <= 1.3) V.set(u, v, z, u === 2 || u === 5 ? LK.stone2 : M.stone);
  mossOver(V, [M.stone, LK.stone2], 0.35, 2);
  return V.finalize();
}
/** A rib: a quarter ellipse from the ground at v = s*rv rising toward the spine at height rz, cut off at angle `cut`. */
function rib(V: Vox, u: number, s: number, rv: number, rz: number, m: number, cut = 1.35): void {
  for (let t = 0; t <= cut; t += 0.03) V.set(u, Math.round(s * rv * Math.cos(t)), Math.round(rz * Math.sin(t)), m);
}
// a whale's ribcage arching out of the sand, spine and skull half buried
function whaleBones(): Vox {
  const V = new Vox(-11, 12, -7, 7, 9);
  for (let u = -9; u <= 6; u++) { V.set(u, 0, 0, PM.bone); if (u % 2 === 0) V.set(u, 0, 1, PM.bone); }
  ([[-5, 0.7], [-2, 0.9], [1, 1], [4, 0.95]] as const).forEach(([u, k], i) => { for (const s of [-1, 1]) if (i || s < 0) rib(V, u, s, 6 * k, 8 * k, PM.bone); });
  V.box(7, 9, -2, 2, 0, 2, PM.bone); V.box(10, 11, -1, 1, 0, 1, PM.bone); V.set(12, 0, 0, PM.bone); V.set(9, -2, 2, PM.dark); V.set(9, 2, 2, PM.dark);
  return transpose(V).finalize();                                         // spine north-south, skull to the south: the ribs read as arches
}
// a drifting log, bark split along the grain, a stub of branch
function driftLog(): Vox {
  const V = new Vox(-8, 8, -3, 3, 5);
  for (let u = -7; u <= 6; u++) for (let v = -2; v <= 2; v++) for (let z = 0; z <= 3; z++) {
    const d = Math.hypot(v, z - 1.4); if (d > 1.7) continue;
    V.set(u, v, z, u === -7 || u === 6 ? (d < 0.8 ? M.plank : PM.wood) : (v + z + 9) % 3 === 0 ? M.wet : TM.trunk);
  }
  V.line([2, 1, 3], [4, 3, 4], TM.trunk); V.set(-3, 0, 3, LK.moss); V.set(-2, 0, 3, LK.moss);
  return V.finalize();
}
// a floating mat of wrack, gold bladders here and there
function weedMat(): Vox {
  const V = new Vox(-8, 8, -6, 6, 2);
  for (let v = -6; v <= 6; v++) for (let u = -8; u <= 8; u++) {
    const a = Math.atan2(v, u), d = Math.hypot(u / 7, v / 5) / (0.8 + 0.3 * hash01(Math.round(a * 3) + 9, 1, 111));
    if (d > 1 || hash01(u, v, 112) < 0.08 + d * 0.2) continue;
    V.set(u, v, 0, hash01(u >> 1, v >> 1, 113) < 0.4 ? SB.kelp : hash01(u, v >> 1, 115) < 0.25 ? TM.moss : PM.weed);
    if (hash01(u, v, 114) < 0.07) V.set(u, v, 1, PM.bladder);
  }
  return V.finalize();
}
// lily pads, notched, one in flower
function lilyPads(): Vox {
  const V = new Vox(-6, 6, -5, 5, 3);
  for (const [cu, cv, r, n] of [[0, 0, 2.6, 0.6], [-4, 2, 1.8, 2.4], [3.5, -2.5, 1.9, 4], [4, 3, 1.4, 1.2], [-3.5, -2.5, 1.5, 5.2]])
    for (let v = -5; v <= 5; v++) for (let u = -6; u <= 6; u++) {
      const d = Math.hypot(u - cu, v - cv), off = Math.abs(((Math.atan2(v - cv, u - cu) - n + 9.42) % 6.283) - 3.14);
      if (d <= r && !(off < 0.45 && d > 0.6)) V.set(u, v, 0, d > r - 0.9 ? PM.pad : TM.leaf2);
    }
  V.box(-1, 1, -1, 1, 1, 1, PM.lily); for (const [u, v] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) V.set(u, v, 2, PM.lily); V.set(0, 0, 2, TT.petal);
  return V.finalize();
}
// a low cone of dark rock round a glowing vent (the steam is particles), sulphur crusting the rim
function steamVent(): Vox {
  const V = new Vox(-6, 6, -6, 6, 6);
  for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) {
    const r = Math.hypot(u, v), d = r / (5 + hash01(u >> 1, v >> 1, 115) * 1.2);
    if (d > 1) continue;
    const top = r < 1.6 ? 1 : Math.round((1 - d) * 5.5);
    for (let z = 0; z <= top; z++) V.set(u, v, z, z < top ? PM.basalt : r < 1.6 ? SB.vent : r < 3 && hash01(u, v, 116) < 0.6 ? PM.sulphur : hash01(u, v, 117) < 0.3 ? PM.basaltT : PM.basalt);
  }
  return V.finalize();
}
// an iceberg: three jagged peaks over a wide skirt, blue crevasses, a cyan band at the waterline
function iceberg(): Vox {
  const V = new Vox(-13, 13, -10, 10, 20), peaks = [[-3, -1, 17, 7], [5, 2, 11, 5.5], [-8, 3, 7, 4]];
  for (let v = -10; v <= 10; v++) for (let u = -13; u <= 13; u++) {
    const a = Math.atan2(v, u), sk = Math.hypot(u / 12, v / 8.5) / (0.85 + 0.25 * hash01(Math.round(a * 3) + 5, 2, 118));
    let h = sk <= 1 ? 1 : -1;
    for (const [pu, pv, ph, pr] of peaks) { const d = Math.hypot(u - pu, v - pv) / pr; if (d < 1) h = Math.max(h, 1 + 3 * Math.round((ph * (1 - d) ** 0.5 + hash01(u >> 2, v >> 2, 119) * 1.5) / 3)); }   // in terraces, so its faces read as big facets
    for (let z = 0; z <= h; z++) V.set(u, v, z, z < 2 ? ICE.side : ICE.top);
  }
  V.each((u, v, z, m) => { if (m === ICE.top && !V.get(u, v + 1, z) && V.get(u, v, z + 1) && hash01(u, 0, 120) < 0.3) V.set(u, v, z, PM.ice2); });   // blue crevasses down the south faces
  return V.finalize();
}
/** A spray of glowing crystal spikes from (cu, cv, z0), scaled by s; `alt` swaps which spikes are violet. */
function crystalSpray(V: Vox, cu: number, cv: number, z0: number, s: number, alt = false): void {
  for (const [bu, bv, du, dv, len, k] of [[0, 0, 0, 0, 10, 0], [1, 1, 0.5, 0.35, 7, 1], [-1, 1, -0.5, 0.3, 6, 0], [1, -1, 0.45, -0.4, 5, 0], [-1, -1, -0.4, -0.45, 7, 1], [2, 0, 0.7, 0, 4, 1]]) {
    const m = (k === 1) !== alt ? PM.crystal2 : PM.crystal, n = Math.max(2, Math.round(len * s));
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = Math.round(cu + bu * s + du * i), v = Math.round(cv + bv * s + dv * i), z = z0 + i;
      V.set(u, v, z, m); if (t < 0.6) { V.set(u + 1, v, z, m); V.set(u, v + 1, z, m); if (t < 0.3) V.set(u + 1, v + 1, z, m); }
    }
  }
}
function crystals(): Vox {
  const V = new Vox(-6, 6, -6, 6, 13);
  blob(V, 0, 0, 0, 5, 2.6, PM.basalt, M.ironp, 121); crystalSpray(V, 0, 0, 1, 1);
  return V.finalize();
}
/** A hut on stilts: platform with a porch to the south, walls, a gabled roof, a ladder down from the porch. */
function stiltHut(V: Vox, u0: number, v0: number, w: number, d: number, wall: number, roofA: number, roofB: number, ridge: number, post = M.post): void {
  const u1 = u0 + w - 1, v1 = v0 + d - 1, dz = 4, cu = (u0 + u1) >> 1;
  for (const u of [u0, u1]) for (const v of [v0, v1 + 2]) V.box(u, u, v, v, 0, dz, post);
  V.box(u0, u1, v0, v1 + 2, dz, dz, M.plank2); for (let u = u0 + 1; u <= u1; u += 2) V.box(u, u, v0, v1 + 2, dz, dz, M.plank);
  walls(V, u0 + 1, u1 - 1, v0 + 1, v1, dz + 1, dz + 4, wall, post);
  V.box(cu, cu, v1, v1, dz + 1, dz + 3, M.door); V.box(u1 - 2, u1 - 2, v1, v1, dz + 3, dz + 3, LK.lit); V.box(u0 + 2, u0 + 2, v1, v1, dz + 3, dz + 3, LK.lit);
  gable(V, u0, u1, v0, v1 + 1, dz + 5, roofA, roofB, ridge);
  for (const u of [cu - 1, cu + 1]) V.box(u, u, v1 + 3, v1 + 3, 0, dz, post);
  for (let z = 1; z < dz; z += 2) V.set(cu, v1 + 3, z, M.plank);
}
function hut(): Vox {
  const V = new Vox(-7, 7, -7, 8, 17);
  stiltHut(V, -5, -5, 11, 8, LK.wall2, LK.thatch, LK.thatchD, LK.thatchD);
  V.box(-5, -5, 4, 4, 5, 8, M.post); V.set(-5, 4, 9, M.lamp);
  basket(V, 3, 3, 5); crate(V, -3, 3, 5);
  return V.finalize();
}
// a tarred net shack with a tin roof, nets drying on racks beside it hung with red and white floats
function netShack(): Vox {
  const V = new Vox(-10, 10, -6, 6, 12);
  walls(V, -8, 0, -4, 2, 0, 5, PM.tar, M.white);
  V.box(-5, -4, 2, 2, 0, 3, M.door); V.box(-2, -2, 2, 2, 2, 3, LK.lit); V.box(-7, -7, 2, 2, 2, 3, LK.lit);
  gable(V, -9, 1, -5, 3, 6, PM.tin, PM.tinD, M.iron);
  for (const u of [3, 7]) { netRack(V, u, -4, 3, 0); for (let v = -3; v <= 2; v += 2) V.set(u, v, 4, v % 4 ? M.redp : M.white); }
  barrel(V, -10, 3, 0); coil(V, 1, 5, 0); crate(V, -7, 4, 0);
  return V.finalize();
}
// a carved post: three painted faces stacked, a thunderbird spreading its wings on top
function totem(): Vox {
  const V = new Vox(-5, 5, -2, 2, 19);
  for (const [z0, band, mouth] of [[0, M.plank, M.redp], [5, LK.verd, M.iron], [10, M.redp, M.white]]) {
    V.box(-1, 1, -1, 0, z0, z0 + 4, band);
    for (const u of [-1, 1]) { V.set(u, 0, z0 + 3, M.white); V.set(u, 0, z0 + 4, M.iron); }
    V.set(0, 1, z0 + 2, band); V.box(-1, 1, 0, 0, z0 + 1, z0 + 1, mouth);
  }
  V.box(-1, 1, -1, 0, 15, 17, LK.verd); V.set(-1, 0, 16, M.white); V.set(1, 0, 16, M.white); V.box(0, 0, 1, 1, 15, 16, M.flag);
  for (const s of [-1, 1]) { for (let i = 2; i <= 5; i++) V.box(s * i, s * i, -1, -1, 14 + (i > 3 ? 1 : 0), 15 + (i > 3 ? 1 : 0), i === 5 ? M.iron : M.redp); }
  return V.finalize();
}
// (append new kinds; the island themes place props by name)
export const PROP_KINDS = ['basalt', 'seastack', 'mesaRock', 'chalkRock', 'standingStones', 'ruinArch', 'ruinColumn', 'whaleBones', 'log', 'weedMat',
  'lilyPad', 'steamVent', 'iceberg', 'crystal', 'hut', 'shack', 'totem'] as const;
export type PropKind = typeof PROP_KINDS[number];
export const PROP_BUILD: Record<PropKind, () => Vox> = { basalt: basaltCols, seastack, mesaRock, chalkRock, standingStones, ruinArch, ruinColumn, whaleBones,
  log: driftLog, weedMat, lilyPad: lilyPads, steamVent, iceberg, crystal: crystals, hut, shack: netShack, totem };
/** The instance z each prop wants: land props stand at 0; water props sink to their waterline (pass it as inst's z). */
export const PROP_Z: Record<PropKind, number> = { basalt: 0, seastack: -2, mesaRock: 0, chalkRock: 0, standingStones: 0, ruinArch: 0, ruinColumn: 0,
  whaleBones: 0, log: -1.2, weedMat: 0, lilyPad: 0, steamVent: 0, iceberg: -1, crystal: 0, hut: -1, shack: 0, totem: 0 };
export const propMesh = family<PropKind>(k => 'prop:' + k, k => PROP_BUILD[k], 0, true);

// ---------- villages: houses in one of four layouts, racks, lamps and a signature piece, styled per island theme ----------
type HouseKind = 'gable' | 'stilt' | 'round' | 'flat' | 'dome' | 'pagoda' | 'mushroom' | 'igloo';
function gableHouse(V: Vox, u0: number, v0: number, w: number, d: number, s: VillageStyle, tall = 4): void {
  const u1 = u0 + w - 1, v1 = v0 + d - 1, cu = (u0 + u1) >> 1;
  walls(V, u0, u1, v0, v1, 0, tall, s.wall, s.post);
  V.box(cu, cu + (w > 9 ? 1 : 0), v1, v1, 0, 2, M.door);
  for (const u of [u0 + 1, u1 - 1]) V.box(u, u, v1, v1, 2, 3, LK.lit);
  gable(V, u0 - 1, u1 + 1, v0 - 1, v1 + 1, tall + 1, ...s.roof);
  V.box(u1 - 2, u1 - 2, v0 + 1, v0 + 1, tall + 1, tall + 3 + ((d + 2) >> 1), M.stone);
}
function roundHut(V: Vox, cu: number, cv: number, r: number, s: VillageStyle): void {
  const R = Math.ceil(r) + 1;
  for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
    const d = Math.hypot(u, v);
    if (d <= r && d > r - 1.3) V.box(cu + u, cu + u, cv + v, cv + v, 0, 3, s.wall);
    for (let k = 0; k <= R + 1; k++) if (d <= r + 1 - k * 0.85) V.set(cu + u, cv + v, 4 + k, k % 2 ? s.roof[1] : s.roof[0]);
  }
  const vf = cv + Math.floor(r); V.box(cu, cu, vf, vf, 0, 2, M.door); V.box(cu - 2, cu - 2, vf - 1, vf - 1, 2, 2, LK.lit);
  V.set(cu, cv, topAt(V, cu, cv) + 1, M.post);
}
function flatHouse(V: Vox, u0: number, v0: number, w: number, d: number, s: VillageStyle, dome: boolean, tall = 4): void {
  const u1 = u0 + w - 1, v1 = v0 + d - 1, cu = (u0 + u1) >> 1;
  V.box(u0, u1, v0, v1, 0, tall, s.wall); V.box(u0, u1, v0, v1, tall + 1, tall + 1, s.roof[0]);
  for (let u = u0; u <= u1; u++) for (const v of [v0, v1]) if ((u - u0) % 3) V.set(u, v, tall + 2, s.roof[1]);
  for (let u = u0 + 1; u < u1; u += 2) V.set(u, v1 + 1, tall, M.post);                              // the ends of the roof beams
  V.box(cu, cu, v1, v1, 0, 2, M.door); for (const u of [u0 + 1, u1 - 1]) V.box(u, u, v1, v1, 2, 3, LK.lit);
  if (dome) { const r = Math.min(w, d) / 2 - 0.5, cv = (v0 + v1) / 2; for (let z = 0; z <= r; z++) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) if (Math.hypot(u - (u0 + u1) / 2, v - cv, z) <= r) V.set(u, v, tall + 1 + z, z === Math.floor(r) ? s.roof[1] : s.roof[0]); }
}
function pagoda(V: Vox, u0: number, v0: number, w: number, d: number, s: VillageStyle, tall = 4): void {
  const u1 = u0 + w - 1, v1 = v0 + d - 1, cu = (u0 + u1) >> 1;
  walls(V, u0, u1, v0, v1, 0, tall, s.wall, s.post);
  V.box(cu, cu, v1, v1, 0, 2, M.door); for (const u of [u0 + 1, u1 - 1]) V.box(u, u, v1, v1, 2, 3, LK.lit);
  V.box(u0 - 2, u1 + 2, v0 - 2, v1 + 2, tall + 1, tall + 1, s.roof[1]);                         // broad eaves, their corners turned up
  for (const u of [u0 - 2, u1 + 2]) for (const v of [v0 - 2, v1 + 2]) V.set(u, v, tall + 2, s.roof[1]);
  gable(V, u0 - 1, u1 + 1, v0 - 1, v1 + 1, tall + 2, s.roof[0], s.roof[0], s.roof[2]);
  const rz = topAt(V, cu, (v0 + v1) >> 1); for (const u of [u0 - 1, u1 + 1]) V.set(u, (v0 + v1) >> 1, rz + 1, s.roof[2]);
  for (const u of [u0 - 2, u1 + 2]) V.set(u, v1 + 2, tall, PM.lantern);
}
function mushroomHouse(V: Vox, cu: number, cv: number, R: number, cap: number, gill: number): void {
  const rs = R - 2.2, Ri = Math.ceil(R);
  for (let v = -Ri; v <= Ri; v++) for (let u = -Ri; u <= Ri; u++) {
    const d = Math.hypot(u, v);
    if (d <= rs) V.box(cu + u, cu + u, cv + v, cv + v, 0, 5, TT.stem);
    if (d <= R - 1 && d > rs) V.set(cu + u, cv + v, 6, gill);
    for (let k = 0; k <= 4; k++) if (d <= R * Math.sqrt(1 - (k / 4.6) ** 2)) V.set(cu + u, cv + v, 7 + k, cap);
  }
  const vf = cv + Math.floor(rs); V.box(cu, cu, vf, vf, 0, 2, M.door); V.box(cu - 2, cu - 2, vf - 1, vf - 1, 3, 3, LK.lit); V.box(cu + 2, cu + 2, vf - 1, vf - 1, 3, 3, LK.lit);
  capSpots(V, cap, cu, gill);
}
function igloo(V: Vox, cu: number, cv: number, r: number): void {
  const R = Math.ceil(r);
  for (let z = 0; z <= R; z++) for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) {
    const d = Math.hypot(u, v, z * 1.05);
    if (d <= r && d > r - 1.4) V.set(cu + u, cv + v, z, (z + Math.floor((Math.atan2(v, u) + 4) * 2.5)) % 2 ? ICE.top : TM.snow);
  }
  V.box(cu - 1, cu + 1, cv + R - 1, cv + R + 2, 0, 2, TM.snow); V.box(cu, cu, cv + R + 2, cv + R + 2, 0, 1, LK.lit);
}
/** Where each layout puts its houses ([u0, v0, w, d, raised by]), its rack, lamps and clutter (barrel, crate, basket), and whether it has the south jetty. */
type Layout = 'row' | 'cluster' | 'stilts' | 'terraced';
const LAYOUTS: Record<Layout, { slots: readonly (readonly number[])[]; rack: readonly number[]; lights: readonly (readonly number[])[]; clutter: readonly (readonly number[])[]; jetty: boolean }> = {
  // a row of houses along the shore, a yard in front of them
  row: { slots: [[-20, -11, 9, 7, 0], [-9, -12, 8, 7, 0], [1, -11, 9, 7, 0], [12, -12, 8, 6, 0]], rack: [-18, 1],
    lights: [[-10, -2, 0], [10, -2, 0], [17, 15, 3]], clutter: [[12, -4, 0], [9, -5, 0], [6, 2, 0]], jetty: true },
  // houses round a well, a fire or a giant toadstool at (-3, -3)
  cluster: { slots: [[-19, -13, 9, 7, 0], [-7, -15, 9, 7, 0], [5, -13, 9, 7, 0], [-20, -3, 7, 6, 0]], rack: [5, 0],
    lights: [[-9, -1, 0], [3, -5, 0], [17, 15, 3]], clutter: [[14, -6, 0], [16, -4, 0], [1, 1, 0]], jetty: true },
  // one house ashore, huts on stilts over the water joined by a boardwalk, a gangway down to the shore
  stilts: { slots: [[-20, -15, 9, 6, 0], [-19, 4, 9, 7, 0], [-6, 4, 9, 7, 0], [7, 4, 9, 7, 0]], rack: [6, -14],
    lights: [[-12, 3, 5], [4, 3, 5], [19, 3, 5]], clutter: [[14, -5, 0], [16, -3, 0], [-14, 2, 5]], jetty: false },
  // two terraces stepping down to the shore, stairs up their east side
  terraced: { slots: [[-19, -15, 9, 6, 6], [-6, -15, 9, 6, 6], [-15, -7, 9, 5, 3], [-3, -7, 8, 5, 3]], rack: [-20, 2],
    lights: [[7, -3, 3], [-9, -9, 6], [17, 15, 3]], clutter: [[13, -4, 0], [13, -1, 0], [7, -6, 3]], jetty: true },
};
/** Builds `draw` into a scratch grid and copies it up by dz (houses standing on terraces). */
function lifted(V: Vox, dz: number, draw: (T: Vox) => void): void {
  const T = new Vox(V.u0, V.u0 + V.nu - 1, V.v0, V.v0 + V.nv - 1, V.nz);
  draw(T); T.each((u, v, z, m) => V.set(u, v, z + dz, m));
}
function house(V: Vox, kind: HouseKind, [u0, v0, w, d, dz]: readonly number[], s: VillageStyle, i: number): void {
  if (dz) { lifted(V, dz, T => house(T, kind, [u0, v0, w, d, 0], s, i)); return; }
  const cu = u0 + (w >> 1), cv = v0 + (d >> 1), r = Math.min(w, d) / 2;
  if (kind === 'gable') gableHouse(V, u0, v0, w, d, s);
  else if (kind === 'stilt') stiltHut(V, u0, v0, w, d - 3, s.wall, ...s.roof, s.post);
  else if (kind === 'round') roundHut(V, cu, cv, r, s);
  else if (kind === 'flat' || kind === 'dome') flatHouse(V, u0, v0, w, d, s, kind === 'dome');
  else if (kind === 'pagoda') pagoda(V, u0 + 1, v0 + 1, w - 2, d - 2, s);
  else if (kind === 'mushroom') mushroomHouse(V, cu, cv, r + 1, i % 2 ? TT.capPurple : TT.capTeal, i % 2 ? TT.gillPurple : TT.gillTeal);
  else igloo(V, cu, cv, r);
}
/** A light that glows at night: an iron lamp post, a red paper lantern on a hook, a torch, or a glowing toadstool. */
function villageLight(V: Vox, u: number, v: number, z: number, kind: VillageStyle['light']): void {
  if (kind === 'lamp') lampPost(V, u, v, z, 4);
  else if (kind === 'paper') { V.box(u, u, v, v, z, z + 5, M.post); V.set(u + 1, v, z + 5, M.post); V.box(u + 1, u + 1, v, v, z + 3, z + 4, PM.lantern); }
  else if (kind === 'torch') { V.box(u, u, v, v, z, z + 3, M.post); V.set(u, v, z + 4, PM.flame); V.set(u, v, z + 5, M.lamp); }
  else { V.box(u, u, v, v, z, z + 2, TT.stem); V.box(u - 1, u + 1, v - 1, v + 1, z + 3, z + 3, TT.gillTeal); V.set(u, v, z + 4, TT.gillTeal); }
}
function campfire(V: Vox, u: number, v: number): void {
  for (const [a, b] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) V.set(u + a, v + b, 0, M.stone);
  V.set(u, v, 0, PM.flame); V.set(u, v, 1, PM.flame); V.set(u, v, 2, M.lamp);
}
// ---- the cluster's centrepieces and each theme's signature piece ----
function well(V: Vox, u: number, v: number): void {
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) V.box(u + a, u + a, v + b, v + b, 0, 1, a || b ? M.stone : PM.water);
  for (const a of [-1, 1]) V.box(u + a, u + a, v, v, 2, 4, M.post);
  V.box(u - 1, u + 1, v, v, 4, 4, M.post); V.set(u, v, 3, M.crate);
  V.box(u - 2, u + 2, v - 1, v + 1, 5, 5, LK.roofD); V.box(u - 2, u + 2, v, v, 6, 6, M.roof);
}
function fireCircle(V: Vox, u: number, v: number): void {
  campfire(V, u, v);
  V.box(u - 3, u - 3, v - 1, v + 1, 0, 0, TM.trunk); V.box(u + 3, u + 3, v - 1, v + 1, 0, 0, TM.trunk); V.box(u - 1, u + 1, v + 3, v + 3, 0, 0, TM.trunk);
}
function orchard(V: Vox, u0: number, v0: number, leaf: number, leaf2: number, trunk: number): void {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const u = u0 + i * 5, v = v0 + j * 5;
    V.box(u, u, v, v, 0, 2, trunk); blob(V, u, v, 4, 2.1, 1.7, leaf, leaf2, 180 + i * 3 + j);
    V.set(u + 2, v + 1, 0, leaf2);                                                 // a few fallen leaves or petals
  }
}
// a white windmill, its four sails turned to the south
function windmill(V: Vox, u: number, v: number): void {
  for (let z = 0; z <= 10; z++) for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) if (Math.hypot(a, b) <= 2.4 - z * 0.04) V.set(u + a, v + b, z, z === 10 ? LK.timber : M.white);
  for (let k = 0; k <= 3; k++) for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) if (Math.hypot(a, b) <= 2.9 - k * 0.9) V.set(u + a, v + b, 11 + k, k % 2 ? LK.thatchD : LK.thatch);
  V.box(u, u, v + 2, v + 2, 0, 2, M.door); V.set(u, v + 2, 6, LK.lit);
  const hv = v + 3; V.set(u, hv, 9, M.post);
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let t = 1; t <= 5; t++) {
    V.set(u + a * t, hv, 9 + b * t, M.post);
    if (t >= 2) V.set(u + a * t + b, hv, 9 + b * t - a, M.sail);
  }
}
/** A low dry-stone wall along a path of points, gaps along its top. */
function stoneWall(V: Vox, pts: readonly (readonly number[])[], m: number, m2: number): void {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = 0; k <= n; k++) {
      const u = Math.round(a[0] + (b[0] - a[0]) * k / n), v = Math.round(a[1] + (b[1] - a[1]) * k / n), r = hash01(u, v, 181);
      V.set(u, v, 0, r < 0.5 ? m : m2); if (r > 0.2) V.set(u, v, 1, r < 0.6 ? m2 : m);
    }
  }
}
function hotSpring(V: Vox, u: number, v: number): void {
  for (let b = -4; b <= 4; b++) for (let a = -4; a <= 4; a++) {
    const d = Math.hypot(a, b);
    if (d <= 2.6) V.set(u + a, v + b, 0, PM.spring);
    else if (d <= 3.9) { V.set(u + a, v + b, 0, PM.basalt); if (hash01(a, b, 182) < 0.5) V.set(u + a, v + b, 1, PM.basaltT); }
  }
}
function woodpile(V: Vox, u: number, v: number): void {
  for (let z = 0; z <= 2; z++) for (let x = 0; x <= 5 - z; x++) V.box(u + x, u + x, v, v + 1, z, z, x === 0 || x === 5 - z ? PM.wood : TM.trunk);
  V.set(u - 2, v, 0, PM.wood);
}
/** A rowing boat laid upside down on two trestles for caulking. */
function upturnedBoat(V: Vox, u0: number, v: number, paint: number): void {
  const T = new Vox(u0, u0 + 9, v - 2, v + 2, 3);
  skiff(T, u0, v, paint);
  for (const u of [u0 + 2, u0 + 7]) for (const b of [-2, 2]) V.box(u, u, v + b, v + b, 0, 2, M.post);
  T.each((u, vv, z, m) => V.set(u, vv, 4 - z, m));
}
// a longship drawn up on the shore: curled prow and stern, a row of painted shields
function longboat(V: Vox, cu: number, cv: number): void {
  hull(V, { cu, cv, yaw: 0, len: 18, beam: 5, depth: 3, roll: 0, pitch: 0, sink: 0, holes: 0, seed: 183, paint: h => h < 1 ? M.post : M.plank });
  for (const s of [-1, 1]) { V.line([cu + s * 8, cv, 2], [cu + s * 10, cv, 6], M.post); V.set(cu + s * 9, cv, 7, M.post); }
  for (let u = cu - 6; u <= cu + 6; u += 2) for (const s of [-1, 1]) V.set(u, cv + s * 2, 3, (u >> 1) % 2 ? M.redp : M.flag);
}
function kayak(V: Vox, cu: number, cv: number, paint: number): void {
  hull(V, { cu, cv, yaw: 0, len: 11, beam: 2.6, depth: 2, roll: 0, pitch: 0, sink: 0, holes: 0, seed: 184, paint: () => paint });
  V.line([cu - 3, cv + 2, 0], [cu + 3, cv + 3, 0], M.oar);
}
function outrigger(V: Vox, cu: number, cv: number, paint: number): void {
  hull(V, { cu, cv, yaw: 0, len: 13, beam: 3, depth: 2, roll: 0, pitch: 0, sink: 0, holes: 0, seed: 185, paint: h => h > 1 ? paint : M.post });
  V.box(cu - 4, cu + 4, cv + 4, cv + 4, 0, 0, M.plank);
  for (const a of [-2, 2]) V.line([a + cu, cv, 2], [a + cu, cv + 4, 1], M.post);
}
/** Basket fish traps set in the water, each marked by a stake. */
function traps(V: Vox, pts: readonly (readonly number[])[]): void {
  for (const [u, v] of pts) { V.box(u, u + 1, v, v + 1, 0, 1, LK.thatchD); V.set(u, v, 1, LK.thatch); V.box(u + 2, u + 2, v, v, 0, 3, M.post); }
}
function paddies(V: Vox): void {
  for (const [u0, u1, v0, v1] of [[-21, -10, 1, 8], [-8, 8, 2, 9]]) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) {
    const bund = u === u0 || u === u1 || v === v0 || v === v1;
    V.set(u, v, 0, bund ? M.floor : PM.water);
    if (!bund && (u + v) % 2 === 0) V.set(u, v, 1, (u * 3 + v) % 5 ? TM.leaf2 : TM.palm);
  }
}
function horno(V: Vox, u: number, v: number): void {
  for (let z = 0; z <= 2; z++) for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) if (Math.hypot(a, b, z * 1.1) <= 2.6) V.set(u + a, v + b, z, PM.adobe);
  V.box(u, u, v + 2, v + 2, 0, 1, PM.dark); V.set(u, v, 3, PM.adobe);
}
function ladder(V: Vox, u: number, v: number, z0: number, h: number): void {
  for (const a of [-1, 1]) V.box(u + a, u + a, v, v, z0, z0 + h, M.post);
  for (let z = z0 + 1; z <= z0 + h; z += 2) V.set(u, v, z, M.plank);
}
function marketStall(V: Vox, u: number, v: number): void {
  for (const [a, b] of [[0, 0], [4, 0], [0, 4], [4, 4]]) V.box(u + a, u + a, v + b, v + b, 0, 4, M.post);
  V.box(u, u + 4, v + 1, v + 3, 2, 2, M.plank); V.set(u + 1, v + 2, 3, M.orange); V.set(u + 3, v + 2, 3, M.fishm); V.set(u + 2, v + 1, 3, LK.flower2);
  for (let a = 0; a <= 4; a++) V.box(u + a, u + a, v, v + 4, 5, 5, a % 2 ? LK.awnR : LK.awnW);
}
interface VillageStyle {
  wall: number; roof: readonly [number, number, number]; post: number; layout: Layout; houses: readonly HouseKind[];
  light: 'lamp' | 'paper' | 'torch' | 'shroom'; rack: 'net' | 'fish' | null; boat: number;
  /** what a cluster gathers round */
  centre?: 'well' | 'fire' | 'shroom';
  /** a terraced village's retaining walls and the terrace tops */
  terrace?: readonly [number, number];
  /** the piece that tells this theme's village apart from above */
  sig?: (V: Vox) => void;
}
const VILLAGES: Record<string, VillageStyle> = {
  pine: { wall: M.plank, roof: [LK.slate, LK.slateD, M.iron], post: M.post, layout: 'row', houses: ['gable', 'gable', 'gable', 'round'], light: 'lamp', rack: 'net', boat: M.skiff,
    sig: V => upturnedBoat(V, -7, 4, M.redp) },
  blossom: { wall: M.white, roof: [LK.slateD, LK.slate, M.iron], post: LK.timber, layout: 'cluster', centre: 'well', houses: ['pagoda', 'pagoda', 'pagoda', 'gable'], light: 'paper', rack: 'fish', boat: M.redp,
    sig: V => orchard(V, -18, 7, TT.blossom, TT.blossom2, TT.darkbark) },
  autumn: { wall: LK.ochre, roof: [M.roof, LK.roofD, M.redp], post: LK.timber, layout: 'cluster', centre: 'fire', houses: ['gable', 'gable', 'round', 'gable'], light: 'lamp', rack: 'fish', boat: M.skiff,
    sig: V => { orchard(V, -18, 7, TT.maple, TT.maple2, TM.trunk); V.box(-5, -4, 8, 9, 0, 1, LK.hay); for (const [u, v] of [[-3, 12], [-1, 13], [-4, 14]]) { V.set(u, v, 0, M.orange); V.set(u, v, 1, TM.leaf); } } },
  birch: { wall: LK.wall2, roof: [LK.thatch, LK.thatchD, LK.thatchD], post: LK.timber, layout: 'row', houses: ['gable', 'round', 'gable', 'gable'], light: 'lamp', rack: 'net', boat: LK.awnB,
    sig: V => { woodpile(V, -6, 2); woodpile(V, -5, 6); } },
  meadow: { wall: M.white, roof: [LK.thatch, LK.thatchD, LK.thatchD], post: LK.timber, layout: 'cluster', centre: 'well', houses: ['gable', 'gable', 'round', 'gable'], light: 'lamp', rack: 'fish', boat: M.redp,
    sig: V => { windmill(V, -14, 7); for (let u = -8; u <= -2; u++) { V.set(u, 13, 0, TM.leaf); V.set(u, 13, 1, u % 2 ? LK.flower : LK.flower2); } } },
  bog: { wall: M.wet, roof: [LK.thatchD, LK.thatch, LK.thatchD], post: M.post, layout: 'stilts', houses: ['round', 'stilt', 'stilt', 'stilt'], light: 'torch', rack: 'fish', boat: M.wetp,
    sig: V => traps(V, [[-15, 13], [-10, 14], [17, 9]]) },
  mangrove: { wall: MG.root, roof: [LK.thatchD, MG.leaf, LK.thatchD], post: M.post, layout: 'stilts', houses: ['gable', 'stilt', 'stilt', 'stilt'], light: 'lamp', rack: 'net', boat: M.skiff,
    sig: V => traps(V, [[-16, 12], [-4, 14], [16, 11]]) },
  chalk: { wall: M.white, roof: [LK.slate, LK.slateD, M.iron], post: PM.flint, layout: 'row', houses: ['gable', 'gable', 'round', 'gable'], light: 'lamp', rack: 'net', boat: LK.awnB,
    sig: V => stoneWall(V, [[-21, 12], [-21, -15], [21, -15], [21, -3]], PM.flint, PM.chalk) },
  bamboo: { wall: TT.bamboo, roof: [LK.thatch, LK.thatchD, LK.thatchD], post: TT.bambooN, layout: 'terraced', terrace: [M.floor, M.grassm], houses: ['pagoda', 'pagoda', 'round', 'pagoda'], light: 'paper', rack: null, boat: M.skiff,
    sig: paddies },
  atoll: { wall: LK.hay, roof: [LK.thatch, LK.thatchD, TM.palm], post: M.post, layout: 'stilts', houses: ['round', 'stilt', 'stilt', 'stilt'], light: 'torch', rack: 'fish', boat: M.orange,
    sig: V => { outrigger(V, -10, -6, M.orange); campfire(V, -8, -11); } },
  dunes: { wall: PM.adobe, roof: [PM.adobe, M.white, M.white], post: PM.adobe, layout: 'cluster', centre: 'well', houses: ['dome', 'flat', 'dome', 'flat'], light: 'torch', rack: 'fish', boat: LK.awnB,
    sig: V => { marketStall(V, -17, 7); marketStall(V, -10, 9); } },
  mesa: { wall: PM.adobeR, roof: [PM.adobeR, PM.mesa, PM.mesa], post: PM.adobeR, layout: 'terraced', terrace: [PM.adobeR, PM.adobe], houses: ['flat', 'flat', 'flat', 'flat'], light: 'torch', rack: 'fish', boat: M.skiff,
    sig: V => { horno(V, -4, 5); ladder(V, -17, -1, 0, 3); ladder(V, 7, -8, 3, 4); } },
  basalt: { wall: PM.basalt, roof: [M.grassm, TM.leaf, TM.moss], post: PM.basaltT, layout: 'cluster', centre: 'fire', houses: ['gable', 'gable', 'gable', 'round'], light: 'lamp', rack: 'fish', boat: M.redp,
    sig: V => stoneWall(V, [[-21, -16], [-21, 14], [-2, 15], [2, 10]], PM.basalt, PM.basaltT) },
  blacksand: { wall: PM.tar, roof: [M.roof, LK.roofD, M.redp], post: M.white, layout: 'row', houses: ['gable', 'gable', 'gable', 'gable'], light: 'lamp', rack: 'net', boat: M.white,
    sig: V => hotSpring(V, -2, 5) },
  fungal: { wall: TT.stem, roof: [TT.capTeal, TT.capPurple, TT.capTeal], post: TT.stem, layout: 'cluster', centre: 'shroom', houses: ['mushroom', 'mushroom', 'mushroom', 'mushroom'], light: 'shroom', rack: 'net', boat: M.skiff,
    sig: V => { for (const [u, v] of [[-17, 8], [-12, 11], [-7, 8], [-15, 13]]) villageLight(V, u, v, 0, 'shroom'); } },
  fjord: { wall: M.redp, roof: [M.grassm, TM.leaf, TM.moss], post: M.white, layout: 'terraced', terrace: [M.stone, M.grassm], houses: ['gable', 'gable', 'gable', 'gable'], light: 'lamp', rack: 'fish', boat: M.white,
    sig: V => longboat(V, -1, 6) },
  glacier: { wall: M.plank, roof: [TM.snow, ICE.top, TM.snow], post: M.post, layout: 'cluster', centre: 'fire', houses: ['igloo', 'gable', 'igloo', 'igloo'], light: 'lamp', rack: 'fish', boat: M.redp,
    sig: V => { kayak(V, -14, 8, M.orange); kayak(V, -13, 13, M.redp); } },
};
export const VILLAGE_THEMES = Object.keys(VILLAGES);
/** A village for an island theme (unknown themes get the pine village). Houses face south (+v), toward the water; the jetty or boardwalk runs out that way. */
export function villageVox(theme: string): Vox {
  const s = VILLAGES[theme] ?? VILLAGES.pine, L = LAYOUTS[s.layout], V = new Vox(-21, 21, -16, 16, 24);
  if (s.terrace) {
    const [side, top] = s.terrace;
    for (const [v0, v1, h] of [[-16, -9, 5], [-8, -2, 2]]) { V.box(-21, 9, v0, v1, 0, h - 1, side); V.box(-21, 9, v0, v1, h, h, top); }
    V.box(10, 11, -9, -8, 0, 5, side); for (let k = 0; k <= 5; k++) V.box(10, 11, -2 - k, -2 - k, 0, k, side);   // stairs up the east side
  }
  s.houses.forEach((k, i) => house(V, k, L.slots[i], s, i));
  if (s.layout === 'cluster') { const c = s.centre ?? 'well'; if (c === 'well') well(V, -3, -3); else if (c === 'fire') fireCircle(V, -3, -3); else { fungus(V, -3, -3, 7, 3.6, TT.capPurple, TT.gillPurple); capSpots(V, TT.capPurple, 7, TT.gillPurple); } }
  if (L.jetty) {
    for (let v = 1; v <= 15; v++) for (let u = 14; u <= 16; u++) V.set(u, v, 2, (v >> 1) % 2 ? M.plank : M.plank2);
    for (let v = 3; v <= 15; v += 4) for (const u of [13, 17]) V.box(u, u, v, v, 0, 3, M.post);
    skiff(V, 3, 12, s.boat); coil(V, 15, 9, 3);
  } else {                                                                                   // the boardwalk over the water and the gangway down to the shore
    V.box(-20, 20, 2, 3, 4, 4, M.plank2); for (let u = -20; u <= 20; u += 2) V.box(u, u, 2, 3, 4, 4, M.plank);
    for (let u = -20; u <= 20; u += 5) for (const v of [2, 3]) V.box(u, u, v, v, 0, 3, M.post);
    for (let v = -12; v <= 1; v++) V.box(-1, 0, v, v, 0, Math.round(1 + 3 * (v + 12) / 13), v === 1 ? M.plank2 : v % 2 ? M.plank : M.plank2);
    skiff(V, 1, 13, s.boat); coil(V, 10, 2, 5);
  }
  const [ru, rv] = L.rack;
  if (s.rack === 'net') { netRack(V, ru, rv, rv + 7, 0); netRack(V, ru + 5, rv, rv + 7, 0); }
  else if (s.rack === 'fish') for (const v of [rv, rv + 4]) {
    V.box(ru, ru, v, v, 0, 4, M.post); V.box(ru + 7, ru + 7, v, v, 0, 4, M.post); V.box(ru, ru + 7, v, v, 5, 5, M.post);
    for (let u = ru + 1; u <= ru + 6; u += 2) V.box(u, u, v, v, 3, 4, M.fishm);
  }
  for (const [u, v, z] of L.lights) villageLight(V, u, v, z, s.light);
  const [b, c, k] = L.clutter; barrel(V, b[0], b[1], b[2]); crate(V, c[0], c[1], c[2]); basket(V, k[0], k[1], k[2]);
  s.sig?.(V);
  return V.finalize();
}
export const villageMesh = family<string>(t => 'village:' + t, t => () => villageVox(t), 0, true);

// ---------- legends: landmark set pieces, up to ~60x50 ----------
interface HullSpec { cu: number; cv: number; yaw: number; len: number; beam: number; depth: number; roll: number; pitch: number; sink: number; holes: number; seed: number; paint?: (h: number) => number }
/**
 * A hull (bow toward local +a) placed at (cu, cv) turned by yaw, rolled, pitched and sunk `sink` voxels; holes stove in at
 * random. Built by sampling every grid voxel back into the hull's frame, so it stays solid at any angle. Returns the
 * hull's local-to-grid mapping for masts and rigging.
 */
function hull(V: Vox, H: HullSpec): (a: number, b: number, h: number) => number[] {
  const c = Math.cos(H.yaw), s = Math.sin(H.yaw), half = H.len / 2, R = Math.ceil(half + H.beam);
  const paint = H.paint ?? ((h: number) => h < 2 ? M.wetp : Math.round(h) % 2 ? M.wet : M.post);
  for (let z = 0; z < V.nz; z++) for (let dv = -R; dv <= R; dv++) for (let du = -R; du <= R; du++) {
    const a = du * c + dv * s, b = -du * s + dv * c, h = z + H.sink - H.roll * b - H.pitch * a, t = a / half;
    if (h < 0 || h > H.depth || Math.abs(t) > 1) continue;
    const hw = H.beam / 2 * (t >= 0 ? Math.pow(1 - t * t, 0.6) : Math.pow(1 - t ** 4, 0.45)) * (0.5 + 0.5 * h / H.depth);
    if (Math.abs(b) > hw + 0.35) continue;
    const shell = Math.abs(b) > hw - 1.1 || h < 1, deck = h > H.depth - 1;
    if (!shell && !deck) continue;
    if (hash01(Math.round(a), Math.round(b * 2 + h * 7), H.seed) < (shell ? H.holes : H.holes * 2 + 0.1)) continue;
    V.set(H.cu + du, H.cv + dv, z, shell ? paint(h) : M.plank2);
  }
  return (a, b, h) => [H.cu + a * c - b * s, H.cv + a * s + b * c, h - H.sink + H.roll * b + H.pitch * a];
}
// a stepped temple sinking into the sea: weed-stained lower tiers, faint glyphs on every step, a broken portico on top
function sunkenTemple(): Vox {
  const V = new Vox(-26, 26, -22, 22, 30), tiers = [[24, 19], [20, 16], [16, 13], [12, 10]];
  tiers.forEach(([hu, hv], k) => {
    const z0 = k * 3;
    for (let z = z0; z <= z0 + 2; z++) for (let v = -hv; v <= hv; v++) for (let u = -hu; u <= hu; u++) {
      if (z === z0 + 2 && (Math.abs(u) === hu || Math.abs(v) === hv) && hash01(u, v, 130 + k) < 0.15) continue;   // crumbled edges
      if (k < 2 && (Math.abs(u) > hu - 3 || Math.abs(v) > hv - 3) && hash01(u >> 2, v >> 2, 134 + k) < 0.3) continue;   // whole blocks fallen away
      V.set(u, v, z, z < 3 ? M.wetp : course(u >> 1, z));
    }
    for (let u = -hu + 3; u <= hu - 3; u += 4) if (Math.abs(u) > 5) {                                               // glyphs along the south face
      const g = Math.floor(hash01(u, k, 131) * 3);
      V.set(u, hv, z0 + 1, PM.glyph); V.set(g === 0 ? u + 1 : u, hv, g === 1 ? z0 + 2 : z0, PM.glyph); if (g === 2) V.set(u - 1, hv, z0 + 1, PM.glyph);
    }
  });
  for (let v = 10; v <= 21; v++) V.box(-3, 3, v, v, 0, 21 - v, v % 2 ? LK.stone2 : M.stone);                   // the great stair
  // the shrine: a dark doorway framed in glyphs, a portico of columns (two broken), a pediment half fallen
  walls(V, -7, 7, -7, 2, 12, 18, M.stone, LK.stone2);
  V.box(-1, 1, 2, 2, 12, 15, PM.dark); for (let z = 12; z <= 16; z += 2) for (const u of [-2, 2]) V.set(u, 2, z, PM.glyph); V.set(0, 2, 16, PM.glyph);
  for (const [u, top] of [[-10, 19], [-6, 15], [4, 19], [8, 13]]) V.box(u, u + 1, 6, 7, 12, top, (u & 2) ? LK.stone2 : M.stone);
  V.box(-11, 6, 3, 8, 20, 20, LK.stone2);
  for (let k = 0; k <= 8; k++) { const w = Math.max(0, Math.round(11 - k * 1.4)); V.box(-w, w, -8, 8, 21 + k, 21 + k, k % 2 ? LK.stone2 : M.stone); }
  V.each((u, v, z) => { if (z >= 21 && u > 2 + Math.floor(hash01(z, v >> 2, 133) * 3)) V.set(u, v, z, 0); });   // its east side has fallen in
  V.each((u, v, z, m) => { if ((m === M.stone || m === LK.stone2) && !V.get(u, v, z + 1) && hash01(u >> 1, v >> 1, 135) < 0.12) V.set(u, v, z, LK.moss); });
  slab(V, [12, 20], [20, 16], 1.2, 0, 1, M.stone); slab(V, [-20, 20], [-15, 21], 1.2, 0, 1, LK.stone2);
  return V.finalize();
}
// a great ring of stones, three lintels still in place, one fallen, a rune glowing faintly on the altar at its heart
function stoneCircle(): Vox {
  const V = new Vox(-18, 18, -18, 18, 14);
  const at = (k: number) => { const a = k / 10 * 6.283 + 0.15; return [Math.cos(a) * 13, Math.sin(a) * 13, a]; };
  for (let k = 0; k < 10; k++) {
    const [cu, cv, a] = at(k);
    if (k === 7) slab(V, [cu, cv], [cu + Math.cos(a) * 6, cv + Math.sin(a) * 6], 1.3, 0, 1, M.stone);
    else stone(V, cu, cv, a, k === 2 || k === 8 || k === 9 ? 7 : 10, k, 1.7, 1.1);
  }
  for (const k of [0, 3, 5]) { const [u1, v1] = at(k), [u2, v2] = at(k + 1); slab(V, [u1, v1], [u2, v2], 1.1, 11, 12, LK.stone2); }
  V.box(-2, 2, -1, 1, 0, 1, LK.stone2); for (const [u, v] of [[-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]]) V.set(u, v, 1, PM.glyph);
  for (const [u, v] of [[6, 5], [-7, 3], [2, -8]]) V.box(u, u + 1, v, v, 0, 0, M.stone);
  return V.finalize();
}
/** A tattered sail hanging under a yard from local a, across b0..b1 at height h. */
function rag(V: Vox, P: (a: number, b: number, h: number) => number[], a: number, b0: number, b1: number, h: number, seed: number): void {
  for (let b = b0; b <= b1; b++) { const n = 1 + Math.floor(hash01(b, seed, 132) * 4); for (let k = 1; k <= n; k++) { const p = P(a, b, h - k); V.set(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), PM.sailOld); } }
}
// four broken hulls in the shallows, masts and a bowsprit poking up, the masthead of a fifth just showing
function wreckGraveyard(): Vox {
  const V = new Vox(-30, 30, -25, 25, 22);
  const A = hull(V, { cu: -12, cv: -6, yaw: 0.35, len: 30, beam: 11, depth: 7, roll: 0.3, pitch: -0.06, sink: 3, holes: 0.12, seed: 141 });
  thick(V, A(4, 0, 6), A(5, 0, 20), M.post); thick(V, A(-6, 0, 6), A(-6.5, 0, 12), M.post);
  V.line(A(4.8, -5, 17), A(4.8, 5, 17), M.post); rag(V, A, 4.8, -4, 4, 17, 1);
  const B = hull(V, { cu: 15, cv: -13, yaw: -0.9, len: 22, beam: 8, depth: 6, roll: -0.55, pitch: 0.05, sink: 3.5, holes: 0.18, seed: 142 });
  thick(V, B(2, 0, 5), B(6, 3, 16), M.post);
  const C = hull(V, { cu: 13, cv: 12, yaw: 2.3, len: 22, beam: 8, depth: 6, roll: 0.1, pitch: 0.8, sink: 6, holes: 0.15, seed: 143 });
  thick(V, C(10, 0, 5), C(15, 0, 7), M.post);
  hull(V, { cu: -17, cv: 15, yaw: -2.6, len: 16, beam: 7, depth: 5, roll: 0.9, pitch: 0, sink: 1, holes: 0.1, seed: 144 });
  thick(V, [0, 6, 0], [1, 6, 15], M.post); V.box(-1, 2, 5, 7, 12, 12, M.post); V.line([-4, 6, 10], [5, 6, 10], M.post);
  slab(V, [4, -16], [8, -14], 0.6, 0, 0, M.plank); slab(V, [-26, -4], [-23, -1], 0.6, 0, 0, M.plank2); barrel(V, -2, 18, 0); crate(V, 22, 4, 0);
  return V.finalize();
}
// a mound of rock ending in a cliff to the south, an arched cave in the cliff, crystals blazing in its mouth and breaking through the slopes
function crystalCave(): Vox {
  const V = new Vox(-22, 22, -17, 17, 20), face = 6;
  for (let v = -17; v <= face; v++) for (let u = -22; u <= 22; u++) {
    const a = Math.atan2(v, u), d = Math.hypot(u / 20, v / 15) / (0.85 + 0.25 * hash01(Math.round(a * 3) + 7, 3, 140));
    if (d > 1) continue;
    const h = Math.round(16 * Math.pow(1 - d * d, 0.7) + hash01(u >> 2, v >> 2, 141) * 2);
    for (let z = 0; z <= h; z++) {
      if (z > 0 && v > -3 && (u / 5.5) ** 2 + (z / 9) ** 2 < 1) continue;                // the tunnel
      V.set(u, v, z, z === h && h > 3 && hash01(u >> 2, v >> 2, 142) < 0.35 ? LK.moss : (z >> 2) % 2 ? LK.stone2 : M.stone);
    }
  }
  // darken the tunnel's walls and floor so the mouth reads as a hole, then fill it with light
  V.each((u, v, z, m) => { if (m !== LK.moss && v > -4 && (u / 6.5) ** 2 + (z / 10) ** 2 < 1) V.set(u, v, z, PM.dark); });
  crystalSpray(V, 0, -2, 1, 0.8); crystalSpray(V, -3, 4, 1, 0.5, true); crystalSpray(V, 3, 5, 1, 0.45);
  crystalSpray(V, -6, 9, 0, 0.4); crystalSpray(V, 5, 10, 0, 0.35, true);                           // spilling out onto the ground in front
  for (const [u, v, s] of [[-10, -4, 0.6], [9, -6, 0.5], [13, 1, 0.4]]) crystalSpray(V, u, v, topAt(V, u, v), s, s > 0.45);
  for (const [u, v] of [[-9, 8], [10, 9], [-14, 7]]) sphere(V, u, v, 0.3, 1.5, M.stone, LK.stone2, u + 40);
  return V.finalize();
}
// a whale's skeleton on a sandbar: skull and jaws, a long spine, ribs arching high, some fallen
function whaleFall(): Vox {
  const V = new Vox(-32, 32, -16, 16, 16);
  for (let v = -16; v <= 16; v++) for (let u = -32; u <= 32; u++) {
    const a = Math.atan2(v, u), d = Math.hypot(u / 30, v / 14) / (0.85 + 0.25 * hash01(Math.round(a * 3) + 3, 4, 150));
    if (d > 1) continue;
    V.set(u, v, 0, d > 0.8 ? PM.wetsand : PM.sandbar); if (d < 0.55) V.set(u, v, 1, PM.sandbar);
  }
  for (let u = -27; u <= 15; u++) { V.set(u, 0, 2, PM.bone); if (u % 2 === 0) { V.box(u, u, -1, 1, 2, 2, PM.bone); if (u > -16) V.set(u, 0, 3, PM.bone); } }
  for (let i = 0; i < 8; i++) {
    const u = -12 + Math.round(i * 3.4), k = 1 - Math.abs(i - 3) * 0.08;
    for (const s of [-1, 1]) {
      if (hash01(i, s + 3, 151) < 0.15) { slab(V, [u, s * 3], [u + 2, s * 11], 0.5, 1, 1, PM.bone); continue; }   // a rib fallen flat
      const cut = hash01(i, s, 152) < 0.3 ? 0.9 : 1.35;
      rib(V, u, s, 10 * k, 12 * k, PM.bone, cut); rib(V, u + 1, s, 10 * k, 12 * k, PM.bone, cut);
    }
  }
  for (let z = 2; z <= 8; z++) for (let v = -5; v <= 5; v++) for (let u = 15; u <= 24; u++) if (((u - 19) / 5) ** 2 + (v / 4.5) ** 2 + ((z - 3) / 3.5) ** 2 <= 1) V.set(u, v, z, PM.bone);
  for (let u = 24; u <= 31; u++) { const w = Math.round(3 * (1 - (u - 24) / 9)); V.box(u, u, -w, w, 2, 3, PM.bone); }
  for (const s of [-1, 1]) for (let u = 15; u <= 31; u++) { const v = s * Math.round(2.5 + 3 * Math.sin(Math.PI * (u - 15) / 20)); V.box(u, u, v, v, 1, 2, PM.bone); }   // the jaws
  for (const s of [-1, 1]) for (let f = 0; f < 3; f++) V.line([9, s * 6, 2], [6 + f * 3, s * (11 + f % 2), 1], PM.bone);
  V.set(21, -4, 4, PM.dark); V.set(21, 4, 4, PM.dark);
  return transpose(V).finalize();
}
// an old ship locked in the pack: dark hull, snow on her deck and yards, icicles, the floe heaved up round her
function iceboundShip(): Vox {
  const V = new Vox(-30, 30, -22, 22, 30);
  for (let v = -22; v <= 22; v++) for (let u = -30; u <= 30; u++) {
    const a = Math.atan2(v, u), d = Math.hypot(u / 28, v / 20) / (0.8 + 0.3 * hash01(Math.round(a * 3) + 1, 5, 160));
    if (d > 1) continue;
    V.set(u, v, 0, ICE.side); V.set(u, v, 1, hash01(u, v, 161) < 0.04 ? PM.ice2 : ICE.top);
    if (d < 0.8 && hash01(u >> 1, v >> 1, 162) < 0.12) V.set(u, v, 2, TM.snow);
  }
  for (const [a, b] of [[[-26, 8], [-6, 15]], [[8, 14], [24, 4]], [[-22, -12], [-8, -17]]]) for (let t = 0; t <= 1; t += 0.08) {
    const u = Math.round(a[0] + (b[0] - a[0]) * t), v = Math.round(a[1] + (b[1] - a[1]) * t);
    V.box(u, u + 1, v, v + 1, 2, 2 + Math.floor(hash01(u, v, 163) * 4), hash01(u, v, 164) < 0.3 ? PM.ice2 : ICE.top);
  }
  const S = hull(V, { cu: 0, cv: -3, yaw: 0.22, len: 34, beam: 11, depth: 8, roll: 0.16, pitch: 0.05, sink: 3, holes: 0.02, seed: 165, paint: h => h > 6 ? M.schband : M.schoon });
  const hullM = [M.schoon, M.schband, M.plank2];
  thick(V, S(16, 0, 7), S(23, 0, 10), M.post);
  for (const [a, top, snapped] of [[-9, 22, 0], [1, 27, 0], [10, 18, 1]]) {
    thick(V, S(a, 0, 7), S(a, 0, top), M.post);
    if (snapped) { thick(V, S(a + 2, 6, 6), S(a + 8, 7, 5), M.post); continue; }
    for (const [h, w] of [[top - 3, 6], [top - 8, 7]]) {
      V.line(S(a, -w, h), S(a, w, h), M.post);
      for (let b = -w; b <= w; b++) { const p = S(a, b, h).map(Math.round); V.set(p[0], p[1], p[2] + 1, TM.snow); if (b % 2 === 0) V.set(p[0], p[1], p[2] - 1, ICE.top); }
    }
    V.line(S(a, 0, top), S(a < 0 ? -16 : 16, 0, 8), M.rope);
  }
  V.each((u, v, z, m) => { if (hullM.includes(m) && !V.get(u, v, z + 1) && hash01(u, v * 3 + z, 166) < 0.65) V.set(u, v, z + 1, TM.snow); });
  const rim: number[][] = [];
  for (let v = -20; v <= 20; v++) for (let u = -28; u <= 28; u++) if (!V.get(u, v, 2) && hullM.some(m => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => V.get(u + a, v + b, 2) === m))) rim.push([u, v]);
  for (const [u, v] of rim) V.box(u, u, v, v, 2, 2 + Math.floor(hash01(u, v, 167) * 2), ICE.top);
  return V.finalize();
}
// (append new kinds; the island themes place legends by name)
export const LEGEND_KINDS = ['sunkenTemple', 'stoneCircle', 'wreckGraveyard', 'crystalCave', 'whaleFall', 'iceboundShip'] as const;
export type LegendKind = typeof LEGEND_KINDS[number];
export const LEGEND_BUILD: Record<LegendKind, () => Vox> = { sunkenTemple, stoneCircle, wreckGraveyard, crystalCave, whaleFall, iceboundShip };
/** The instance z each legend wants (the temple stands half drowned; wrecks, whale bar and ice sit at the waterline). */
export const LEGEND_Z: Record<LegendKind, number> = { sunkenTemple: -4, stoneCircle: 0, wreckGraveyard: -0.6, crystalCave: 0, whaleFall: -0.5, iceboundShip: -0.5 };
export const legendMesh = family<string>(k => 'legend:' + k, k => LEGEND_BUILD[k as LegendKind] ?? stoneCircle, 0, true);

// ---------- fish: each species' sprite extruded into a two-voxel-thick slab ----------
const matCache = new Map<string, number>();
// a material ramp around one sprite colour: 70% for shadow, 115% for lit; glowing ramps shine at night
function matFor(c: string, glow = false): number {
  const key = glow ? c + '*' : c;
  let m = matCache.get(key);
  if (m === undefined) {
    const [r, g, b] = hex(c);
    m = mat([toHex([r * 0.7, g * 0.7, b * 0.7]), c, toHex([r * 1.15, g * 1.15, b * 1.15])], glow);
    matCache.set(key, m);
  }
  return m;
}
const GOLD_PAL = ['#a47f22', '#f0cf6a', '#fff6d6', '#e2b94a'];
// glow spots (G) always shine; glowing species' fins (F) shine too. `gold`: the species' shape in gold
const fishBuild = (gold: boolean) => (spIdx: number) => () => {
    const sp = SPECIES[spIdx], rows = FISH_T[sp.shape], h = rows.length, w = rows[0].length, glowFins = schoolLook(spIdx).glow, c = gold ? GOLD_PAL : sp.c;
    const col: Record<string, string> = { T: c[0], M: c[1], B: c[2], F: c[3], G: c[3], S: c[0], E: '#1b2a33' };   // sprite letters -> colour
    const V = new Vox(-Math.ceil(w / 2), Math.ceil(w / 2), -1, 1, h + 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rows[j][i]; if (ch === '.') continue;
      const m = matFor(col[ch] || c[1], ch === 'G' || (glowFins && ch === 'F')), u = i - (w >> 1), z = h - 1 - j;
      V.set(u, 0, z, m); if (ch !== 'F') V.set(u, -1, z, m);
    }
    return V.finalize();
};
const plainFish = family<number>(sp => 'fish:' + sp, fishBuild(false)), goldFish = family<number>(sp => 'goldfish:' + sp, fishBuild(true));
export const fishMesh = (spIdx: number, gold = false): Mesh => (gold ? goldFish : plainFish)(spIdx);

// ---------- sea life and props ----------
const LM = { whale: mat(['#26343e', '#34464f', '#4a5c66']), belly: mat(['#6d7780', '#8a949c', '#a9b1b7']), dolphin: mat(['#4a5862', '#66747e', '#86949c']),
  gull: mat(['#c8ccd0', '#eef0f2', '#ffffff']), wing: mat(['#6d7780', '#8a949c', '#b3bbc0']), beak: mat(['#a8822c', '#e2b94a', '#f0cf6a']), levi: mat(['#121c24', '#1c2a34', '#2a3a46']),
  glass: mat(['#2e6a4a', '#4f9a6e', '#8fd0a8']), paper: mat(['#c8b48a', '#e8dcc0', '#fff6e0']), cork: mat(['#6a4a2a', '#8f6a3c', '#b08a5a']) };
function ellipsoid(V: Vox, rx: number, ry: number, rz: number, m: number, belly?: number): void {
  for (let z = 0; z <= rz * 2; z++) for (let v = -Math.ceil(ry); v <= ry; v++) for (let u = -Math.ceil(rx); u <= rx; u++)
    if ((u / rx) ** 2 + (v / ry) ** 2 + ((z - rz) / rz) ** 2 <= 1) V.set(u, v, z, belly && z <= rz * 0.6 ? belly : m);
}
// Humpback, nose toward +u, spine on z = 0 (the renderer pitches/rolls it about the spine). The tail stock and
// fluke are a separate mesh hinged at u = -10 so the tail can beat and lift clear of the water.
const HM = { back: mat(['#18222a', '#25323c', '#384956']), flank: mat(['#3c4a54', '#56666f', '#74848c']),
  pleat: mat(['#9aa4aa', '#c9d0d4', '#eef2f4']), groove: mat(['#545f68', '#6d7780', '#8a949c']), fin: mat(['#a9b3b8', '#d8dfe2', '#f6f8f9']),
  knob: mat(['#10181e', '#1a242c', '#2c3a44']), barn: mat(['#7d8a92', '#a9b4ba', '#ccd4d8']) };
const HUMP: [number, number, number][] = [   // [u, half-width, half-height] along the body
  [-10, 1.0, 1.4], [-6, 1.9, 2.0], [-2, 2.8, 2.4], [3, 3.2, 2.6], [7, 2.9, 2.4], [10, 2.2, 1.9], [12, 1.6, 1.4], [14, 0.9, 0.9]];
// [half-width, half-height] at u, interpolated between the HUMP stations
function profile(P: [number, number, number][], u: number): [number, number] {
  for (let i = 1; i < P.length; i++) if (u <= P[i][0]) {
    const a = P[i - 1], b = P[i], t = (u - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  return [0, 0];
}
function humpback(): Vox {
  const V = new Vox(-10, 14, -12, 12, 10), zc = 4, top = new Map<number, number>();   // (u, v) -> highest body voxel
  for (let u = -10; u <= 14; u++) {
    const [w, h] = profile(HUMP, u), throat = u > -2 && u < 14;
    for (let z = 0; z < 9; z++) for (let v = -4; v <= 4; v++) {
      const dz = z + 0.5 - zc, hz = dz > 0 ? h : h * (throat ? 1.25 : 1);
      if ((v / w) ** 2 + (dz / hz) ** 2 > 1 || (u === 14 && dz > 0)) continue;   // the lower jaw juts past the snout
      let m = HM.back;
      if (dz < -hz * 0.35) m = throat ? (Math.abs(v) % 2 ? HM.groove : HM.pleat) : HM.flank;   // ventral pleats run nose to navel
      else if (dz < 0 && hash01(u, v * 3 + z, 17) < 0.35) m = HM.flank;                     // mottled flanks
      V.set(u, v, z, m); if (!top.has(u * 64 + v) || top.get(u * 64 + v)! < z) top.set(u * 64 + v, z);
    }
  }
  // knobbly head: tubercles along the snout and lower jaw, a few barnacles
  for (let u = 8; u <= 13; u++) for (let v = -2; v <= 2; v++) { const z = top.get(u * 64 + v); if (z !== undefined && hash01(u, v, 23) < 0.42) V.set(u, v, z + 1, hash01(u, v, 29) < 0.5 ? HM.barn : HM.knob); }
  for (let u = 9; u <= 13; u += 2) for (const s of [-1, 1]) V.set(u, s * Math.round(profile(HUMP, u)[0] + 0.3), 2, HM.barn);
  // dorsal hump with its small hooked fin, two-thirds of the way back
  for (let u = -6; u <= -2; u++) V.set(u, 0, top.get(u * 64)! + 1, HM.back);
  V.set(-4, 0, top.get(-4 * 64)! + 2, HM.back); V.set(-5, 0, top.get(-5 * 64)! + 2, HM.back);
  // long white pectoral fins sweeping back from behind the head, scalloped on the leading edge
  for (const s of [-1, 1]) for (let i = 0; i <= 9; i++) {
    const u = Math.round(5 - i * 0.6), v = s * Math.round(2.6 + i * 0.95), z = Math.round(3.2 + i * 0.1), m = i < 2 ? HM.flank : HM.fin;
    V.set(u, v, z, m); if (i < 7) V.set(u - 1, v, z, m); if (i % 2 === 0 && i > 1) V.set(u + 1, v, z, m);
  }
  return V;
}
function humpTail(): Vox {
  const V = new Vox(-10, 0, -8, 8, 3);
  for (let u = 0; u >= -3; u--) { const w = u > -2 ? 1 : 0; for (let v = -w; v <= w; v++) { V.set(u, v, 0, HM.flank); V.set(u, v, 1, HM.back); } V.set(u, 0, 2, HM.back); }   // the narrow tail stock
  for (let a = 0; a <= 7; a++) {
    const le = -3 - a * 0.55, te = (a === 0 ? -5 : -6 - a * 0.42) - (a % 2 ? 0.7 : 0);       // swept leading edge; notched, serrated trailing edge
    for (const s of a ? [-1, 1] : [1]) for (let u = Math.round(le); u >= Math.round(te); u--) {
      V.set(u, s * a, 0, hash01(u, s * a, 31) < 0.22 ? HM.knob : HM.fin);             // white underside, black-patterned
      if (a < 7) V.set(u, s * a, 1, HM.back);
    }
  }
  return V;
}
export const whaleMesh = lazy('humpback', humpback, 4);
export const flukeMesh = lazy('humptail', humpTail, 1);
export const WHALE = { len: 33, joint: -10 };       // mesh length (snout to fluke tips) and the tail hinge, in voxels

// ---------- giants under the boat ----------
const GM = { ray: mat(['#101418', '#1c2228', '#2e363e']), rayW: mat(['#9aa4aa', '#d0d6da', '#eef2f4']), shadow: mat(['#0a1218', '#111c24', '#1a2832']),
  squid: mat(['#4a1626', '#7a2a40', '#a6445e']), squidE: mat(['#1a0a10', '#22101a', '#3a1a2a']), photo: mat(['#127a74', '#1fa89e', '#5ad8cc'], true),
  eel: mat(['#18241e', '#26382e', '#3a5244']), eelB: mat(['#4a5a3a', '#66784e', '#88986a']), eelP: mat(['#1a5a9a', '#2a82c8', '#6ab8f0'], true), eye: mat(['#8a7a20', '#c8b040', '#f0d860'], true) };
// manta: flat diamond with white shoulder patches, horn-like cephalic fins and a whip tail; f picks the wingbeat pose
function manta(f: number): Vox {
  const V = new Vox(-10, 7, -12, 12, 9), zc = 4, flap = Math.sin(f / 4 * Math.PI * 2);
  for (let v = -11; v <= 11; v++) {
    const a = Math.abs(v), le = Math.round(4 - a * 0.42 - (a > 8 ? (a - 8) * 0.5 : 0)), te = Math.round(-3 + a * 0.3 - (a < 3 ? 1 : 0));
    const lift = a > 2 ? Math.round(flap * 2.2 * ((a - 2) / 9) ** 1.5) : 0;
    for (let u = te; u <= le; u++) {
      const z = zc + lift, white = u >= -1 && u <= 1 && a >= 3 && a <= 5;
      V.set(u, v, z, white ? HM.pleat : GM.ray);
      if (a < 6) V.set(u, v, z - 1, GM.rayW);                // white belly under the body
      if (a < 3 && u > -2 && u < 3) V.set(u, v, z + 1, GM.ray);
    }
  }
  for (const s of [-1, 1]) { V.set(5, s * 2, zc, GM.ray); V.set(6, s * 2, zc, GM.ray); V.set(6, s * 2, zc - 1, GM.ray); }
  for (let u = -4; u >= -10; u--) V.set(u, 0, zc, GM.ray);
  return V;
}
// four wingbeat poses, picked by phase
const mantaPose = family<number>(f => 'manta' + f, f => () => manta(f), 4);
export const mantaMesh = (ph: number): Mesh => mantaPose(((Math.floor(ph * 4 / (Math.PI * 2)) % 4) + 4) % 4);
export const MANTA_LEN = 17;
// the vast dark fish that sometimes slides under the boat: just a silhouette, it is always deep
export const shadowFishMesh = lazy('shadowfish', () => {
  const V = new Vox(-20, 20, -8, 8, 7);
  for (let u = -13; u <= 19; u++) { const t = (u + 13) / 32, w = 6 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 + 0.6, h = w * 0.5;
    for (let z = 0; z < 7; z++) for (let v = -7; v <= 7; v++) if ((v / w) ** 2 + ((z + 0.5 - 3) / h) ** 2 <= 1) V.set(u, v, z, GM.shadow); }
  for (let u = -20; u <= -13; u++) { const k = -13 - u; for (let v = -k; v <= k; v++) if (Math.abs(v) > k - 3) V.set(u, v, 3, GM.shadow); }   // forked tail
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) V.set(6 - i, s * (5 + i), 3, GM.shadow);                                            // pectoral fins
  return V;
}, 3);
export const SHADOW_LEN = 40;
// squid: mantle forward, fins at the tip, arms and two long tentacles trailing; photophores glow at night
export const squidMesh = lazy('squid', () => {
  const V = new Vox(-13, 10, -4, 4, 7), zc = 3;
  for (let u = -1; u <= 10; u++) { const r = u < 1 ? 1.6 : u < 5 ? 2.2 : 2.2 - (u - 4) * 0.28;
    for (let z = 0; z < 7; z++) for (let v = -3; v <= 3; v++) { const d = Math.hypot(v, z + 0.5 - zc); if (d > r) continue;
      V.set(u, v, z, d > r - 1 && u > 0 && hash01(u, v * 5 + z, 41) < 0.3 ? GM.photo : GM.squid); } }
  for (let u = 6; u <= 10; u++) for (const s of [-1, 1]) for (let v = 2; v <= 2 + Math.min(u - 6, 10 - u); v++) V.set(u, s * v, zc, GM.squid);   // diamond fins at the tip
  for (const s of [-1, 1]) V.set(0, s * 2, zc, GM.squidE);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; for (let u = -2; u >= -8; u--) { const r = 1.0 + (-2 - u) * 0.3; V.set(u, Math.round(Math.cos(a) * r), Math.round(zc + Math.sin(a) * r * 0.5), u < -6 ? GM.photo : GM.squid); } }
  for (const s of [-1, 1]) { for (let u = -2; u >= -12; u--) V.set(u, s, zc, GM.squid); V.set(-13, s, zc, GM.photo); V.set(-12, s * 2, zc, GM.photo); }
  return V;
}, 3);
export const SQUID_LEN = 23;
// eels are drawn as a chain of segments so the body can undulate; each segment is 4 voxels long
export type EelPart = 'head' | 'seg' | 'tail';
const eelPart = (kind: EelPart) => () => {
  const V = new Vox(-2, 3, -2, 2, 4), zc = 2;
  for (let u = -2; u <= (kind === 'head' ? 3 : 1); u++) { const r = kind === 'tail' ? 1.4 - (1 - u) * 0.25 : kind === 'head' && u > 1 ? 1.0 : 1.4;
    for (let z = 0; z < 4; z++) for (let v = -2; v <= 2; v++) { const dz = z + 0.5 - zc; if (v * v + dz * dz > r * r) continue;
      V.set(u, v, z, dz < -0.5 ? GM.eelB : Math.abs(v) === 1 && Math.abs(dz) < 0.6 && u === 0 ? GM.eelP : GM.eel); } }
  if (kind === 'head') for (const s of [-1, 1]) V.set(2, s, zc, GM.eye);
  if (kind === 'tail') for (let u = -2; u <= 1; u++) V.set(u, 0, zc + 1 + (u < 0 ? 1 : 0), GM.eel);
  return V;
};
export const eelMesh = family<EelPart>(k => 'eel' + k, eelPart, 2);

// jellyfish: a glowing bell (open or squeezed) trailing tentacles; tinted per jelly
const JM = { bell: mat(['#6a7a84', '#8a9ca6', '#b8c8d0'], true), core: mat(['#8a9cb0', '#b8cce0', '#e8f4ff'], true), tent: mat(['#3a4650', '#56646e', '#7a8892']) };
function jelly(squeeze: boolean): Vox {
  const V = new Vox(-3, 3, -3, 3, 9), r = squeeze ? 1.9 : 2.7, hgt = squeeze ? 3 : 2.2, base = 5;
  for (let z = base; z < base + 3; z++) for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) {
    const k = (z - base + 0.5) / hgt; if (k > 1) continue;
    const rr = r * Math.sqrt(1 - k * k); if (Math.hypot(u, v) <= rr) V.set(u, v, z, z === base && Math.hypot(u, v) < 1.2 ? JM.core : JM.bell);
  }
  const tr = squeeze ? 1.2 : 2;                         // dotted, twisting tentacles under the rim
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; for (let z = base - 1; z >= (squeeze ? 1 : 2); z -= 1 + (k & 1)) V.set(Math.round(Math.cos(a + (base - z) * 0.3) * tr), Math.round(Math.sin(a + (base - z) * 0.3) * tr), z, JM.tent); }
  V.set(0, 0, base - 1, JM.core); V.set(0, 0, base - 2, JM.tent);
  return V;
}
export const jellyMesh = family<boolean>(q => 'jelly' + (q ? 1 : 0), q => () => jelly(q), 5);
export const dolphinMesh = lazy('dolphin', () => { const V = new Vox(-6, 6, -2, 2, 5); ellipsoid(V, 4.6, 1.3, 1.2, LM.dolphin, LM.belly); V.set(5, 0, 1, LM.dolphin); V.set(0, 0, 3, LM.dolphin); V.set(-1, 0, 4, LM.dolphin); V.box(-6, -6, -1, 1, 1, 1, LM.dolphin); return V.finalize(); });
export const gullMesh = family<number>(up => 'gull' + up, up => () => { const V = new Vox(-3, 3, -5, 5, 4); V.box(-1, 1, 0, 0, 1, 1, LM.gull); V.set(2, 0, 1, LM.beak); for (let v = 1; v <= 4; v++) { const z = up ? 1 + Math.min(2, v - 1) : 1; V.set(0, v, z, v > 3 ? LM.wing : LM.gull); V.set(0, -v, z, v > 3 ? LM.wing : LM.gull); } return V.finalize(); });
export const leviMesh = lazy('levi', () => { const V = new Vox(-22, 22, -8, 8, 7); ellipsoid(V, 17, 6, 3, LM.levi); for (let u = -22; u <= -16; u++) for (let v = -Math.round((-16 - u) * 0.9); v <= Math.round((-16 - u) * 0.9); v++) V.set(u, v, 3, LM.levi); return V.finalize(); });
export const bobberMesh = lazy('bobber', () => { const V = new Vox(-1, 1, -1, 1, 4); V.box(-1, 1, -1, 1, 0, 0, M.white); V.box(-1, 1, -1, 1, 1, 1, M.redp); V.set(0, 0, 2, M.redp); V.set(0, 0, 3, M.iron); return V.finalize(); });
export const buoyMesh = lazy('buoy', () => { const V = new Vox(-2, 3, -2, 2, 10); V.box(-1, 1, -1, 1, 0, 1, M.redp); V.box(-1, 1, -1, 1, 2, 2, M.white); V.box(0, 0, 0, 0, 3, 8, M.iron); V.box(1, 2, 0, 0, 7, 8, M.redp); V.set(0, 0, 9, M.lamp); return V.finalize(); });

/** After a lost WebGL context is restored: forget every mesh (their buffers died with the context); each rebuilds on next use. */
// ---------- owned islands: the owner's flag on a tall pole, a cottage roofed in the island's colour, bunting ----------
/** Height of the flag's top edge; the pole's gilt cap and lamp sit just above it. */
export const POLE = 47;
const tones = new Map<string, number>();
/** A material for any '#rrggbb' (logo pixels, island colours), made once per colour. */
function toneOf(c: string): number {
  let m = tones.get(c);
  if (m === undefined) { const [r, g, b] = hex(c); tones.set(c, m = mat([toHex([r * 0.72, g * 0.72, b * 0.72]), c, toHex([r * 1.15, g * 1.15, b * 1.15])])); }
  return m;
}
// a string of pennants sagging from a to b
function bunting(V: Vox, a: Vec3, b: Vec3, c: string): void {
  const cols = [M.redp, M.white, toneOf(c), M.gilt], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = Math.round(a[0] + (b[0] - a[0]) * t), v = Math.round(a[1] + (b[1] - a[1]) * t);
    const z = Math.round(a[2] + (b[2] - a[2]) * t - Math.sin(Math.PI * t) * 3);
    V.set(u, v, z, M.rope);
    if (i % 3 === 1) { const m = cols[Math.floor(i / 3) % 4]; V.set(u, v, z - 1, m); V.set(u, v, z - 2, m); }
  }
}
/** How grand an owned island's seat is: the cottage it comes with, then the hall, keep and castle its owner builds. */
export type Seat = 'cottage' | 'hall' | 'keep' | 'castle';
/** How far west of the flagpole (u) and how wide (v) each seat's ground runs: trees keep off it. */
export const SEAT_YARD: Record<Seat, { u0: number; v0: number; v1: number }> = {
  cottage: { u0: -34, v0: -14, v1: 18 }, hall: { u0: -36, v0: -14, v1: 18 }, keep: { u0: -34, v0: -16, v1: 18 }, castle: { u0: -52, v0: -24, v1: 22 },
};
// crenellations along the top of a wall run
function crenels(V: Vox, u0: number, u1: number, v0: number, v1: number, z: number, m: number): void {
  for (let u = u0; u <= u1; u++) for (let v = v0; v <= v1; v++) if ((u === u0 || u === u1 || v === v0 || v === v1) && (u + v) % 2 === 0) V.set(u, v, z, m);
}
// a round-ish tower of radius r at (cu, cv), z0..z1, crenellated, with a cone roof in the island's colour
function tower(V: Vox, cu: number, cv: number, r: number, z0: number, z1: number, roof: number): void {
  for (let u = cu - r; u <= cu + r; u++) for (let v = cv - r; v <= cv + r; v++) if (Math.hypot(u - cu, v - cv) <= r + 0.3) V.box(u, u, v, v, z0, z1, M.stone);
  for (let z = z0 + 3; z < z1; z += 4) V.set(cu, cv + r, z, LK.lit);                                   // arrow slits, lit at night
  for (let k = 0; k <= r + 1; k++) for (let u = cu - r + k; u <= cu + r - k; u++) for (let v = cv - r + k; v <= cv + r - k; v++) V.set(u, v, z1 + 1 + k, roof);
}
/** An owned island's seat west of the flagpole (u < 0), in the island's colour c. */
function seat(V: Vox, kind: Seat, c: string): void {
  const roof = toneOf(c), roofD = toneOf(toHex(hex(c).map(v => v * 0.8)));
  if (kind === 'cottage') { cottage(V, -17, -7, M.white, roof, roofD); return; }
  if (kind === 'hall') {                                                     // a long timbered hall with a chimney
    walls(V, -27, -10, -8, -1, 1, 6, M.white);
    for (let u = -25; u <= -12; u += 4) V.box(u, u, -1, -1, 3, 4, LK.lit);
    V.box(-19, -18, -1, -1, 1, 3, M.door);
    gable(V, -28, -9, -9, 0, 7, roof, roofD);
    V.box(-13, -12, -6, -5, 7, 13, M.stone); V.set(-13, -6, 14, LK.smoke);
    return;
  }
  if (kind === 'keep') {                                                     // a square stone keep, banded in the island's colour
    V.box(-22, -10, -9, 2, 1, 15, M.stone);
    V.box(-22, -10, -9, 2, 11, 11, roof);
    for (let z = 4; z <= 13; z += 4) for (const u of [-19, -13]) V.set(u, 2, z, LK.lit);
    V.box(-17, -15, 2, 2, 1, 3, M.door);
    crenels(V, -22, -10, -9, 2, 16, M.stone);
    V.box(-16, -16, -4, -4, 16, 22, M.post); V.box(-15, -12, -4, -4, 19, 21, roof);   // its own banner on the roof
    return;
  }
  // a castle: a curtain wall with four towers round a keep, a gate on the south side facing the flag
  const wall = (u0: number, u1: number, v0: number, v1: number) => { V.box(u0, u1, v0, v1, 1, 7, M.stone); crenels(V, u0, u1, v0, v1, 8, M.stone); };
  wall(-48, -8, -20, -18); wall(-48, -8, 16, 18); wall(-48, -46, -20, 18); wall(-10, -8, -20, 18);
  V.box(-30, -26, 16, 18, 1, 5, 0); V.box(-30, -26, 18, 18, 1, 5, M.door);  // the gate
  for (const [u, v] of [[-47, -19], [-9, -19], [-47, 17], [-9, 17]]) tower(V, u, v, 3, 1, 12, roof);
  V.box(-36, -20, -12, 6, 1, 20, M.stone);
  for (let z = 5; z <= 18; z += 5) for (const u of [-32, -24]) V.set(u, 6, z, LK.lit);
  crenels(V, -36, -20, -12, 6, 21, M.stone);
  tower(V, -28, -3, 4, 20, 27, roof);
}
/** Pole, seat and bunting for an island of colour c (the flag is separate, so it can sway). Key: 'colour|seat'. */
export const homesteadMesh = family<string>(k => 'homestead:' + k, k => () => {
  const [c, kind] = k.split('|') as [string, Seat], big = kind === 'castle';
  const V = new Vox(big ? -50 : -28, 2, big ? -22 : -10, big ? 20 : 8, POLE + 5);
  seat(V, kind, c);
  V.box(-1, 1, -1, 1, 0, 1, M.stone); V.box(0, 0, 0, 0, 2, POLE + 1, M.post);
  V.set(0, 0, POLE + 2, M.gilt); V.set(0, 0, POLE + 3, M.lamp);
  if (!big) { V.box(-27, -27, 6, 6, 0, 7, M.post); bunting(V, [-18, -1, 8], [-27, 6, 7], c); }
  bunting(V, [0, 1, 30], [-9, -2, 9], c);
  return V.finalize();
}, 0, true);

// ---------- what an owner builds on their island (drawn at world.realmPlots; built facing +u, turned to face the sea) ----------
export type RealmBuilding = 'dock' | 'fishery' | 'market' | 'garden' | 'shipyard';
export const realmMesh = family<string>(k => 'realm:' + k, k => () => {
  const [kind, c] = k.split('|') as [RealmBuilding, string];
  if (kind === 'dock') {                                                     // a pier running out to sea, with a lamp at its end
    const V = new Vox(-4, 26, -4, 4, 9);
    V.box(-4, 26, -2, 2, 1, 1, M.plank); for (let u = -4; u <= 26; u += 2) V.box(u, u, -2, 2, 1, 1, u % 4 ? M.plank : M.plank2);
    for (let u = 0; u <= 26; u += 6) for (const v of [-3, 3]) V.box(u, u, v, v, -4, 2, M.post);
    V.box(26, 26, -3, -3, 2, 3, M.post); lampPost(V, 26, 3, 2, 4); coil(V, 18, -1, 2); barrel(V, 2, -2, 2);
    return V.finalize();
  }
  if (kind === 'fishery') {                                                  // a smokehouse, net racks and a skiff drawn up
    const V = new Vox(-14, 14, -10, 10, 14);
    walls(V, -12, -4, -8, -2, 1, 5, LK.wall2); gable(V, -13, -3, -9, -1, 6, LK.thatch, LK.thatchD);
    V.box(-6, -5, -6, -5, 6, 11, M.stone); V.set(-6, -6, 12, LK.smoke); V.set(-5, -5, 13, LK.smoke);
    netRack(V, 0, -8, -2, 1); netRack(V, 4, -8, -2, 1);
    skiff(V, 2, 5, M.redp); barrel(V, -11, 2, 1); barrel(V, -8, 3, 1); crate(V, -4, 3, 1);
    return V.finalize();
  }
  if (kind === 'market') {                                                   // three stalls under striped awnings
    const V = new Vox(-14, 14, -8, 8, 9), awn = toneOf(c);
    for (const [u, a] of [[-12, awn], [-3, LK.awnW], [6, awn]] as const) {
      for (const [du, dv] of [[0, -4], [6, -4], [0, 3], [6, 3]]) V.box(u + du, u + du, dv, dv, 1, 5, M.post);
      for (let du = -1; du <= 7; du++) for (let dv = -5; dv <= 4; dv++) V.set(u + du, dv, 6 + (dv < 0 ? 0 : 0), (du + 99) % 2 ? a : LK.awnW);
      V.box(u + 1, u + 5, -2, 1, 1, 2, M.plank2); basket(V, u + 1, -1, 3); crate(V, u + 4, -1, 3);
    }
    lampPost(V, -14, 7, 1, 5); lampPost(V, 14, 7, 1, 5);
    return V.finalize();
  }
  if (kind === 'garden') {                                                   // fenced beds of crops and a few fruit trees
    const V = new Vox(-14, 14, -10, 10, 10);
    for (let u = -14; u <= 14; u++) for (const v of [-10, 10]) if (u % 2 === 0) V.box(u, u, v, v, 1, 2, M.post);
    for (let v = -10; v <= 10; v++) for (const u of [-14, 14]) if (v % 2 === 0) V.box(u, u, v, v, 1, 2, M.post);
    for (let v = -7; v <= 7; v += 3) for (let u = -11; u <= 0; u++) V.set(u, v, 1, (u + v) % 3 ? LK.moss : LK.hay);
    for (const [u, v] of [[5, -5], [10, 0], [5, 5]]) { V.box(u, u, v, v, 1, 4, M.post); for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (Math.abs(a) + Math.abs(b) < 4) V.box(u + a, u + a, v + b, v + b, 5, 6, (a + b) % 3 ? LK.moss : LK.flower); }
    return V.finalize();
  }
  // shipyard: a slipway into the sea with a hull taking shape on it, and a gantry over it
  const V = new Vox(-16, 18, -9, 9, 16);
  V.box(-16, 18, -3, 3, 0, 0, M.plank2); for (let u = -16; u <= 18; u += 3) V.box(u, u, -4, 4, 0, 0, M.post);
  for (let u = -10; u <= 8; u += 2) { const w = u < -6 || u > 4 ? 2 : 3; V.box(u, u, -w, -w, 1, 5, M.plank); V.box(u, u, w, w, 1, 5, M.plank); V.box(u, u, -w + 1, w - 1, 1, 1, M.plank); }
  V.box(-10, 8, 0, 0, 1, 1, M.post);
  for (const u of [-13, 11]) for (const v of [-7, 7]) V.box(u, u, v, v, 1, 13, M.post);
  V.box(-13, 11, -7, -7, 13, 13, M.post); V.box(-13, 11, 7, 7, 13, 13, M.post); V.box(-1, -1, -7, 7, 13, 13, M.post);
  V.box(-1, -1, 0, 0, 8, 12, M.rope); crate(V, -15, -8, 1); crate(V, -15, 6, 1, 3);
  return V.finalize();
}, 0, true);
const flagCache = new Map<string, Mesh>();
/**
 * An island's flag, hanging from the pole at u = 0: its 32x32 logo (RGBA, one voxel per pixel, on the island's colour
 * where the logo is clear), or a plain pennant in that colour while there is none; edged gilt on your own island.
 */
export function flagMesh(sig: string, c: string, logo: Uint8ClampedArray | null, mine: boolean): Mesh {
  let m = flagCache.get(sig);
  if (m) { flagCache.delete(sig); flagCache.set(sig, m); return m; }
  const V = new Vox(0, 35, 0, 0, POLE + 1), field = toneOf(c), edge = mine ? M.gilt : M.iron;
  if (logo) {
    for (let u = 1; u <= 34; u++) for (let z = POLE - 33; z <= POLE; z++) V.set(u, 0, z, u === 1 || u === 34 || z === POLE - 33 || z === POLE ? edge : field);
    for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
      const o = (py * 32 + px) * 4;
      if (logo[o + 3] < 128) continue;
      const q = (k: number) => (logo[o + k] >> 4) * 17;                  // 16 levels a channel keeps the materials few
      V.set(px + 2, 0, POLE - 1 - py, toneOf(toHex([q(0), q(1), q(2)])));
    }
  } else {
    const L = 28, mid = POLE - 8;
    for (let u = 1; u <= L; u++) {
      const hh = Math.round(8 * (1 - (u - 1) / L));
      for (let z = mid - hh; z <= mid + hh; z++) V.set(u, 0, z, u === 1 || Math.abs(z - mid) >= hh ? edge : field);
    }
  }
  const g = voxGeometry(V.finalize());
  m = upload(g.verts, g.idx);
  flagCache.set(sig, m);
  while (flagCache.size > 16) {
    const [k, old] = flagCache.entries().next().value!;
    gl.deleteBuffer(old.vbo); gl.deleteBuffer(old.ibo); gl.deleteVertexArray(old.vao); flagCache.delete(k);
  }
  return m;
}

export function reset(): void {
  gen++; cache.clear(); boatCache.clear(); flagCache.clear(); dyn = null; dynReady = false;
  for (const memo of families) memo.clear();
}

// ---------- dynamic thin parts, built in world space every frame ----------
// Boxes are written straight into a reused buffer (no per-frame garbage); each box is 6 faces x 2 triangles.
const BOX_FLOATS = 36 * VERT;
let dynBuf = new Float32Array(BOX_FLOATS * 32), dynN = 0;
let dyn: Mesh | null = null, dynReady = false;   // uploaded since the last dynBegin
const corner = new Float64Array(24);              // the box's 8 corners, xyz each
// faces as corner indices, with the axis (1 = e1, 2 = e2, 3 = e3) and sign of their normal
const BOX_FACES = [[0, 1, 2, 3, -1], [4, 5, 6, 7, 1], [0, 1, 5, 4, -3], [3, 2, 6, 7, 3], [0, 3, 7, 4, -2], [1, 2, 6, 5, 2]];
const CORNER_SIGNS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const QUAD_TRIS = [0, 1, 2, 0, 2, 3];               // a face's two triangles, as positions in its corner list
export function dynBegin(): void { dynN = 0; dynReady = false; }
/** A box of width w from a to b (world space), coloured rgb (0..255); em = 1 makes it glowable. */
export function dynBox(a: readonly number[], b: readonly number[], w: number, rgb: readonly number[], em = 0): void {
  const d0 = b[0] - a[0], d1 = b[1] - a[1], d2 = b[2] - a[2], L = Math.hypot(d0, d1, d2) || 1e-4;
  const e1x = d0 / L, e1y = d1 / L, e1z = d2 / L;
  // a frame around the axis: e2 = e1 x up, e3 = e1 x e2
  const upZ = Math.abs(e1z) < 0.9, ux = upZ ? 0 : 1, uy = 0, uz = upZ ? 1 : 0;   // world up, or +x for near-vertical boxes
  let e2x = e1y * uz - e1z * uy, e2y = e1z * ux - e1x * uz, e2z = e1x * uy - e1y * ux;
  const l2 = Math.hypot(e2x, e2y, e2z);
  e2x /= l2; e2y /= l2; e2z /= l2;
  const e3x = e1y * e2z - e1z * e2y, e3y = e1z * e2x - e1x * e2z, e3z = e1x * e2y - e1y * e2x, hw = w / 2;
  for (let k = 0; k < 8; k++) {
    const p = k < 4 ? a : b, [s2, s3] = CORNER_SIGNS[k & 3], o = k * 3;
    corner[o] = p[0] + (e2x * s2 + e3x * s3) * hw;
    corner[o + 1] = p[1] + (e2y * s2 + e3y * s3) * hw;
    corner[o + 2] = p[2] + (e2z * s2 + e3z * s3) * hw;
  }
  if (dynN + BOX_FLOATS > dynBuf.length) { const t = new Float32Array(dynBuf.length * 2); t.set(dynBuf); dynBuf = t; }
  const r = rgb[0] / 255, g = rgb[1] / 255, bl = rgb[2] / 255, D = dynBuf;
  for (const [i0, i1, i2, i3, ax] of BOX_FACES) {
    const nx = ax === 1 || ax === -1 ? e1x : ax === 2 || ax === -2 ? e2x : e3x;
    const ny = ax === 1 || ax === -1 ? e1y : ax === 2 || ax === -2 ? e2y : e3y;
    const nz = ax === 1 || ax === -1 ? e1z : ax === 2 || ax === -2 ? e2z : e3z;
    const sg = ax < 0;
    for (const q of QUAD_TRIS) {
      const o = (q === 0 ? i0 : q === 1 ? i1 : q === 2 ? i2 : i3) * 3;
      D[dynN] = corner[o]; D[dynN + 1] = corner[o + 1]; D[dynN + 2] = corner[o + 2];
      D[dynN + 3] = sg ? -nx : nx; D[dynN + 4] = sg ? -ny : ny; D[dynN + 5] = sg ? -nz : nz;
      D[dynN + 6] = r; D[dynN + 7] = g; D[dynN + 8] = bl; D[dynN + 9] = em;
      dynN += VERT;
    }
  }
}
// positions are stored relative to (ox, oy) and drawn as an instance there, so thin parts rasterise exactly like
// the hull they hang off (absolute world coordinates lose precision and made oar edges flicker as the camera slid)
// (built once per frame: the shadow and scene passes share the upload)
export function dynMesh(ox = 0, oy = 0): Mesh {
  if (dyn && dynReady) return dyn;
  for (let i = 0; i < dynN; i += VERT) { dynBuf[i] -= ox; dynBuf[i + 1] -= oy; }
  if (!dyn) dyn = upload(dynBuf.subarray(0, dynN), null, true); else refill(dyn, dynBuf, dynN);
  dynReady = true;
  return dyn;
}
