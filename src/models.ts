// Voxel models: rowboat (with animated oars), sailing and steam boats, lighthouse, harbour, wreck, crate.
// Boats are decorated with the player's fitted gear (decorate) and either rendered to sprites (boatFrame, for the UI)
// or meshed for the GL renderer (gl/meshes).
import { Vox, mat, RGB, renderVox, type Vec3, type VoxFrame, type VoxLine, type VoxPoint } from './voxel';
import { hash01 } from './noise';
import { smooth01 } from './config';
import { PAINTS } from './econ';
import type { BoatId } from './types';

/** Shared materials (ids into voxel RGB). */
export const M = {
  cat: mat(['#b8b0a2', '#efe9de', '#fffaf0']), catd: mat(['#9a4e22', '#d9803a', '#f2b36a']),
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
  tackle: mat(['#2e5a3a', '#3f7a4a', '#5a9a62']), rope: mat(['#8a7448', '#b49a62', '#d6bf86']), ropeD: mat(['#5e4c2e', '#7a6440', '#9a8256']),
  // big ships: each hull and waterline band has its own material so paint and plating only touch those
  schoon: mat(['#16262a', '#22393d', '#345257']), schband: mat(['#9a7430', '#c9a04e', '#e8c97a']),
  coal: mat(['#15191c', '#22282c', '#363e44']), dred: mat(['#76261f', '#a8352b', '#c84a3c']), buff: mat(['#9a7a4e', '#c8a46c', '#e6c894']),
  fhull: mat(['#142c46', '#1f4266', '#30608c']), fband: mat(['#a8401f', '#d85a2a', '#f07a46']), fdeck: mat(['#3e5248', '#556b60', '#6e867a']),
  navr: mat(['#a8302a', '#e04a3a', '#ff8a7a'], true), navg: mat(['#2a7a3a', '#3ab05a', '#8ae09a'], true),
};
const PAINT_MAT: Record<string, number> = Object.fromEntries(PAINTS.flatMap(p => p.ramp ? [[p.id, mat(p.ramp)]] : []));

// ---------- rowboat ----------
const HL = 14, HB = 6.2, HZ = 5;
const hullLen = (z: number) => HL * (0.78 + 0.22 * Math.min(z, HZ) / HZ);
function hullHW(u: number, z: number): number {
  const zf = Math.min(z, HZ) / HZ, t = u / hullLen(z); if (t > 1 || t < -1) return -1;
  const b = t >= 0 ? HB * Math.pow(1 - t * t, 0.6) : HB * Math.pow(1 - Math.pow(-t, 4), 0.45);
  return b * (0.45 + 0.55 * zf);
}
const ztop = (u: number) => HZ + (u > 7 ? 1 : 0) + (u > 11 ? 1 : 0) + (u < -12 ? 1 : 0);
const BOAT = new Vox(-17, 17, -10, 10, 15);
(() => {
  const B = BOAT;
  for (let z = 0; z < B.nz; z++) for (let u = -17; u <= 17; u++) for (let v = -10; v <= 10; v++) {
    if (z > ztop(u)) continue;
    const hw = hullHW(u, z); if (hw < 0 || Math.abs(v) > hw + 0.3) continue;
    const in1 = Math.abs(v) <= hw - 1.1 && Math.abs(u) <= hullLen(z) - 1.6, in2 = Math.abs(v) <= hw - 2.1 && Math.abs(u) <= hullLen(z) - 2.6;
    if (z >= 2 && in2) continue;
    let m: number;
    if (z === ztop(u)) m = in1 ? M.gun : M.paint;
    else if (z === 1 && in2) m = (v + 21) % 3 === 0 ? M.plank2 : M.floor;          // floorboards with dark seams
    else if (in1 && z >= 1) m = (u + 30) % 3 === 0 ? M.plank2 : M.lining;          // ribs inside the hull
    else m = z <= 1 ? M.bottom : z === ztop(u) - 1 ? M.stripe : M.paint;
    B.set(u, v, z, m);
  }
  // a stem post at the bow and a coil of rope on the floor aft of the rower
  for (let u = 17; u > 0; u--) if (B.get(u, 0, ztop(u))) { B.set(u, 0, ztop(u) + 1, M.gun); break; }
  for (let u = -6; u <= -4; u++) for (let v = -1; v <= 1; v++) B.set(u, v, 2, u === -5 && v === 0 ? M.ropeD : M.rope);
  for (const [u0, u1] of [[0, 2], [7, 8], [-10, -9]]) for (let u = u0; u <= u1; u++) for (let v = -8; v <= 8; v++)
    if (Math.abs(v) <= hullHW(u, 4) - 0.6 && !B.get(u, v, 4)) B.set(u, v, 4, M.seat);
  // the rower faces the bow (the way you travel) and pushes the oars from locks just in front of him
  for (const v of [-6, 6]) { B.set(4, v, 6, M.gun); B.set(4, v, 7, M.gun); }
  B.box(0, 2, -2, 2, 5, 8, M.coat); for (const v of [-3, 3]) B.box(1, 1, v, v, 6, 8, M.coat);
  B.box(0, 2, -1, 1, 9, 10, M.skin); B.box(0, 2, -1, 1, 11, 11, M.hat); B.set(1, 0, 12, M.hat); B.set(3, 0, 10, M.skin);
  for (const v of [-2, -1, 1, 2]) { B.box(3, 5, v, v, 5, 5, M.pants); B.set(6, v, 3, M.boot); B.set(6, v, 4, M.pants); B.set(6, v, 5, M.pants); }
  B.finalize();
})();
const BOAT_RAD = 22;
/** rowboat oar geometry: the oarlock position, how far out the blade reaches, and the fore-aft sweep of a stroke */
export const OAR = { lockU: 4, lockV: 6, lockZ: 7, reach: 19, sweep: 8 };
/** Blade [u, z] at stroke phase ph in [0, 1): the first half pulls it aft through the water, the second lifts it forward. */
function bladeAt(ph: number): [number, number] {
  if (ph < 0.5) return [OAR.sweep - 2 * OAR.sweep * smooth01(ph / 0.5), 0.3];
  const q = (ph - 0.5) / 0.5;
  return [-OAR.sweep + 2 * OAR.sweep * smooth01(q), 0.3 + 3.6 * Math.sin(Math.PI * q)];
}
/** sprite headings per turn, oar stroke poses, and the extra pose index for oars shipped (stowed) */
export const NA = 96, NP = 12, SHIPPED = NP;
// each side has its own stroke pose (sgn -1 = port/left, +1 = starboard/right), so a turn can pull one oar
export function oarGeom(pose: number, lvl = 0, poseR = pose, coat = M.coat): { lines: VoxLine[]; points: VoxPoint[] } {
  const lines: VoxLine[] = [], points: VoxPoint[] = [];
  for (const sgn of [-1, 1]) {
    const ps = sgn < 0 ? pose : poseR;
    let Hd: Vec3, B: Vec3, BS: Vec3;               // handle, blade tip, where the shaft meets the blade
    if (ps === SHIPPED) {
      Hd = [3, sgn * 3.5, 6.6]; B = [-13, sgn * 6, 5.8]; BS = [-8, sgn * 5.2, 6];
    } else {
      const [bu, bz] = bladeAt(ps / NP), O: Vec3 = [OAR.lockU, sgn * OAR.lockV, OAR.lockZ];
      B = [bu, sgn * OAR.reach, bz];
      Hd = [O[0] + (O[0] - B[0]) * 0.3, O[1] + (O[1] - B[1]) * 0.3, O[2] + (O[2] - B[2]) * 0.3];
      const dl = Math.hypot(B[0] - O[0], B[1] - O[1], B[2] - O[2]);
      BS = [B[0] - (B[0] - O[0]) / dl * 5, B[1] - (B[1] - O[1]) / dl * 5, B[2] - (B[2] - O[2]) / dl * 5];
    }
    // better propulsion upgrades show as darker shafts and painted, then gilded, blades
    lines.push(
      { a: Hd, b: BS, col: RGB[lvl >= 2 ? M.post : M.oar][sgn < 0 ? 2 : 1] },
      { a: BS, b: B, col: RGB[lvl >= 3 ? M.gilt : lvl >= 1 ? M.stripe : M.blade][2], wide: true },
    );
    points.push({ p: B, col: RGB[M.tip][1] });
    if (ps !== SHIPPED) {                          // the rower's arm and hand on the handle
      lines.push({ a: [1, sgn * 3, 7.5], b: Hd, col: RGB[coat][sgn < 0 ? 2 : 1] });
      points.push({ p: Hd, col: RGB[M.skin][2] });
    }
  }
  return { lines, points };
}

// generic planked hull; deckFrom: u beyond which the hull is decked over at the gunwale
// sternPow > 4 gives a fuller stern; transom (a fraction of HL) cuts the stern off square
interface HullSpec {
  /** half-length, half-beam and gunwale height */
  HL: number; HB: number; HZ: number;
  /** hull side, waterline band and gunwale materials */
  paint: number; stripe?: number; gun?: number;
  deckFrom?: number; deckZ?: number; floorMat?: number; sternPow?: number; transom?: number;
}
/** hull half-width at (u, z) (negative outside the hull's length), and the gunwale height at u */
interface Hull { hw: (u: number, z: number) => number; top: (u: number) => number }
function buildHull(V: Vox, { HL, HB, HZ, paint, stripe = M.paint, gun = M.gun, deckFrom = 99, deckZ = 1, floorMat = M.floor, sternPow = 4, transom = 0 }: HullSpec): Hull {
  const len = (z: number) => HL * (0.78 + 0.22 * Math.min(z, HZ) / HZ), tail = transom ? -HL * transom : -1e9;
  const hw = (u: number, z: number) => {
    const zf = Math.min(z, HZ) / HZ, t = u / len(z);
    if (t > 1 || t < -1) return -1;
    const b = t >= 0 ? HB * Math.pow(1 - t * t, 0.6) : HB * Math.pow(1 - Math.pow(-t, sternPow), 0.45);
    return b * (0.45 + 0.55 * zf);
  };
  // sheer: the gunwale steps up toward the bow and at the very stern
  const top = (u: number) => HZ + (u > HL * 0.5 ? 1 : 0) + (u > HL * 0.8 ? 1 : 0) + (u < -HL * 0.86 ? 1 : 0);
  for (let z = 0; z < V.nz; z++) for (let u = V.u0; u < V.u0 + V.nu; u++) for (let v = V.v0; v < V.v0 + V.nv; v++) {
    const zt = top(u); if (z > zt) continue;
    const h = hw(u, z); if (h < 0 || Math.abs(v) > h + 0.3 || u < tail) continue;
    const in1 = Math.abs(v) <= h - 1.1 && Math.abs(u) <= len(z) - 1.6 && u >= tail + 1.1, in2 = Math.abs(v) <= h - 2.1 && Math.abs(u) <= len(z) - 2.6 && u >= tail + 2.1;
    if (in2 && z > deckZ) { if (u > deckFrom && z === zt) V.set(u, v, z, M.plank); continue; }
    let m: number;
    if (z === zt) m = in1 ? gun : stripe;
    else if (in2 && z === deckZ) m = floorMat;
    else if (in1 && z >= 1) m = M.lining;
    else m = z <= 1 ? M.bottom : z === zt - 1 ? stripe : paint;
    V.set(u, v, z, m);
  }
  return { hw, top };
}
function sailor(V: Vox, u: number, z: number, coat: number = M.coat): void { V.box(u, u + 1, -1, 1, z, z + 3, coat); V.box(u, u + 1, -1, 1, z + 4, z + 5, M.skin); V.box(u, u + 1, -1, 1, z + 6, z + 6, M.hat); }

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

// ---------- big ships: shared helpers ----------
// a flat sheet (sail) filling the convex polygon pts = [[u, z], ...], two voxels thick at v = vAt(u)
function sail(V: Vox, pts: [number, number][], vAt: (u: number) => number, m: number = M.sail): void {
  const ar = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[0], b = pts[i], c = pts[i + 1], A = ar(a, b, c), us = [a[0], b[0], c[0]], zs = [a[1], b[1], c[1]];
    for (let u = Math.floor(Math.min(...us)); u <= Math.max(...us); u++) for (let z = Math.floor(Math.min(...zs)); z <= Math.max(...zs); z++) {
      const p = [u, z]; if (ar(b, c, p) / A < -0.02 || ar(c, a, p) / A < -0.02 || ar(a, b, p) / A < -0.02) continue;
      const v = Math.round(vAt(u)); V.set(u, v, z, m); V.set(u, v + 1, z, m);
    }
  }
}
// a cylinder lying across the deck (axis along v), e.g. a net drum
function drum(V: Vox, cu: number, cz: number, r: number, v0: number, v1: number, m: number): void { for (let u = Math.floor(cu - r); u <= cu + r; u++) for (let z = Math.floor(cz - r); z <= cz + r; z++) if (Math.hypot(u - cu, z - cz) <= r) V.box(u, u, v0, v1, z, z, m); }

// ---------- schooner: two masts, gaff sails and a jib, raised quarterdeck with the helm ----------
const SCHOONER = new Vox(-38, 45, -12, 12, 48);
(() => {
  const V = SCHOONER, FORE = 13, MAIN = -7;
  buildHull(V, { HL: 32, HB: 10, HZ: 9, paint: M.schoon, stripe: M.schband, deckZ: 6, floorMat: M.plank });
  for (let u = -32; u <= -18; u++) for (let v = -9; v <= 9; v++) if (V.get(u, v, 6) === M.plank) { V.set(u, v, 7, M.plank2); V.set(u, v, 8, M.plank); }
  for (let v = -6; v <= 6; v++) { V.set(-18, v, 10, M.gun); if (v % 3 === 0) V.set(-18, v, 9, M.gun); }      // quarterdeck rail
  V.box(-25, -20, -3, 3, 9, 10, M.seat); V.box(-26, -19, -4, 4, 11, 11, M.plank2);                         // cabin trunk
  for (const u of [-24, -21]) for (const v of [-3, 3]) V.set(u, v, 10, M.window);
  V.box(-28, -28, 0, 0, 9, 11, M.gun);                                                                      // the helm
  for (let dv = -3; dv <= 3; dv++) for (let dz = -3; dz <= 3; dz++) { const r = Math.hypot(dv, dz); if ((r > 1.5 && r < 2.6) || (r === 3 && dz > -3)) V.set(-29, dv, 12 + dz, M.gun); }
  V.set(-29, 0, 12, M.gilt);
  for (let v = -4; v <= 4; v += 2) { let u = V.u0; while (u < 0 && !V.get(u, v, 7)) u++; V.set(u, v, 7, M.window); }   // stern lights
  V.box(31, 32, 0, 0, 10, 11, M.gilt);                                                                      // gilded stem head
  V.box(-3, 4, -3, 3, 7, 7, M.band); V.box(-2, 3, -2, 2, 8, 8, M.plank2); for (const u of [-2, 3]) V.box(u, u, -2, 2, 8, 8, M.band);   // cargo hatch
  for (const v of [-6, 5]) { V.box(7, 8, v, v + 1, 7, 8, M.crate); V.box(7, 8, v, v + 1, 9, 9, M.band); }  // water casks
  // sails first, spars and rigging drawn over them
  const vFore = (u: number) => (FORE - 1 - u) * 0.1, vMain = (u: number) => (MAIN - 1 - u) * 0.1;
  sail(V, [[FORE - 1, 14], [FORE - 1, 33], [-2, 38], [-4, 14]], vFore);
  sail(V, [[FORE - 1, 34], [FORE - 1, 40], [-1, 39]], vFore);
  sail(V, [[MAIN - 1, 15], [MAIN - 1, 37], [-29, 43], [-33, 15]], vMain);
  sail(V, [[MAIN - 1, 38], [MAIN - 1, 45], [-28, 44]], vMain);
  sail(V, [[42, 14], [16, 37], [29, 13]], () => -1);                                                       // jib
  sail(V, [[29, 12], [15, 31], [20, 11]], () => -1);                                                       // fore staysail
  for (const [u, top] of [[FORE, 41], [MAIN, 46]]) {
    V.box(u, u, 0, 0, 7, top - 9, M.oar); V.box(u, u, 0, 0, top - 8, top, M.post); V.box(u, u, -3, 3, top - 9, top - 9, M.post); V.set(u, 0, top + 1, M.gilt);
    for (const s of [-1, 1]) { V.line([u, 0, top - 10], [u + 1, s * 8, 10], M.post); V.line([u, 0, top - 10], [u - 2, s * 8, 10], M.post); }
  }
  V.line([FORE, 0, 13], [-5, Math.round(vFore(-5)), 13], M.oar); V.line([FORE, 0, 33], [-3, Math.round(vFore(-3)), 39], M.oar);
  V.line([MAIN, 0, 14], [-35, Math.round(vMain(-35)), 14], M.oar); V.line([MAIN, 0, 37], [-30, Math.round(vMain(-30)), 44], M.oar);
  V.line([30, 0, 11], [44, 0, 14], M.oar); V.line([44, 0, 13], [32, 0, 3], M.iron);                        // bowsprit, bobstay
  V.line([44, 0, 14], [FORE, 0, 39], M.post); V.line([30, 0, 12], [FORE, 0, 32], M.post); V.line([FORE, 0, 40], [MAIN, 0, 44], M.post);
  sailor(V, 10, 7); sailor(V, -31, 9, M.stripe);
  V.finalize();
})();

// ---------- steam drifter: black hull, tall raked black funnel with a red band, wheelhouse aft, mizzen with a riding sail ----------
const DRIFTER = new Vox(-41, 40, -13, 13, 44);
(() => {
  const V = DRIFTER, { hw } = buildHull(V, { HL: 36, HB: 11, HZ: 10, paint: M.coal, stripe: M.dred, gun: M.iron, deckZ: 7, floorMat: M.plank });
  V.box(-9, 3, -3, 3, 8, 9, M.buff); V.box(-9, -7, -2, 2, 10, 10, M.window);                               // engine casing + skylight
  for (let z = 10; z <= 30; z++) {                                                                          // funnel, raked aft
    const cu = -2 - Math.floor((z - 10) / 6);
    for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
      const r = Math.hypot(du, dv); if (r > 2.3 || (z >= 29 && r < 1.2)) continue;
      V.set(cu + du, dv, z, z === 22 || z === 26 ? M.white : z >= 23 && z <= 25 ? M.redp : M.iron);
    }
    if (z <= 28) V.set(cu + 3, 0, z, M.copper);                                                             // steam pipe up the front
  }
  V.set(-1, 0, 29, M.gilt);                                                                                 // whistle
  for (const v of [-3, 3]) { V.box(5, 5, v, v, 8, 11, M.white); V.box(5, 6, v, v, 12, 13, M.white); V.set(6, v, 12, M.redp); }   // ventilators
  V.box(-17, -11, -4, 4, 8, 15, M.seat); V.box(-18, -10, -5, 5, 16, 16, M.white);                           // wheelhouse
  for (let v = -3; v <= 3; v++) if (v) V.box(-11, -11, v, v, 12, 13, M.window);
  for (const v of [-4, 4]) V.box(-15, -13, v, v, 12, 13, M.window);
  V.box(-16, -15, 4, 4, 8, 11, M.door); V.set(-12, -5, 14, M.navr); V.set(-12, 5, 14, M.navg);
  for (let u = -27; u <= -20; u++) {                                                                        // the ship's boat, on chocks
    const w = Math.round(2.4 * Math.sqrt(Math.max(0, 1 - ((u + 23.5) / 4.6) ** 2)));
    for (let v = -w; v <= w; v++) { V.set(u, v, 9, M.white); V.set(u, v, 10, Math.abs(v) === w || u === -27 || u === -20 ? M.white : M.lining); }
  }
  for (const u of [-26, -21]) V.box(u, u, -1, 1, 8, 8, M.band); V.box(-24, -24, -1, 1, 10, 10, M.seat);
  // net drum, steam capstan and the net heap forward
  drum(V, 11, 10.5, 2.5, -4, 4, M.net); for (const v of [-5, 5]) { drum(V, 11, 10.5, 3, v, v, M.iron); V.box(10, 12, v, v, 8, 9, M.iron); }
  for (let z = 8; z <= 10; z++) for (const [du, dv] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) V.set(17 + du, dv, z, M.iron);
  V.box(16, 18, -1, 1, 11, 11, M.copper); V.set(17, 0, 12, M.gilt);
  for (let u = 26; u <= 31; u++) for (let v = -4; v <= 4; v++) if (Math.abs(v) <= hw(u, 8) - 2 && hash01(u, v, 15) < 0.8) { V.set(u, v, 8, M.net); if (hash01(u, v, 16) < 0.5) V.set(u, v, 9, M.net); }
  const rv = Math.floor(hw(26, 10)) - 1; V.box(24, 28, rv, rv, 12, 12, M.steel); V.set(24, rv, 12, M.iron); V.set(28, rv, 12, M.iron);   // net roller on the rail
  // pellet buoys and a dan buoy with its flag
  [[-7, -6, M.redp], [-4, -6, M.orange], [-1, -6, M.redp], [2, -6, M.orange], [-4, 5, M.orange], [-1, 5, M.redp]].forEach(([u, v, m]) => { V.box(u, u + 1, v, v + 1, 8, 9, m); V.set(u, v, 9, M.white); V.set(u + 1, v + 1, 9, M.white); });
  V.box(2, 3, 5, 6, 8, 9, M.redp); V.line([2, 5, 10], [4, 6, 20], M.post); V.box(5, 7, 6, 6, 19, 20, M.iron);
  // masts: foremast forward, mizzen aft with a tan riding sail, an aerial wire between them
  V.box(22, 22, 0, 0, 8, 34, M.oar); V.box(22, 22, -3, 3, 28, 28, M.post);
  for (const s of [-1, 1]) V.line([22, 0, 27], [21, s * 7, 12], M.post);
  sail(V, [[-31, 13], [-31, 27], [-37, 30], [-39, 13]], () => 0, M.sailred);
  V.box(-30, -30, 0, 0, 8, 32, M.oar); V.box(-30, -30, -2, 2, 27, 27, M.post);
  V.line([-30, 0, 12], [-40, 0, 12], M.oar); V.line([-30, 0, 27], [-38, 0, 31], M.oar);
  V.line([22, 0, 33], [36, 0, 13], M.post); V.line([22, 0, 34], [-30, 0, 32], M.iron);
  sailor(V, 14, 8);
  V.finalize();
})();

// ---------- flagship: big stern trawler with a white superstructure, gantry, crane, lifeboats, harpoon ----------
const FLAGSHIP = new Vox(-48, 50, -16, 16, 46);
(() => {
  const V = FLAGSHIP, { hw } = buildHull(V, { HL: 46, HB: 14, HZ: 12, paint: M.fhull, stripe: M.fband, gun: M.white, deckZ: 9, floorMat: M.fdeck, sternPow: 8, transom: 0.9 });
  for (let u = 28; u <= 46; u++) for (let v = -14; v <= 14; v++) if (V.get(u, v, 9) === M.fdeck) { V.box(u, u, v, v, 10, 11, M.white); V.set(u, v, 12, M.fdeck); }   // fo'c'sle
  // superstructure in three tiers, portholes and a wraparound bridge
  const house = (u0: number, u1: number, w: number, z0: number, z1: number) => { for (let u = u0; u <= u1; u++) { const h = Math.min(w, Math.floor(hw(u, 12) - 1.5)); V.box(u, u, -h, h, z0, z1, M.white); } };
  house(4, 27, 11, 10, 15); house(8, 26, 9, 16, 20);
  V.box(18, 26, -12, 12, 21, 25, M.white); V.box(17, 27, -13, 13, 26, 26, M.white);
  for (let u = 5; u <= 26; u += 3) { const h = Math.min(11, Math.floor(hw(u, 12) - 1.5)); V.set(u, -h, 13, M.window); V.set(u, h, 13, M.window); }
  for (let u = 9; u <= 25; u++) if (u % 3) { V.set(u, -9, 18, M.window); V.set(u, 9, 18, M.window); }
  for (let v = -8; v <= 8; v += 2) { V.set(26, v, 18, M.window); V.set(27, v, 13, M.window); }
  for (let v = -12; v <= 12; v++) if (v % 4) { V.box(26, 26, v, v, 23, 24, M.window); V.box(18, 18, v, v, 23, 24, M.window); }
  for (let u = 19; u <= 25; u++) if (u % 3) for (const s of [-12, 12]) V.box(u, u, s, s, 23, 24, M.window);
  V.set(22, -13, 25, M.navr); V.set(22, 13, 25, M.navg);
  // radar mast with its antenna and lights, a radome and whip aerials
  V.box(20, 20, 0, 0, 27, 40, M.white); V.box(19, 21, -3, 3, 34, 34, M.white); V.box(20, 20, -6, 6, 37, 37, M.iron);
  V.set(20, 0, 41, M.lamp); V.set(20, -3, 35, M.lamp); V.set(20, 3, 35, M.lamp);
  V.box(23, 24, -6, -5, 27, 28, M.white); for (const v of [-10, 10]) V.box(25, 25, v, v, 27, 32, M.iron);
  // funnel with a blue company band and twin exhausts
  for (let z = 10; z <= 27; z++) for (let u = -4; u <= 2; u++) for (let v = -3; v <= 3; v++)
    if (((u + 1) / 3.6) ** 2 + (v / 3.4) ** 2 <= 1) V.set(u, v, z, z >= 26 ? M.iron : z >= 21 && z <= 23 ? M.stripe : M.white);
  V.box(-2, -2, -1, -1, 28, 29, M.iron); V.box(0, 0, 1, 1, 28, 29, M.iron);
  // lifeboats in davits either side
  for (const s of [-1, 1]) {
    for (let u = 9; u <= 17; u++) { const end = u === 9 || u === 17; V.box(u, u, s * (end ? 11 : 10), s * (end ? 11 : 12), 16, 17, M.orange); if (!end) V.set(u, s * 11, 18, M.white); }
    for (const u of [10, 16]) V.box(u, u, s * 13, s * 13, 15, 19, M.iron);
  }
  // stern ramp, gantry and trawl doors
  for (let u = -46; u <= -33; u++) {
    const zs = Math.max(2, Math.round(9 - (-33 - u) * 0.8));
    for (let v = -4; v <= 4; v++) { let any = false; for (let z = 0; z <= zs; z++) any ||= !!V.get(u, v, z); for (let z = zs + 1; z < V.nz; z++) V.set(u, v, z, 0); if (any) { V.set(u, v, zs, M.fdeck); if (u > -40 && hash01(u, v, 21) < 0.55) V.set(u, v, zs + 1, M.net); } }
  }
  for (const s of [-1, 1]) { V.box(-39, -38, s * 8, s * 8, 10, 28, M.orange); V.line([-37, s * 8, 10], [-37, s * 8, 18], M.orange); V.box(-37, -34, s * 13, s * 13, 11, 15, M.ironp); V.box(-37, -34, s * 13, s * 13, 15, 15, M.orange); }
  V.box(-39, -38, -8, 8, 28, 29, M.orange); V.box(-39, -39, -1, 1, 25, 27, M.iron); V.line([-39, 0, 25], [-39, 0, 17], M.iron);
  drum(V, -27, 12.5, 3, -6, 6, M.net); for (const v of [-7, 7]) { drum(V, -27, 12.5, 3.6, v, v, M.orange); V.box(-28, -26, v, v, 10, 11, M.orange); }
  // containers, fish boxes and the deck crane
  for (const [z, m, rib] of [[10, M.orange, M.copper], [13, M.stripe, M.navy]]) { V.box(-21, -14, 7, 10, z, z + 2, m); for (let u = -21; u <= -14; u += 2) { V.set(u, 7, z + 1, rib); V.set(u, 10, z + 1, rib); } }
  for (let u = -21; u <= -17; u += 2) for (let v = -11; v <= -9; v += 2) { const n = 1 + Math.floor(hash01(u, v, 22) * 3); for (let k = 0; k < n; k++) V.box(u, u + 1, v, v + 1, 10 + k, 10 + k, (u + v + k) & 2 ? M.stripe : M.window); }
  V.box(-11, -10, 8, 9, 10, 14, M.orange); V.box(-12, -9, 7, 10, 15, 16, M.flag); V.set(-9, 8, 16, M.window);
  V.line([-10, 8, 17], [-24, 3, 25], M.flag); V.line([-10, 9, 17], [-24, 4, 25], M.flag); V.line([-24, 3, 24], [-24, 3, 19], M.iron); V.box(-25, -24, 3, 3, 18, 18, M.iron);
  // the bow: windlass, foremast, harpoon gun with its coiled line
  for (const v of [-4, 2]) V.box(34, 35, v, v + 2, 13, 14, M.iron);
  V.box(32, 32, 0, 0, 13, 30, M.white); V.box(32, 32, -3, 3, 26, 26, M.white);
  V.box(40, 42, -1, 1, 13, 13, M.ironp); V.box(41, 41, 0, 0, 14, 15, M.iron); V.line([38, 0, 16], [46, 0, 17], M.iron); V.line([38, 0, 15], [45, 0, 16], M.iron);
  V.box(43, 43, -2, 2, 15, 17, M.ironp); V.set(47, 0, 17, M.steel); V.set(48, 0, 17, M.redp);
  for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) if (du || dv) V.set(38 + du, -4 + dv, 13, M.paint);
  sailor(V, -8, 10, M.orange);
  V.finalize();
})();
// smoke outlets in local [u, v, z] (top centre of each funnel)
export const FUNNEL: Partial<Record<BoatId, Vec3>> = { drifter: [-5, 0, 31], flagship: [-1, 0, 30] };

export interface BoatModel {
  vox: Vox;
  /** rowed: sprites and meshes get animated oars */
  oars?: boolean;
  /** sprite radius (room for the oars) and the height below which the dark contact edge is drawn */
  rad: number; outlineZ: number;
  /** the hull material that paint jobs replace */
  hull: number;
}
export const BOAT_MODELS: Record<BoatId, BoatModel> = {
  row: { vox: BOAT, oars: true, rad: BOAT_RAD, outlineZ: HZ + 1, hull: M.paint },
  skiff: { vox: SKIFF, rad: 21, outlineZ: 6, hull: M.skiff },
  launch: { vox: LAUNCH, rad: 22, outlineZ: 7, hull: M.navy },
  trawler: { vox: TRAWLER, rad: 28, outlineZ: 9, hull: M.trawl },
  schooner: { vox: SCHOONER, rad: 46, outlineZ: 10, hull: M.schoon },
  drifter: { vox: DRIFTER, rad: 42, outlineZ: 11, hull: M.coal },
  flagship: { vox: FLAGSHIP, rad: 50, outlineZ: 13, hull: M.fhull },
};
export const hasOars = (id: BoatId): boolean => !!BOAT_MODELS[id].oars;

// where gear goes on each hull: [u, v, z] (z = the layer the item sits on)
interface Mount {
  crew: Vec3; cook: Vec3; pump: Vec3; flag: Vec3; lamp: Vec3; sonar: Vec3;
  /** rod holder; only the first point is used */
  rod: [Vec3, Vec3];
  ice: Vec3; tackle: Vec3; net: Vec3 | null; ant: Vec3; anchor: Vec3;
  crates: Vec3[]; pile: Vec3[];
}
const MOUNT: Record<BoatId, Mount> = {
  row: { crew: [7, 0, 5], cook: [-10, -2, 5], pump: [-6, 3, 2], flag: [-13, 0, 6], lamp: [-12, 0, 6], sonar: [7, -2, 5], rod: [[-8, 4, 6], [-13, 8, 13]], ice: [-8, -2, 2], tackle: [-9, 2, 5], net: [10, 0, 7], ant: [-11, 4, 6], anchor: [12, 3, 6],
    crates: [[5, -3, 2], [3, -3, 2], [-10, 1, 5]], pile: [[3, -1, 2], [4, 1, 2], [5, -1, 2], [6, 1, 2], [3, 1, 2], [5, 1, 2]] },
  skiff: { crew: [-3, -2, 5], cook: [-9, 2, 2], pump: [-5, 3, 2], flag: [4, 0, 30], lamp: [-14, 3, 6], sonar: [7, 2, 5], rod: [[-8, 4, 5], [-13, 8, 12]], ice: [-6, -3, 2], tackle: [-2, 2, 5], net: [-10, 0, 2], ant: [-14, -3, 6], anchor: [15, 3, 6],
    crates: [[0, -3, 2], [0, 2, 2], [10, -2, 5]], pile: [[1, -1, 2], [2, 1, 2], [3, -1, 2], [1, 1, 2], [2, -2, 2], [3, 2, 2]] },
  launch: { crew: [9, -2, 8], cook: [-12, 2, 5], pump: [-10, -4, 2], flag: [-15, 2, 7], lamp: [-15, 0, 7], sonar: [2, -2, 11], rod: [[-12, 5, 6], [-17, 9, 13]], ice: [-14, -3, 2], tackle: [-14, 2, 2], net: [-4, 0, 2], ant: [0, 3, 11], anchor: [12, 0, 8],
    crates: [[8, -2, 8], [8, 2, 8], [10, 0, 8]], pile: [[-9, -2, 2], [-8, 1, 2], [-5, -2, 2], [-5, 2, 2], [-9, 2, 2], [-7, -1, 2]] },
  trawler: { crew: [10, -4, 6], cook: [-3, 3, 6], pump: [-15, -6, 6], flag: [5, 0, 28], lamp: [-5, -4, 15], sonar: [-13, -4, 15], rod: [[-14, 7, 9], [-19, 11, 16]], ice: [16, 1, 6], tackle: [7, -5, 6], net: null, ant: [-8, -4, 15], anchor: [21, 4, 10],
    crates: [[-2, 5, 6], [-2, -6, 6], [2, -6, 6]], pile: [[2, 3, 6], [3, -3, 6], [6, 2, 6], [7, -2, 6], [4, 4, 6], [8, 1, 6]] },
  schooner: { crew: [5, -5, 7], cook: [-16, 3, 7], pump: [-11, 5, 7], flag: [-31, 3, 11], lamp: [-30, -4, 11], sonar: [-23, 1, 12], rod: [[-16, 8, 10], [-22, 12, 17]], ice: [-14, -6, 7], tackle: [-11, -6, 7], net: [22, 0, 7], ant: [-21, -3, 12], anchor: [30, 3, 12],
    crates: [[16, 2, 7], [16, -4, 7], [0, 5, 7]], pile: [[-2, -2, 9], [-1, 0, 9], [0, 2, 9], [1, -1, 9], [2, 1, 9], [-2, 2, 9]] },
  drifter: { crew: [7, -7, 8], cook: [-22, 4, 8], pump: [-8, 5, 8], flag: [-30, 0, 33], lamp: [22, 0, 35], sonar: [-15, -3, 17], rod: [[-24, 8, 11], [-30, 13, 18]], ice: [-26, -6, 8], tackle: [-21, -5, 8], net: null, ant: [-12, 3, 17], anchor: [32, 4, 13],
    crates: [[23, 3, 8], [23, -4, 8], [-27, 4, 8]], pile: [[19, -3, 8], [19, 2, 8], [20, -1, 8], [20, 1, 8], [19, 4, 8], [19, -5, 8]] },
  flagship: { crew: [-12, -4, 10], cook: [-5, 5, 10], pump: [-34, -9, 10], flag: [-39, 0, 30], lamp: [32, 0, 31], sonar: [23, 3, 27], rod: [[-30, 12, 13], [-36, 15, 21]], ice: [-7, -10, 10], tackle: [-14, -10, 10], net: null, ant: [17, -8, 27], anchor: [40, 6, 13],
    crates: [[-2, -9, 10], [-2, 6, 10], [-12, 5, 10]], pile: [[-22, -2, 10], [-21, 1, 10], [-19, -4, 10], [-18, 3, 10], [-16, -1, 10], [-15, 2, 10]] },
};
function cloneVox(V: Vox): Vox { const c = new Vox(V.u0, V.u0 + V.nu - 1, V.v0, V.v0 + V.nv - 1, V.nz); c.d.set(V.d); return c; }
const PLATE = [0, M.copper, M.ironp, M.steel, M.gilt];   // hull plating material by level (0 = unplated)
const STRIPE: Record<BoatId, number> = { row: M.stripe, skiff: M.paint, launch: M.redp, trawler: M.redp, schooner: M.schband, drifter: M.dred, flagship: M.fband };   // the visible waterline band that plating replaces
/** What a boat visibly carries: paint, plating and the level of each piece of fitted gear (0 = none). */
export interface Fit {
  paint: string;
  plate: number; prop: number; lantern: number; sonar: number; rod: number; ice: number; tackle: number;
  net: number; radio: number; anchor: number; hold: number;
  /** fish piled on deck, 0..3 */
  pile: number;
  deckhand: number; cook: number; quarter: number; bilge: number; reel: number;
  /** 1 if the ship's cat is aboard */
  pet: number;
  pots: number; harpoon: number; bell: number;
  /** the captain's own look on the rowboat (see lookSeed); 0 or missing is the plain classic look */
  look?: number;
}
type Put = (u: number, v: number, z: number, m: number) => void;

// ---------- the captain's look ----------
// Every rowboat is a little different: the rower's coat and hat, the trim along the gunwale, a pennant at the stern
// and what sits on the stern seat all come from a hash of the captain's name, so everyone sees the same boat for you.
// Paint jobs still colour the hull and plating still covers the trim; gear fitted later takes the stern seat.
const LOOK_COAT = [M.coat, mat(['#7e3a26', '#b0523a', '#d0705a']), mat(['#2e5a46', '#3f7a5e', '#5a9a78']), M.stripe,
  mat(['#4e2e4a', '#6e4268', '#8e5a88']), mat(['#1f5a5e', '#2e7a7e', '#4a9a9a']), M.orange, M.paint];
const LOOK_HAT = [M.hat, M.redp, mat(['#24382a', '#33503a', '#4a6a48']), mat(['#4a5258', '#6a747a', '#8a9298']), M.door, M.flag];
const LOOK_TRIM = [M.stripe, M.redp, M.net, mat(['#8a6a1e', '#c49a32', '#e2b94a']), mat(['#1f5a5e', '#2e7a7e', '#4a9a9a']), mat(['#4e2e4a', '#6e4268', '#8e5a88']), M.iron];
const LOOK_FLAG = [M.redp, M.white, M.stripe, M.flag, M.net, M.orange];
interface Look { coat: number; hat: number; trim: number; flagA: number; flagB: number; split: boolean; stern: number }
const looks = new Map<number, Look>();
/** A stable non-zero look seed from a captain's name (FNV-1a). */
export function lookSeed(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) || 1;
}
function lookOf(seed: number | undefined): Look | null {
  if (!seed) return null;
  let l = looks.get(seed);
  if (!l) {
    let h = seed >>> 0;
    const pick = (n: number): number => { const r = h % n; h = (Math.floor(h / n) ^ (Math.imul(h, 0x9e3779b1) >>> 7)) >>> 0; return r; };
    const coat = pick(LOOK_COAT.length), hat = (coat + 1 + pick(LOOK_HAT.length - 1)) % LOOK_HAT.length;   // never coat-coloured
    const a = pick(LOOK_FLAG.length), b = (a + 1 + pick(LOOK_FLAG.length - 1)) % LOOK_FLAG.length;
    l = { coat: LOOK_COAT[coat], hat: LOOK_HAT[hat], trim: LOOK_TRIM[pick(LOOK_TRIM.length)], flagA: LOOK_FLAG[a], flagB: LOOK_FLAG[b], split: pick(2) === 1, stern: pick(4) };
    looks.set(seed, l);
  }
  return l;
}
/** The rower's coat material for a look seed, for the oar arms drawn outside the model. */
export const lookCoat = (seed: number | undefined): number => lookOf(seed)?.coat ?? M.coat;
/** The pennant on a staff at the stern, streaming aft, and one thing on the stern seat. Only fills empty space. */
function lookExtras(eq: Fit, put: Put): void {
  const lk = lookOf(eq.look);
  if (!lk) return;
  for (let z = 7; z <= 9; z++) put(-13, 0, z, M.post);
  for (const [u, v] of [[-14, 0], [-14, 1], [-15, 0], [-15, 1], [-16, 0]]) put(u, v, 9, lk.split && u <= -15 ? lk.flagB : u === -16 ? lk.flagB : lk.flagA);
  const u = -9, v = -1, z = 5;
  if (lk.stern === 0) { put(u, v, z, M.iron); put(u, v + 1, z, M.iron); put(u - 1, v, z, M.iron); put(u - 1, v + 1, z, M.window); }   // a bucket of water
  else if (lk.stern === 1) { put(u, v, z, lk.trim); put(u, v + 1, z, lk.trim); put(u - 1, v, z, lk.trim); put(u - 1, v + 1, z, lk.trim); put(u, v, z + 1, lk.trim); }   // a folded tarp
  else if (lk.stern === 2) { put(u, v, z, M.crate); put(u - 1, v, z, M.crate); put(u, v + 1, z, M.band); put(u - 1, v + 1, z, M.crate); put(u, v, z + 1, M.crate); }   // a bait box
  else { put(u, v, z, M.wetp); put(u - 1, v + 1, z, M.wetp); put(u, v + 1, z, M.fishm); }   // a net bag
}

// paint jobs swap the hull material; plating swaps the bottom and the waterline band; better sails get red cloth
function recolour(id: BoatId, eq: Fit, V: Vox): void {
  const bm = BOAT_MODELS[id], remap = new Map<number, number>();
  if (eq.paint !== 'classic' && PAINT_MAT[eq.paint]) remap.set(bm.hull, PAINT_MAT[eq.paint]);
  const lk = id === 'row' ? lookOf(eq.look) : null;
  if (lk) { remap.set(M.coat, lk.coat); remap.set(M.hat, lk.hat); remap.set(M.stripe, lk.trim); }
  if (eq.plate > 0) { remap.set(M.bottom, PLATE[eq.plate]); remap.set(STRIPE[id], PLATE[eq.plate]); }
  const layer = V.nu * V.nv, sails = id === 'skiff' || id === 'schooner';
  for (let i = 0; i < V.d.length; i++) {
    const r = remap.get(V.d[i]);
    if (r) V.d[i] = r;
    if (sails && V.d[i] === M.sail && eq.prop >= 2) V.d[i] = eq.prop >= 4 ? M.sailred : Math.floor(i / layer) % 4 === 0 ? M.sailred : M.sail;
  }
}
function deckGear(V: Vox, m: Mount, eq: Fit): void {
  if (eq.lantern > 0) {
    const [u, v, z] = m.lamp;
    V.box(u, u, v, v, z, z + 3, M.iron); V.set(u, v, z + 4, M.lamp);
    if (eq.lantern >= 2) { V.set(u, v, z + 5, M.lamp); V.set(u, v, z + 6, M.iron); }
    if (eq.lantern >= 3) { V.set(u + 1, v, z + 4, M.lamp); V.set(u - 1, v, z + 4, M.lamp); }
  }
  if (eq.sonar > 0) {
    const [u, v, z] = m.sonar;
    V.box(u, u + 1, v, v + 1, z, z, M.iron); V.set(u + 1, v, z, M.window);
    if (eq.sonar >= 2) V.box(u, u + 1, v, v + 1, z + 1, z + 1, M.white);
    if (eq.sonar >= 3) V.line([u, v, z + 2], [u, v, z + 6], M.iron);
  }
  for (let k = 0; k < Math.min(3, eq.rod + 1); k++) {
    // a light bamboo rod resting in a holder on the gunwale, leaning out over the water (not straight up,
    // where a dark pole read as a smoke plume); white tip, iron reel at the butt
    const [[u0, v0, z0]] = m.rod, sg = k % 2 ? -1 : 1, du = -2 * Math.floor(k / 2);
    const B: Vec3 = [u0 + du, sg * v0, z0], T: Vec3 = [u0 + du - 3, sg * (v0 + 7), z0 + 4];
    const at = (f: number): Vec3 => [B[0] + (T[0] - B[0]) * f, B[1] + (T[1] - B[1]) * f, B[2] + (T[2] - B[2]) * f];
    V.line(B, at(0.75), M.seat);
    V.line(at(0.8), T, M.white);
    V.set(B[0], B[1], B[2], M.iron);
  }
  if (eq.ice > 0) {
    const [u, v, z] = m.ice;
    V.box(u, u + 2, v, v + 2, z, z + 1, M.white); V.box(u, u + 2, v, v + 2, z + 1, z + 1, eq.ice >= 3 ? M.stripe : M.white); V.set(u + 1, v + 1, z + 1, M.stripe);
  }
  if (eq.tackle > 0) { const [u, v, z] = m.tackle; V.box(u, u + 1, v, v + 1, z, z, M.tackle); V.set(u, v, z, M.flag); }
  if (eq.net > 0 && m.net) {
    const [u, v, z] = m.net;
    V.box(u, u, v - 3, v + 3, z, z, M.net);
    if (eq.net >= 2) V.box(u - 1, u - 1, v - 2, v + 2, z, z, M.net);
  }
  if (eq.radio > 0) { const [u, v, z] = m.ant; V.line([u, v, z], [u, v, z + 9], M.iron); V.set(u, v, z + 10, M.redp); }
  if (eq.anchor > 0) {
    const [u, v, z] = m.anchor;
    V.line([u, v, z], [u, v, z - 3], M.iron); V.box(u - 1, u + 1, v, v, z - 3, z - 3, M.iron); V.set(u - 1, v, z - 2, M.iron); V.set(u + 1, v, z - 2, M.iron);
  }
}
// cargo crates for the hold upgrade and the catch piled on deck
function cargo(m: Mount, eq: Fit, put: Put): void {
  for (let k = 0; k < Math.min(3, eq.hold); k++) {
    const [u, v, z] = m.crates[k];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { put(u + a, v + b, z, M.crate); put(u + a, v + b, z + 1, (a + b) % 2 ? M.crate : M.band); }
  }
  for (let k = 0; k < Math.min(m.pile.length, eq.pile * 2); k++) {
    const [u, v, z] = m.pile[k];
    put(u, v, z, M.fishm); put(u + 1, v, z, k % 3 ? M.fishm : M.stripe);
  }
}
function crewAndFittings(V: Vox, m: Mount, eq: Fit, put: Put): void {
  const figure = (u: number, v: number, z: number, coat: number, hat: number) => {
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      put(u + a, v + b, z, coat); put(u + a, v + b, z + 1, coat); put(u + a, v + b, z + 2, M.skin); put(u + a, v + b, z + 3, hat);
    }
  };
  if (eq.deckhand > 0) { const [u, v, z] = m.crew; figure(u, v, z, eq.deckhand >= 2 ? M.redp : M.stripe, M.hat); }
  if (eq.cook > 0) {                               // in whites, with a tall hat
    const [u, v, z] = m.cook;
    figure(u, v, z, M.white, M.white); put(u, v, z + 4, M.white); put(u + 1, v + 1, z + 4, M.white);
  }
  if (eq.quarter > 0) {                            // the quartermaster flies a pennant
    const [u, v, z] = m.flag, cloth = eq.quarter >= 2 ? M.flag : M.redp;
    V.line([u, v, z], [u, v, z + 6], M.iron);
    for (let k = 0; k < 4; k++) { put(u - 1 - k, v, z + 6, cloth); if (k < 3) put(u - 1 - k, v, z + 5, cloth); }
  }
  if (eq.bilge > 0) {
    const [u, v, z] = m.pump;
    put(u, v, z, M.redp); put(u, v, z + 1, M.redp); put(u, v + 1, z, M.iron);
    if (eq.bilge >= 2) put(u + 1, v, z, M.redp);
  }
  if (eq.reel > 0) { const [[u0, v0, z0]] = m.rod; put(u0 - 1, v0, z0 + 1, M.gilt); }
}
// dry dock gear: a stack of crab pots, a bow harpoon gun, a brass diving bell
function dryDockGear(m: Mount, eq: Fit, put: Put): void {
  if (eq.pots > 0) {
    const [u, v, z] = m.crates[Math.min(2, m.crates.length - 1)];
    for (let k = 0; k < Math.min(3, eq.pots); k++) {
      const uu = u - k * 3;
      for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) { put(uu + a, -v + c, z, M.net); put(uu + a, -v + c, z + 1, (a + c) % 2 ? M.net : M.post); }
    }
  }
  if (eq.harpoon > 0) {
    const [u, , z] = m.anchor;
    put(u - 3, 0, z + 1, M.iron); put(u - 3, 0, z + 2, M.iron);
    for (let k = 0; k < 4; k++) put(u - 3 + k, 0, z + 3, k === 3 ? M.white : M.iron);
  }
  if (eq.bell > 0) {
    const [u, v, z] = m.ice;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      put(u + a - 4, -v + c, z, M.copper);
      if (!a || !c) put(u + a - 4, -v + c, z + 1, M.copper);
    }
    put(u - 4, -v, z + 2, M.copper); put(u - 4, -v, z + 3, M.iron);
  }
}
// the ship's cat curls up on a free deck spot toward the stern
function shipsCat(V: Vox): void {
  const L = Math.floor(V.u0 + V.nu * 0.3);
  const top = (u: number, v: number) => { for (let z = V.nz - 1; z >= 0; z--) if (V.get(u, v, z)) return z; return -1; };
  // prefer a high, flat perch (a seat or cabin roof) so the cat shows above the gunwales
  let spot: Vec3 | null = null, best = -1e9;
  for (let du = -14; du <= 14; du++) for (const v of [0, -1, 1, -2, 2, -3]) {
    const u = L + du, z = top(u, v) + 1;
    const flat = [0, 1, 2].every(k => top(u + k, v) + 1 === z && top(u + k, v + 1) + 1 === z);
    if (z < 2 || z > 13 || !flat || V.get(u - 1, v, z + 1)) continue;
    const score = z - Math.abs(du) * 0.15 - Math.abs(v) * 0.3;
    if (score > best) { best = score; spot = [u, v, z]; }
  }
  if (!spot) return;
  // a white cat with ginger patches, loafing: body 3x2, head up front, ears, tail
  const [u, v, z] = spot;
  V.box(u, u + 2, v, v + 1, z, z, M.cat); V.box(u, u + 1, v, v + 1, z + 1, z + 1, M.cat); V.set(u, v + 1, z + 1, M.catd);
  V.box(u + 2, u + 2, v, v + 1, z + 1, z + 2, M.catd); V.set(u + 2, v, z + 3, M.catd); V.set(u + 2, v + 1, z + 3, M.catd);
  V.set(u - 1, v, z, M.catd); V.set(u - 1, v, z + 1, M.catd);
}
/** The boat's voxel model with this fit-out applied (a fresh copy, finalized). */
export function decorate(id: BoatId, eq: Fit): Vox {
  const V = cloneVox(BOAT_MODELS[id].vox), m = MOUNT[id];
  const put: Put = (u, v, z, mt) => { if (!V.get(u, v, z)) V.set(u, v, z, mt); };   // only into empty space
  recolour(id, eq, V);
  deckGear(V, m, eq);
  cargo(m, eq, put);
  crewAndFittings(V, m, eq, put);
  dryDockGear(m, eq, put);
  if (eq.pet) shipsCat(V);
  if (id === 'row') lookExtras(eq, put);
  if (id === 'launch' && eq.prop >= 3) for (const v of [-3, 3]) {   // twin outboards
    V.box(-19, -17, v - 1, v, 3, 8, M.iron); V.box(-19, -17, v - 1, v, 9, 9, M.redp);
  }
  return V.finalize();
}
/** cache key for a decorated model: every fit field that changes how the boat looks */
export const eqSig = (id: BoatId, eq: Fit): string => [
  id, eq.paint, eq.plate, eq.prop, eq.lantern, eq.sonar, Math.min(2, eq.rod), eq.ice, eq.tackle, eq.net, eq.radio, eq.anchor,
  Math.min(3, eq.hold), eq.pile, eq.deckhand | 0, eq.cook | 0, eq.quarter | 0, eq.pet | 0, eq.pots | 0, eq.harpoon | 0, eq.bell | 0,
  eq.bilge | 0, eq.reel ? 1 : 0, id === 'row' ? eq.look ?? 0 : 0,
].join('|');
interface SpriteModel { vox: Vox; frames: Map<number, VoxFrame> }
const models = new Map<string, SpriteModel>();   // signature -> model and its rendered frames, most recent last
function modelFor(id: BoatId, eq: Fit): SpriteModel {
  const sig = eqSig(id, eq);
  let m = models.get(sig);
  if (m) { models.delete(sig); models.set(sig, m); return m; }
  m = { vox: decorate(id, eq), frames: new Map() };
  models.set(sig, m);
  while (models.size > 4) models.delete(models.keys().next().value!);
  return m;
}
/** the bare boat: classic paint, no gear */
export const PLAIN: Fit = {
  paint: 'classic', plate: 0, prop: 0, lantern: 0, sonar: 0, rod: 0, ice: 0, tackle: 0, net: 0, radio: 0, anchor: 0, hold: 0, pile: 0,
  deckhand: 0, cook: 0, quarter: 0, bilge: 0, reel: 0, pet: 0, pots: 0, harpoon: 0, bell: 0,
};
/** Sprite of a boat at heading index ai (of NA) and oar pose (of NP, or SHIPPED); cached per fit-out. */
export function boatFrame(id: BoatId, ai: number, pose: number, eq: Fit = PLAIN): VoxFrame {
  const bm = BOAT_MODELS[id], m = modelFor(id, eq), k = ai * 16 + (bm.oars ? pose : 0);
  let f = m.frames.get(k);
  if (!f) {
    const g = bm.oars ? oarGeom(pose, eq.prop, pose, lookCoat(eq.look)) : { lines: [], points: [] };
    f = renderVox(m.vox, ai / NA * Math.PI * 2, { ...g, rad: bm.rad + 3, outlineZ: bm.outlineZ });
    m.frames.set(k, f);
  }
  return f;
}

// ---------- lighthouse ----------
export const LIGHTHOUSE = new Vox(-13, 13, -13, 13, 35);
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
export const HARBOUR = new Vox(-20, 29, -9, 9, 16);
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
export const WRECK = new Vox(-24, 24, -12, 12, 16);
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
export const CRATE = new Vox(-3, 3, -3, 3, 5);
(() => { CRATE.box(-2, 2, -2, 2, 0, 3, M.crate); for (const u of [-2, 2]) CRATE.box(u, u, -2, 2, 0, 3, M.band); CRATE.box(-2, 2, -2, 2, 0, 0, M.band); CRATE.finalize(); })();

