// Infinite world: island archipelago heightfield, cached height tiles, points of interest,
// fish schools and floating crates. Everything is deterministic from the seed.
import { nA, nB, nC, fbm, hash, hash01, mulberry } from './noise';
import { pickSpecies, SP, SPECIES } from './econ';
import { HABITAT, livesAt, schoolLook } from './species';
import type { Point, Poi, Port, Wreck, School, Crate } from './types';
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';
import { biomeAt, biomeMix, coldness, setBiomeAnchor, type BiomeId } from './biome';
import { smooth01 } from './config';
import { drawMainIsland, ISLAND_CELL, HOME_ISLAND } from '../convex/islandRules';

/**
 * The world layout. Bump it whenever islands, ports or wrecks move, and re-record tests/fixtures/landmarks.json (it
 * carries the same number): a save from an older layout keeps its progress but forgets everything tied to places,
 * and starts at Alderhaven (game/save.ts). 1: the first world; 2: bigger islands, coves and mountains.
 */
export const WORLD = 3;
export const CELL = ISLAND_CELL;               // one archipelago cell
// how many islets survive: tuned with the main islands' size (islandRules.ts) for open channels between islands
const ISLET_KEEP = 0.5;
const key = (i: number, j: number) => (i + 50000) * 100000 + (j + 50000);

// ---------- islands ----------
// Every island has all its fields from the start, in one fixed shape: heightAt reads them for every point, and
// properties added later (in differing orders) made those reads several times slower.
interface Island {
  x: number; y: number; R: number; peak: number; islet: boolean;
  /** the cell it belongs to (main islands; 0, 0 is Alderhaven) */
  ci: number; cj: number;
  /** relief, worked out on first use (mtn < 0 until then): how mountainous it is, and whether it is a volcano */
  mtn: number; volc: number;
  /** the coast factor (shoreAt) baked at 64 headings, null for a plain round coast, undefined until worked out */
  coast: Float32Array | null | undefined;
  /** how far its land can reach, squared and in units of R (2.3 for a plain island, more with headlands) */
  reach2: number;
}
const island = (x: number, y: number, R: number, peak: number, islet: boolean, ci = 0, cj = 0): Island =>
  ({ x, y, R, peak, islet, ci, cj, mtn: -1, volc: 0, coast: undefined, reach2: 2.3 });
const cells = new Map<number, Island[]>();
function cellIslands(i: number, j: number): Island[] {
  const k = key(i, j), cached = cells.get(k);
  if (cached) return cached;
  const r = mulberry(hash(i, j, 7)), L: Island[] = [];
  const ox = i * CELL, oy = j * CELL, m = drawMainIsland(i, j, r);    // the main island first (the server draws it too)
  const main: Island | null = m && island(m.x, m.y, m.R, m.peak, false, i, j);
  if (main) L.push(main);
  const n = Math.floor(r() * 3.6);
  for (let q = 0; q < n; q++) {
    let x, y;
    if (main && r() < 0.7) {                   // most islets ring the main island
      const a = r() * Math.PI * 2, d = main.R * (1.1 + r() * 0.7);
      x = main.x + Math.cos(a) * d; y = main.y + Math.sin(a) * d;
    } else {
      x = ox + CELL * (0.15 + 0.7 * r()); y = oy + CELL * (0.15 + 0.7 * r());
    }
    const sandbar = r() < 0.3;
    const R = 12 + r() * 28;
    const islet = island(x, y, R, sandbar ? 0.1 + 0.08 * r() : 0.45 + 0.4 * r(), true);
    if (hash01(i * 8 + q, j, 77) < ISLET_KEEP) L.push(islet);
  }
  cells.set(k, L);
  return L;
}

// an island and the water around it share the region at its centre (see biome.ts)
setBiomeAnchor((x, y) => {
  const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
  let best: { x: number; y: number; w: number } | null = null;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const m = cellIslands(ci + di, cj + dj)[0];
    if (!m || m.islet) continue;
    const w = 1 - smooth01((Math.hypot(x - m.x, y - m.y) / m.R - 1.3) / 0.9);
    if (w > 0 && (!best || w > best.w)) best = { x: m.x, y: m.y, w };
  }
  return best;
});

// ---------- relief ----------
// Mountains rise only well above the sea, so they shape the interior without moving a coastline. Some islands are
// rugged and some gentle, the north more rugged; big ember-isle islands become a volcano with a crater.
const nRidge = createNoise2D(Alea('bobber-run', 'ridge'));
const ridged = (x: number, y: number): number => {
  let s = 0, a = 0.6, f = 0.012;
  for (let o = 0; o < 2; o++) { const v = 1 - Math.abs(nRidge(x * f, y * f)); s += v * v * a; a *= 0.55; f *= 2.3; }
  return s;                                    // about 0..1, sharp crests (two octaves: it runs for every inland point)
};
function relief(is: Island): void {
  if (is.mtn >= 0) return;
  const big = smooth01((is.R - 50) / 120);
  is.mtn = is.islet ? 0 : big * (0.35 + 0.65 * hash01(Math.round(is.x), Math.round(is.y), 41)) * (0.7 + 0.6 * coldness(is.y));
  is.volc = !is.islet && is.R > 80 ? smooth01((biomeMix(is.x, is.y).volcanic - 0.4) / 0.3) : 0;
}
// The coastline of a main island: coves bitten in (sheltered water, where a port likes to sit) and headlands
// reaching out (peninsulas, so big islands become ragged landmasses). Alderhaven keeps its shape.
function shore(is: Island): number[] {
  const S: number[] = [];
  if (is.islet || (is.ci === 0 && is.cj === 0)) return S;
  const sx = Math.round(is.x), sy = Math.round(is.y);
  if (is.R >= 80) {                                          // coves
    const n = 2 + Math.floor(hash01(sx, sy, 51) * 3);
    for (let k = 0; k < n; k++) S.push(hash01(sx, sy, 52 + k) * Math.PI * 2, 0.14 + 0.16 * hash01(sx, sy, 56 + k), -(0.3 + 0.3 * hash01(sx, sy, 60 + k)));
  }
  if (is.R >= 70) {                                          // headlands and peninsulas
    const n = 1 + Math.floor(hash01(sx, sy, 64) * 3);
    for (let k = 0; k < n; k++) S.push(hash01(sx, sy, 65 + k) * Math.PI * 2, 0.2 + 0.3 * hash01(sx, sy, 69 + k), 0.3 + 0.6 * hash01(sx, sy, 73 + k));
  }
  return S;
}
/** The headings of an island's coves, deepest first: where its port is tried first. */
function coveHeadings(is: Island): number[] {
  const S = shore(is), C: [number, number][] = [];
  for (let q = 0; q < S.length; q += 3) if (S[q + 2] < 0) C.push([S[q], S[q + 2]]);
  return C.sort((a, b) => a[1] - b[1]).map(c => c[0]);
}
// heightAt only looks at islands in the 3 x 3 cells around a point, so no island may reach further than about
// 1.3 cells from its centre: big islands' headlands are clipped to that
const MAX_REACH = CELL * 1.25;
// baked once per island: heightAt reads it per point with one atan2 and a lerp
const COAST_N = 64;
function coastTable(is: Island): Float32Array | null {
  if (is.coast !== undefined) return is.coast;
  const S = shore(is);
  if (!S.length) return is.coast = null;
  const T = new Float32Array(COAST_N + 1), floor = is.R * Math.sqrt(2.3) / MAX_REACH;
  let lo = 1;
  for (let k = 0; k <= COAST_N; k++) lo = Math.min(lo, T[k] = Math.max(floor, shoreAt(S, k / COAST_N * Math.PI * 2 - Math.PI)));
  is.reach2 = 2.3 / (lo * lo);
  return is.coast = T;
}
function coastAt(T: Float32Array, dx: number, dy: number): number {
  const f = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) * COAST_N, k = Math.floor(f);
  return T[k] + (T[k + 1] - T[k]) * (f - k);
}
/** How far the coast is pulled in (> 1, a cove) or pushed out (< 1, a lobe) at heading a, as a factor on distance. */
function shoreAt(S: number[], a: number): number {
  let k = 1;
  for (let q = 0; q < S.length; q += 3) {
    const da = Math.atan2(Math.sin(a - S[q]), Math.cos(a - S[q])) / S[q + 1], g = Math.exp(-da * da), v = S[q + 2];
    k *= v < 0 ? 1 - v * g : 1 / (1 + v * g);
  }
  return k;
}
const LIFT = 0.14;                             // relief starts this far above the sea, so beaches stay low and sandy
// the islands of the 3 x 3 cells round cell (ci, cj), in the order heightAt reads them (row by row): neighbouring
// points almost always share a cell, so the last list is kept rather than looking up nine cells per point
let nearCi = NaN, nearCj = NaN, nearList: Island[] = [];
function islandsNear(ci: number, cj: number): Island[] {
  if (ci === nearCi && cj === nearCj) return nearList;
  const L: Island[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const is of cellIslands(ci + di, cj + dj)) L.push(is);
  nearCi = ci; nearCj = cj;
  return nearList = L;
}

/** Terrain height: < 0 is water (deeper = more negative), > 0 is land. */
export function heightAt(x: number, y: number): number {
  // domain-warp the lookup so coastlines wander
  const wx = x + 36 * nB(x * 0.0042, y * 0.0042), wy = y + 36 * nB(x * 0.0042 + 31.7, y * 0.0042 - 12.3);
  const ci = Math.floor(wx / CELL), cj = Math.floor(wy / CELL);
  let h = -0.5 + 0.1 * nC(x * 0.0016, y * 0.0016);
  let shape: number | null = null, best = -9, top: Island | null = null, topD = 0;
  const near = islandsNear(ci, cj);
  for (let q = 0; q < near.length; q++) {
    const is = near[q], T = is.islet ? null : coastTable(is);
    const dx = wx - is.x, dy = wy - is.y, d2 = (dx * dx + dy * dy) / (is.R * is.R);
    if (d2 > (T ? is.reach2 : 2.3)) continue;                       // headlands reach further than a round coast
    // coves and headlands scale the distance by heading; an island counts within 2.3 of its shaped radius
    const k = T && d2 > 0.16 ? 1 + (coastAt(T, dx, dy) - 1) * smooth01((d2 - 0.16) / 0.5) : 1;
    if (d2 * k * k > 2.3) continue;
    if (shape === null) shape = fbm(nA, x * 0.009, y * 0.009, 3);
    const d = Math.sqrt(d2) * (1 + 0.3 * shape) * k;
    const base = 1 - d * d, e = base > 0 ? is.peak * Math.pow(base, 1.4) : is.peak * base;
    if (e > best) { best = e; top = is; topD = d; }
  }
  if (best > -9) {
    let e = best;
    if (e > -0.25) { const k = Math.min(1, (e + 0.25) / 0.5); e += 0.15 * k * fbm(nC, x * 0.022, y * 0.022, 3); }
    if (e > LIFT && top) {
      relief(top);
      const up = smooth01((e - LIFT) / 0.35);              // 0 at the foothills, 1 well inland
      const rugged = up * top.mtn * (1 - 0.8 * top.volc);              // a volcano is a smooth cone, not a ridge
      if (rugged > 0.01) e += rugged * 0.75 * ridged(x, y);
      if (top.volc > 0) {                                     // a cone, and a crater at its top
        const cone = Math.max(0, 1 - topD / 0.55);
        e += top.volc * up * (0.9 * cone * cone - 0.55 * smooth01((0.12 - topD) / 0.07));
      }
    }
    if (e > h) h = e;
  }
  return h;
}

// ---------- cached height tiles ----------
/** tile size in world units; TN = stored row length (one cell of border each side) */
export const TS = 128, TN = TS + 2;
export interface HeightTile {
  tx: number; ty: number;
  /** TN x TN heights starting at world (tx*TS - 1, ty*TS - 1) */
  h: Float32Array;
  /** any land (or near-land) in the tile */
  land: boolean;
  /** tree instances cached by the renderer: [x, y, kind, scale, yaw, shade] per tree */
  trees?: number[];
}
const tiles = new Map<number, HeightTile>();
/** What tile (tx, ty) is made of: its heights and whether it has land (built here, or by a tile worker: tilepool.ts). */
export function tileHeights(tx: number, ty: number): { h: Float32Array; land: boolean } {
  const h = new Float32Array(TN * TN), x0 = tx * TS - 1, y0 = ty * TS - 1;
  let land = false;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
    const v = heightAt(x0 + i, y0 + j);
    h[j * TN + i] = v;
    if (v > -0.04) land = true;
  }
  return { h, land };
}
export function getTile(tx: number, ty: number): HeightTile {
  const k = key(tx, ty), cached = tiles.get(k);
  if (cached) return cached;
  const t: HeightTile = { tx, ty, ...tileHeights(tx, ty) };
  tiles.set(k, t);
  return t;
}
export const hasTile = (tx: number, ty: number): boolean => tiles.has(key(tx, ty));
/** A tile a worker built: kept, unless it was needed sooner and built here meanwhile. */
export function adoptTile(tx: number, ty: number, h: Float32Array, land: boolean): void {
  const k = key(tx, ty);
  if (!tiles.has(k)) tiles.set(k, { tx, ty, h, land });
}
/** height at the integer cell containing (x, y), from the tile cache */
export function hAt(x: number, y: number): number {
  x = Math.floor(x); y = Math.floor(y);
  const tx = Math.floor(x / TS), ty = Math.floor(y / TS), t = getTile(tx, ty);
  return t.h[(y - ty * TS + 1) * TN + (x - tx * TS + 1)];
}
/** bilinear height between cell centres */
export function hBil(x: number, y: number): number {
  const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5), fx = x - 0.5 - x0, fy = y - 0.5 - y0;
  const a = hAt(x0, y0), b = hAt(x0 + 1, y0), c = hAt(x0, y0 + 1), d = hAt(x0 + 1, y0 + 1);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

// ---------- names ----------
const S1 = ['Kel', 'Mar', 'Bri', 'Ash', 'Dun', 'Hav', 'Ros', 'Tor', 'Pen', 'Sal', 'Fen', 'Wen', 'Orm', 'Lun', 'Car', 'Gray', 'Bram', 'Stor', 'Oak', 'Mor'];
const S2 = ['wick', 'mere', 'holm', 'by', 'stead', 'haven', 'mouth', 'ness', 'ford', 'ton', 'sey', 'point', 'head', 'water', 'bury', 'skerry', 'cove', 'sound'];
const SHIPS = ['Mary Anne', 'North Star', 'Gull', 'Perseverance', 'Salt Queen', 'Lucky Tern', 'Old Hope', 'Merriweather', 'Grey Lady', 'Drifter'];
type Rng = () => number;
const placeName = (r: Rng) => S1[Math.floor(r() * S1.length)] + S2[Math.floor(r() * S2.length)];

// ---------- points of interest ----------
const DIRS = 32;                               // candidate pier headings around an island
const poiCells = new Map<number, Poi[]>();
// the outermost land point walking out from an island's centre along heading a
function shoreAlong(is: Island, a: number): Point | null {
  const c = Math.cos(a), s = Math.sin(a);
  let last: Point | null = null;
  for (let d = 0; d < MAX_REACH; d += 2) {
    const x = is.x + c * d, y = is.y + s * d;
    if (heightAt(x, y) > 0) last = { x, y };
    else if (last && d > is.R * 0.35) return last;
  }
  return null;
}
// room for a pier and a docked boat heading out from p along a: water ahead, deep water further out, clear both sides
function openWater(p: Point, a: number): boolean {
  const c = Math.cos(a), s = Math.sin(a);
  for (let d = 4; d <= 56; d += 4) {
    const need = d > 18 ? -0.1 : 0;
    if (heightAt(p.x + c * d, p.y + s * d) > need) return false;
    if (d > 14 && (heightAt(p.x + c * d - s * 14, p.y + s * d + c * 14) > -0.02 || heightAt(p.x + c * d + s * 14, p.y + s * d - c * 14) > -0.02)) return false;
  }
  return true;
}
/** How many species existed when port prices were first drawn; never change this. */
const LEGACY_SPECIES = 43;
const idSalt = (id: string): number => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };
function makePort(i: number, j: number, home: boolean, r: Rng, s: Point, di: number, a: number): Port {
  const c = Math.cos(a), sn = Math.sin(a);
  const ax = s.x - c * 3, ay = s.y - sn * 3;
  // the first 43 species' prices and the shipyard come off one sequence; later species get their price from their
  // own hash, so appending a species never reshuffles a port
  const pr = mulberry(hash(i, j, 5));
  const mult: Record<number, number> = {};
  for (let k = 0; k < LEGACY_SPECIES; k++) mult[k] = 0.75 + pr() * 0.7;
  const shipyard = home || pr() < 0.45;
  for (let k = LEGACY_SPECIES; k < SPECIES.length; k++) mult[k] = 0.75 + hash01(i, j, idSalt(SPECIES[k].id)) * 0.7;
  return {
    id: `port:${i},${j}`, type: 'port', name: home ? 'Alderhaven' : placeName(r), x: ax, y: ay, dir: di, ang: a,
    end: { x: ax + c * 26, y: ay + sn * 26 }, dock: { x: ax + c * 44, y: ay + sn * 44 }, mult, shipyard,
    solid: { kind: 'seg', ax, ay, bx: ax + c * 27, by: ay + sn * 27, r: 3.5 },
  };
}
function landmarks(i: number, j: number): Poi[] {
  const r = mulberry(hash(i, j, 99)), L = cellIslands(i, j), out: Poi[] = [];
  const main = L.find(is => !is.islet), home = i === 0 && j === 0;
  let portA: number | null = null;
  if (main) {
    // a port tries its island's deepest cove first: sheltered water inside a bay
    const spin = r() * Math.PI * 2, cove = home ? undefined : coveHeadings(main)[0], a0 = home ? 0.6 : cove ?? spin;
    if (home || (main.R >= 70 && r() < 0.62)) {
      for (let q = 0; q < DIRS; q++) {
        const di = (Math.round(a0 / (Math.PI * 2) * DIRS) + q) % DIRS, a = di / DIRS * Math.PI * 2;
        const s = shoreAlong(main, a);
        if (!s || !openWater(s, a)) continue;
        out.push(makePort(i, j, home, r, s, di, a));
        portA = a;
        break;
      }
    }
    // a lighthouse on the far side of the island from the port
    if (r() < 0.55 || (!portA && r() < 0.5)) {
      const base = (portA ?? r() * 6.28) + Math.PI * (0.7 + r() * 0.6);
      for (let q = 0; q < 12; q++) {
        const a = base + q * 0.5, s = shoreAlong(main, a);
        if (!s) continue;
        const x = s.x - Math.cos(a) * 7, y = s.y - Math.sin(a) * 7;
        if (heightAt(x, y) < 0.03) continue;
        out.push({ id: `light:${i},${j}`, type: 'light', name: placeName(r) + ' Light', x, y, beam: r() * 6.28 });
        break;
      }
    }
  }
  for (const is of L) if (is.islet && is.peak > 0.3 && r() < 0.14 && heightAt(is.x, is.y) > 0.05)
    out.push({ id: `light:${i},${j}:${Math.round(is.x)}`, type: 'light', name: placeName(r) + ' Light', x: is.x, y: is.y, beam: r() * 6.28 });
  if (r() < 0.42) {
    const w = placeWreck(i, j, r, main, out);
    if (w) out.push(w);
  }
  return out;
}
// a wreck in shallow water off the main island (or anywhere in an empty cell), away from ports
function placeWreck(i: number, j: number, r: Rng, main: Island | undefined, pois: Poi[]): Wreck | null {
  for (let q = 0; q < 20; q++) {
    let x, y;
    if (main) { const a = r() * 6.28, d = main.R * (1.12 + r() * 0.35); x = main.x + Math.cos(a) * d; y = main.y + Math.sin(a) * d; }
    else { x = i * CELL + CELL * (0.2 + 0.6 * r()); y = j * CELL + CELL * (0.2 + 0.6 * r()); }
    const h = heightAt(x, y);
    if (h > -0.08 || h < -0.36) continue;
    if (pois.some(p => p.type === 'port' && Math.hypot(p.dock.x - x, p.dock.y - y) < 70)) continue;
    const dist = Math.hypot(x - HOME_ISLAND.x, y - HOME_ISLAND.y);
    const a = r() * 6.28;
    const w: Wreck = {
      id: `wreck:${i},${j}`, type: 'wreck', name: 'Wreck of the ' + SHIPS[Math.floor(r() * SHIPS.length)], x, y, dir: Math.floor(r() * 16),
      loot: 25 + Math.floor(r() * 40 + dist / 60), solid: { kind: 'circ', x, y, r: 12 },
    };
    const sp = pickSpecies(0, dist, r, x, y, 'wreck'), home = openSpot(x, y, a, [34, 46, 58], sp);
    if (home) w.school = makeSchool(`ws:${i},${j}`, home.x, home.y, sp, r, 2);
    return w;
  }
  return null;
}
/** A home for a landmark's school: the first spot around (x, y), from heading a0, at one of `dists`, with open water to swim in. */
function openSpot(x: number, y: number, a0: number, dists: number[], sp: number, taken: readonly School[] = []): Point | null {
  for (const d of dists) for (let q = 0; q < 16; q++) {
    const a = a0 + q / 16 * Math.PI * 2, sx = x + Math.cos(a) * d, sy = y + Math.sin(a) * d;
    if (!landPull(sx, sy, schoolReach(sp)) && !crowded(sx, sy, sp, taken)) return { x: sx, y: sy };
  }
  return null;
}
// lighthouses attract beaconfish into the water at their feet
function lightSchools(L: Poi[], i: number, j: number): Poi[] {
  const r = mulberry(hash(i, j, 77)), taken = L.flatMap(p => p.school ? [p.school] : []);
  for (const p of L) if (p.type === 'light') {
    const sp = pickSpecies(0, 0, r, p.x, p.y, 'light'), home = openSpot(p.x, p.y, 0, [38, 52, 66, 80], sp, taken);
    if (home) taken.push(p.school = makeSchool(`ls:${p.id}`, home.x, home.y, sp, r, 3));
  }
  return L;
}
export function cellPois(i: number, j: number): Poi[] {
  const k = key(i, j);
  let L = poiCells.get(k);
  if (!L) { L = lightSchools(landmarks(i, j), i, j); poiCells.set(k, L); }
  return L;
}
/** points of interest within a square of half-size rad around (x, y); fills and returns `out` if given */
/** The landmarks within rad of (x, y); `skipCell` leaves out whole cells (never generating them), e.g. closed waters. */
export function poisNear(x: number, y: number, rad: number, out: Poi[] = [], skipCell?: (i: number, j: number) => boolean): Poi[] {
  out.length = 0;
  const i0 = Math.floor((x - rad) / CELL) - 1, i1 = Math.floor((x + rad) / CELL) + 1;
  const j0 = Math.floor((y - rad) / CELL) - 1, j1 = Math.floor((y + rad) / CELL) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (skipCell?.(i, j)) continue;
    for (const p of cellPois(i, j)) {
      if (Math.abs(p.x - x) < rad && Math.abs(p.y - y) < rad) out.push(p);
    }
  }
  return out;
}
// the seeded home island always gets a port (Alderhaven)
export const homePort = (): Port => cellPois(0, 0).find((p): p is Port => p.type === 'port')!;

// ---------- fish schools + floating crates ----------
/** One fish of a school as it swims (runtime only). */
export interface Swimmer {
  /** position, the velocity it means to swim at (eased toward its heading), and its heading */
  x: number; y: number; vx: number; vy: number; h: number;
  /** its own rhythm, seconds to its next change of heading, and the turn it leans into */
  ph: number; turn: number; bias: number;
}
// Runtime school state (not saved). Kept beside the school data so every reader sees one shape.
declare module './types' {
  interface School {
    /** a golden fish swims with this school */
    gold?: boolean;
    /** game time the school last scattered */
    scatterT?: number;
    /** recent scares; enough in a row and the school dives (until `spooked`) */
    heat?: number;
    /** its fish, once the boat has come near */
    swim?: Swimmer[];
    /** in a hotspot: the bait ball this predator hunts, or the predator hunting this bait ball */
    prey?: School; hunter?: School;
  }
}
/** Share of ordinary schools that carry a golden fish. */
export const GOLD_SCHOOLS = 0.08;
/** Fish mill within their species' radius of a centre that wanders this far from home, and scatter this much further. */
export const SWIM = { wander: 2, scatter: 6 };
/** Water at least this deep everywhere a school can swim (heightAt); fish never enter water shallower than FISH_SHORE (hAt). */
const SWIM_WATER = -0.09;
export const FISH_SHORE = -0.06;
/** Furthest any fish of species sp can be from its school's home. */
const schoolReach = (sp: number): number => schoolLook(sp).radius + SWIM.wander + SWIM.scatter;
/** Closest two schools may be: their reaches plus clear water between (at least ~50 for the smallest). */
const schoolGap = (a: number, b: number): number => schoolReach(a) + schoolReach(b) + 14;
const FC = 300;                                // fish cell size
interface FishCell { schools: School[]; crates: Crate[] }
const fishCells = new Map<number, FishCell>();
function makeSchool(id: string, x: number, y: number, sp: number, r: Rng, stock?: number): School {
  return { id, x, y, sp, stock: stock ?? 2 + Math.floor(r() * 3), max: stock ?? 3, respawn: 0, ph: r() * 6.28 };
}
// the summed directions from (x, y), out to `reach`, where the water is too shallow for a school; null if none
function landPull(x: number, y: number, reach: number, dirs = 24): Point | null {
  let dx = 0, dy = 0, hit = heightAt(x, y) > SWIM_WATER;
  for (let k = 0; k < dirs; k++) {
    const a = k / dirs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const f of [0.35, 0.7, 1]) if (heightAt(x + c * reach * f, y + s * reach * f) > SWIM_WATER) { dx += c; dy += s; hit = true; }
  }
  return hit ? { x: dx, y: dy } : null;
}
/** Nudge a school's home away from the shore until its whole swim area is open water; null if there's no room. */
function settle(x: number, y: number, reach: number, box: readonly number[]): Point | null {
  for (let step = 0; step < 6; step++) {
    const pull = landPull(x, y, reach);
    if (!pull) return { x, y };
    const L = Math.hypot(pull.x, pull.y);
    if (!L) return null;                          // shallows all round
    x = Math.min(box[2], Math.max(box[0], x - pull.x / L * reach * 0.4));
    y = Math.min(box[3], Math.max(box[1], y - pull.y / L * reach * 0.4));
  }
  return null;
}
function crowded(x: number, y: number, sp: number, others: readonly School[]): boolean {
  for (const o of others) if (Math.hypot(o.x - x, o.y - y) < schoolGap(sp, o.sp)) return true;
  return false;
}
function genFishCell(i: number, j: number): FishCell {
  const r = mulberry(hash(i, j, 31)), schools: School[] = [], crates: Crate[] = [];
  if (r() < 0.65) {
    const x = (i + 0.1 + 0.8 * r()) * FC, y = (j + 0.1 + 0.8 * r()) * FC;
    if (heightAt(x, y) < -0.06) crates.push({ id: `c:${i},${j}`, x, y, value: 3 + Math.floor(r() * 7), taken: false, respawn: 0, ph: r() * 6.28 });
  }
  return { schools, crates };
}
function fishCell(i: number, j: number): FishCell {
  const k = key(i, j);
  let c = fishCells.get(k);
  if (!c) { c = genFishCell(i, j); fishCells.set(k, c); }
  return c;
}
// ---------- fish hotspots ----------
// The sea is not a grid of schools. A few hotspots are up within reach at a time, each a tight cluster of two to four
// schools of what its water holds: often a bait ball with a predator under it, now and then a golden fish. A hotspot
// surfaces for a few minutes, dives, and comes up again somewhere else in its patch of sea, favouring drop-offs, coasts
// and reef or kelp water. Its state follows the game clock (tickHotspots), so a reload finds the same sea. The home
// waters keep one cluster up and in place, so a first voyage always starts by biting fish.
export interface Hotspot {
  id: string; x: number; y: number; r: number;
  /** 0 hidden … 1 fully surfaced; eases in and out over SURF_S */
  surf: number;
  /** a school of bait fish, a predator feeding under it, a golden fish among them */
  bait: boolean; predator: boolean; rare: boolean;
  schools: School[];
}
interface HotSlot {
  k: number; period: number; phase: number; duty: number; fixed: boolean; n: number; up: boolean; spot: Hotspot;
  /** where the cluster surfaced, each school's home then, and the way it drifts (unit vector) and how far it can */
  bx: number; by: number; homes: Point[]; dx: number; dy: number; travel: number;
}
const HC = 420, HSLOTS = 3, SURF_S = 10, HOME_R = 300, RARE_SPOT = 0.1, CLUSTER = 4;
/** A surfaced cluster drifts this fast (world units a second), following its fish, up to DRIFT_MAX from where it rose. */
const DRIFT = 0.6, DRIFT_MAX = 240;
// round Alderhaven the sea stays calm: past the one cluster that is always up, only one slot in a cell surfaces, rarely
const CALM_R = 1150, CALM_DUTY = 0.12;
const BAIT_FISH = new Set([SP.anchovy, SP.sardine, SP.herring]);
const hotCells = new Map<number, HotSlot[]>();
let hotClock = 0;
const DOWN = 1e12;                                // spooked until "never": a cluster under water neither shows nor bites
// how interesting the water at (x, y) is to fish: the edge of a drop-off, a coast, reef or kelp water
function lure(x: number, y: number): number {
  const h = heightAt(x, y), edge = Math.abs(heightAt(x + 24, y) - heightAt(x - 24, y)) + Math.abs(heightAt(x, y + 24) - heightAt(x, y - 24));
  const m = biomeMix(x, y);
  return edge * 3 + (h > -0.3 ? 0.4 : 0) + m.reef * 0.6 + m.kelp * 0.5 + m.mangrove * 0.3;
}
// a cluster for slot k of hot cell (i, j) on its n-th surfacing: where it comes up and which fish it holds
function placeSpot(i: number, j: number, sl: HotSlot): void {
  const spot = sl.spot, r = mulberry(hash(i * 3 + sl.k, j, 7919 + sl.n)), x0 = i * HC + 30, y0 = j * HC + 30, span = HC - 60;
  const box = [x0, y0, x0 + span, y0 + span];
  const fixed = [BOSS, ...poisNear(x0 + span / 2, y0 + span / 2, HC).flatMap(p => p.school ? [p.school] : [])];
  let best: Point | null = null, score = -1;
  for (let t = 0; t < 30; t++) {
    const cx = x0 + span * r(), cy = y0 + span * r();
    if (heightAt(cx, cy) > -0.08) continue;
    const sc = lure(cx, cy) + r() * 0.3;
    if (sc > score) { score = sc; best = { x: cx, y: cy }; }
  }
  const used: number[] = [];
  let bait = false, predator = false, reach = 0;
  for (const s of spot.schools) { s.spooked = DOWN; s.stock = 0; s.gold = false; s.swim = undefined; s.prey = s.hunter = undefined; }
  if (best) {
    for (let m = 0, tries = 0; m < CLUSTER && tries < 12; tries++) {
      // fish of the first school's water; behind a bait ball, a predator from a little deeper
      const ox = best.x + (m ? (r() - 0.5) * 50 : 0), oy = best.y + (m ? (r() - 0.5) * 36 : 0), h = heightAt(ox, oy);
      if (h > -0.08) continue;
      const d = Math.hypot(ox - HOME_ISLAND.x, oy - HOME_ISLAND.y), sp = pickSpecies(m === 1 && bait ? h - 0.15 : h, d, r, ox, oy);
      if (used.includes(sp) || (m > 0 && BAIT_FISH.has(sp) && bait)) continue;
      const home = settle(ox, oy, schoolReach(sp), box);
      if (!home || crowded(home.x, home.y, sp, fixed)) continue;
      const s = spot.schools[m] ??= makeSchool(`${spot.id},${m}`, home.x, home.y, sp, r);
      const n = BAIT_FISH.has(sp) ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2);
      Object.assign(s, { x: home.x, y: home.y, sp, stock: n, max: n, respawn: 0, ph: r() * 6.28, spooked: undefined, gold: false, swim: undefined, scatterT: undefined, heat: 0 });
      if (m === 0) bait = BAIT_FISH.has(sp);
      else if (bait && !BAIT_FISH.has(sp)) predator = true;
      used.push(sp); reach = Math.max(reach, Math.hypot(home.x - best.x, home.y - best.y) + schoolReach(sp));
      m++;
      if (m >= 2 && r() < 0.35) break;              // two to four schools
    }
    const live = spot.schools.filter(s => s.stock > 0 && !SPECIES[s.sp].legend);
    spot.rare = live.length > 0 && r() < RARE_SPOT;
    if (spot.rare) live[Math.floor(r() * live.length)].gold = true;
    const hunter = predator ? spot.schools.find((s, m) => m > 0 && s.stock > 0 && !BAIT_FISH.has(s.sp)) : undefined;
    if (hunter) { hunter.prey = spot.schools[0]; spot.schools[0].hunter = hunter; }
  }
  Object.assign(spot, { x: best?.x ?? x0 + span / 2, y: best?.y ?? y0 + span / 2, r: reach, bait, predator });
  if (!used.length) spot.rare = false;
  // the way it will drift while up: of four headings, the one with the most open water before any shallows
  Object.assign(sl, { bx: spot.x, by: spot.y, homes: spot.schools.map(q => ({ x: q.x, y: q.y })), dx: 0, dy: 0, travel: 0 });
  if (sl.fixed || !used.length) return;
  for (let t = 0, a0 = r() * Math.PI * 2; t < 4; t++) {
    const a = a0 + t * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
    // every school's home moved e along the heading: open water round it, still the first school's kind of water (its
    // species set the spot), and biome fish still in their biome
    const fits = (e: number) => spot.schools.every((q, m) => {
      if (q.stock <= 0) return true;
      const x = q.x + c * e, y = q.y + sn * e, hab = HABITAT[SPECIES[q.sp].id];
      return !landPull(x, y, schoolReach(q.sp), 12) && (m > 0 || livesAt(q.sp, x, y, heightAt(x, y))) && (!hab || biomeMix(x, y)[hab] >= 0.4);
    });
    let d = 0;
    while (d < DRIFT_MAX && fits(d + 30)) d += 30;
    if (d > sl.travel) Object.assign(sl, { dx: c, dy: sn, travel: d });
  }
}
function hotCell(i: number, j: number): HotSlot[] {
  const k = key(i, j);
  let c = hotCells.get(k);
  if (c) return c;
  const dHome = Math.hypot((i + 0.5) * HC - HOME_ISLAND.x, (j + 0.5) * HC - HOME_ISLAND.y), home = dHome < HOME_R, calm = dHome < CALM_R;
  c = [];
  for (let q = 0; q < HSLOTS; q++) {
    const period = 420 + hash01(i * 5 + q, j, 61) * 300;   // seven to twelve minutes a cycle
    const spot: Hotspot = { id: `h:${i},${j},${q}`, x: 0, y: 0, r: 0, surf: 0, bait: false, predator: false, rare: false, schools: [] };
    const duty = !calm ? 0.55 : q === 0 ? CALM_DUTY : 0;
    const phase = calm ? hash01(i, j, 63) : q / HSLOTS + hash01(i, j * 5 + q, 62) * 0.2;   // calm cells out of step, so they don't all surface at the start
    c.push({ k: q, period, phase, duty, fixed: home && q === 0, n: -1, up: false, spot, bx: 0, by: 0, homes: [], dx: 0, dy: 0, travel: 0 });
  }
  hotCells.set(k, c);
  for (const sl of c) stepSlot(i, j, sl);
  return c;
}
// bring one slot to the hotspot clock: surfacing (somewhere new), diving, and the ease of its signs
function stepSlot(i: number, j: number, sl: HotSlot): void {
  const cyc = hotClock / sl.period + sl.phase, n = sl.fixed ? 0 : Math.floor(cyc), f = cyc - Math.floor(cyc);
  const up = sl.fixed || f < sl.duty;
  if (up && n !== sl.n) { sl.n = n; placeSpot(i, j, sl); }
  else if (!up && sl.up) for (const s of sl.spot.schools) s.spooked = DOWN;
  sl.up = up;
  const into = f * sl.period, left = (sl.duty - f) * sl.period;
  sl.spot.surf = sl.fixed ? 1 : up ? Math.min(1, into / SURF_S, left / SURF_S) : 0;
  if (up && sl.travel > 0) {                      // drifting with its fish
    const d = Math.min(sl.travel, into * DRIFT), ox = sl.dx * d, oy = sl.dy * d;
    sl.spot.x = sl.bx + ox; sl.spot.y = sl.by + oy;
    sl.spot.schools.forEach((q, m) => { const h = sl.homes[m]; if (h) { q.x = h.x + ox; q.y = h.y + oy; } });
  }
}
// One rare fish roams each wide stretch of sea: a lone school of something valuable that lives there, travelling a
// loop through deep water on the game clock. It counts as a rare hotspot, so its sign shows from afar.
const RC = 1400, ROAM_SPEED = 4;
/** A roamer's loop keeps to water at least this deep along every leg, so its fish have room on either side. */
const ROAM_WATER = -0.22;
interface Roamer { path: Point[]; len: number; spot: Hotspot }
const roamCells = new Map<number, Roamer | null>();
function roamCell(i: number, j: number): Roamer | null {
  const k = key(i, j);
  if (roamCells.has(k)) return roamCells.get(k)!;
  const r = mulberry(hash(i, j, 8111)), path: Point[] = [], cx = (i + 0.5) * RC, cy = (j + 0.5) * RC;
  // deep water all along a leg of the loop, not just at its ends (a straight line between two deep points can cross an island)
  const clear = (p: Point, q: Point): boolean => {
    const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 12);
    for (let k = 1; k < n; k++) if (heightAt(p.x + (q.x - p.x) * k / n, p.y + (q.y - p.y) * k / n) > ROAM_WATER) return false;
    return true;
  };
  for (let t = 0; t < 60 && path.length < 5; t++) {
    const a = path.length / 5 * Math.PI * 2 + (r() - 0.5) * 0.8, d = 250 + r() * 300, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, p = { x, y };
    // each new point joins the last and can close the loop back to the first
    if (heightAt(x, y) < -0.3 && (!path.length || clear(path[path.length - 1], p)) && (path.length < 2 || clear(p, path[0]))) path.push(p);
  }
  let ro: Roamer | null = null;
  const d = Math.hypot(cx - HOME_ISLAND.x, cy - HOME_ISLAND.y);
  // a roamer is a swimmer that travels: never a crab, a bottom fish or a bait ball
  const rare = path.length >= 3 && d > 700 ? [...SPECIES.keys()].filter(n => { const s = SPECIES[n]; return !s.legend && !s.special && s.base >= 30 && s.role !== 'crawler' && s.role !== 'bottom' && s.role !== 'bait' && livesAt(n, path[0].x, path[0].y, heightAt(path[0].x, path[0].y)); }) : [];
  if (rare.length) {
    const sp = rare[Math.floor(r() * rare.length)], s = makeSchool(`r:${i},${j}`, path[0].x, path[0].y, sp, r, 2);
    let len = 0;
    for (let q = 0; q < path.length; q++) len += Math.hypot(path[(q + 1) % path.length].x - path[q].x, path[(q + 1) % path.length].y - path[q].y);
    ro = { path, len, spot: { id: s.id, x: s.x, y: s.y, r: schoolReach(sp), surf: 1, bait: false, predator: false, rare: true, schools: [s] } };
    stepRoamer(ro);
  }
  roamCells.set(k, ro);
  return ro;
}
// where along its loop the roamer is at the hotspot clock
function stepRoamer(ro: Roamer): void {
  let d = (hotClock * ROAM_SPEED) % ro.len;
  for (let q = 0; q < ro.path.length; q++) {
    const a = ro.path[q], b = ro.path[(q + 1) % ro.path.length], seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= seg) { const s = ro.spot.schools[0], f = d / seg; s.x = ro.spot.x = a.x + (b.x - a.x) * f; s.y = ro.spot.y = a.y + (b.y - a.y) * f; return; }
    d -= seg;
  }
}
/** Move the hotspots on to game clock `clock` (seconds): call once a frame from the game loop. */
export function tickHotspots(clock: number): void {
  hotClock = clock;
  for (const [k, c] of hotCells) { const i = Math.floor(k / 100000) - 50000, j = (k % 100000) - 50000; for (const sl of c) stepSlot(i, j, sl); }
  for (const ro of roamCells.values()) if (ro) stepRoamer(ro);
}
/** The hotspots up (or easing in or out) within the square of half-size rad; fills `out` if given. */
export function hotspotsNear(x: number, y: number, rad: number, out: Hotspot[] = []): Hotspot[] {
  out.length = 0;
  for (let j = Math.floor((y - rad) / HC); j <= Math.floor((y + rad) / HC); j++)
    for (let i = Math.floor((x - rad) / HC); i <= Math.floor((x + rad) / HC); i++)
      for (const sl of hotCell(i, j)) if (sl.spot.surf > 0 && sl.spot.r > 0 && Math.abs(sl.spot.x - x) < rad + sl.spot.r && Math.abs(sl.spot.y - y) < rad + sl.spot.r) out.push(sl.spot);
  for (let j = Math.floor((y - rad) / RC); j <= Math.floor((y + rad) / RC); j++)
    for (let i = Math.floor((x - rad) / RC); i <= Math.floor((x + rad) / RC); i++) {
      const ro = roamCell(i, j);
      if (ro && Math.abs(ro.spot.x - x) < rad + ro.spot.r && Math.abs(ro.spot.y - y) < rad + ro.spot.r) out.push(ro.spot);
    }
  return out;
}
// the Old One's lair: deep open water far from home, fixed for this world
export const LAIR: Point = (() => {
  for (let r = 3400; r < 5600; r += 150) for (let a = 0; a < 6.28; a += 0.35) {
    const x = HOME_ISLAND.x + Math.cos(a + 2.2) * r, y = HOME_ISLAND.y + Math.sin(a + 2.2) * r;
    if (heightAt(x, y) < -0.48 && heightAt(x + 70, y) < -0.4 && heightAt(x - 70, y) < -0.4 && heightAt(x, y + 70) < -0.4 && heightAt(x, y - 70) < -0.4) return { x, y };
  }
  return { x: 3700, y: 280 };
})();
export const BOSS: School = { id: 'boss', x: LAIR.x, y: LAIR.y, sp: SP.oldone, stock: 1, max: 1, respawn: 0, ph: 0, boss: true };
const landmarkScratch: Poi[] = [];
/** fish schools in hotspots within the square of half-size rad, plus the boss and landmark schools nearby; fills `out` if given */
export function schoolsNear(x: number, y: number, rad: number, out: School[] = []): School[] {
  out.length = 0;
  if (Math.abs(BOSS.x - x) < rad + 20 && Math.abs(BOSS.y - y) < rad + 20) out.push(BOSS);
  for (let j = Math.floor((y - rad) / HC); j <= Math.floor((y + rad) / HC); j++)
    for (let i = Math.floor((x - rad) / HC); i <= Math.floor((x + rad) / HC); i++)
      for (const sl of hotCell(i, j)) for (const s of sl.spot.schools) if (Math.abs(s.x - x) < rad && Math.abs(s.y - y) < rad) out.push(s);
  for (let j = Math.floor((y - rad) / RC); j <= Math.floor((y + rad) / RC); j++)
    for (let i = Math.floor((x - rad) / RC); i <= Math.floor((x + rad) / RC); i++) {
      const s = roamCell(i, j)?.spot.schools[0];
      if (s && Math.abs(s.x - x) < rad && Math.abs(s.y - y) < rad) out.push(s);
    }
  for (const p of poisNear(x, y, rad + 60, landmarkScratch)) if (p.school) out.push(p.school);
  return out;
}
export function cratesNear(x: number, y: number, rad: number, out: Crate[] = []): Crate[] {
  out.length = 0;
  for (let j = Math.floor((y - rad) / FC); j <= Math.floor((y + rad) / FC); j++)
    for (let i = Math.floor((x - rad) / FC); i <= Math.floor((x + rad) / FC); i++) for (const c of fishCell(i, j).crates) out.push(c);
  return out;
}

// ---------- keeping the caches bounded ----------
// Everything above regenerates identically from the seed, so data far from the view is dropped and rebuilt on the
// way back. Fish cells and landmarks only go while untouched (every school full, every crate in place): a fished-out
// school or a taken crate keeps its state until it has refilled.
const full = (s: School | undefined) => !s || s.stock >= s.max;
/** whether cache key k's square (side `size`) lies more than `keep` from (x, y) */
function far(k: number, size: number, x: number, y: number, keep: number): boolean {
  const i = Math.floor(k / 100000) - 50000, j = (k % 100000) - 50000;
  return Math.max(Math.abs((i + 0.5) * size - x), Math.abs((j + 0.5) * size - y)) > keep + size / 2;
}
/** Drop cached world data far from the view centre (x, y); `view` is the larger side of the view in world units. */
export function trimWorld(x: number, y: number, view: number): void {
  const keepTiles = view / 2 + 3 * TS;            // the renderer's prefetch reaches 1.5 tiles past the view; keep 1.5 more for turning back
  for (const k of tiles.keys()) if (far(k, TS, x, y, keepTiles)) tiles.delete(k);
  for (const k of cells.keys()) if (far(k, CELL, x, y, 4000)) cells.delete(k);
  for (const [k, L] of poiCells) if (far(k, CELL, x, y, 4000) && L.every(p => full(p.school))) poiCells.delete(k);
  for (const [k, c] of hotCells) if (far(k, HC, x, y, 1500) && c.every(sl => sl.spot.schools.every(full))) hotCells.delete(k);
  for (const [k, c] of fishCells) {
    if (!far(k, FC, x, y, 1500)) continue;
    if (c.schools.every(full) && c.crates.every(cr => !cr.taken)) fishCells.delete(k);
    else for (const s of c.schools) s.swim = undefined;     // kept for its state; its fish respawn on the way back
  }
}
// ---------- claimable islands ----------
/** The main island of a cell: the unit players can claim and name (islets ride along), Alderhaven's included. */
export interface Claimable { key: string; i: number; j: number; x: number; y: number; R: number }
export function claimableNear(x: number, y: number, rad: number): Claimable[] {
  const out: Claimable[] = [], i0 = Math.floor((x - rad) / CELL), i1 = Math.floor((x + rad) / CELL), j0 = Math.floor((y - rad) / CELL), j1 = Math.floor((y + rad) / CELL);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const m = cellIslands(i, j)[0];
    if (m && !m.islet && Math.hypot(m.x - x, m.y - y) < rad + m.R) out.push({ key: `${i},${j}`, i, j, x: m.x, y: m.y, R: m.R });
  }
  return out;
}
/** The claimable island with this key ("i,j"), or null when its cell has none. */
export function claimableAt(key: string): Claimable | null {
  const [i, j] = key.split(',').map(Number), m = cellIslands(i, j)[0];
  return m && !m.islet ? { key, i, j, x: m.x, y: m.y, R: m.R } : null;
}
// An owned island's homestead (flag pole, cottage, bunting) stands on meadow toward its south shore, so its hills don't
// hide it from the camera, and well clear of a harbour or lighthouse; on an island with no meadow, on any dry ground.
// The pole is at the returned point, the cottage to its west (homesteadMesh in gl/meshes.ts); null only for an island
// with no room at all. The chart hangs its pennant here too.
const sites = new Map<string, Point | null>();
export function homesteadSite(c: Claimable): Point | null {
  if (!sites.has(c.key)) sites.set(c.key, siteIn(c, 0.16, 0.45) ?? siteIn(c, 0.05, 0.9));   // meadow, else any dry ground
  return sites.get(c.key)!;
}
function siteIn(c: Claimable, lo: number, hi: number): Point | null {
  const ok = (x: number, y: number): boolean => { const v = heightAt(x, y); return v > lo && v < hi; };
  const pois = poisNear(c.x, c.y, c.R * 1.5 + 60);
  let best: Point | null = null, score = -Infinity;
  for (let dy = -0.8 * c.R; dy <= 0.9 * c.R; dy += 8) for (let dx = -0.8 * c.R; dx <= 0.8 * c.R; dx += 8) {
    const x = c.x + dx, y = c.y + dy, s = dy - 0.6 * Math.abs(dx);
    if (s <= score || Math.hypot(dx, dy) > 0.9 * c.R || !ok(x, y) || !ok(x - 9, y) || !ok(x - 18, y - 7) || !ok(x - 13, y - 3) || !ok(x - 27, y + 6)) continue;
    if (pois.some(p => p.type !== 'wreck' && Math.hypot(p.x - (x - 10), p.y - y) < 55)) continue;
    best = { x, y }; score = s;
  }
  return best;
}
// ---------- a kingdom's ground: where an owned island's buildings stand ----------
/**
 * Where an island's buildings go, round its homestead: shore spots facing open water (the dock first, then the
 * shipyard; `a` points out to sea) and level dry plots inland (market, gardens, lighthouse), clear of the homestead,
 * each other and the island's landmarks. Fixed for the world, found once per island.
 */
export interface RealmPlots { seat: Point; shore: { x: number; y: number; a: number }[]; land: Point[] }
const realmPlotCache = new Map<string, RealmPlots | null>();
export function realmPlots(c: Claimable): RealmPlots | null {
  if (realmPlotCache.has(c.key)) return realmPlotCache.get(c.key)!;
  const seat = homesteadSite(c);
  let plots: RealmPlots | null = null;
  if (seat) {
    const pois = poisNear(c.x, c.y, c.R * 1.6 + 80), clear = (x: number, y: number, r: number) => !pois.some(p => p.type !== 'wreck' && Math.hypot(p.x - x, p.y - y) < r);
    // the shore: along rays from the homestead, the last dry ground before water that stays water a little further out
    const shore: { x: number; y: number; a: number; d: number }[] = [];
    for (let k = 0; k < 32; k++) {
      const a = k / 32 * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
      for (let d = 12; d < 170; d += 3) {
        const x = seat.x + cx * d, y = seat.y + cy * d;
        if (heightAt(x, y) > -0.02) continue;
        const lx = x - cx * 5, ly = y - cy * 5;
        // a berth: the water off it stays deep enough to float a hull all along the pier and past its end
        let deep = true;
        for (let k = 8; k <= 40 && deep; k += 4) deep = heightAt(lx + cx * k, ly + cy * k) < -0.1;
        if (deep && heightAt(lx, ly) > 0.02 && clear(lx, ly, 45)) shore.push({ x: lx, y: ly, a, d });
        break;
      }
    }
    shore.sort((p, q) => p.d - q.d);
    const picked: { x: number; y: number; a: number }[] = [];
    for (const p of shore) if (picked.length < 2 && picked.every(q => Math.hypot(p.x - q.x, p.y - q.y) > 34)) picked.push({ x: p.x, y: p.y, a: p.a });
    // level dry plots on a ring round the homestead, nearest first
    const land: Point[] = [], ok = (x: number, y: number) => { const v = heightAt(x, y); return v > 0.08 && v < 0.5; };
    for (let r = 46; r <= 120 && land.length < 3; r += 10) for (let k = 0; k < 24 && land.length < 3; k++) {
      const a = k / 24 * Math.PI * 2 + r * 0.1, x = seat.x + Math.cos(a) * r, y = seat.y + Math.sin(a) * r;
      if (!ok(x, y) || !ok(x + 9, y) || !ok(x - 9, y) || !ok(x, y + 7) || !ok(x, y - 7) || !clear(x, y, 50)) continue;
      if ([seat, ...land, ...picked].some(q => Math.hypot(q.x - x, q.y - y) < 34)) continue;
      land.push({ x, y });
    }
    plots = { seat, shore: picked, land };
  }
  realmPlotCache.set(c.key, plots);
  return plots;
}
// ---------- region sites: a village in each region, and legend spots ----------
// Places the region stories happen: a small village on an island of each region near home, where its characters live,
// and six legends further out. Fixed for this world and found by id ('reef-village', 'legend-sunkenTemple'), so a quest
// can send a player to one.
export interface RegionSite { id: string; kind: 'village' | 'legend'; biome: BiomeId; legend?: string; x: number; y: number; a: number }
const VILLAGE_BIOMES: BiomeId[] = ['reef', 'kelp', 'volcanic', 'mangrove', 'cold', 'warm'];
// legend, the region it belongs to, how far from home, and whether it stands on land or in the shallows
const LEGENDS: [string, (b: BiomeId) => boolean, number, 'land' | 'shallows'][] = [
  ['sunkenTemple', b => b === 'reef' || b === 'warm', 1500, 'shallows'],
  ['stoneCircle', b => b === 'open' || b === 'home', 900, 'land'],
  ['wreckGraveyard', b => b === 'open' || b === 'kelp', 1800, 'shallows'],
  ['crystalCave', b => b === 'volcanic', 1200, 'land'],
  ['whaleFall', b => b === 'cold' || b === 'open', 1600, 'shallows'],
  ['iceboundShip', b => b === 'cold', 2200, 'shallows'],
];
let placed: RegionSite[] | null = null;
function placeSites(): RegionSite[] {
  const out: RegionSite[] = [], taken: Point[] = [];
  const clear = (x: number, y: number, gap: number): boolean => taken.every(t => Math.hypot(t.x - x, t.y - y) > gap)
    && !poisNear(x, y, 90).some(p => p.type !== 'wreck' && Math.hypot(p.x - x, p.y - y) < 80);
  const isles = claimableNear(HOME_ISLAND.x, HOME_ISLAND.y, 6000).filter(c => c.key !== '0,0')
    .sort((a, b) => Math.hypot(a.x - HOME_ISLAND.x, a.y - HOME_ISLAND.y) - Math.hypot(b.x - HOME_ISLAND.x, b.y - HOME_ISLAND.y));
  // a village: dry ground near the island's shore, facing open water, clear of where a homestead would stand
  for (const biome of VILLAGE_BIOMES) for (const c of isles) {
    if (biomeAt(c.x, c.y) !== biome) continue;
    const home = homesteadSite(c);
    let best: RegionSite | null = null, score = -Infinity;
    for (let k = 0; k < 24; k++) for (const f of [0.5, 0.65, 0.8]) {
      const a = k / 24 * Math.PI * 2, x = c.x + Math.cos(a) * c.R * f, y = c.y + Math.sin(a) * c.R * f, v = heightAt(x, y);
      if (v < 0.06 || v > 0.5 || heightAt(x + Math.cos(a) * 40, y + Math.sin(a) * 40) > -0.05) continue;   // the sea within a jetty's reach
      if ((home && Math.hypot(home.x - x, home.y - y) < 110) || !clear(x, y, 200)) continue;
      const sc = -Math.hypot(x - HOME_ISLAND.x, y - HOME_ISLAND.y) + f * 40;
      if (sc > score) { score = sc; best = { id: `${biome}-village`, kind: 'village', biome, x, y, a }; }
    }
    if (best) { out.push(best); taken.push(best); break; }
  }
  // a legend: the first fitting spot on rings out from its distance, in its region, on land or in the shallows
  for (const [legend, fits, from, ground] of LEGENDS) {
    found: for (let r = from; r < from + 4800; r += 120) for (let k = 0, n = Math.ceil(r * Math.PI * 2 / 60); k < n; k++) {   // a sample every ~60 units round the ring
      const a = k / n * Math.PI * 2 + hash01(r, k, 71) * 0.1, x = HOME_ISLAND.x + Math.cos(a) * r, y = HOME_ISLAND.y + Math.sin(a) * r, v = heightAt(x, y);
      if (ground === 'land' ? v < 0.1 || v > 0.7 : v > -0.04 || v < -0.2) continue;
      if (ground === 'land' && ![0, 1, 2, 3, 4, 5, 6, 7].some(q => heightAt(x + Math.cos(q * Math.PI / 4) * 45, y + Math.sin(q * Math.PI / 4) * 45) < -0.06)) continue;   // in sight of a boat
      if (!fits(biomeAt(x, y)) || !clear(x, y, 400)) continue;
      out.push({ id: `legend-${legend}`, kind: 'legend', biome: biomeAt(x, y), legend, x, y, a: hash01(r, k, 72) * Math.PI * 2 });
      taken.push({ x, y });
      break found;
    }
  }
  return out;
}
/** Every region site, placed once. */
export const regionSites = (): RegionSite[] => placed ??= placeSites();
export const regionSite = (id: string): RegionSite | undefined => regionSites().find(s => s.id === id);
/** The nearest point of open water (depth beyond `depth`) to (x, y), searching outward in rings; (x, y) if none. */
export function nearestWater(x: number, y: number, depth = -0.12): Point {
  if (heightAt(x, y) < depth) return { x, y };
  for (let r = 12; r <= 600; r += 12) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (heightAt(px, py) < depth) return { x: px, y: py };
  }
  return { x, y };
}
export const worldCaches = () => ({ tiles: tiles.size, cells: cells.size, pois: poiCells.size, fish: fishCells.size });
