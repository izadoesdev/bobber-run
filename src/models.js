// Voxel models: rowboat (with animated oars), lighthouse, harbour, wreck, crate.
import { Vox, mat, RGB, renderVox } from './voxel.js';
import { hash01 } from './noise.js';
import { PAINTS } from './econ.js';

export const M = {
  bottom: mat(['#6e2a26', '#9a3a32', '#c0493a']), paint: mat(['#a9a291', '#d3cbb9', '#efe9dc']), stripe: mat(['#2b4566', '#3f5f8a', '#5b7fae']),
  gun: mat(['#7a5530', '#b4874a', '#dcb074']), floor: mat(['#6a4828', '#83603a', '#9c7646']), lining: mat(['#6a4828', '#8f6a3c', '#b08250']),
  seat: mat(['#7a5530', '#a67a42', '#c89a5a']), coat: mat(['#a47f22', '#d9ae3e', '#f0cf6a']), skin: mat(['#b07c58', '#d79f76', '#ecbd94']),
  pants: mat(['#1f2c36', '#2e4050', '#435a6e']), hat: mat(['#14212a', '#26394a', '#3a5068']), oar: mat(['#8a6236', '#b4874a', '#d3a868']),
  blade: mat(['#b9b1a0', '#d8d0bf', '#efe9dc']), tip: mat(['#8e3328', '#c0493a', '#d8665a']), boot: mat(['#1b2a33', '#2b3a44', '#3d4c56']),
  stone: mat(['#5c6670', '#8a949c', '#b3bbc0']), white: mat(['#aaa393', '#d9d2c2', '#f4efe4']), redp: mat(['#7e2c25', '#b0423a', '#cf5a4c']),
  iron: mat(['#14212a', '#1b2a33', '#33454f']), glass: mat(['#e2b94a', '#f0cf6a', '#fbeaa8'], true), roof: mat(['#6e2a24', '#9a3a31', '#bc4a3c']),
  plank: mat(['#6e4c2a', '#8f6a3c', '#b08250']), plank2: mat(['#5e4024', '#7a5530', '#9a7044']), post: mat(['#2e2218', '#4a3624', '#5e4430']),
  wet: mat(['#3a2c20', '#54402c', '#6e553a']), wetp: mat(['#4f5a52', '#6b7a70', '#8a9a8e']), flag: mat(['#a47f22', '#e2b94a', '#f0cf6a']),
  window: mat(['#2b4566', '#3f5f8a', '#86b0bf']), door: mat(['#3a2818', '#5e4024', '#7a5530']), crate: mat(['#7a5530', '#a67a42', '#c89a5a']),
  band: mat(['#3a2818', '#5e4024', '#7a5530']), lamp: mat(['#f0cf6a', '#fbeaa8', '#fff6d6'], true), grassm: mat(['#4a6a3a', '#6e9050', '#86a65c']),
  skiff: mat(['#24423a', '#3a6656', '#548a72']), navy: mat(['#17233a', '#26405e', '#3a5c80']), trawl: mat(['#22404c', '#30586a', '#467486']),
  sail: mat(['#c2baa8', '#e2dccc', '#f8f4ea']), net: mat(['#2e4a34', '#3f6a46', '#5a8a5a']), orange: mat(['#a8562a', '#d9733a', '#f0955a']),
  copper: mat(['#7a4a24', '#b0703a', '#d8945a']), ironp: mat(['#3d4852', '#5c6670', '#7d8790']), steel: mat(['#7a848c', '#a9b1b7', '#d3d8da']),
  gilt: mat(['#8a6a1e', '#c49a32', '#f0cf6a']), sailred: mat(['#7e2c25', '#b0423a', '#d0594c']), fishm: mat(['#4a5a6a', '#8a9aa8', '#cfd8dc']),
  tackle: mat(['#2e5a3a', '#3f7a4a', '#5a9a62']),
};
const PAINT_MAT = Object.fromEntries(PAINTS.filter(p => p.ramp).map(p => [p.id, mat(p.ramp)]));

// ---------- rowboat ----------
const HL = 14, HB = 6.2, HZ = 5;
const hullLen = z => HL * (0.78 + 0.22 * Math.min(z, HZ) / HZ);
function hullHW(u, z) {
  const zf = Math.min(z, HZ) / HZ, t = u / hullLen(z); if (t > 1 || t < -1) return -1;
  const b = t >= 0 ? HB * Math.pow(1 - t * t, 0.6) : HB * Math.pow(1 - Math.pow(-t, 4), 0.45);
  return b * (0.45 + 0.55 * zf);
}
const ztop = u => HZ + (u > 7 ? 1 : 0) + (u > 11 ? 1 : 0) + (u < -12 ? 1 : 0);
const BOAT = new Vox(-17, 17, -10, 10, 15);
(() => {
  const B = BOAT;
  for (let z = 0; z < B.nz; z++) for (let u = -17; u <= 17; u++) for (let v = -10; v <= 10; v++) {
    if (z > ztop(u)) continue;
    const hw = hullHW(u, z); if (hw < 0 || Math.abs(v) > hw + 0.3) continue;
    const in1 = Math.abs(v) <= hw - 1.1 && Math.abs(u) <= hullLen(z) - 1.6, in2 = Math.abs(v) <= hw - 2.1 && Math.abs(u) <= hullLen(z) - 2.6;
    if (z >= 2 && in2) continue;
    let m;
    if (z === ztop(u)) m = in1 ? M.gun : M.paint;
    else if (z === 1 && in2) m = M.floor;
    else if (in1 && z >= 1) m = M.lining;
    else m = z <= 1 ? M.bottom : z === ztop(u) - 1 ? M.stripe : M.paint;
    B.set(u, v, z, m);
  }
  for (const [u0, u1] of [[0, 2], [7, 8], [-10, -9]]) for (let u = u0; u <= u1; u++) for (let v = -8; v <= 8; v++)
    if (Math.abs(v) <= hullHW(u, 4) - 0.6 && !B.get(u, v, 4)) B.set(u, v, 4, M.seat);
  for (const v of [-6, 6]) { B.set(-2, v, 6, M.gun); B.set(-2, v, 7, M.gun); }
  B.box(0, 2, -2, 2, 5, 8, M.coat); for (const v of [-3, 3]) B.box(1, 1, v, v, 6, 8, M.coat);
  B.box(0, 2, -1, 1, 9, 10, M.skin); B.box(0, 2, -1, 1, 11, 11, M.hat); B.set(1, 0, 12, M.hat); B.set(-1, 0, 10, M.skin);
  for (const v of [-2, -1, 1, 2]) { B.box(-3, -1, v, v, 5, 5, M.pants); B.set(-4, v, 3, M.boot); B.set(-4, v, 4, M.pants); B.set(-4, v, 5, M.pants); }
  B.finalize();
})();
export const BOAT_RAD = 22;
const smooth = x => x * x * (3 - 2 * x);
export const OAR = { lockU: -2, lockV: 6, lockZ: 7, reach: 19, sweep: 8 };
export function bladeAt(ph) {
  if (ph < 0.5) return [OAR.sweep - 2 * OAR.sweep * smooth(ph / 0.5), 0.3];
  const q = (ph - 0.5) / 0.5; return [-OAR.sweep + 2 * OAR.sweep * smooth(q), 0.3 + 3.6 * Math.sin(Math.PI * q)];
}
export const NA = 96, NP = 12, SHIPPED = NP;
function oarGeom(pose, lvl = 0) {
  const lines = [], points = [];
  for (const sgn of [-1, 1]) {
    let Hd, B, BS;
    if (pose === SHIPPED) { Hd = [3, sgn * 3.5, 6.6]; B = [-13, sgn * 6, 5.8]; BS = [-8, sgn * 5.2, 6]; }
    else {
      const [bu, bz] = bladeAt(pose / NP), O = [OAR.lockU, sgn * OAR.lockV, OAR.lockZ]; B = [bu, sgn * OAR.reach, bz];
      Hd = [O[0] + (O[0] - B[0]) * 0.3, O[1] + (O[1] - B[1]) * 0.3, O[2] + (O[2] - B[2]) * 0.3];
      const dl = Math.hypot(B[0] - O[0], B[1] - O[1], B[2] - O[2]); BS = [B[0] - (B[0] - O[0]) / dl * 5, B[1] - (B[1] - O[1]) / dl * 5, B[2] - (B[2] - O[2]) / dl * 5];
    }
    lines.push({ a: Hd, b: BS, col: RGB[lvl >= 2 ? M.post : M.oar][sgn < 0 ? 2 : 1] }, { a: BS, b: B, col: RGB[lvl >= 3 ? M.gilt : lvl >= 1 ? M.stripe : M.blade][2], wide: true });
    points.push({ p: B, col: RGB[M.tip][1] });
    if (pose !== SHIPPED) { lines.push({ a: [1, sgn * 3, 7.5], b: Hd, col: RGB[M.coat][sgn < 0 ? 2 : 1] }); points.push({ p: Hd, col: RGB[M.skin][2] }); }
  }
  return { lines, points };
}

// generic planked hull; deckFrom: u beyond which the hull is decked over at the gunwale
function buildHull(V, { HL, HB, HZ, paint, stripe = M.paint, gun = M.gun, deckFrom = 99, deckZ = 1, floorMat = M.floor }) {
  const len = z => HL * (0.78 + 0.22 * Math.min(z, HZ) / HZ);
  const hw = (u, z) => { const zf = Math.min(z, HZ) / HZ, t = u / len(z); if (t > 1 || t < -1) return -1; const b = t >= 0 ? HB * Math.pow(1 - t * t, 0.6) : HB * Math.pow(1 - Math.pow(-t, 4), 0.45); return b * (0.45 + 0.55 * zf); };
  const top = u => HZ + (u > HL * 0.5 ? 1 : 0) + (u > HL * 0.8 ? 1 : 0) + (u < -HL * 0.86 ? 1 : 0);
  V.each = V.each; // keep API
  for (let z = 0; z < V.nz; z++) for (let u = V.u0; u < V.u0 + V.nu; u++) for (let v = V.v0; v < V.v0 + V.nv; v++) {
    const zt = top(u); if (z > zt) continue;
    const h = hw(u, z); if (h < 0 || Math.abs(v) > h + 0.3) continue;
    const in1 = Math.abs(v) <= h - 1.1 && Math.abs(u) <= len(z) - 1.6, in2 = Math.abs(v) <= h - 2.1 && Math.abs(u) <= len(z) - 2.6;
    if (in2 && z > deckZ) { if (u > deckFrom && z === zt) V.set(u, v, z, M.plank); continue; }
    let m;
    if (z === zt) m = in1 ? gun : stripe;
    else if (in2 && z === deckZ) m = floorMat;
    else if (in1 && z >= 1) m = M.lining;
    else m = z <= 1 ? M.bottom : z === zt - 1 ? stripe : paint;
    V.set(u, v, z, m);
  }
  return { hw, top };
}
function sailor(V, u, z, coat = M.coat) { V.box(u, u + 1, -1, 1, z, z + 3, coat); V.box(u, u + 1, -1, 1, z + 4, z + 5, M.skin); V.box(u, u + 1, -1, 1, z + 6, z + 6, M.hat); }

const SKIFF = new Vox(-20, 20, -12, 12, 31);
(() => {
  const V = SKIFF, { hw } = buildHull(V, { HL: 16.5, HB: 6.4, HZ: 5, paint: M.skiff, stripe: M.paint });
  for (const [a, b] of [[-3, -2], [7, 8]]) for (let u = a; u <= b; u++) for (let v = -8; v <= 8; v++) if (Math.abs(v) <= hw(u, 4) - 0.6 && !V.get(u, v, 4)) V.set(u, v, 4, M.seat);
  V.box(4, 4, 0, 0, 1, 29, M.post);                                   // mast
  V.line([4, 1, 8], [-11, 2, 8], M.oar);                              // boom
  for (let u = -10; u <= 3; u++) { const topz = Math.round(9 + (u + 10) / 13 * 19), v = Math.round((4 - u) * 0.13); for (let z = 9; z <= topz; z++) { V.set(u, v, z, M.sail); V.set(u, v + 1, z, M.sail); } }
  for (let u = 6; u <= 14; u++) { const topz = Math.round(6 + (15 - u) * 2); for (let z = 7; z <= Math.min(topz, 26); z++) { V.set(u, 0, z, M.sail); V.set(u, -1, z, M.sail); } }
  sailor(V, -13, 4);
  V.line([-16, 0, 6], [-12, 0, 7], M.oar);
  V.finalize();
})();

const LAUNCH = new Vox(-21, 21, -12, 12, 16);
(() => {
  const V = LAUNCH; buildHull(V, { HL: 17.5, HB: 7, HZ: 6, paint: M.navy, stripe: M.redp, gun: M.gun, deckFrom: 6 });
  V.box(-1, 5, -4, 4, 6, 9, M.white);
  V.box(5, 5, -3, 3, 8, 9, M.window); for (const v of [-4, 4]) V.box(0, 4, v, v, 8, 8, M.window);
  V.box(-2, 6, -5, 5, 10, 10, M.stripe);
  V.box(-11, -10, -4, 4, 4, 4, M.seat);
  sailor(V, -7, 4, M.orange);
  V.box(-19, -17, -1, 1, 3, 8, M.iron); V.box(-19, -17, -1, 1, 9, 9, M.redp); V.box(-18, -18, 0, 0, 0, 2, M.iron);
  V.finalize();
})();

const TRAWLER = new Vox(-27, 27, -13, 13, 30);
(() => {
  const V = TRAWLER, { hw } = buildHull(V, { HL: 23, HB: 9, HZ: 8, paint: M.trawl, stripe: M.white, gun: M.redp, deckZ: 5, floorMat: M.plank });
  V.box(-14, -5, -5, 5, 6, 13, M.white);
  V.box(-5, -5, -4, 4, 11, 12, M.window); for (const v of [-5, 5]) V.box(-13, -7, v, v, 11, 11, M.window);
  V.box(-15, -4, -6, 6, 14, 14, M.roof);
  V.box(-11, -11, 3, 3, 15, 19, M.iron); V.set(-11, 3, 20, M.iron);
  V.box(5, 5, 0, 0, 6, 27, M.iron); V.box(5, 5, -5, 5, 24, 24, M.iron);
  V.line([5, 0, 24], [-22, 0, 12], M.iron); V.line([-22, 0, 12], [-22, 0, 7], M.iron);
  for (let u = -22; u <= -16; u++) for (let v = -5; v <= 5; v++) if (Math.abs(v) <= hw(u, 6) - 2 && hash01(u, v, 5) < 0.75) { V.set(u, v, 6, M.net); if (hash01(u, v, 6) < 0.5) V.set(u, v, 7, M.net); }
  V.box(9, 11, 2, 4, 6, 7, M.crate); V.box(13, 14, -3, -2, 6, 6, M.crate);
  for (const [u, z] of [[-10, 9], [-9, 9], [-8, 9], [-10, 10], [-8, 10], [-10, 11], [-9, 11], [-8, 11]]) V.set(u, 6, z, (u + z) % 2 ? M.redp : M.white);
  sailor(V, 0, 6, M.orange);
  V.finalize();
})();

const BOAT_MODELS = {
  row: { vox: BOAT, oars: true, rad: BOAT_RAD, outlineZ: HZ + 1, hull: M.paint },
  skiff: { vox: SKIFF, rad: 21, outlineZ: 6, hull: M.skiff },
  launch: { vox: LAUNCH, rad: 22, outlineZ: 7, hull: M.navy },
  trawler: { vox: TRAWLER, rad: 28, outlineZ: 9, hull: M.trawl },
};
export const hasOars = id => !!BOAT_MODELS[id].oars;

// where gear goes on each hull: [u, v, z] (z = the layer the item sits on)
const MOUNT = {
  row: { crew: [7, 0, 5], cook: [-10, -2, 5], pump: [-6, 3, 2], flag: [-13, 0, 6], lamp: [-12, 0, 6], sonar: [7, -2, 5], rod: [[-8, 4, 6], [-13, 8, 13]], ice: [-8, -2, 2], tackle: [-9, 2, 5], net: [10, 0, 7], ant: [-11, 4, 6], anchor: [12, 3, 6],
    crates: [[5, -3, 2], [3, -3, 2], [-10, 1, 5]], pile: [[3, -1, 2], [4, 1, 2], [5, -1, 2], [6, 1, 2], [3, 1, 2], [5, 1, 2]] },
  skiff: { crew: [-3, -2, 5], cook: [-9, 2, 2], pump: [-5, 3, 2], flag: [4, 0, 30], lamp: [-14, 3, 6], sonar: [7, 2, 5], rod: [[-8, 4, 5], [-13, 8, 12]], ice: [-6, -3, 2], tackle: [-2, 2, 5], net: [-10, 0, 2], ant: [-14, -3, 6], anchor: [15, 3, 6],
    crates: [[0, -3, 2], [0, 2, 2], [10, -2, 5]], pile: [[1, -1, 2], [2, 1, 2], [3, -1, 2], [1, 1, 2], [2, -2, 2], [3, 2, 2]] },
  launch: { crew: [9, -2, 8], cook: [-12, 2, 5], pump: [-10, -4, 2], flag: [-15, 2, 7], lamp: [-15, 0, 7], sonar: [2, -2, 11], rod: [[-12, 5, 6], [-17, 9, 13]], ice: [-14, -3, 2], tackle: [-14, 2, 2], net: [-4, 0, 2], ant: [0, 3, 11], anchor: [12, 0, 8],
    crates: [[8, -2, 8], [8, 2, 8], [10, 0, 8]], pile: [[-9, -2, 2], [-8, 1, 2], [-5, -2, 2], [-5, 2, 2], [-9, 2, 2], [-7, -1, 2]] },
  trawler: { crew: [10, -4, 6], cook: [-3, 3, 6], pump: [-15, -6, 6], flag: [5, 0, 28], lamp: [-5, -4, 15], sonar: [-13, -4, 15], rod: [[-14, 7, 9], [-19, 11, 16]], ice: [16, 1, 6], tackle: [7, -5, 6], net: null, ant: [-8, -4, 15], anchor: [21, 4, 10],
    crates: [[-2, 5, 6], [-2, -6, 6], [2, -6, 6]], pile: [[2, 3, 6], [3, -3, 6], [6, 2, 6], [7, -2, 6], [4, 4, 6], [8, 1, 6]] },
};
function cloneVox(V) { const c = new Vox(V.u0, V.u0 + V.nu - 1, V.v0, V.v0 + V.nv - 1, V.nz); c.d.set(V.d); return c; }
const PLATE = [null, M.copper, M.ironp, M.steel, M.gilt];
const STRIPE = { row: M.stripe, skiff: M.paint, launch: M.redp, trawler: M.redp };   // the visible waterline band that plating replaces
function decorate(id, eq) {
  const bm = BOAT_MODELS[id], V = cloneVox(bm.vox), m = MOUNT[id];
  const remap = new Map();
  if (eq.paint !== 'classic' && PAINT_MAT[eq.paint]) remap.set(bm.hull, PAINT_MAT[eq.paint]);
  if (eq.plate > 0) { remap.set(M.bottom, PLATE[eq.plate]); remap.set(STRIPE[id], PLATE[eq.plate]); }
  const layer = V.nu * V.nv;
  for (let i = 0; i < V.d.length; i++) {
    const r = remap.get(V.d[i]); if (r) V.d[i] = r;
    if (id === 'skiff' && V.d[i] === M.sail && eq.prop >= 2) V.d[i] = eq.prop >= 4 ? M.sailred : Math.floor(i / layer) % 4 === 0 ? M.sailred : M.sail;
  }
  const put = (u, v, z, mt) => { if (!V.get(u, v, z)) V.set(u, v, z, mt); };
  if (eq.lantern > 0) { const [u, v, z] = m.lamp; V.box(u, u, v, v, z, z + 3, M.iron); V.set(u, v, z + 4, M.lamp); if (eq.lantern >= 2) { V.set(u, v, z + 5, M.lamp); V.set(u, v, z + 6, M.iron); } if (eq.lantern >= 3) { V.set(u + 1, v, z + 4, M.lamp); V.set(u - 1, v, z + 4, M.lamp); } }
  if (eq.sonar > 0) { const [u, v, z] = m.sonar; V.box(u, u + 1, v, v + 1, z, z, M.iron); V.set(u + 1, v, z, M.window); if (eq.sonar >= 2) V.box(u, u + 1, v, v + 1, z + 1, z + 1, M.white); if (eq.sonar >= 3) V.line([u, v, z + 2], [u, v, z + 6], M.iron); }
  for (let k = 0; k < Math.min(3, eq.rod + 1); k++) {
    const [[u0, v0, z0], [u1, v1, z1]] = m.rod, sg = k % 2 ? -1 : 1, du = -2 * Math.floor(k / 2);
    V.line([u0 + du, sg * v0, z0], [u1 + du, sg * v1, z1], M.post); V.set(u0 + du, sg * v0, z0 + 1, M.flag);
  }
  if (eq.ice > 0) { const [u, v, z] = m.ice; V.box(u, u + 2, v, v + 2, z, z + 1, M.white); V.box(u, u + 2, v, v + 2, z + 1, z + 1, eq.ice >= 3 ? M.stripe : M.white); V.set(u + 1, v + 1, z + 1, M.stripe); }
  if (eq.tackle > 0) { const [u, v, z] = m.tackle; V.box(u, u + 1, v, v + 1, z, z, M.tackle); V.set(u, v, z, M.flag); }
  if (eq.net > 0 && m.net) { const [u, v, z] = m.net; V.box(u, u, v - 3, v + 3, z, z, M.net); if (eq.net >= 2) V.box(u - 1, u - 1, v - 2, v + 2, z, z, M.net); }
  if (eq.radio > 0) { const [u, v, z] = m.ant; V.line([u, v, z], [u, v, z + 9], M.iron); V.set(u, v, z + 10, M.redp); }
  if (eq.anchor > 0) { const [u, v, z] = m.anchor; V.line([u, v, z], [u, v, z - 3], M.iron); V.box(u - 1, u + 1, v, v, z - 3, z - 3, M.iron); V.set(u - 1, v, z - 2, M.iron); V.set(u + 1, v, z - 2, M.iron); }
  for (let k = 0; k < Math.min(3, eq.hold); k++) { const [u, v, z] = m.crates[k]; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { put(u + a, v + b, z, M.crate); put(u + a, v + b, z + 1, (a + b) % 2 ? M.crate : M.band); } }
  for (let k = 0; k < Math.min(m.pile.length, eq.pile * 2); k++) { const [u, v, z] = m.pile[k]; put(u, v, z, M.fishm); put(u + 1, v, z, k % 3 ? M.fishm : M.stripe); }
  const figure = (u, v, z, coat, hat) => { for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { put(u + a, v + b, z, coat); put(u + a, v + b, z + 1, coat); put(u + a, v + b, z + 2, M.skin); put(u + a, v + b, z + 3, hat); } };
  if (eq.deckhand > 0) { const [u, v, z] = m.crew; figure(u, v, z, eq.deckhand >= 2 ? M.redp : M.stripe, M.hat); }
  if (eq.cook > 0) { const [u, v, z] = m.cook; figure(u, v, z, M.white, M.white); put(u, v, z + 4, M.white); put(u + 1, v + 1, z + 4, M.white); }
  if (eq.quarter > 0) { const [u, v, z] = m.flag; V.line([u, v, z], [u, v, z + 6], M.iron); for (let k = 0; k < 4; k++) { put(u - 1 - k, v, z + 6, eq.quarter >= 2 ? M.flag : M.redp); if (k < 3) put(u - 1 - k, v, z + 5, eq.quarter >= 2 ? M.flag : M.redp); } }
  if (eq.bilge > 0) { const [u, v, z] = m.pump; put(u, v, z, M.redp); put(u, v, z + 1, M.redp); put(u, v + 1, z, M.iron); if (eq.bilge >= 2) put(u + 1, v, z, M.redp); }
  if (eq.reel > 0) { const [[u0, v0, z0]] = m.rod; put(u0 - 1, v0, z0 + 1, M.gilt); }
  if (id === 'launch' && eq.prop >= 3) for (const v of [-3, 3]) { V.box(-19, -17, v - 1, v, 3, 8, M.iron); V.box(-19, -17, v - 1, v, 9, 9, M.redp); }
  return V.finalize();
}
export const eqSig = (id, eq) => [id, eq.paint, eq.plate, eq.prop, eq.lantern, eq.sonar, Math.min(2, eq.rod), eq.ice, eq.tackle, eq.net, eq.radio, eq.anchor, Math.min(3, eq.hold), eq.pile, eq.deckhand | 0, eq.cook | 0, eq.quarter | 0, eq.bilge | 0, eq.reel ? 1 : 0].join('|');
const models = new Map();                         // signature -> { vox, frames }, most recent last
function modelFor(id, eq) {
  const sig = eqSig(id, eq); let m = models.get(sig);
  if (m) { models.delete(sig); models.set(sig, m); return m; }
  m = { vox: decorate(id, eq), frames: new Map() }; models.set(sig, m);
  while (models.size > 4) models.delete(models.keys().next().value);
  return m;
}
export const PLAIN = { paint: 'classic', plate: 0, prop: 0, lantern: 0, sonar: 0, rod: 0, ice: 0, tackle: 0, net: 0, radio: 0, anchor: 0, hold: 0, pile: 0 };
export function boatFrame(id, ai, pose, eq = PLAIN) {
  const bm = BOAT_MODELS[id], m = modelFor(id, eq), k = ai * 16 + (bm.oars ? pose : 0); let f = m.frames.get(k);
  if (!f) {
    const g = bm.oars ? oarGeom(pose, eq.prop) : { lines: [], points: [] };
    f = renderVox(m.vox, ai / NA * Math.PI * 2, { ...g, rad: bm.rad + 3, outlineZ: bm.outlineZ }); m.frames.set(k, f);
  }
  return f;
}
export const boatFrameCached = (id, ai, pose, eq = PLAIN) => modelFor(id, eq).frames.has(ai * 16 + (BOAT_MODELS[id].oars ? pose : 0));

// ---------- lighthouse ----------
const LIGHTHOUSE = new Vox(-13, 13, -13, 13, 35);
(() => {
  const L = LIGHTHOUSE;
  for (let u = -8; u <= 8; u++) for (let v = -8; v <= 8; v++) { const d = Math.hypot(u, v); if (d <= 7.2) { const top = d < 5.8 ? 2 : 1 + (hash01(u, v, 3) < 0.5 ? 1 : 0); for (let z = 0; z <= top; z++) L.set(u, v, z, M.stone); } }
  for (let z = 3; z <= 24; z++) { const r = 4.6 - (z - 3) * 0.065; for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) if (Math.hypot(u, v) <= r) L.set(u, v, z, Math.floor((z - 3) / 4) % 2 ? M.redp : M.white); }
  L.box(-1, 0, 3, 4, 3, 5, M.door);
  for (const z of [11, 18]) L.box(0, 0, 3, 4, z, z + 1, M.window);
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) { const d = Math.hypot(u, v); if (d <= 5.4) L.set(u, v, 25, M.iron); if (d > 4.6 && d <= 5.6 && (u + v) % 2 === 0) L.set(u, v, 26, M.iron); }
  for (let z = 26; z <= 29; z++) for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) if (Math.hypot(u, v) <= 2.6) L.set(u, v, z, (u === 0 || v === 0) && Math.hypot(u, v) > 2 ? M.iron : M.glass);
  for (const [z, r] of [[30, 3.4], [31, 2.4], [32, 1.4]]) for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) if (Math.hypot(u, v) <= r) L.set(u, v, z, M.roof);
  L.set(0, 0, 33, M.iron); L.set(0, 0, 34, M.iron);
  // keeper's cottage
  L.box(6, 12, -4, 2, 1, 6, M.white); L.box(8, 9, 3, 3, 1, 3, M.door); L.box(11, 11, 3, 3, 3, 4, M.window); L.box(12, 12, -2, -1, 3, 4, M.window);
  for (let z = 7; z <= 10; z++) { const hw = 4.6 - (z - 7) * 1.3; for (let v = -6; v <= 4; v++) if (Math.abs(v + 1) <= hw) L.box(5, 13, v, v, z, z, M.roof); }
  L.box(11, 11, -3, -3, 7, 12, M.stone);
  L.finalize();
})();


// ---------- harbour: pier pointing +u, boathouse inland ----------
const HARBOUR = new Vox(-20, 29, -9, 9, 16);
(() => {
  const P = HARBOUR;
  for (let u = 0; u <= 27; u++) for (let v = -2; v <= 2; v++) P.set(u, v, 3, (u >> 1) % 2 ? M.plank : M.plank2);
  for (const u of [2, 9, 16, 23, 27]) for (const v of [-3, 3]) P.box(u, u, v, v, 0, 4, M.post);
  P.box(-6, 0, -5, 5, 1, 3, M.plank2);
  P.box(20, 21, 1, 2, 4, 5, M.redp); P.box(6, 7, -2, -1, 4, 5, M.crate); P.set(6, -2, 6, M.crate);
  P.box(27, 27, 2, 2, 5, 8, M.iron); P.set(27, 2, 9, M.lamp); P.set(27, 3, 8, M.iron);
  P.box(-19, -8, -6, 5, 1, 7, M.white); P.box(-19, -8, -6, 5, 0, 0, M.stone);
  P.box(-8, -8, -1, 0, 1, 4, M.door); P.box(-8, -8, 3, 3, 4, 5, M.window); P.box(-8, -8, -4, -4, 4, 5, M.window); P.box(-14, -12, 5, 5, 4, 5, M.window);
  for (let z = 8; z <= 12; z++) { const hw = 7.6 - (z - 8) * 1.7; for (let v = -8; v <= 7; v++) if (Math.abs(v + 0.5) <= hw) P.box(-20, -7, v, v, z, z, M.roof); }
  P.box(-6, -6, 7, 7, 1, 15, M.iron); P.box(-5, -1, 7, 7, 12, 14, M.flag); P.box(-3, -1, 7, 7, 13, 13, M.redp);
  P.finalize();
})();


// ---------- wreck: tilted, half sunk, broken mast ----------
const WRECK = new Vox(-24, 24, -12, 12, 16);
(() => {
  const Wk = WRECK, L = 19, Bm = 8;
  for (let u = -22; u <= 22; u++) for (let v = -11; v <= 11; v++) for (let z0 = 0; z0 <= 7; z0++) {
    const zf = Math.min(z0, 7) / 7, len = L * (0.8 + 0.2 * zf), t = u / len; if (t > 1 || t < -1) continue;
    const hw = (t >= 0 ? Bm * Math.pow(1 - t * t, 0.6) : Bm * Math.pow(1 - Math.pow(-t, 4), 0.45)) * (0.45 + 0.55 * zf);
    if (Math.abs(v) > hw + 0.3) continue;
    const shell = !(Math.abs(v) <= hw - 1.3 && Math.abs(u) <= len - 1.8);
    if (!shell && z0 > 1) continue;
    if (shell && z0 > 1 && hash01(u, v * 7 + z0, 11) < (u < -6 ? 0.45 : 0.12)) continue;
    const z = z0 + Math.round(u * 0.22) - 3; if (z < 0) continue;
    Wk.set(u, v, z, z0 === 7 ? M.wet : z0 >= 4 ? M.wetp : M.wet);
  }
  Wk.line([3, 0, 3], [9, 5, 13], M.wet); Wk.line([4, 0, 3], [10, 5, 13], M.wet); Wk.line([8, 4, 11], [12, -2, 10], M.post);
  Wk.finalize();
})();


// ---------- floating crate ----------
const CRATE = new Vox(-3, 3, -3, 3, 5);
(() => { CRATE.box(-2, 2, -2, 2, 0, 3, M.crate); for (const u of [-2, 2]) CRATE.box(u, u, -2, 2, 0, 3, M.band); CRATE.box(-2, 2, -2, 2, 0, 0, M.band); CRATE.finalize(); })();

export { BOAT_MODELS, decorate, oarGeom, LIGHTHOUSE, HARBOUR, WRECK, CRATE };
