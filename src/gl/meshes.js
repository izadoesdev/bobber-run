// Voxel models -> GPU meshes (flat-shaded cubes with per-vertex ambient occlusion), plus procedural
// trees, fish, sea life and a per-frame builder for thin dynamic parts (oars, rod, fishing line).
import { Vox, RGB, EMISSIVE, mat } from '../voxel.js';
import { M, decorate, eqSig, LIGHTHOUSE, HARBOUR, WRECK, CRATE, BOAT_MODELS, oarGeom } from '../models.js';
import { SPECIES } from '../econ.js';
import { FISH_T } from '../fishart.js';
import { hash01 } from '../noise.js';
import { hex } from '../config.js';

let gl, instBuf;
const AOL = [0.52, 0.7, 0.86, 1.0];
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export function voxGeometry(V) {
  const out = [], solid = (u, v, z) => V.get(u, v, z) ? 1 : 0;
  V.each((u, v, z, m) => {
    const rgb = RGB[m][1], em = EMISSIVE.has(m) ? 1 : 0;
    for (const n of FACES) {
      if (solid(u + n[0], v + n[1], z + n[2])) continue;
      const t1 = n[0] ? [0, 1, 0] : [1, 0, 0], t2 = n[2] ? [0, 1, 0] : [0, 0, 1];
      const cx = u + n[0] * 0.5, cy = v + n[1] * 0.5, cz = z + 0.5 + n[2] * 0.5, cs = [];
      for (const [s1, s2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = solid(u + n[0] + s1 * t1[0], v + n[1] + s1 * t1[1], z + n[2] + s1 * t1[2]);
        const b = solid(u + n[0] + s2 * t2[0], v + n[1] + s2 * t2[1], z + n[2] + s2 * t2[2]);
        const c = solid(u + n[0] + s1 * t1[0] + s2 * t2[0], v + n[1] + s1 * t1[1] + s2 * t2[1], z + n[2] + s1 * t1[2] + s2 * t2[2]);
        const ao = em ? 3 : a && b ? 0 : 3 - a - b - c;
        cs.push([cx + (s1 * t1[0] + s2 * t2[0]) * 0.5, cy + (s1 * t1[1] + s2 * t2[1]) * 0.5, cz + (s1 * t1[2] + s2 * t2[2]) * 0.5, AOL[ao]]);
      }
      const tri = cs[0][3] + cs[2][3] > cs[1][3] + cs[3][3] ? [0, 1, 2, 0, 2, 3] : [1, 2, 3, 1, 3, 0];
      for (const i of tri) { const c = cs[i]; out.push(c[0], c[1], c[2], n[0], n[1], n[2], rgb[0] / 255 * c[3], rgb[1] / 255 * c[3], rgb[2] / 255 * c[3], em); }
    }
  });
  return new Float32Array(out);
}

// ---------- GPU plumbing ----------
export function init(g, ib) { gl = g; instBuf = ib; }
export function upload(data, dynamic = false) {
  const vao = gl.createVertexArray(), vbo = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  for (let k = 0; k < 3; k++) { gl.enableVertexAttribArray(3 + k); gl.vertexAttribPointer(3 + k, 4, gl.FLOAT, false, 48, k * 16); gl.vertexAttribDivisor(3 + k, 1); }
  gl.bindVertexArray(null);
  return { vao, vbo, count: data.length / 10 };
}
export function refill(mesh, data) { gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); mesh.count = data.length / 10; }
export function drawInstances(mesh, inst, n) {
  if (!n || !mesh.count) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, n * 12), gl.STREAM_DRAW);
  gl.bindVertexArray(mesh.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n); gl.bindVertexArray(null);
}
const cache = new Map();
const cached = (key, build) => { let m = cache.get(key); if (!m) { m = upload(voxGeometry(build())); cache.set(key, m); } return m; };

// ---------- boats (rebuilt when the fitted equipment changes) ----------
const boatCache = new Map();
export function boatMesh(id, eq) {
  const sig = eqSig(id, eq); let m = boatCache.get(sig);
  if (m) { boatCache.delete(sig); boatCache.set(sig, m); return m; }
  m = upload(voxGeometry(decorate(id, eq))); boatCache.set(sig, m);
  while (boatCache.size > 4) { const [k, old] = boatCache.entries().next().value; gl.deleteBuffer(old.vbo); gl.deleteVertexArray(old.vao); boatCache.delete(k); }
  return m;
}
export const lighthouseMesh = () => cached('lighthouse', () => LIGHTHOUSE);
export const harbourMesh = () => cached('harbour', () => HARBOUR);
export const wreckMesh = () => cached('wreck', () => WRECK);
export const crateMesh = () => cached('crate', () => CRATE);

// ---------- procedural voxel trees ----------
const TM = {
  needle: mat(['#24382a', '#33503a', '#4a6a48']), needle2: mat(['#2c4430', '#3f5f3a', '#577a48']), leaf: mat(['#3f6034', '#5a8040', '#78a050']),
  leaf2: mat(['#4a7038', '#6a9446', '#8ab45a']), palm: mat(['#3f6a28', '#5e8e34', '#80b048']), trunk: mat(['#3e2c1e', '#5a4028', '#765638']),
  ptrunk: mat(['#7a5e3a', '#a2804e', '#c4a06a']), snow: mat(['#c8d2d6', '#eef2f4', '#ffffff']), coco: mat(['#3a2818', '#5e4024', '#7a5530']),
};
function sphere(V, cx, cy, cz, r, m1, m2, seed) {
  for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let v = Math.floor(cy - r); v <= cy + r; v++) for (let u = Math.floor(cx - r); u <= cx + r; u++) {
    const d = Math.hypot(u - cx, v - cy, (z - cz) * 1.15); if (d > r - hash01(u * 7 + seed, v * 13 + z, 5) * 0.9) continue;
    V.set(u, v, z, hash01(u + seed, v * 3 + z * 7, 9) < 0.35 ? m2 : m1);
  }
}
function pine(big, snowy) {
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
function round(big) {
  const r = big ? 4.6 : 3.6, V = new Vox(-6, 6, -6, 6, 16), cz = big ? 9 : 7;
  V.box(0, 0, 0, 0, 0, cz - 2, TM.trunk); sphere(V, 0, 0, cz, r, TM.leaf, TM.leaf2, big ? 3 : 1);
  return V.finalize();
}
function palm() {
  const V = new Vox(-8, 8, -8, 8, 16); let x = 0, y = 0;
  for (let z = 0; z <= 11; z++) { V.set(Math.round(x), Math.round(y), z, TM.ptrunk); x += 0.22; y += 0.08; }
  const tx = Math.round(x), ty = Math.round(y);
  for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283 + 0.3; for (let d = 1; d <= 6; d++) V.set(tx + Math.round(Math.cos(a) * d), ty + Math.round(Math.sin(a) * d), 12 - Math.floor(d * d / 9), TM.palm); }
  V.set(tx, ty, 12, TM.palm); V.set(tx + 1, ty, 11, TM.coco); V.set(tx, ty + 1, 11, TM.coco);
  return V.finalize();
}
function rock() { const V = new Vox(-3, 3, -3, 3, 4); sphere(V, 0, 0, 1, 2.4, M.stone, M.ironp, 7); return V.finalize(); }
export const TREE_KINDS = ['pine', 'pineB', 'round', 'roundB', 'palm', 'snowpine', 'snowpineB', 'rock'];
const TREE_BUILD = { pine: () => pine(false, false), pineB: () => pine(true, false), round: () => round(false), roundB: () => round(true), palm, snowpine: () => pine(false, true), snowpineB: () => pine(true, true), rock };
export const treeMesh = k => cached('tree:' + k, TREE_BUILD[k]);

// ---------- fish: each species' sprite extruded into a two-voxel-thick slab ----------
const matCache = new Map();
const matFor = c => { if (!matCache.has(c)) { const [r, g, b] = hex(c), d = x => '#' + x.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); matCache.set(c, mat([d([r * 0.7, g * 0.7, b * 0.7]), c, d([r * 1.15, g * 1.15, b * 1.15])])); } return matCache.get(c); };
export function fishMesh(spIdx) {
  return cached('fish:' + spIdx, () => {
    const sp = SPECIES[spIdx], rows = FISH_T[sp.shape], h = rows.length, w = rows[0].length;
    const col = { T: sp.c[0], M: sp.c[1], B: sp.c[2], F: sp.c[3], G: sp.c[3], S: sp.c[0], E: '#1b2a33' };
    const V = new Vox(-Math.ceil(w / 2), Math.ceil(w / 2), -1, 1, h + 1);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rows[j][i]; if (ch === '.') continue;
      const m = matFor(col[ch] || sp.c[1]), u = i - (w >> 1), z = h - 1 - j;
      V.set(u, 0, z, m); if (ch !== 'F') V.set(u, -1, z, m);
    }
    return V.finalize();
  });
}

// ---------- sea life and props ----------
const LM = { whale: mat(['#26343e', '#34464f', '#4a5c66']), belly: mat(['#6d7780', '#8a949c', '#a9b1b7']), dolphin: mat(['#4a5862', '#66747e', '#86949c']),
  gull: mat(['#c8ccd0', '#eef0f2', '#ffffff']), wing: mat(['#6d7780', '#8a949c', '#b3bbc0']), beak: mat(['#a8822c', '#e2b94a', '#f0cf6a']), levi: mat(['#121c24', '#1c2a34', '#2a3a46']) };
function ellipsoid(V, rx, ry, rz, m, belly) {
  for (let z = 0; z <= rz * 2; z++) for (let v = -Math.ceil(ry); v <= ry; v++) for (let u = -Math.ceil(rx); u <= rx; u++)
    if ((u / rx) ** 2 + (v / ry) ** 2 + ((z - rz) / rz) ** 2 <= 1) V.set(u, v, z, belly && z <= rz * 0.6 ? belly : m);
}
export const whaleMesh = () => cached('whale', () => { const V = new Vox(-13, 13, -5, 5, 8); ellipsoid(V, 11, 3.6, 2.4, LM.whale, LM.belly); V.box(-3, -2, 0, 0, 5, 6, LM.whale); return V.finalize(); });
export const flukeMesh = () => cached('fluke', () => { const V = new Vox(-1, 1, -5, 5, 6); for (let v = -4; v <= 4; v++) { const z = 2 + Math.round(Math.abs(v) * 0.6); V.set(0, v, z, LM.whale); V.set(0, v, z + 1, LM.whale); } V.box(0, 0, 0, 0, 0, 2, LM.whale); return V.finalize(); });
export const dolphinMesh = () => cached('dolphin', () => { const V = new Vox(-6, 6, -2, 2, 5); ellipsoid(V, 4.6, 1.3, 1.2, LM.dolphin, LM.belly); V.set(5, 0, 1, LM.dolphin); V.set(0, 0, 3, LM.dolphin); V.set(-1, 0, 4, LM.dolphin); V.box(-6, -6, -1, 1, 1, 1, LM.dolphin); return V.finalize(); });
export const gullMesh = up => cached('gull' + up, () => { const V = new Vox(-3, 3, -5, 5, 4); V.box(-1, 1, 0, 0, 1, 1, LM.gull); V.set(2, 0, 1, LM.beak); for (let v = 1; v <= 4; v++) { const z = up ? 1 + Math.min(2, v - 1) : 1; V.set(0, v, z, v > 3 ? LM.wing : LM.gull); V.set(0, -v, z, v > 3 ? LM.wing : LM.gull); } return V.finalize(); });
export const leviMesh = () => cached('levi', () => { const V = new Vox(-22, 22, -8, 8, 7); ellipsoid(V, 17, 6, 3, LM.levi); for (let u = -22; u <= -16; u++) for (let v = -Math.round((-16 - u) * 0.9); v <= Math.round((-16 - u) * 0.9); v++) V.set(u, v, 3, LM.levi); return V.finalize(); });
export const bobberMesh = () => cached('bobber', () => { const V = new Vox(-1, 1, -1, 1, 4); V.box(-1, 1, -1, 1, 0, 0, M.white); V.box(-1, 1, -1, 1, 1, 1, M.redp); V.set(0, 0, 2, M.redp); V.set(0, 0, 3, M.iron); return V.finalize(); });
export const buoyMesh = () => cached('buoy', () => { const V = new Vox(-2, 3, -2, 2, 10); V.box(-1, 1, -1, 1, 0, 1, M.redp); V.box(-1, 1, -1, 1, 2, 2, M.white); V.box(0, 0, 0, 0, 3, 8, M.iron); V.box(1, 2, 0, 0, 7, 8, M.redp); V.set(0, 0, 9, M.lamp); return V.finalize(); });

// ---------- dynamic thin parts, built in world space every frame ----------
const dynData = [];
let dyn = null;
export function dynBegin() { dynData.length = 0; }
export function dynBox(a, b, w, rgb, em = 0) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1e-4, e1 = d.map(x => x / L);
  let up = Math.abs(e1[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e2 = [e1[1] * up[2] - e1[2] * up[1], e1[2] * up[0] - e1[0] * up[2], e1[0] * up[1] - e1[1] * up[0]]; const l2 = Math.hypot(...e2); e2 = e2.map(x => x / l2);
  const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], hw = w / 2;
  const P = (p, s2, s3) => [p[0] + (e2[0] * s2 + e3[0] * s3) * hw, p[1] + (e2[1] * s2 + e3[1] * s3) * hw, p[2] + (e2[2] * s2 + e3[2] * s3) * hw];
  const c = [[a, -1, -1], [a, 1, -1], [a, 1, 1], [a, -1, 1], [b, -1, -1], [b, 1, -1], [b, 1, 1], [b, -1, 1]].map(([p, s2, s3]) => P(p, s2, s3));
  const quads = [[0, 1, 2, 3, e1.map(x => -x)], [4, 5, 6, 7, e1], [0, 1, 5, 4, e3.map(x => -x)], [3, 2, 6, 7, e3], [0, 3, 7, 4, e2.map(x => -x)], [1, 2, 6, 5, e2]];
  const col = rgb.map(x => x / 255);
  for (const [i0, i1, i2, i3, n] of quads) for (const i of [i0, i1, i2, i0, i2, i3]) dynData.push(...c[i], ...n, ...col, em);
}
export function dynMesh() { const data = new Float32Array(dynData); if (!dyn) dyn = upload(data, true); else refill(dyn, data); return dyn; }
export { oarGeom, BOAT_MODELS };
