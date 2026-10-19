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
// dz lowers the geometry so a creature pivots (pitch/roll) about its spine instead of its belly
const cached = (key, build, dz = 0) => {
  let m = cache.get(key); if (m) return m;
  const g = voxGeometry(build()); if (dz) for (let i = 2; i < g.length; i += 10) g[i] -= dz;
  m = upload(g); cache.set(key, m); return m;
};

// ---------- boats (rebuilt when the fitted equipment changes) ----------
const boatCache = new Map();
// the player's boat plus the NPC ships sailing nearby (a handful of hull/paint combinations)
export function boatMesh(id, eq) {
  const sig = eqSig(id, eq); let m = boatCache.get(sig);
  if (m) { boatCache.delete(sig); boatCache.set(sig, m); return m; }
  m = upload(voxGeometry(decorate(id, eq))); boatCache.set(sig, m);
  while (boatCache.size > 12) { const [k, old] = boatCache.entries().next().value; gl.deleteBuffer(old.vbo); gl.deleteVertexArray(old.vao); boatCache.delete(k); }
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
// Humpback, nose toward +u, spine on z = 0 (the renderer pitches/rolls it about the spine). The tail stock and
// fluke are a separate mesh hinged at u = -10 so the tail can beat and lift clear of the water.
const HM = { back: mat(['#18222a', '#25323c', '#384956']), flank: mat(['#3c4a54', '#56666f', '#74848c']),
  pleat: mat(['#9aa4aa', '#c9d0d4', '#eef2f4']), groove: mat(['#545f68', '#6d7780', '#8a949c']), fin: mat(['#a9b3b8', '#d8dfe2', '#f6f8f9']),
  knob: mat(['#10181e', '#1a242c', '#2c3a44']), barn: mat(['#7d8a92', '#a9b4ba', '#ccd4d8']) };
const HUMP = [[-10, 1.0, 1.4], [-6, 1.9, 2.0], [-2, 2.8, 2.4], [3, 3.2, 2.6], [7, 2.9, 2.4], [10, 2.2, 1.9], [12, 1.6, 1.4], [14, 0.9, 0.9]];
const profile = (P, u) => { for (let i = 1; i < P.length; i++) if (u <= P[i][0]) { const a = P[i - 1], b = P[i], t = (u - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; } return [0, 0]; };
function humpback() {
  const V = new Vox(-10, 14, -12, 12, 10), zc = 4, top = new Map();
  for (let u = -10; u <= 14; u++) {
    const [w, h] = profile(HUMP, u), throat = u > -2 && u < 14;
    for (let z = 0; z < 9; z++) for (let v = -4; v <= 4; v++) {
      const dz = z + 0.5 - zc, hz = dz > 0 ? h : h * (throat ? 1.25 : 1);
      if ((v / w) ** 2 + (dz / hz) ** 2 > 1 || (u === 14 && dz > 0)) continue;   // the lower jaw juts past the snout
      let m = HM.back;
      if (dz < -hz * 0.35) m = throat ? (Math.abs(v) % 2 ? HM.groove : HM.pleat) : HM.flank;   // ventral pleats run nose to navel
      else if (dz < 0 && hash01(u, v * 3 + z, 17) < 0.35) m = HM.flank;                     // mottled flanks
      V.set(u, v, z, m); if (!top.has(u * 64 + v) || top.get(u * 64 + v) < z) top.set(u * 64 + v, z);
    }
  }
  // knobbly head: tubercles along the snout and lower jaw, a few barnacles
  for (let u = 8; u <= 13; u++) for (let v = -2; v <= 2; v++) { const z = top.get(u * 64 + v); if (z !== undefined && hash01(u, v, 23) < 0.42) V.set(u, v, z + 1, hash01(u, v, 29) < 0.5 ? HM.barn : HM.knob); }
  for (let u = 9; u <= 13; u += 2) for (const s of [-1, 1]) V.set(u, s * Math.round(profile(HUMP, u)[0] + 0.3), 2, HM.barn);
  // dorsal hump with its small hooked fin, two-thirds of the way back
  for (let u = -6; u <= -2; u++) V.set(u, 0, top.get(u * 64) + 1, HM.back);
  V.set(-4, 0, top.get(-4 * 64) + 2, HM.back); V.set(-5, 0, top.get(-5 * 64) + 2, HM.back);
  // long white pectoral fins sweeping back from behind the head, scalloped on the leading edge
  for (const s of [-1, 1]) for (let i = 0; i <= 9; i++) {
    const u = Math.round(5 - i * 0.6), v = s * Math.round(2.6 + i * 0.95), z = Math.round(3.2 + i * 0.1), m = i < 2 ? HM.flank : HM.fin;
    V.set(u, v, z, m); if (i < 7) V.set(u - 1, v, z, m); if (i % 2 === 0 && i > 1) V.set(u + 1, v, z, m);
  }
  return V;
}
function humpTail() {
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
export const whaleMesh = () => cached('humpback', humpback, 4);
export const flukeMesh = () => cached('humptail', humpTail, 1);
export const WHALE = { len: 33, joint: -10 };       // mesh length (snout to fluke tips) and the tail hinge, in voxels

// ---------- giants under the boat ----------
const GM = { ray: mat(['#101418', '#1c2228', '#2e363e']), rayW: mat(['#9aa4aa', '#d0d6da', '#eef2f4']), shadow: mat(['#0a1218', '#111c24', '#1a2832']),
  squid: mat(['#4a1626', '#7a2a40', '#a6445e']), squidE: mat(['#1a0a10', '#22101a', '#3a1a2a']), photo: mat(['#127a74', '#1fa89e', '#5ad8cc'], true),
  eel: mat(['#18241e', '#26382e', '#3a5244']), eelB: mat(['#4a5a3a', '#66784e', '#88986a']), eelP: mat(['#1a5a9a', '#2a82c8', '#6ab8f0'], true), eye: mat(['#8a7a20', '#c8b040', '#f0d860'], true) };
// manta: flat diamond with white shoulder patches, horn-like cephalic fins and a whip tail; f picks the wingbeat pose
function manta(f) {
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
export const mantaMesh = ph => { const f = ((Math.floor(ph * 4 / (Math.PI * 2)) % 4) + 4) % 4; return cached('manta' + f, () => manta(f), 4); };
export const MANTA_LEN = 17;
// the vast dark fish that sometimes slides under the boat: just a silhouette, it is always deep
export const shadowFishMesh = () => cached('shadowfish', () => {
  const V = new Vox(-20, 20, -8, 8, 7);
  for (let u = -13; u <= 19; u++) { const t = (u + 13) / 32, w = 6 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 + 0.6, h = w * 0.5;
    for (let z = 0; z < 7; z++) for (let v = -7; v <= 7; v++) if ((v / w) ** 2 + ((z + 0.5 - 3) / h) ** 2 <= 1) V.set(u, v, z, GM.shadow); }
  for (let u = -20; u <= -13; u++) { const k = -13 - u; for (let v = -k; v <= k; v++) if (Math.abs(v) > k - 3) V.set(u, v, 3, GM.shadow); }   // forked tail
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) V.set(6 - i, s * (5 + i), 3, GM.shadow);                                            // pectoral fins
  return V;
}, 3);
export const SHADOW_LEN = 40;
// squid: mantle forward, fins at the tip, arms and two long tentacles trailing; photophores glow at night
export const squidMesh = () => cached('squid', () => {
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
const eelPart = kind => () => {
  const V = new Vox(-2, 3, -2, 2, 4), zc = 2;
  for (let u = -2; u <= (kind === 'head' ? 3 : 1); u++) { const r = kind === 'tail' ? 1.4 - (1 - u) * 0.25 : kind === 'head' && u > 1 ? 1.0 : 1.4;
    for (let z = 0; z < 4; z++) for (let v = -2; v <= 2; v++) { const dz = z + 0.5 - zc; if (v * v + dz * dz > r * r) continue;
      V.set(u, v, z, dz < -0.5 ? GM.eelB : Math.abs(v) === 1 && Math.abs(dz) < 0.6 && u === 0 ? GM.eelP : GM.eel); } }
  if (kind === 'head') for (const s of [-1, 1]) V.set(2, s, zc, GM.eye);
  if (kind === 'tail') for (let u = -2; u <= 1; u++) V.set(u, 0, zc + 1 + (u < 0 ? 1 : 0), GM.eel);
  return V;
};
export const eelMesh = kind => cached('eel' + kind, eelPart(kind), 2);

// jellyfish: a glowing bell (open or squeezed) trailing tentacles; tinted per jelly
const JM = { bell: mat(['#6a7a84', '#8a9ca6', '#b8c8d0'], true), core: mat(['#8a9cb0', '#b8cce0', '#e8f4ff'], true), tent: mat(['#3a4650', '#56646e', '#7a8892']) };
function jelly(squeeze) {
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
export const jellyMesh = squeeze => cached('jelly' + (squeeze ? 1 : 0), () => jelly(squeeze), 5);
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
// positions are stored relative to (ox, oy) and drawn as an instance there, so thin parts rasterise exactly like
// the hull they hang off (absolute world coordinates lose precision and made oar edges flicker as the camera slid)
export function dynMesh(ox = 0, oy = 0) {
  const data = new Float32Array(dynData); for (let i = 0; i < data.length; i += 10) { data[i] -= ox; data[i + 1] -= oy; }
  if (!dyn) dyn = upload(data, true); else refill(dyn, data); return dyn;
}
export { oarGeom, BOAT_MODELS };
