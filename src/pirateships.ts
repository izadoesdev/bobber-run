// Fighting ships, built voxel by voxel: a gaff-rigged sloop, a brigantine with a square-rigged foremast and a row of
// gunports, a three-masted galleon with a towering stern castle of lit windows, a stubby bomb ketch with a mortar in
// its well, and a long, low oared galley with one great gun in her bow. Each pirate crew paints its ship in its own
// colours and flies its own flag; as a fight goes on the sails are holed, the hull charred and stove in, and at the last
// the mainmast goes by the board. Sized and armed for the game in game/pirates.ts (SHIP_DIMS here); drawn by
// gl/renderer.ts through meshes.ts. The sloop in navy blue and ochre, white sails, a blue-jacketed crew and an ensign
// is the revenue cutter you can buy, alongside steel hulls only your navy builds: a coast guard cutter, a rocket
// gunboat, a dreadnought, a destroyer, a missile cruiser and an aircraft carrier (navyVox, for models.ts), whose jets
// fly as planeVox.
import { Vox, mat } from './voxel';
import { M, HAIR, EYE, SAIL_MATS, buildHull, cloneVox, sail, weather } from './models';

export type PirateHull = 'sloop' | 'brig' | 'galleon' | 'ketch' | 'galley';
/** Hulls only your navy builds: steel and steam, from a patrol cutter to an aircraft carrier. */
export type WarHull = PirateHull | 'patrol' | 'gunboat' | 'dreadnought' | 'destroyer' | 'cruiser' | 'carrier';
/**
 * Half-length and half-beam (world units, like a BoatDef's L and B), where the broadside guns sit along the hull (a
 * gunport each side at each), the height of the topsides (for battle damage), and the mainmast and where it snaps.
 */
export const SHIP_DIMS: Record<PirateHull, { L: number; B: number; ports: readonly number[]; top: number; mast: number; snap: number }> = {
  sloop: { L: 17, B: 6.2, ports: [0], top: 7, mast: 2, snap: 13 },
  brig: { L: 26, B: 8.5, ports: [-9, 7], top: 10, mast: -6, snap: 16 },
  galleon: { L: 36, B: 11, ports: [-16, -2, 12], top: 19, mast: 2, snap: 20 },
  ketch: { L: 21, B: 7.5, ports: [], top: 8, mast: -1, snap: 14 },
  galley: { L: 24, B: 5.6, ports: [], top: 6, mast: 3, snap: 11 },
};

// ---------- a crew's colours ----------
const SAIL_RED = mat(['#3a1a14', '#5a2a20', '#7a3a2c']), SAIL_REDS = mat(['#2c1410', '#462018', '#5e2e24']);
const SAIL_DUN = mat(['#46423c', '#625d56', '#827c74']), SAIL_DUNS = mat(['#36322e', '#4e4a44', '#69645d']);
const HULLS = [mat(['#141418', '#202026', '#30303a']), mat(['#3a1612', '#561e18', '#702a20']), mat(['#14261c', '#1e3a2a', '#2c5038']), mat(['#141c2c', '#1e2a42', '#2c3c5a']), mat(['#3a3630', '#524c44', '#6a6258'])];
const RUST = mat(['#5e3020', '#84442a', '#a8603c']), NAVY_HULL = mat(['#121c30', '#1c2c4a', '#2a4068']), OCHRE = mat(['#a8802a', '#d4a63c', '#ecc25a']);
const FLIGHT = mat(['#2c3034', '#3a3f44', '#4a5056']), STEEL_DECK = mat(['#2e3338', '#3c4248', '#4c535a']), BOOT = mat(['#4a1a18', '#6a2420', '#86302a']), ROOF = mat(['#59616a', '#737c86', '#8f98a2']), GREY_HULL = mat(['#4a5159', '#626a73', '#7e8790']), WHITE_HULL = mat(['#c4c9ce', '#dde1e5', '#f2f4f6']);
interface Scheme { hull: number; trim: number; sail: number; seam: number }
/** How many pirate colour schemes there are. */
export const SCHEME_COUNT = HULLS.length;
// models.ts builds your warships from these hulls, so nothing here may touch its exports until a ship is built
let palette: { schemes: Scheme[]; navy: Scheme } | null = null;
/**
 * Hull and trim paint and sailcloth: black and red, oxblood and gold, deep green and bone, navy and white, weathered
 * grey and rust; and a navy's colours for your warships: blue topsides, an ochre band along the gunports, white canvas.
 */
function colours(): { schemes: Scheme[]; navy: Scheme } {
  if (palette) return palette;
  for (const m of [SAIL_RED, SAIL_REDS, SAIL_DUN, SAIL_DUNS]) SAIL_MATS.add(m);
  const [black, oxblood, green, blue, grey] = HULLS;
  return palette = {
    schemes: [
      { hull: black, trim: M.redp, sail: M.sailblk, seam: M.sailblkS }, { hull: oxblood, trim: M.gilt, sail: SAIL_RED, seam: SAIL_REDS },
      { hull: green, trim: M.bone, sail: M.sailblk, seam: M.sailblkS }, { hull: blue, trim: M.white, sail: SAIL_DUN, seam: SAIL_DUNS },
      { hull: grey, trim: RUST, sail: SAIL_DUN, seam: SAIL_DUNS },
    ],
    navy: { hull: NAVY_HULL, trim: OCHRE, sail: M.sail, seam: M.sailSeam },
  };
}
/** The warships' hull paint (the material a paint job replaces) and the ochre band along their gunports (plating's). */
export const NAVY_PAINT = NAVY_HULL, NAVY_TRIM = OCHRE;
/** The steel warships' grey, and the coast guard's white: the materials a paint job replaces on them; and the dark red
 *  boot-topping at their waterline, which plating replaces. */
export const GREY_PAINT = GREY_HULL, WHITE_PAINT = WHITE_HULL, STEEL_BOOT = BOOT;
/** A steel warship's hull: grey (or white) sides, the dark red boot-topping, and a steel deck. */
const steel = (paint = GREY_HULL) => ({ paint, stripe: paint, gun: paint, boot: BOOT, floorMat: STEEL_DECK, seams: false, lining: paint });
/** The ensign a warship flies: flag design NAVY_FLAG, a white field with a blue cross. */
export const NAVY_FLAG = 4;
/** How many flag designs there are: the skull and bones, crossed cutlasses, the bleeding heart (a crew's own black
 *  flags), and plain red, run up for no quarter. A look's flag -1 is none at all: a ship flying no colours. */
export const FLAGS = 4;
export const RED_FLAG = 3;
const BLOOD = mat(['#7a1c16', '#a8261e', '#cc3a2e']), GLASS = mat(['#c88a2a', '#f0b84a', '#ffe08a'], true);
const HOLD = mat(['#08080a', '#0e0e12', '#16161c']);   // the dark of an open gunport

// ---------- pieces ----------
/** A square sail across the beam at u, `hw` either side, from z0 to z1, bellied forward, with its yards above and below. */
function squareSail(V: Vox, u: number, hw: number, z0: number, z1: number, s: Scheme, belly = 2): void {
  for (let z = z0; z <= z1; z++) for (let v = -hw; v <= hw; v++) {
    const du = Math.round(belly * (1 - (v / hw) ** 2) * Math.sin(Math.PI * (z - z0 + 0.5) / (z1 - z0 + 1)));
    V.set(u + du, v, z, (z - z0) % 5 === 4 ? s.seam : s.sail);
  }
  V.line([u, -hw - 1, z1 + 1], [u, hw + 1, z1 + 1], M.oar); V.line([u, -hw, z0 - 1], [u, hw, z0 - 1], M.oar);
}
function mast(V: Vox, u: number, z0: number, top: number, nest = 0): void {
  V.box(u, u, 0, 0, z0, top, M.oar); V.set(u, 0, top + 1, M.gilt);
  if (nest) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (Math.abs(a) === 2 || Math.abs(b) === 2) V.set(u + a, b, nest, M.plank2);
  for (const s of [-1, 1]) V.line([u, 0, top - 3], [u - 2, s * 8, z0 + 2], M.post);   // shrouds
}
/** A flag flying aft from the masthead at (u, z): design `k` of FLAGS (none if k < 0), or white once she has struck. */
function flag(V: Vox, u: number, z: number, k: number, white: boolean): void {
  if (k < 0 && !white) return;
  const bg = white || k === NAVY_FLAG ? M.white : k === 3 ? BLOOD : M.sailblk;
  for (let a = 1; a <= 8; a++) for (let b = 0; b < 5; b++) V.set(u - a, 0, z + b, k === NAVY_FLAG && !white && (a === 3 || b === 2) ? NAVY_HULL : bg);
  if (white || k === 3 || k === NAVY_FLAG) return;
  const pts = k === 0 ? [[4, 3], [5, 3], [4, 4], [5, 4], [3, 1], [6, 1], [2, 0], [7, 0], [3, 2], [6, 2]]                // skull and crossed bones
    : k === 1 ? [[4, 3], [5, 3], [4, 4], [5, 4], [2, 0], [3, 1], [4, 2], [7, 0], [6, 1], [5, 2]]                        // skull and crossed cutlasses
      : [[4, 3], [6, 3], [3, 3], [5, 2], [4, 2], [6, 2], [5, 1]];                                                    // the bleeding heart
  for (const [a, b] of pts) V.set(u - a, 0, z + b, k === 2 ? BLOOD : M.bone);
  if (k === 2) { V.set(u - 6, 0, z + 4, M.steel); V.set(u - 7, 0, z + 4, M.steel); V.set(u - 5, 0, z, M.redp); }   // the dagger, the drop of blood
}
/**
 * A pirate on deck at (u, v), standing on layer z: boots, breeches, a striped shirt, a bandana; or the captain in his
 * red coat and black tricorne with a gold band. Eight voxels tall, readable from above by the headgear.
 */
function pirate(V: Vox, u: number, v: number, z: number, captain = false): void {
  if (navy) { bluejacket(V, u, v, z, captain); return; }
  V.set(u, v, z, M.boot); V.set(u + 1, v, z, M.boot); V.box(u, u + 1, v, v, z + 1, z + 2, M.pants);
  for (let k = 3; k <= 4; k++) V.box(u, u + 1, v - 1, v + 1, z + k, z + k, captain ? M.redp : k === 3 ? M.white : M.redp);
  V.box(u, u + 1, v, v, z + 5, z + 6, M.skin); V.set(u, v, z + 6, HAIR); V.set(u + 1, v, z + 6, EYE);
  if (captain) { V.box(u - 1, u + 2, v - 1, v + 1, z + 7, z + 7, M.sailblk); V.box(u, u + 1, v, v, z + 7, z + 7, M.gilt); }
  else V.box(u, u + 1, v, v, z + 7, z + 7, M.redp);
}
/** A navy seaman in a blue jacket and white trousers, a straw hat; or the captain in a blue coat with gold and a bicorne. */
function bluejacket(V: Vox, u: number, v: number, z: number, captain: boolean): void {
  V.set(u, v, z, M.boot); V.set(u + 1, v, z, M.boot); V.box(u, u + 1, v, v, z + 1, z + 2, M.white);
  for (let k = 3; k <= 4; k++) V.box(u, u + 1, v - 1, v + 1, z + k, z + k, NAVY_HULL);
  if (captain) { V.set(u + 1, v - 1, z + 4, M.gilt); V.set(u + 1, v + 1, z + 4, M.gilt); }
  V.box(u, u + 1, v, v, z + 5, z + 6, M.skin); V.set(u, v, z + 6, HAIR); V.set(u + 1, v, z + 6, EYE);
  if (captain) { V.box(u, u + 1, v - 2, v + 2, z + 7, z + 7, M.sailblk); V.set(u, v, z + 8, M.gilt); }
  else V.box(u, u + 1, v - 1, v + 1, z + 7, z + 7, M.seat);
}
/** Whether the ship being built is a warship of yours (her crew in blue jackets) rather than a pirate. */
let navy = false;
/** A gunport each side at each u on layer z: the open port, its lid propped above, and the muzzle run out. */
function gunports(V: Vox, us: readonly number[], z: number, s: Scheme, run = true): void {
  for (const u of us) for (const side of [-1, 1]) {
    let edge = 0;
    for (let v = 1; v < V.nv; v++) if (V.get(u, side * v, z)) edge = v;
    if (!edge) continue;
    for (const du of [0, 1]) for (const dz of [0, 1]) V.set(u + du, side * edge, z + dz, HOLD);
    V.box(u, u + 1, side * edge, side * edge, z + 2, z + 2, s.trim);
    if (run) V.box(u, u + 1, side * (edge + 1), side * (edge + 1), z, z, M.iron);
  }
}
/** A stern lantern, lit (EMISSIVE): one glowing voxel on an iron bracket. */
function lantern(V: Vox, u: number, v: number, z: number): void { V.set(u, v, z, M.iron); V.set(u - 1, v, z, GLASS); V.set(u - 1, v, z + 1, M.iron); }

// ---------- the ships ----------
function sloop(s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-21, 31, -10, 10, 36);
  buildHull(V, { HL: 17, HB: 6.2, HZ: 5, paint: s.hull, stripe: s.trim, deckZ: 3, floorMat: M.plank, entry: 0.6 });
  gunports(V, SHIP_DIMS.sloop.ports, 4, s);
  mast(V, 2, 4, 30);
  sail(V, [[1, 7], [1, 27], [-15, 30], [-17, 7]], u => (1 - u) * 0.08, s.sail, s.seam);
  sail(V, [[29, 7], [3, 26], [16, 6]], () => -1, s.sail, s.seam);
  V.line([16, 0, 6], [30, 0, 8], M.oar); V.line([30, 0, 8], [2, 0, 29], M.post);
  V.line([2, 0, 7], [-18, 0, 7], M.oar);                                                                   // the boom
  V.box(13, 13, 0, 0, 6, 7, M.post); for (let q = 0; q < 3; q++) V.set(13 + q, 0, 8, M.iron);            // bow swivel
  pirate(V, -7, 2, 4); pirate(V, 8, -2, 4); pirate(V, -12, -1, 4, true);
  lantern(V, -17, 0, 7);
  flag(V, 2, 31, k, white);
  return V;
}
function brig(s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-31, 41, -14, 14, 48);              // tall enough for the flag atop her main
  buildHull(V, { HL: 26, HB: 8.5, HZ: 8, paint: s.hull, stripe: s.trim, deckZ: 5, floorMat: M.plank, sternPow: 5 });
  for (let u = -26; u <= -15; u++) for (let v = -8; v <= 8; v++) if (V.get(u, v, 5) === M.plank) { V.set(u, v, 6, M.plank2); V.set(u, v, 7, M.plank); }   // quarterdeck
  for (let v = -7; v <= 7; v++) if (v % 2 === 0) V.set(-15, v, 9, s.trim);
  V.box(-24, -24, 0, 0, 8, 10, M.gun); for (let dv = -2; dv <= 2; dv++) V.set(-25, dv, 11, M.gun);        // the helm
  gunports(V, SHIP_DIMS.brig.ports, 6, s);
  V.box(26, 27, 0, 0, 7, 9, M.gilt); V.set(28, 0, 8, M.gilt);                                              // figurehead
  mast(V, 10, 6, 38, 29);
  squareSail(V, 10, 9, 10, 18, s); squareSail(V, 10, 7, 20, 27, s); squareSail(V, 10, 5, 31, 35, s, 1);
  mast(V, -6, 6, 42, 0);
  sail(V, [[-7, 10], [-7, 34], [-25, 38], [-27, 10]], u => (-7 - u) * 0.08, s.sail, s.seam);
  V.line([-6, 0, 9], [-28, 0, 9], M.oar); V.line([-6, 0, 34], [-25, 0, 39], M.oar);
  V.line([26, 0, 9], [39, 0, 12], M.oar);
  sail(V, [[38, 11], [11, 34], [24, 9]], () => -1, s.sail, s.seam);
  V.line([39, 0, 12], [10, 0, 37], M.post); V.line([10, 0, 38], [-6, 0, 41], M.post);
  pirate(V, 3, 3, 6); pirate(V, 16, -3, 6); pirate(V, -2, -4, 6); pirate(V, -21, 2, 8, true);
  lantern(V, -26, -3, 10); lantern(V, -26, 3, 10);
  flag(V, -6, 43, k, white);
  return V;
}
function galleon(s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-41, 53, -17, 17, 60);
  buildHull(V, { HL: 36, HB: 11, HZ: 10, paint: s.hull, stripe: s.trim, deckZ: 7, floorMat: M.plank, sternPow: 7 });
  // the stern castle: three decks of cabins, rows of lit windows across the stern and down the quarters, gilded trim
  for (let u = -37; u <= -21; u++) for (let v = -11; v <= 11; v++) {
    const inHull = V.get(u, v, 7) || V.get(u, v, 6);
    if (!inHull) continue;
    for (let z = 8; z <= 17; z++) {
      const outer = !V.get(u, v + 1, 7) || !V.get(u, v - 1, 7) || !V.get(u - 1, v, 7) || u === -21;
      if (!outer && z < 17) continue;
      const lit = outer && (z === 10 || z === 14) && (u + v) % 3 === 0;
      V.set(u, v, z, z === 17 ? M.plank : z === 16 ? M.gilt : lit ? GLASS : s.hull);
    }
  }
  for (let v = -10; v <= 10; v++) if (v % 2 === 0) V.set(-21, v, 18, s.trim);
  for (let u = 26; u <= 33; u++) for (let v = -7; v <= 7; v++) if (V.get(u, v, 7)) { V.set(u, v, 11, M.plank); if (!V.get(u, v + 1, 7) || !V.get(u, v - 1, 7)) V.box(u, u, v, v, 8, 10, s.hull); }   // forecastle
  gunports(V, SHIP_DIMS.galleon.ports, 8, s);
  gunports(V, [-12, 4, 18], 5, s, false);                                                                  // the lower tier, lids shut
  V.box(35, 36, 0, 0, 9, 12, M.gilt); V.box(37, 37, 0, 0, 10, 11, M.gilt);                                 // figurehead
  mast(V, 20, 11, 46, 34);
  squareSail(V, 20, 11, 14, 23, s); squareSail(V, 20, 9, 25, 33, s); squareSail(V, 20, 6, 36, 42, s, 1);
  mast(V, 2, 7, 52, 38);
  squareSail(V, 2, 12, 12, 24, s, 3); squareSail(V, 2, 10, 27, 36, s); squareSail(V, 2, 7, 40, 47, s, 1);
  mast(V, -18, 17, 44, 0);
  sail(V, [[-19, 21], [-19, 40], [-34, 45], [-36, 21]], u => (-19 - u) * 0.08, s.sail, s.seam);
  V.line([-18, 0, 20], [-37, 0, 20], M.oar);
  V.line([34, 0, 12], [51, 0, 17], M.oar);
  sail(V, [[50, 16], [21, 44], [35, 13]], () => -1, s.sail, s.seam);
  V.line([51, 0, 17], [20, 0, 45], M.post); V.line([20, 0, 46], [2, 0, 51], M.post); V.line([2, 0, 52], [-18, 0, 43], M.post);
  pirate(V, 10, 4, 7); pirate(V, 14, -5, 7); pirate(V, -6, 5, 7); pirate(V, -10, -4, 7); pirate(V, 28, 2, 11); pirate(V, -30, 0, 17, true);
  lantern(V, -37, -5, 19); lantern(V, -38, 0, 20); lantern(V, -37, 5, 19);
  flag(V, 2, 53, k, white); flag(V, 20, 47, k, white);
  return V;
}
function ketch(s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-25, 35, -12, 12, 38);
  buildHull(V, { HL: 21, HB: 7.5, HZ: 6, paint: s.hull, stripe: s.trim, deckZ: 4, floorMat: M.plank, sternPow: 3 });
  // the mortar well amidships forward: a timber bed braced across the hull, and the fat iron mortar in it, mouth up
  V.box(7, 15, -5, 5, 5, 5, M.plank2); for (const v of [-5, 5]) V.box(7, 15, v, v, 5, 6, M.post);
  for (let z = 6; z <= 9; z++) for (let du = -3; du <= 3; du++) for (let dv = -3; dv <= 3; dv++) {
    const d = Math.hypot(du, dv);
    if (d <= 3.2 && (d > 2 || z < 8)) V.set(11 + du, dv, z, z === 9 ? M.ironp : M.iron);
  }
  mast(V, -1, 5, 32);
  sail(V, [[-2, 8], [-2, 29], [-16, 32], [-18, 8]], u => (-2 - u) * 0.08, s.sail, s.seam);
  V.line([-1, 0, 7], [-19, 0, 7], M.oar);
  mast(V, -15, 5, 22);
  sail(V, [[-16, 9], [-16, 20], [-23, 22], [-24, 9]], u => (-16 - u) * 0.08, s.sail, s.seam);
  V.line([21, 0, 7], [33, 0, 9], M.oar);
  sail(V, [[32, 8], [1, 28], [18, 7]], () => -1, s.sail, s.seam);
  pirate(V, 4, 3, 4); pirate(V, 17, -2, 4); pirate(V, -9, 0, 4, true);
  lantern(V, -21, 0, 8);
  flag(V, -1, 33, k, white);
  return V;
}
/**
 * A war galley: long, low and narrow, a bank of oars down each side so she goes where she likes whatever the wind, one
 * lateen sail, and a single long gun in her bow that she has to point at you to fire; a raised poop for her captain.
 */
function galley(s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-28, 34, -14, 14, 30);
  buildHull(V, { HL: 24, HB: 5.6, HZ: 4, paint: s.hull, stripe: s.trim, deckZ: 3, floorMat: M.plank, entry: 0.7, sternPow: 3 });
  for (let u = -24; u <= -16; u++) for (let v = -5; v <= 5; v++) if (V.get(u, v, 3)) { V.set(u, v, 5, M.plank2); if (!V.get(u, v + 1, 3) || !V.get(u, v - 1, 3)) V.set(u, v, 4, s.hull); }   // the poop
  for (let u = -12; u <= 16; u += 4) for (const side of [-1, 1]) {                                      // the oars, blades in the water
    let edge = 0;
    for (let v = 1; v < 8; v++) if (V.get(u, side * v, 3)) edge = v;
    V.line([u + 1, side * (edge - 1), 5], [u - 2, side * (edge + 7), 1], M.oar);
    V.set(u - 2, side * (edge + 7), 1, M.plank2); V.set(u - 3, side * (edge + 7), 1, M.plank2);
  }
  V.box(18, 23, -1, 1, 5, 5, M.plank2); V.box(19, 27, 0, 0, 6, 6, M.iron); V.box(19, 21, 0, 0, 7, 7, M.iron);   // the bow gun on its slide
  V.box(24, 26, 0, 0, 2, 3, s.trim);                                                                      // the ram at her stem
  mast(V, 3, 4, 24);
  sail(V, [[22, 9], [-4, 27], [-14, 8]], () => 0, s.sail, s.seam);                                        // a lateen
  V.line([24, 0, 8], [-6, 0, 28], M.oar);
  pirate(V, 14, 2, 4); pirate(V, 0, -1, 4); pirate(V, -20, 0, 6, true);
  lantern(V, -24, 0, 7);
  flag(V, 3, 25, k, white);
  return V;
}
const BUILD: Record<PirateHull, (s: Scheme, k: number, white: boolean) => Vox> = { sloop, brig, galleon, ketch, galley };

/** A gun turret centred at u on layer z: a round armoured house of radius r, its barrels (two, or one) run out `len` fore or aft. */
function gunTurret(V: Vox, u: number, z: number, r: number, aft: boolean, len: number, twin = true): void {
  for (let dz = 0; dz <= 2; dz++) for (let du = -r; du <= r; du++) for (let dv = -r; dv <= r; dv++) if (Math.hypot(du, dv) <= r + 0.3) V.set(u + du, dv, z + dz, dz === 2 ? ROOF : dz === 1 && Math.abs(dv) > r - 1 ? M.iron : GREY_HULL);
  const sgn = aft ? -1 : 1;
  for (const v of twin ? [-1, 1] : [0]) V.line([u + sgn * r, v, z + 1], [u + sgn * (r + len), v, z + 1], M.iron);
}
/** A funnel of radius r at u, from layer z0 up to z1, capped in black. */
function stack(V: Vox, u: number, z0: number, z1: number, r: number): void {
  for (let z = z0; z <= z1; z++) for (let du = -3; du <= 3; du++) for (let dv = -3; dv <= 3; dv++) if (Math.hypot(du, dv) <= r + 0.3) V.set(u + du, dv, z, z >= z1 - 1 ? M.coal : GREY_HULL);
}
/**
 * A coast guard cutter: a fast white hull with a slanting red stripe down her bows, a bridge with wings, a radar mast,
 * a light gun forward, and her boarding team's orange boat ready aft.
 */
function patrol(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-30, 32, -10, 10, 26);
  buildHull(V, { HL: 26, HB: 7.5, HZ: 5, ...steel(WHITE_HULL), deckZ: 4, entry: 0.65, sternPow: 2, rake: 0.08 });
  for (let u = 4; u <= 24; u++) for (let v = -9; v <= 9; v++) for (let z = 2; z <= 7; z++) {               // the racing stripe up her topsides and over the rail: a broad red band, a thin navy one
    const d = u - 10 - z * 1.5, surface = V.get(u, v, z) === WHITE_HULL && ((v !== 0 && !V.get(u, v + Math.sign(v), z)) || !V.get(u, v, z + 1));
    if (surface && d >= -2 && d <= 3.5 && (d < 1.5 || d >= 2.5)) V.set(u, v, z, d < 1.5 ? M.redp : NAVY_HULL);
  }
  V.box(-6, 8, -4, 4, 5, 9, WHITE_HULL); V.box(-6, 8, -4, 4, 8, 8, M.window); V.box(-1, 8, -5, 5, 10, 10, WHITE_HULL);   // the bridge and its wings
  V.box(2, 2, 0, 0, 11, 20, M.iron); V.box(2, 2, -3, 3, 18, 18, M.iron);                                   // the radar mast
  gunTurret(V, 15, 5, 1, false, 5, false);
  for (let u = -21; u <= -12; u++) for (let v = -3; v <= 3; v++) {                                          // the boarding boat: orange tubes round a dark floor, a console and an outboard
    const tube = Math.abs(v) === 3 || u === -21 || (u === -12 && Math.abs(v) < 2) || (u === -13 && Math.abs(v) === 2);
    if (u === -12 && Math.abs(v) >= 2) continue;
    V.set(u, v, 5, tube ? M.orange : M.coal); if (tube) V.set(u, v, 6, M.orange);
  }
  V.box(-16, -15, -1, 1, 6, 7, M.white); V.set(-15, 0, 8, M.window);
  V.box(-22, -22, 0, 0, 5, 7, M.coal);
  pirate(V, -10, 5, 4); pirate(V, 11, -4, 4); pirate(V, -24, -2, 4); pirate(V, 4, 4, 11, true);
  flag(V, 2, 21, k, white);
  return V;
}
/** A rocket gunboat: a small grey steel hull, a rocket pod forward and another aft (a block of launch tubes on a
 *  turntable, red-nosed rockets in the mouths), a bridge and a funnel. */
function gunboat(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-26, 28, -10, 10, 24);
  buildHull(V, { HL: 22, HB: 7, HZ: 5, ...steel(), deckZ: 4, entry: 0.6, sternPow: 2, rake: 0.08 });
  for (const u of [10, -13]) {
    for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) if (Math.hypot(du, dv) <= 2.4) V.set(u + du, dv, 5, M.iron);   // the turntable
    V.box(u - 2, u + 1, -3, 3, 6, 7, GREY_HULL); V.box(u - 2, u + 1, -3, 3, 6, 6, NAVY_HULL);
    for (let du = -2; du <= 1; du++) for (let dv = -3; dv <= 3; dv++) V.set(u + du, dv, 8, (du + dv + 9) % 2 ? M.coal : M.redp);   // tube mouths, rockets loaded
  }
  V.box(-4, 3, -3, 3, 5, 8, GREY_HULL); V.box(-4, 3, -3, 3, 7, 7, M.window); V.box(-5, 4, -4, 4, 9, 9, STEEL_DECK);   // the bridge
  stack(V, -7, 5, 13, 1.5);
  V.box(0, 0, 0, 0, 10, 18, M.iron);
  pirate(V, 15, -3, 4); pirate(V, -18, 3, 4); pirate(V, -1, 0, 10, true);
  lantern(V, -20, 0, 6);
  flag(V, 0, 19, k, white);
  return V;
}
/**
 * A dreadnought battleship: a long grey hull, big twin-gun turrets forward (the second raised to fire over the first)
 * and aft, a bridge on a tripod mast, two funnels, and an after mast.
 */
function dreadnought(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-50, 52, -14, 14, 40);
  buildHull(V, { HL: 46, HB: 11, HZ: 7, ...steel(), deckZ: 6, entry: 0.7, sternPow: 3, rake: 0.06 });
  gunTurret(V, 32, 7, 4, false, 10);
  V.box(16, 24, -4, 4, 7, 8, GREY_HULL); gunTurret(V, 20, 9, 4, false, 10);                               // the superfiring turret on its barbette
  gunTurret(V, -30, 7, 4, true, 10);
  V.box(4, 14, -5, 5, 7, 13, GREY_HULL); V.box(4, 14, -5, 5, 12, 12, M.window); V.box(8, 14, -7, 7, 14, 14, STEEL_DECK);   // the bridge
  V.line([10, 0, 14], [10, 0, 32], M.iron); V.line([7, -3, 13], [10, 0, 26], M.iron); V.line([7, 3, 13], [10, 0, 26], M.iron);   // the tripod
  V.box(9, 11, -1, 1, 30, 32, GREY_HULL);
  stack(V, 0, 7, 21, 2); stack(V, -9, 7, 20, 2);
  V.box(-20, -14, -4, 4, 7, 10, GREY_HULL); V.box(-17, -17, 0, 0, 11, 26, M.iron);
  pirate(V, 26, 6, 6); pirate(V, -24, -6, 6); pirate(V, -40, 3, 6); pirate(V, 11, 5, 15, true);
  lantern(V, -45, 0, 8);
  flag(V, -17, 27, k, white);
  return V;
}
/**
 * A missile cruiser: a long, clean grey hull, a single gun forward, a grid of missile hatches let into her deck fore and
 * aft, a stepped superstructure with a wraparound bridge and her flat radar panels on every face, a lattice mast with
 * its radome, a funnel, a white close-in gun dome aft, and a helicopter deck at her stern.
 */
function cruiser(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-44, 46, -12, 12, 34);
  buildHull(V, { HL: 40, HB: 9, HZ: 6, ...steel(), deckZ: 5, entry: 0.75, sternPow: 2, rake: 0.08 });
  gunTurret(V, 30, 6, 2, false, 6, false);
  for (const [u0, u1] of [[17, 24], [-22, -15]]) {                                                         // missile hatches
    V.box(u0, u1, -4, 4, 5, 5, M.ironp);
    for (let u = u0; u <= u1; u += 2) for (let v = -3; v <= 3; v += 2) V.box(u, u, v, v + 1, 6, 6, M.white);
  }
  V.box(-8, 14, -6, 6, 6, 9, GREY_HULL); V.box(-8, 14, -6, 6, 9, 9, STEEL_DECK);                           // the deckhouse
  V.box(-2, 12, -5, 5, 10, 14, GREY_HULL); V.box(2, 12, -5, 5, 13, 13, M.window); V.box(-2, 12, -5, 5, 15, 15, STEEL_DECK);   // the bridge block
  for (const v of [-6, 6]) V.box(5, 9, v, v, 10, 13, NAVY_HULL);                                           // radar panels on her sides
  V.box(13, 13, -2, 2, 10, 12, NAVY_HULL);                                                                 // and her front
  for (const [a, b] of [[-3, 3], [3, -3], [-3, -3], [3, 3]]) V.line([4 + a / 3, b, 16], [4, 0, 26], M.iron);   // the lattice mast
  V.box(4, 4, -4, 4, 23, 23, M.iron); V.box(3, 5, -1, 1, 27, 28, M.white);
  stack(V, -10, 6, 15, 2);
  for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) for (let dz = 0; dz <= 2; dz++) if (Math.hypot(du, dv, dz) <= 2.3) V.set(-19 + du, dv, 10 + dz, M.white);   // the close-in gun's dome
  V.box(-21, -17, -2, 2, 6, 9, GREY_HULL); V.box(-17, -15, 0, 0, 10, 10, M.iron);
  for (let u = -35; u <= -29; u++) for (const v of [-2, 2]) V.set(u, v, 5, M.white);                       // the helicopter deck's H
  for (let v = -2; v <= 2; v++) V.set(-32, v, 5, M.white);
  pirate(V, 25, 4, 5); pirate(V, -26, -4, 5); pirate(V, -38, 3, 5); pirate(V, 8, 0, 16, true);
  lantern(V, -40, 0, 7);
  flag(V, 4, 29, k, white);
  return V;
}
/**
 * A torpedo-boat destroyer: a long, narrow, low steel hull in grey with a whaleback forecastle, a bridge, three raked
 * funnels, a quick-firing gun on her forecastle and another aft, and two twin torpedo mounts amidships.
 */
function destroyer(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-36, 36, -9, 9, 30);
  buildHull(V, { HL: 32, HB: 6.5, HZ: 5, ...steel(), deckZ: 4, entry: 0.75, sternPow: 2, rake: 0.05 });
  for (let u = 15; u <= 31; u++) for (let v = -6; v <= 6; v++) if (V.get(u, v, 4)) {                      // the whaleback, curving down to her sides
    const top = 7 - Math.round(Math.abs(v) / 3);
    const edge = !V.get(u, v + 1, 4) || !V.get(u, v - 1, 4);
    for (let z = 5; z <= top; z++) V.set(u, v, z, z === top || edge ? GREY_HULL : 0);
  }
  V.box(18, 20, -1, 1, 8, 9, GREY_HULL); V.box(21, 26, 0, 0, 9, 9, M.iron);                               // the forecastle gun behind its shield
  V.box(9, 13, -2, 2, 5, 9, GREY_HULL); V.box(9, 13, -2, 2, 8, 8, M.window); V.box(8, 14, -3, 3, 10, 10, STEEL_DECK);   // the bridge
  for (const f of [4, -3, -10]) for (let z = 5; z <= 16; z++) {                                            // three raked funnels
    const u0 = f - Math.floor((z - 5) / 4);
    for (let du = -1; du <= 1; du++) for (let dv = -1; dv <= 1; dv++) if (Math.abs(du) + Math.abs(dv) < 2 || z < 15) V.set(u0 + du, dv, z, z >= 15 ? M.coal : GREY_HULL);
  }
  for (const u of [-16, -22]) {                                                                           // twin torpedo mounts on turntables
    V.box(u - 1, u + 1, -1, 1, 5, 5, M.iron);
    for (const v of [-1, 1]) { V.box(u - 4, u + 4, v, v, 6, 6, M.ironp); V.set(u + 5, v, 6, M.redp); }
  }
  V.box(-29, -27, -1, 1, 5, 6, GREY_HULL); V.box(-34, -28, 0, 0, 7, 7, M.iron);                           // the after gun
  V.box(8, 8, 0, 0, 11, 22, M.iron); V.box(8, 8, -3, 3, 19, 19, M.iron);                                 // a steel signal mast
  pirate(V, 16, 3, 4); pirate(V, -14, -4, 4); pirate(V, -25, 3, 4); pirate(V, 11, 0, 11, true);
  lantern(V, -32, 0, 6);
  flag(V, 8, 23, k, white);
  return V;
}
/**
 * A jet fighter at (u, v) on layer z, her nose to +u: a grey fuselage with a dark canopy, swept wings, tailplanes and
 * a fin in navy blue; `hot` lights her afterburner (aloft).
 */
function jet(V: Vox, u: number, v: number, z: number, hot = false): void {
  V.box(u - 4, u + 5, v, v, z, z, GREY_HULL); V.set(u + 6, v, z, M.iron);
  V.set(u + 2, v, z + 1, M.window); V.set(u + 3, v, z + 1, M.window);
  for (let k = 1; k <= 4; k++) for (let c = 0; c < (k < 3 ? 2 : 1); c++) { const w = u + 1 - (k >> 1) - c; V.set(w, v + k, z, GREY_HULL); V.set(w, v - k, z, GREY_HULL); }
  for (const s of [-1, 1]) for (let k = 1; k <= 2; k++) V.set(u - 4, v + s * k, z, GREY_HULL);
  V.box(u - 4, u - 3, v, v, z + 1, z + 1, NAVY_HULL); V.set(u - 4, v, z + 2, NAVY_HULL);
  if (hot) V.set(u - 5, v, z, GLASS);
}
/** A jet of a carrier's air wing in flight, for meshes.ts. */
export function planeVox(): Vox {
  const V = new Vox(-6, 7, -5, 5, 3);
  jet(V, 0, 0, 0, true);
  return V;
}
/**
 * An aircraft carrier: a long grey hull under a flight deck that overhangs it, the angled landing deck and centre line
 * marked out, two catapults in her bow with a jet on one, a lift at the deck edge, an island on her starboard side
 * with the bridge, a funnel and a radar mast, and the rest of her air wing ranged aft.
 */
function carrier(_s: Scheme, k: number, white: boolean): Vox {
  const V = new Vox(-62, 64, -18, 18, 34);
  buildHull(V, { HL: 58, HB: 12, HZ: 7, ...steel(), deckZ: 6, entry: 0.6, sternPow: 4, rake: 0.05 });
  for (let u = -58; u <= 62; u++) {
    const w = Math.round(u > 38 ? Math.max(3, 15 - (u - 38) * 0.5) : 15);
    for (let v = -w; v <= w; v++) {
      V.set(u, v, 9, FLIGHT);
      if (Math.abs(v) <= 10 && u > -55 && u < 50) V.box(u, u, v, v, 7, 8, GREY_HULL);                      // the hangar under it
    }
  }
  for (let u = -54; u <= 58; u += 4) V.box(u, u + 1, 0, 0, 9, 9, M.white);                                // the centre line
  V.line([-56, 3, 9], [16, -13, 9], M.white); V.line([-56, 10, 9], [22, -6, 9], M.gilt);                // the angled landing deck
  for (const v of [-5, 5]) V.box(28, 58, v, v, 9, 9, M.iron);                                            // the catapults
  V.box(-12, -3, -15, -11, 9, 9, M.ironp);                                                               // the lift
  V.box(-14, 6, 11, 14, 10, 15, GREY_HULL); V.box(-14, 6, 11, 14, 16, 16, M.window); V.box(-12, 4, 10, 15, 17, 17, M.ironp);   // the island and bridge
  for (let z = 18; z <= 22; z++) for (let du = -2; du <= 2; du++) for (let dv = 11; dv <= 14; dv++) V.set(-9 + du, dv, z, z >= 21 ? M.coal : GREY_HULL);   // her funnel
  V.box(0, 0, 12, 12, 18, 28, M.iron); V.box(0, 0, 9, 15, 25, 25, M.iron); V.box(-1, 1, 12, 12, 29, 30, M.white);   // the radar mast and radome
  jet(V, 44, -5, 10);
  for (const u of [-46, -32]) for (const v of [-9, 0]) jet(V, u, v, 10);
  V.box(-50, -50, 0, 0, 10, 16, M.iron); flag(V, -50, 12, k, white);
  pirate(V, 36, 2, 10); pirate(V, -22, 6, 10); pirate(V, 12, -9, 10); pirate(V, -4, 12, 18, true);
  lantern(V, -56, 0, 8);
  return V;
}
/** A long commission pennant streaming aft from a masthead at (u, z), red and white, into empty space only. */
function pennant(V: Vox, u: number, z: number, n: number): void {
  for (let a = 1; a <= n; a++) { const w = z - (a >> 2); if (!V.get(u - a, 0, w)) V.set(u - a, 0, w, a % 3 ? M.redp : M.white); }
}
const WAR_BUILD: Record<WarHull, (s: Scheme, k: number, white: boolean) => Vox> = { ...BUILD, patrol, gunboat, dreadnought, destroyer, cruiser, carrier };
/**
 * A warship of yours: navy colours, white sails, an ensign and a commission pennant, a blue-jacketed crew, and what she
 * fights with: a cutter's long bow chaser in place of the swivel; or a steel hull of her own, from a coast guard cutter
 * to an aircraft carrier.
 */
export function navyVox(hull: WarHull): Vox {
  navy = true;
  try {
    const s = colours().navy, V = WAR_BUILD[hull](s, NAVY_FLAG, false), layer = V.nu * V.nv;
    for (let i = 0; i + layer < V.d.length; i++) if (V.d[i] === OCHRE && !V.d[i + layer]) V.d[i] = NAVY_HULL;   // a dark rail over the ochre band
    if (hull === 'sloop') {
      V.box(13, 15, 0, 0, 6, 8, 0);                                                                       // the swivel out
      V.box(10, 13, -1, 1, 4, 6, M.plank2); V.box(10, 12, -1, 1, 7, 7, M.gilt); V.box(10, 21, 0, 0, 8, 8, M.gilt); V.set(21, 0, 8, M.iron);   // the long brass gun on its slide
      pennant(V, 2, 29, 9);
    } else if (hull === 'destroyer') pennant(V, 8, 21, 9);
    return V;
  } finally { navy = false; }
}

/** The mainmast shot away: everything aloft of it gone above the break, the stump splintered, the spar over the side. */
function dismast(V: Vox, kind: PirateHull, sail: number): void {
  const d = SHIP_DIMS[kind], reach = d.L * 0.55, aloft = new Set<number>([M.oar, M.post, M.gilt, M.bone, BLOOD, M.white, M.steel, M.redp, M.plank, M.plank2, ...SAIL_MATS]);   // spars, rigging, flags and the crow's nest
  for (let z = d.snap + 1; z < V.nz; z++) for (let u = d.mast - Math.round(reach); u <= d.mast + Math.round(reach); u++) for (let v = V.v0; v < V.v0 + V.nv; v++) {
    if (aloft.has(V.get(u, v, z))) V.set(u, v, z, 0);
  }
  V.set(d.mast, 1, d.snap, M.plank2); V.set(d.mast, -1, d.snap - 1, M.plank2);                             // splinters at the stump
  V.line([d.mast, 0, d.snap - 4], [d.mast - Math.round(d.L * 0.5), Math.round(d.B + 4), 2], M.oar);          // the mast over the side
  for (let k = 0; k < 6; k++) V.set(d.mast - 4 - k * 2, Math.round(d.B * 0.6) + (k % 2), 2 + (k % 3), sail);   // its sail in the water
}

/** What a pirate ship looks like now: her colours and flag, and how battered she is. */
export interface ShipLook { kind: PirateHull; scheme: number; flag: number; torn: number; scorch: number; dismasted: boolean; white: boolean }
export const lookKey = (l: ShipLook): string => `${l.kind}|${l.scheme}|${l.flag}|${l.torn}|${l.scorch}|${+l.dismasted}|${+l.white}`;
const bases = new Map<string, Vox>();
/** The ship's voxel model for a look (the undamaged hull built once per colours and flag, then battered to suit). */
export function pirateVox(l: ShipLook): Vox {
  const key = `${l.kind}|${l.scheme}|${l.flag}|${+l.white}`;
  let base = bases.get(key);
  if (!base) bases.set(key, base = BUILD[l.kind](colours().schemes[l.scheme % SCHEME_COUNT], l.flag % FLAGS, l.white));
  const V = cloneVox(base);
  if (l.dismasted) dismast(V, l.kind, colours().schemes[l.scheme % SCHEME_COUNT].sail);
  if (l.torn || l.scorch) weather(V, l.torn, l.scorch, l.scheme * 31 + l.flag, SHIP_DIMS[l.kind].top);
  return V.finalize();
}
