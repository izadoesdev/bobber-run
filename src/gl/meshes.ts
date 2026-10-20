// Voxel models -> GPU meshes (flat-shaded cubes with per-vertex ambient occlusion), plus procedural
// trees, fish, sea life and a per-frame builder for thin dynamic parts (oars, rod, fishing line).
import { Vox, RGB, EMISSIVE, mat, type Vec3 } from '../voxel';
import { M, decorate, eqSig, LIGHTHOUSE, HARBOUR, WRECK, CRATE, type Fit } from '../models';
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
/** Draws n instances (INST floats each, from the start of inst). */
export function drawInstances(mesh: Mesh, inst: Float32Array, n: number): void {
  if (!n || !mesh.count) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, inst, gl.STREAM_DRAW, 0, n * INST);
  gl.bindVertexArray(mesh.vao);
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
// a mesh built on first use and kept: the accessor allocates nothing per call
function lazy(key: string, build: () => Vox, dz = 0): () => Mesh {
  let m: Mesh | null = null, g = -1;
  return () => { if (g !== gen) { m = cached(key, build, dz); g = gen; } return m!; };
}
export const lighthouseMesh = lazy('lighthouse', () => LIGHTHOUSE);
export const harbourMesh = lazy('harbour', () => HARBOUR);
export const wreckMesh = lazy('wreck', () => WRECK);
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
// (append new kinds: tiles cache trees by index into this list)
export const TREE_KINDS = ['pine', 'pineB', 'round', 'roundB', 'palm', 'snowpine', 'snowpineB', 'rock', 'bush', 'berrybush', 'boulders',
  'birch', 'deadtree', 'ashbush', 'fern'] as const;
export type TreeKind = typeof TREE_KINDS[number];
const TREE_BUILD: Record<TreeKind, () => Vox> = { pine: () => pine(false, false), pineB: () => pine(true, false), round: () => round(false), roundB: () => round(true), palm, snowpine: () => pine(false, true), snowpineB: () => pine(true, true), rock,
  bush: () => bush(TM.bloom), berrybush: () => bush(TM.berry), boulders, birch, deadtree, ashbush, fern };

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
function pebble(): Vox { const V = new Vox(-2, 2, -2, 2, 2); sphere(V, 0, 0, 0.4, 1.6, M.stone, M.ironp, 43); return V.finalize(); }
function shell(): Vox { const V = new Vox(-1, 1, -1, 1, 1); V.box(-1, 1, 0, 0, 0, 0, SB.shell); V.set(0, 1, 0, SB.shell); V.set(0, 0, 1, SB.shell); return V.finalize(); }
// (append new kinds: tiles cache props by index into this list)
export const BED_KINDS = ['coralPink', 'coralOrange', 'coralPurple', 'domeYellow', 'domePink', 'tubesTeal', 'tubesOrange', 'fanPurple', 'fanPink',
  'anemone', 'starOrange', 'starPink', 'clam', 'kelp', 'kelpTall', 'urchin', 'seagrass', 'basalt', 'vent', 'pebble', 'shell'] as const;
export type BedKind = typeof BED_KINDS[number];
const BED_BUILD: Record<BedKind, () => Vox> = {
  coralPink: () => coralBranch(SB.pink, 1), coralOrange: () => coralBranch(SB.orange, 2), coralPurple: () => coralBranch(SB.purple, 3),
  domeYellow: () => coralDome(SB.yellow), domePink: () => coralDome(SB.pink), tubesTeal: () => coralTubes(SB.teal), tubesOrange: () => coralTubes(SB.orange),
  fanPurple: () => seaFan(SB.purple), fanPink: () => seaFan(SB.pink), anemone, starOrange: () => starfish(SB.orange), starPink: () => starfish(SB.pink),
  clam, kelp: () => kelpStrand(9), kelpTall: () => kelpStrand(14), urchin, seagrass, basalt, vent, pebble, shell,
};
const bedMeshes: Partial<Record<BedKind, Mesh>> = {};
export const bedMesh = (k: BedKind): Mesh => bedMeshes[k] ??= cached('bed:' + k, BED_BUILD[k], 0, true);
const treeMeshes: Partial<Record<TreeKind, Mesh>> = {};
export const treeMesh = (k: TreeKind): Mesh => treeMeshes[k] ??= cached('tree:' + k, TREE_BUILD[k], 0, true);   // trees only turn about the vertical

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
const fishMeshes: Mesh[] = [], goldMeshes: Mesh[] = [];
const GOLD_PAL = ['#a47f22', '#f0cf6a', '#fff6d6', '#e2b94a'];
// glow spots (G) always shine; glowing species' fins (F) shine too. `gold`: the species' shape in gold
export function fishMesh(spIdx: number, gold = false): Mesh {
  const meshes = gold ? goldMeshes : fishMeshes;
  return meshes[spIdx] ??= cached((gold ? 'goldfish:' : 'fish:') + spIdx, () => {
    const sp = SPECIES[spIdx], rows = FISH_T[sp.shape], h = rows.length, w = rows[0].length, glowFins = schoolLook(spIdx).glow, c = gold ? GOLD_PAL : sp.c;
    const col: Record<string, string> = { T: c[0], M: c[1], B: c[2], F: c[3], G: c[3], S: c[0], E: '#1b2a33' };   // sprite letters -> colour
    const V = new Vox(-Math.ceil(w / 2), Math.ceil(w / 2), -1, 1, h + 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rows[j][i]; if (ch === '.') continue;
      const m = matFor(col[ch] || c[1], ch === 'G' || (glowFins && ch === 'F')), u = i - (w >> 1), z = h - 1 - j;
      V.set(u, 0, z, m); if (ch !== 'F') V.set(u, -1, z, m);
    }
    return V.finalize();
  });
}

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
const mantaMeshes: Mesh[] = [];
export function mantaMesh(ph: number): Mesh {
  const f = ((Math.floor(ph * 4 / (Math.PI * 2)) % 4) + 4) % 4;
  return mantaMeshes[f] ??= cached('manta' + f, () => manta(f), 4);
}
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
const eelMeshes: Partial<Record<EelPart, Mesh>> = {};
export const eelMesh = (kind: EelPart): Mesh => eelMeshes[kind] ??= cached('eel' + kind, eelPart(kind), 2);

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
const jellyMeshes: Mesh[] = [];
export const jellyMesh = (squeeze: boolean): Mesh => jellyMeshes[squeeze ? 1 : 0] ??= cached('jelly' + (squeeze ? 1 : 0), () => jelly(squeeze), 5);
export const dolphinMesh = lazy('dolphin', () => { const V = new Vox(-6, 6, -2, 2, 5); ellipsoid(V, 4.6, 1.3, 1.2, LM.dolphin, LM.belly); V.set(5, 0, 1, LM.dolphin); V.set(0, 0, 3, LM.dolphin); V.set(-1, 0, 4, LM.dolphin); V.box(-6, -6, -1, 1, 1, 1, LM.dolphin); return V.finalize(); });
const gullMeshes: Mesh[] = [];
export const gullMesh = (up: number): Mesh => gullMeshes[up] ??= cached('gull' + up, () => { const V = new Vox(-3, 3, -5, 5, 4); V.box(-1, 1, 0, 0, 1, 1, LM.gull); V.set(2, 0, 1, LM.beak); for (let v = 1; v <= 4; v++) { const z = up ? 1 + Math.min(2, v - 1) : 1; V.set(0, v, z, v > 3 ? LM.wing : LM.gull); V.set(0, -v, z, v > 3 ? LM.wing : LM.gull); } return V.finalize(); });
export const leviMesh = lazy('levi', () => { const V = new Vox(-22, 22, -8, 8, 7); ellipsoid(V, 17, 6, 3, LM.levi); for (let u = -22; u <= -16; u++) for (let v = -Math.round((-16 - u) * 0.9); v <= Math.round((-16 - u) * 0.9); v++) V.set(u, v, 3, LM.levi); return V.finalize(); });
export const bobberMesh = lazy('bobber', () => { const V = new Vox(-1, 1, -1, 1, 4); V.box(-1, 1, -1, 1, 0, 0, M.white); V.box(-1, 1, -1, 1, 1, 1, M.redp); V.set(0, 0, 2, M.redp); V.set(0, 0, 3, M.iron); return V.finalize(); });
export const buoyMesh = lazy('buoy', () => { const V = new Vox(-2, 3, -2, 2, 10); V.box(-1, 1, -1, 1, 0, 1, M.redp); V.box(-1, 1, -1, 1, 2, 2, M.white); V.box(0, 0, 0, 0, 3, 8, M.iron); V.box(1, 2, 0, 0, 7, 8, M.redp); V.set(0, 0, 9, M.lamp); return V.finalize(); });

/** After a lost WebGL context is restored: forget every mesh (their buffers died with the context); each rebuilds on next use. */
export function reset(): void {
  gen++; cache.clear(); boatCache.clear(); dyn = null; dynReady = false;
  for (const memo of [treeMeshes, bedMeshes, eelMeshes] as Record<string, Mesh>[]) for (const k in memo) delete memo[k];
  for (const memo of [fishMeshes, goldMeshes, mantaMeshes, jellyMeshes, gullMeshes]) memo.length = 0;
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
