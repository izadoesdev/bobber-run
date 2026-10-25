// Landmark models: harbours, lighthouses and wrecks, a few designs of each so no two places along the coast look
// the same. A place's design comes from its position (no strings hashed per frame). Harbours keep their pier along
// +u out to the lamp at u = 27 (world.ts puts the pier end at 26 and the dock at 44); inland is -u.
import { Vox, mat } from './voxel';
import { hash01 } from './noise';
import { M } from './models';
import type { Poi } from './types';

export const L = {
  roofD: mat(['#5a2420', '#7e302a', '#a03e34']), slate: mat(['#2a3440', '#3c4a58', '#566676']), slateD: mat(['#222b35', '#323e4a', '#485666']),
  ochre: mat(['#8a6a3a', '#b8904e', '#d8b06a']), ochreD: mat(['#7a5c30', '#a07c42', '#c09a5a']), thatch: mat(['#7a6436', '#a88a4a', '#ccae66']),
  thatchD: mat(['#6a5630', '#927840', '#b49858']), wall2: mat(['#7c8a8e', '#a8b6b8', '#cfdadb']), timber: mat(['#3a2818', '#54402a', '#6e5638']),
  stone2: mat(['#4e5862', '#76808a', '#9ea8ae']), moss: mat(['#3a5230', '#527040', '#6e8c50']), sand: mat(['#a8946a', '#cdb88a', '#e6d6aa']),
  verd: mat(['#2e6a5a', '#3f8a74', '#62b098']), brass: mat(['#8a6a1e', '#c49a32', '#f0cf6a']), awnW: mat(['#b8b0a0', '#e6e0d2', '#fbf8ee']),
  awnR: mat(['#7e2c25', '#b0423a', '#d0594c']), awnB: mat(['#22405e', '#30587e', '#4a7aa4']), flower: mat(['#9a3a5a', '#d05a7a', '#f08aa4']),
  flower2: mat(['#a88a1e', '#e0be3a', '#fae07a']), hay: mat(['#8a7436', '#b89a4a', '#d8be6a']), smoke: mat(['#5a5e62', '#7e8488', '#a2a8ac']),
  lit: mat(['#a8742a', '#e0a84a', '#f6d27a'], true), navyS: mat(['#14243a', '#203a5a', '#345a84']), rust: mat(['#5e3020', '#84442a', '#a8603c']), funnel: mat(['#14191c', '#22282c', '#3a4248']),
};
const h = (a: number, b: number, s: number): number => hash01(a + 101, b + 37, s);

// ---------- props, shared by every design ----------
/** A gable roof over the box u0..u1 x v0..v1 with its ridge along u, in shingle rows, starting at height z. */
export function gable(V: Vox, u0: number, u1: number, v0: number, v1: number, z: number, a: number, b: number, ridge = a): void {
  for (let k = 0; v0 + k <= v1 - k; k++) {
    const lo = v0 + k, hi = v1 - k, m = k % 2 ? b : a;
    V.box(u0, u1, lo, hi, z + k, z + k, lo >= hi - 1 ? ridge : m);
  }
}
/** The same with its ridge along v. */
function gableV(V: Vox, u0: number, u1: number, v0: number, v1: number, z: number, a: number, b: number, ridge = a): void {
  for (let k = 0; u0 + k <= u1 - k; k++) {
    const lo = u0 + k, hi = u1 - k, m = k % 2 ? b : a;
    V.box(lo, hi, v0, v1, z + k, z + k, lo >= hi - 1 ? ridge : m);
  }
}
/** Walls of a house from z0 up to z1 with dark corner posts, hollow inside (only the shell shows). */
export function walls(V: Vox, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, m: number, post = L.timber): void {
  V.box(u0, u1, v0, v1, z0, z1, m);
  for (const u of [u0, u1]) for (const v of [v0, v1]) V.box(u, u, v, v, z0, z1, post);
}
export function barrel(V: Vox, u: number, v: number, z: number): void {
  V.box(u, u + 1, v, v + 1, z, z + 2, M.crate); V.box(u, u + 1, v, v + 1, z + 1, z + 1, M.band); V.set(u, v, z + 2, M.plank2);
}
export function crate(V: Vox, u: number, v: number, z: number, s = 2): void {
  V.box(u, u + s - 1, v, v + s - 1, z, z + s - 1, M.crate);
  V.box(u, u + s - 1, v, v + s - 1, z + s - 1, z + s - 1, M.plank);
  if (s > 2) { V.box(u, u, v, v + s - 1, z, z + s - 1, M.band); V.box(u + s - 1, u + s - 1, v, v + s - 1, z, z + s - 1, M.band); }
}
/** A basket of the day's catch. */
export function basket(V: Vox, u: number, v: number, z: number): void { V.box(u, u + 1, v, v + 1, z, z, L.thatchD); V.box(u, u + 1, v, v + 1, z + 1, z + 1, M.fishm); }
export function lampPost(V: Vox, u: number, v: number, z: number, tall = 4): void { V.box(u, u, v, v, z, z + tall, M.iron); V.set(u, v, z + tall + 1, M.lamp); }
function bollard(V: Vox, u: number, v: number, z: number): void { V.box(u, u, v, v, z, z + 1, M.post); V.set(u, v, z + 1, M.iron); }
export function coil(V: Vox, u: number, v: number, z: number): void { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) V.set(u + a, v + b, z, M.rope); V.set(u, v, z, M.ropeD); }
function flowers(V: Vox, u0: number, u1: number, v: number, z: number): void {
  for (let u = u0; u <= u1; u++) { V.set(u, v, z, M.plank2); V.set(u, v, z + 1, (u & 1) ? L.flower : L.flower2); }
}
/** A rough outcrop of rock centred on (cu, cv), mossy on top. */
export function rocks(V: Vox, cu: number, cv: number, r: number, zmax: number, seed: number): void {
  for (let u = cu - r - 1; u <= cu + r + 1; u++) for (let v = cv - r - 1; v <= cv + r + 1; v++) {
    const d = Math.hypot(u - cu, v - cv) / (r * (0.75 + 0.5 * h(u, v, seed)));
    if (d > 1) continue;
    const top = Math.round((1 - d) * zmax + h(u, v, seed + 1) * 1.5);
    for (let z = 0; z <= top; z++) V.set(u, v, z, z === top && h(u >> 1, v >> 1, seed + 2) < 0.4 ? L.moss : h(u >> 1, (v >> 1) * 3 + (z >> 1), seed + 3) < 0.6 ? M.stone : L.stone2);
  }
}
/** A short pier of planks along +u from u0 to u1 at deck height z, on posts every few planks, with bollards. */
function pier(V: Vox, u0: number, u1: number, w: number, z: number): void {
  for (let u = u0; u <= u1; u++) for (let v = -w; v <= w; v++) V.set(u, v, z, (u >> 1) % 2 ? M.plank : M.plank2);
  for (let u = u0 + 2; u <= u1; u += 7) for (const v of [-w - 1, w + 1]) V.box(u, u, v, v, 0, z + 1, M.post);
  for (const v of [-w - 1, w + 1]) V.box(u1, u1, v, v, 0, z + 1, M.post);
  for (const u of [u0 + 9, u0 + 18]) if (u < u1) bollard(V, u, -w, z + 1);
}
/** A small rowing skiff moored alongside, bow +u. */
export function skiff(V: Vox, u0: number, v: number, paint: number): void {
  for (let u = 0; u <= 9; u++) {
    const hw = u < 2 ? 1 : u > 7 ? (u === 9 ? 0 : 1) : 2;
    for (let dv = -hw; dv <= hw; dv++) {
      V.set(u0 + u, v + dv, 0, M.bottom);
      V.set(u0 + u, v + dv, 1, Math.abs(dv) === hw || u === 0 || u === 9 ? paint : M.floor);
    }
  }
  V.box(u0 + 4, u0 + 5, v - 1, v + 1, 2, 2, M.seat); V.set(u0 + 9, v, 2, M.gun);
}
/** A rack of nets hung to dry between two posts, running along v. */
export function netRack(V: Vox, u: number, v0: number, v1: number, z: number): void {
  for (const v of [v0, v1]) V.box(u, u, v, v, z, z + 4, M.post);
  for (let v = v0 + 1; v < v1; v++) for (let k = 1; k <= 3; k++) if ((v + k) % 2 || k === 1) V.set(u, v, z + 5 - k, M.net);
  V.box(u, u, v0, v1, z + 5, z + 5, M.post);
}
function flagpole(V: Vox, u: number, v: number, z: number, a = M.flag, b = M.redp): void {
  V.box(u, u, v, v, z, z + 13, M.iron); V.box(u + 1, u + 5, v, v, z + 10, z + 12, a); V.box(u + 3, u + 5, v, v, z + 11, z + 11, b);
}

// ---------- harbours ----------
const HU0 = -26, HU1 = 29, HV = 14, HZ = 22;
/** Alderhaven-style fishing village: a long fish hall, a net loft, a market stall, a skiff alongside. */
function harbourVillage(): Vox {
  const P = new Vox(HU0, HU1, -HV, HV, HZ);
  P.box(-8, 0, -7, 7, 0, 2, M.stone); P.box(-8, 0, -7, 7, 3, 3, M.plank2);      // the quay
  for (let u = -8; u <= 0; u += 2) for (let v = -7; v <= 7; v += 3) P.set(u, v, 3, M.plank);
  pier(P, 0, 27, 2, 3);
  lampPost(P, 27, 2, 4, 4); P.set(27, 3, 8, M.iron);
  // the fish hall: white walls, timber corners, red roof, a chimney, the door toward the pier
  walls(P, -21, -9, -7, 5, 1, 7, M.white);
  P.box(-9, -9, -2, 0, 1, 5, M.door); for (const v of [-5, 3]) P.box(-9, -9, v, v, 4, 5, L.lit); for (const u of [-18, -14]) P.box(u, u + 1, 5, 5, 4, 5, L.lit);
  gable(P, -22, -8, -8, 6, 8, M.roof, L.roofD, M.redp);
  P.box(-12, -11, 2, 3, 8, 15, M.stone); P.box(-12, -11, 2, 3, 16, 16, M.iron);
  // a net loft with a blue door, slate roof
  walls(P, -21, -15, 8, 13, 1, 6, L.wall2);
  P.box(-15, -15, 10, 11, 1, 4, L.awnB); P.box(-18, -17, 8, 8, 4, 5, L.lit);
  gableV(P, -22, -14, 7, 14, 7, L.slate, L.slateD, M.iron);
  // a market stall with a striped awning by the quay
  for (const [u, v] of [[-6, 8], [-2, 8], [-6, 12], [-2, 12]]) P.box(u, u, v, v, 1, 5, M.post);
  P.box(-6, -2, 8, 12, 2, 2, M.plank); for (let u = -6; u <= -2; u++) for (let v = 8; v <= 12; v++) P.set(u, v, 6, (u + 40) % 2 ? L.awnR : L.awnW);
  basket(P, -5, 9, 3); basket(P, -3, 10, 3); P.set(-4, 11, 3, M.fishm);
  // the quay's clutter: barrels, crates, a coil of rope, nets drying, flower boxes under the hall windows
  barrel(P, -7, -6, 4); barrel(P, -5, -6, 4); barrel(P, -6, -4, 4); crate(P, -3, -7, 4, 3); crate(P, -3, -7, 7);
  coil(P, 12, 1, 4); crate(P, 20, -2, 4); basket(P, 6, -2, 4);
  netRack(P, -12, -13, -9, 1);
  flowers(P, -20, -10, -8, 4);
  skiff(P, 8, -6, M.skiff);
  flagpole(P, -24, -2, 1);
  return P.finalize();
}
/** A stone quay with a warehouse and a timber crane. */
function harbourQuay(): Vox {
  const P = new Vox(HU0, HU1, -HV, HV, HZ);
  P.box(-10, 3, -9, 9, 0, 3, M.stone);
  for (let u = -10; u <= 3; u++) for (const v of [-9, 9]) if (u % 3 !== 0) P.set(u, v, 4, L.stone2);   // a parapet with gaps
  for (let u = -10; u <= 3; u += 3) for (let v = -8; v <= 8; v += 4) P.set(u, v, 3, L.stone2);
  pier(P, 3, 27, 2, 3);
  lampPost(P, 27, 2, 4, 4); P.set(27, 3, 8, M.iron); lampPost(P, 2, -8, 4, 4); lampPost(P, 2, 8, 4, 4);
  // the warehouse: ochre walls, big doors, slate roof running along the quay
  walls(P, -24, -11, -9, 6, 1, 9, L.ochre);
  P.box(-11, -11, -4, 0, 1, 7, M.door); P.box(-11, -11, -4, 0, 4, 4, M.band);
  for (const v of [-8, 4]) P.box(-11, -11, v, v + 1, 6, 7, L.lit); for (const u of [-21, -17, -14]) P.box(u, u, 6, 6, 6, 7, L.lit);
  gable(P, -25, -10, -10, 7, 10, L.slate, L.slateD, M.iron);
  // a timber crane at the quay's edge, a crate hanging from its jib
  P.box(-1, 0, 5, 6, 4, 16, M.post); P.line([0, 6, 16], [8, 6, 13], M.post); P.line([0, 5, 16], [8, 5, 13], M.post);
  P.box(8, 8, 5, 5, 9, 12, M.rope); crate(P, 7, 4, 6, 3);
  P.box(-2, 1, 4, 7, 4, 4, M.plank2);
  // crates stacked to ship, barrels, sacks
  crate(P, -8, -8, 4, 3); crate(P, -5, -8, 4, 3); crate(P, -8, -8, 7, 3); crate(P, -6, -5, 4);
  barrel(P, -9, 4, 4); barrel(P, -7, 4, 4); barrel(P, -9, 6, 4);
  for (const [u, v] of [[-4, 2], [-3, 3], [-5, 3]]) P.box(u, u, v, v, 4, 5, L.hay);
  coil(P, 14, -1, 4); bollard(P, 26, 2, 4);
  // a harbourmaster's office with a red roof and a flag
  walls(P, -22, -16, 9, 13, 1, 6, M.white); P.box(-16, -16, 10, 11, 1, 4, M.door); P.box(-19, -18, 9, 9, 4, 5, L.lit);
  gableV(P, -23, -15, 8, 14, 7, M.roof, L.roofD, M.redp);
  flagpole(P, -14, 13, 1, L.awnB, L.awnW);
  return P.finalize();
}
/** Fishing shacks on stilts over the shallows, drying racks, a boat pulled up on the sand. */
function harbourStilts(): Vox {
  const P = new Vox(HU0, HU1, -HV, HV, HZ);
  pier(P, -1, 27, 2, 3);
  lampPost(P, 27, -2, 4, 4); P.set(27, -3, 8, M.iron);
  // two shacks on stilts either side of the pier, thatched, with ladders down to the water
  const shack = (u0: number, v0: number, v1: number, wall: number) => {
    for (const u of [u0, u0 + 6]) for (const v of [v0, v1]) P.box(u, u, v, v, 0, 4, M.post);
    P.box(u0, u0 + 6, v0, v1, 4, 4, M.plank2);
    walls(P, u0 + 1, u0 + 5, v0 + 1, v1 - 1, 5, 8, wall);
    P.box(u0 + 3, u0 + 3, v0 + 1, v0 + 1, 5, 7, M.door);
    gable(P, u0, u0 + 6, v0, v1, 9, L.thatch, L.thatchD, L.thatchD);
  };
  shack(6, 4, 10, L.wall2); shack(15, -10, -4, M.white);
  P.box(9, 9, 3, 3, 3, 4, M.plank2); P.box(18, 18, -3, -3, 3, 4, M.plank2);   // gangways to the pier
  // the smokehouse ashore, a stone chimney trailing smoke
  walls(P, -20, -12, -6, 3, 1, 6, M.stone); P.box(-12, -12, -2, -1, 1, 4, M.door);
  gable(P, -21, -11, -7, 4, 7, M.roof, L.roofD, M.redp);
  P.box(-17, -16, -1, 0, 7, 14, L.stone2); P.set(-17, -1, 15, L.smoke); P.set(-16, 0, 16, L.smoke); P.set(-17, 0, 17, L.smoke);
  // fish drying on racks, a boat on the sand, baskets
  for (const v of [5, 9]) { P.box(-9, -9, v, v, 1, 5, M.post); P.box(-3, -3, v, v, 1, 5, M.post); P.box(-9, -3, v, v, 5, 5, M.post); for (let u = -8; u <= -4; u += 2) P.set(u, v, 4, M.fishm); }
  skiff(P, -11, -11, L.awnB);
  basket(P, -2, -6, 2); basket(P, 1, 4, 4); barrel(P, -5, -7, 2);
  netRack(P, -22, 6, 11, 1);
  coil(P, 24, 1, 4);
  return P.finalize();
}
export const HARBOURS: (() => Vox)[] = [harbourVillage, harbourQuay, harbourStilts];

// ---------- lighthouses ----------
const LR = 16, LZ = 42;
/** Where each lighthouse design's lantern room starts; the renderer hangs its lamp and beam at LAMP_Z. */
const LANTERN_Z = [28, 27, 30];
export const LAMP_Z = LANTERN_Z.map(z => z + 2.5);
/** A tower of rings from z0 to z1, its radius tapering from r0 to r1; `paint(z, u, v)` picks each voxel's material. */
function tower(V: Vox, z0: number, z1: number, r0: number, r1: number, paint: (z: number, u: number, v: number) => number): void {
  for (let z = z0; z <= z1; z++) {
    const r = r0 + (r1 - r0) * (z - z0) / Math.max(1, z1 - z0);
    for (let u = -7; u <= 7; u++) for (let v = -7; v <= 7; v++) { const d = Math.hypot(u, v); if (d <= r && d > r - 1.6) V.set(u, v, z, paint(z, u, v)); else if (d <= r - 1.6 && (z === z0 || z === z1)) V.set(u, v, z, M.plank2); }
  }
}
/** The gallery, lantern room and cap on top of a tower ending at z. */
function lantern(V: Vox, z: number, rail: number, dome: number, domeB: number): number {
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) { const d = Math.hypot(u, v); if (d <= 5.6) V.set(u, v, z, rail); if (d > 4.8 && d <= 5.8 && (u + v) % 2 === 0) V.set(u, v, z + 1, rail); }
  for (let k = 1; k <= 4; k++) for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) {
    const d = Math.hypot(u, v); if (d > 2.7) continue;
    V.set(u, v, z + k, (u === 0 || v === 0) && d > 2 ? rail : d < 1.2 ? M.lamp : M.glass);
  }
  const top = z + 5;
  for (const [k, r] of [[0, 3.5], [1, 2.6], [2, 1.6]] as const) for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) if (Math.hypot(u, v) <= r) V.set(u, v, top + k, k === 1 ? domeB : dome);
  V.set(0, 0, top + 3, rail); V.set(0, 0, top + 4, L.brass);
  return top + 4;
}
/** A keeper's cottage beside the tower, door facing +v. */
export function cottage(V: Vox, u0: number, v0: number, wall: number, roofA: number, roofB: number): void {
  walls(V, u0, u0 + 7, v0, v0 + 5, 1, 5, wall);
  V.box(u0 + 3, u0 + 4, v0 + 5, v0 + 5, 1, 3, M.door); V.box(u0 + 1, u0 + 1, v0 + 5, v0 + 5, 3, 4, L.lit); V.box(u0 + 6, u0 + 6, v0 + 5, v0 + 5, 3, 4, L.lit);
  gable(V, u0 - 1, u0 + 8, v0 - 1, v0 + 6, 6, roofA, roofB);
  V.box(u0 + 6, u0 + 6, v0 + 1, v0 + 1, 6, 11, M.stone);
}
function picket(V: Vox, u0: number, u1: number, v0: number, v1: number): void {
  for (let u = u0; u <= u1; u++) for (const v of [v0, v1]) { V.set(u, v, 1, M.white); if (u % 2 === 0) V.set(u, v, 2, M.white); }
  for (let v = v0; v <= v1; v++) for (const u of [u0, u1]) { V.set(u, v, 1, M.white); if (v % 2 === 0) V.set(u, v, 2, M.white); }
}
/** Red and white bands on a stone plinth, a keeper's cottage with a garden. */
function lightClassic(): Vox {
  const V = new Vox(-LR, LR, -LR, LR, LZ);
  rocks(V, 0, 0, 9, 2, 3); rocks(V, -10, 7, 3, 2, 5);
  for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) if (Math.hypot(u, v) <= 6.2) V.box(u, u, v, v, 2, 3, Math.hypot(u, v) > 5.2 && (Math.round(Math.atan2(v, u) * 3) & 1) ? L.stone2 : M.stone);
  V.box(-1, 1, 6, 8, 2, 2, M.stone); V.box(-1, 1, 6, 7, 3, 3, M.stone);        // steps up to the door
  tower(V, 4, 27, 4.9, 3.7, z => Math.floor((z - 4) / 4) % 2 ? M.redp : M.white);
  V.box(-1, 1, 4, 4, 4, 7, M.door); for (const z of [13, 20]) V.box(0, 0, 4, 4, z, z + 1, L.lit);
  lantern(V, LANTERN_Z[0], M.iron, M.roof, L.roofD);
  cottage(V, 6, -12, M.white, L.slate, L.slateD);
  picket(V, 4, 15, -14, -5); for (let u = 7; u <= 13; u += 2) { V.set(u, -6, 2, L.flower); V.set(u + 1, -6, 2, L.flower2); }
  barrel(V, -7, -5, 3); crate(V, -8, -8, 3);
  return V.finalize();
}
/** A rugged tower of grey stone blocks with a black gallery and a copper dome gone green. */
function lightStone(): Vox {
  const V = new Vox(-LR, LR, -LR, LR, LZ);
  rocks(V, 0, 0, 10, 3, 11); rocks(V, 9, -8, 4, 3, 13); rocks(V, -9, -9, 3, 2, 17);
  tower(V, 3, 26, 5.4, 4.1, (z, u, v) => (Math.floor(z / 2) + Math.floor((Math.atan2(v, u) + 4) * 2.2)) % 3 === 0 ? L.stone2 : M.stone);
  V.box(-1, 1, 5, 5, 4, 8, M.door); V.box(-1, 1, 5, 5, 9, 9, L.stone2);
  for (const z of [12, 18, 23]) V.box(0, 0, -5, -5, z, z + 1, L.lit);
  lantern(V, LANTERN_Z[1], M.iron, L.verd, L.verd);
  // a lean-to store and a woodpile against the rocks
  walls(V, -13, -7, 4, 9, 2, 6, M.stone); V.box(-7, -7, 6, 7, 2, 5, M.door);
  for (let k = 0; k <= 4; k++) V.box(-14, -6, 3 + k, 3 + k, 7 + Math.floor(k / 2), 7 + Math.floor(k / 2), k % 2 ? L.slateD : L.slate);
  for (let u = -13; u <= -9; u++) V.box(u, u, 10, 11, 2, 3, (u & 1) ? M.plank2 : M.crate);
  lampPost(V, 3, 8, 3, 3);
  return V.finalize();
}
/** A white tower wound with a navy spiral on a sandy spit, a boat shed beside it. */
function lightSpiral(): Vox {
  const V = new Vox(-LR, LR, -LR, LR, LZ);
  rocks(V, 0, 0, 7, 2, 29);
  tower(V, 3, 29, 4.4, 3.3, (z, u, v) => ((Math.atan2(v, u) / (Math.PI * 2) + z / 14) % 1 + 1) % 1 < 0.3 ? L.navyS : M.white);
  V.box(-1, 1, 4, 4, 3, 6, M.door);
  lantern(V, LANTERN_Z[2], L.navyS, L.navyS, M.iron);
  // the boat shed with a dinghy run out on the sand
  walls(V, 5, 13, 4, 10, 1, 5, L.wall2); V.box(13, 13, 5, 9, 1, 4, M.door);
  gable(V, 4, 14, 3, 11, 6, M.roof, L.roofD, M.redp);
  skiff(V, 3, -10, M.redp);
  barrel(V, -8, 4, 1); basket(V, -9, 7, 1); coil(V, -6, -8, 1);
  for (let u = -12; u <= -6; u++) { V.set(u, 10, 1, M.post); if (u % 2 === 0) V.set(u, 10, 2, M.post); }
  return V.finalize();
}
export const LIGHTHOUSES: (() => Vox)[] = [lightClassic, lightStone, lightSpiral];

// ---------- wrecks ----------
/** A sloop on her side, half sunk, the mast snapped. */
function wreckSloop(): Vox {
  const Wk = new Vox(-24, 24, -12, 12, 16), Ln = 19, Bm = 8;
  for (let u = -22; u <= 22; u++) for (let v = -11; v <= 11; v++) for (let z0 = 0; z0 <= 7; z0++) {
    const zf = Math.min(z0, 7) / 7, len = Ln * (0.8 + 0.2 * zf), t = u / len; if (t > 1 || t < -1) continue;
    const hw = (t >= 0 ? Bm * Math.pow(1 - t * t, 0.6) : Bm * Math.pow(1 - Math.pow(-t, 4), 0.45)) * (0.45 + 0.55 * zf);
    if (Math.abs(v) > hw + 0.3) continue;
    const shell = !(Math.abs(v) <= hw - 1.3 && Math.abs(u) <= len - 1.8);
    if (!shell && z0 > 1) continue;
    if (shell && z0 > 1 && hash01(u, v * 7 + z0, 11) < (u < -6 ? 0.45 : 0.12)) continue;
    const z = z0 + Math.round(u * 0.22) - 3; if (z < 0) continue;
    Wk.set(u, v, z, z0 === 7 ? M.wet : z0 >= 4 ? M.wetp : M.wet);
  }
  Wk.line([3, 0, 3], [9, 5, 13], M.wet); Wk.line([4, 0, 3], [10, 5, 13], M.wet); Wk.line([8, 4, 11], [12, -2, 10], M.post);
  return Wk.finalize();
}
/** A little steamer gone down by the stern: bow and funnel above water, rust streaks, a lifebuoy. */
function wreckSteamer(): Vox {
  const Wk = new Vox(-24, 24, -12, 12, 18);
  for (let u = -20; u <= 22; u++) {
    const t = u / 22, hw = t > 0 ? 6 * Math.sqrt(Math.max(0, 1 - t * t * t)) : 6, rise = Math.round((u + 20) * 0.18);
    for (let v = -7; v <= 7; v++) {
      if (Math.abs(v) > hw) continue;
      for (let z0 = 0; z0 <= 6; z0++) {
        const z = z0 + rise - 5 + Math.round(v * 0.35), edge = Math.abs(v) > hw - 1.2 || z0 === 0;   // down by the stern, listing to starboard
        if (z < 0 || (!edge && z0 > 0 && z0 < 6)) continue;
        if (hash01(u, v + z0 * 5, 41) < (u < -6 ? 0.45 : z0 === 6 && !edge ? 0.3 : 0.06)) continue;          // stove in, worst aft
        Wk.set(u, v, z, z0 === 6 ? (edge ? L.rust : M.wet) : hash01(u >> 1, z0, 43) < 0.3 ? L.rust : M.coal);
      }
    }
  }
  for (let z = 2; z <= 11; z++) { const o = Math.round((z - 2) * 0.3); Wk.box(-2 + o, 1 + o, -2, 1, z, z, z === 9 ? M.dred : L.funnel); }   // the funnel, leaning
  Wk.box(6, 10, -3, 3, 4, 6, M.ironp); Wk.box(6, 10, -3, 3, 7, 7, L.rust); Wk.box(7, 9, -3, -3, 5, 5, M.window);
  for (const [u, v] of [[13, 5], [13, 6], [14, 6], [15, 6], [15, 5], [14, 4], [13, 4], [15, 4]]) Wk.set(u, v, 8, (u + v) % 2 ? M.redp : M.white);
  return Wk.finalize();
}
export const WRECKS: (() => Vox)[] = [wreckSloop, wreckSteamer];

/** Which design a landmark gets: Alderhaven keeps the fishing village; elsewhere it follows the place's position. */
export function landmarkKind(p: Poi): number {
  if (p.type === 'port') return p.id === 'port:0,0' ? 0 : Math.floor(hash01(Math.round(p.x), Math.round(p.y), 61) * HARBOURS.length);
  return Math.floor(hash01(Math.round(p.x), Math.round(p.y), 61) * (p.type === 'light' ? LIGHTHOUSES : WRECKS).length);
}
/** Whether (x, y) is on a landmark's grounds, where no tree may grow: a harbour's buildings inland of its pier, a lighthouse's rock. */
export function onGrounds(pois: readonly Poi[], x: number, y: number): boolean {
  for (const q of pois) {
    if (q.type === 'light') { if (Math.hypot(x - q.x, y - q.y) < 17) return true; }
    else if (q.type === 'port' && (Math.hypot(x - q.x, y - q.y) < 13 || Math.hypot(x - (q.x - Math.cos(q.ang) * 12), y - (q.y - Math.sin(q.ang) * 12)) < 21)) return true;
  }
  return false;
}
