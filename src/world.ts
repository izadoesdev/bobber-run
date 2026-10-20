// Infinite world: island archipelago heightfield, cached height tiles, points of interest,
// fish schools and floating crates. Everything is deterministic from the seed.
import { nA, nB, nC, fbm, hash, hash01, mulberry } from './noise';
import { pickSpecies, SP, SPECIES } from './econ';
import { schoolLook } from './species';
import type { Point, Poi, Port, Wreck, School, Crate } from './types';
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';
import { biomeMix, coldness, setBiomeAnchor } from './biome';

const CELL = 560;                              // one archipelago cell
const HOME_ISLAND: Point = { x: 280, y: 280 };
const key = (i: number, j: number) => (i + 50000) * 100000 + (j + 50000);

// ---------- islands ----------
// Every island has all its fields from the start, in one fixed shape: heightAt reads them for every point, and
// properties added later (in differing orders) made those reads several times slower.
interface Island {
  x: number; y: number; R: number; peak: number; islet: boolean;
  /** the cell it belongs to (main islands), for its landmarks */
  ci: number; cj: number;
  /** relief, worked out on first use (mtn < 0 until then): how mountainous it is, and whether it is a volcano */
  mtn: number; volc: number;
  /** how much bigger it grows than its first size (1 = not at all) */
  grow: number;
  /** the coast factor (shoreAt) baked at 64 headings, null for a plain round coast, undefined until worked out */
  coast: Float32Array | null | undefined;
  /** how far its land can reach, squared and in units of R (2.3 for a plain island, more with headlands) */
  reach2: number;
}
const island = (x: number, y: number, R: number, peak: number, islet: boolean, ci = 0, cj = 0): Island =>
  ({ x, y, R, peak, islet, ci, cj, mtn: -1, volc: 0, grow: 1, coast: undefined, reach2: 2.3 });
const cells = new Map<number, Island[]>();
function cellIslands(i: number, j: number): Island[] {
  const k = key(i, j), cached = cells.get(k);
  if (cached) return cached;
  const r = mulberry(hash(i, j, 7)), L: Island[] = [];
  const ox = i * CELL, oy = j * CELL;
  let main: Island | null = null;
  if (i === 0 && j === 0) main = island(HOME_ISLAND.x, HOME_ISLAND.y, 145, 0.8, false, i, j);
  else if (r() < 0.72) {
    // argument order matters: x, y, R and peak draw from r in this order, as they always have
    const x = ox + CELL * (0.3 + 0.4 * r()), y = oy + CELL * (0.3 + 0.4 * r()), R = 55 + Math.pow(r(), 1.4) * 160, peak = 0.55 + 0.45 * r();
    main = island(x, y, R, peak, false, i, j);
  }
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
    L.push(island(x, y, R, sandbar ? 0.1 + 0.08 * r() : 0.45 + 0.4 * r(), true));
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
const smooth01 = (t: number): number => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c); };

// ---------- relief ----------
// Mountains are added only where the ground is already well above the sea, so they shape the interior (ridges,
// valleys, peaks) without moving a single coastline. Some islands are rugged and some gentle; the far north is
// rugged, and big islands in the ember isles grow a volcano with a crater.
const nRidge = createNoise2D(Alea('bobber-run', 'ridge'));
const ridged = (x: number, y: number): number => {
  let s = 0, a = 0.6, f = 0.012;
  for (let o = 0; o < 2; o++) { const v = 1 - Math.abs(nRidge(x * f, y * f)); s += v * v * a; a *= 0.55; f *= 2.3; }
  return s;                                    // about 0..1, sharp crests (two octaves: it runs for every inland point)
};
function relief(is: Island): void {
  if (is.mtn >= 0) return;
  const big = smoothstepN((is.R - 50) / 120);
  is.mtn = is.islet ? 0 : big * (0.35 + 0.65 * hash01(Math.round(is.x), Math.round(is.y), 41)) * (0.7 + 0.6 * coldness(is.y));
  is.volc = !is.islet && is.R > 80 ? smoothstepN((biomeMix(is.x, is.y).volcanic - 0.4) / 0.3) : 0;
}
// The coastline of a main island: coves bitten in (sheltered water to fish in) and lobes reaching out (headlands
// and peninsulas, so some islands become large, ragged landmasses), plus, for islands with no landmarks of their own,
// overall growth. All of it keeps clear of every port, lighthouse and wreck nearby: those were placed on the plain
// coast and never move, and the island's centre (its claim) never moves either. Alderhaven keeps its shape.
function shore(is: Island): number[] {
  const S: number[] = [];
  if (is.islet || (is.ci === 0 && is.cj === 0)) return S;
  const near: Point[] = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) near.push(...bareLandmarks(is.ci + di, is.cj + dj));
  const own = bareLandmarks(is.ci, is.cj);
  const sx = Math.round(is.x), sy = Math.round(is.y);
  if (!own.length && hash01(sx, sy, 71) < 0.6) is.grow = 1.4 + 0.6 * hash01(sx, sy, 72);
  const R = is.R * is.grow;
  // a feature at heading a reaching out to `reach` x R must keep clear of every landmark within that reach
  const clear = (a: number, half: number, reach: number): boolean => near.every(p => {
    const da = Math.abs(Math.atan2(Math.sin(Math.atan2(p.y - is.y, p.x - is.x) - a), Math.cos(Math.atan2(p.y - is.y, p.x - is.x) - a)));
    return da > half * 2.5 + 0.35 || Math.hypot(p.x - is.x, p.y - is.y) > R * (reach + 0.35);
  });
  if (is.R >= 80) {                                          // coves
    const n = 2 + Math.floor(hash01(sx, sy, 51) * 2);
    for (let k = 0; k < n; k++) {
      const a = hash01(sx, sy, 52 + k) * Math.PI * 2, half = 0.16 + 0.14 * hash01(sx, sy, 56 + k);
      if (own.some(p => Math.abs(Math.atan2(Math.sin(Math.atan2(p.y - is.y, p.x - is.x) - a), Math.cos(Math.atan2(p.y - is.y, p.x - is.x) - a))) < 0.75)) continue;
      S.push(a, half, -(0.28 + 0.22 * hash01(sx, sy, 60 + k)));
    }
  }
  if (is.R >= 60) {                                          // lobes and peninsulas
    const n = 1 + Math.floor(hash01(sx, sy, 64) * 3);
    for (let k = 0; k < n; k++) {
      const a = hash01(sx, sy, 65 + k) * Math.PI * 2, half = 0.25 + 0.3 * hash01(sx, sy, 69 + k), reach = 0.35 + 0.55 * hash01(sx, sy, 73 + k);
      if (clear(a, half, 1 + reach)) S.push(a, half, reach);
    }
  }
  return S;
}
// baked once per island: heightAt reads it per point with one atan2 and a lerp
const COAST_N = 64;
function coastTable(is: Island): Float32Array | null {
  if (is.coast !== undefined) return is.coast;
  const S = shore(is);                          // (also sets grow)
  if (!S.length) return is.coast = null;
  const T = new Float32Array(COAST_N + 1);
  let lo = 1;
  for (let k = 0; k <= COAST_N; k++) lo = Math.min(lo, T[k] = shoreAt(S, k / COAST_N * Math.PI * 2 - Math.PI));
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
const smoothstepN = (t: number): number => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c); };
const LIFT = 0.14;                             // relief starts this far above the sea, so shores and beaches stay put

/** Terrain height: < 0 is water (deeper = more negative), > 0 is land. */
export const heightAt = (x: number, y: number): number => shape(x, y, true);
/** The coast before coves are cut: where ports, lighthouses and wrecks were always placed, so they never move. */
const baseHeight = (x: number, y: number): number => shape(x, y, false);
function shape(x: number, y: number, cut: boolean): number {
  // domain-warp the lookup so coastlines wander
  const wx = x + 36 * nB(x * 0.0042, y * 0.0042), wy = y + 36 * nB(x * 0.0042 + 31.7, y * 0.0042 - 12.3);
  const ci = Math.floor(wx / CELL), cj = Math.floor(wy / CELL);
  let h = -0.5 + 0.1 * nC(x * 0.0016, y * 0.0016);
  let shape: number | null = null, best = -9, top: Island | null = null, topD = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    for (const is of cellIslands(ci + di, cj + dj)) {
      const T = cut && !is.islet ? coastTable(is) : null, R = cut && !is.islet ? is.R * is.grow : is.R;
      const dx = wx - is.x, dy = wy - is.y, d2 = (dx * dx + dy * dy) / (R * R);
      if (d2 > (T ? is.reach2 : 2.3)) continue;                       // headlands reach further than a round coast
      // coves and headlands scale the distance by heading; an island only counts within 2.3 of its own, shaped
      // radius in that direction, as a round island always did
      const k = T && d2 > 0.16 ? 1 + (coastAt(T, dx, dy) - 1) * smoothstepN((d2 - 0.16) / 0.5) : 1;
      if (d2 * k * k > 2.3) continue;
      if (shape === null) shape = fbm(nA, x * 0.009, y * 0.009, 3);
      const d = Math.sqrt(d2) * (1 + 0.3 * shape) * k;
      const base = 1 - d * d, e = base > 0 ? is.peak * Math.pow(base, 1.4) : is.peak * base;
      if (e > best) { best = e; top = is; topD = d; }
    }
  }
  if (best > -9) {
    let e = best;
    if (e > -0.25) { const k = Math.min(1, (e + 0.25) / 0.5); e += 0.15 * k * fbm(nC, x * 0.022, y * 0.022, 3); }
    if (e > LIFT && top) {
      relief(top);
      const up = smoothstepN((e - LIFT) / 0.35);              // 0 at the foothills, 1 well inland
      const rugged = up * top.mtn * (1 - 0.8 * top.volc);              // a volcano is a smooth cone, not a ridge
      if (rugged > 0.01) e += rugged * 0.75 * ridged(x, y);
      if (top.volc > 0) {                                     // a cone, and a crater at its top
        const cone = Math.max(0, 1 - topD / 0.55);
        e += top.volc * up * (0.9 * cone * cone - 0.55 * smoothstepN((0.12 - topD) / 0.07));
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
  /** tree instances cached by the renderer: [x, y, kind, scale, yaw] per tree */
  trees?: number[];
}
const tiles = new Map<number, HeightTile>();
export function getTile(tx: number, ty: number): HeightTile {
  const k = key(tx, ty), cached = tiles.get(k);
  if (cached) return cached;
  const h = new Float32Array(TN * TN), x0 = tx * TS - 1, y0 = ty * TS - 1;
  let land = false;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
    const v = heightAt(x0 + i, y0 + j);
    h[j * TN + i] = v;
    if (v > -0.04) land = true;
  }
  const t: HeightTile = { tx, ty, h, land };
  tiles.set(k, t);
  return t;
}
export const hasTile = (tx: number, ty: number): boolean => tiles.has(key(tx, ty));
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
  for (let d = 0; d < is.R * 1.9; d += 2) {
    const x = is.x + c * d, y = is.y + s * d;
    if (baseHeight(x, y) > 0) last = { x, y };
    else if (last && d > is.R * 0.35) return last;
  }
  return null;
}
// room for a pier and a docked boat heading out from p along a: water ahead, deep water further out, clear both sides
function openWater(p: Point, a: number): boolean {
  const c = Math.cos(a), s = Math.sin(a);
  for (let d = 4; d <= 56; d += 4) {
    const need = d > 18 ? -0.1 : 0;
    if (baseHeight(p.x + c * d, p.y + s * d) > need) return false;
    if (d > 14 && (baseHeight(p.x + c * d - s * 14, p.y + s * d + c * 14) > -0.02 || baseHeight(p.x + c * d + s * 14, p.y + s * d - c * 14) > -0.02)) return false;
  }
  return true;
}
/** How many species existed when port prices were first drawn; never change this. */
const LEGACY_SPECIES = 43;
const idSalt = (id: string): number => { let h = 2166136261; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619); return h >>> 0; };
function makePort(i: number, j: number, home: boolean, r: Rng, s: Point, di: number, a: number): Port {
  const c = Math.cos(a), sn = Math.sin(a);
  const ax = s.x - c * 3, ay = s.y - sn * 3;
  // the first species' prices and the shipyard come off one sequence, as they always have; species added since then
  // get their price from their own hash, so appending a species never reshuffles a port
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
// a cell's landmarks without their schools, for the coast work in shore(); cached, as each island asks for 9 cells
const bareCells = new Map<number, Poi[]>();
function bareLandmarks(i: number, j: number): Poi[] {
  const k = key(i, j);
  let L = bareCells.get(k);
  if (!L) bareCells.set(k, L = landmarks(i, j, false));
  return L;
}
function landmarks(i: number, j: number, schools: boolean): Poi[] {
  const r = mulberry(hash(i, j, 99)), L = cellIslands(i, j), out: Poi[] = [];
  const main = L.find(is => !is.islet), home = i === 0 && j === 0;
  let portA: number | null = null;
  if (main) {
    const a0 = home ? 0.6 : r() * Math.PI * 2;
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
        if (baseHeight(x, y) < 0.03) continue;
        out.push({ id: `light:${i},${j}`, type: 'light', name: placeName(r) + ' Light', x, y, beam: r() * 6.28 });
        break;
      }
    }
  }
  for (const is of L) if (is.islet && is.peak > 0.3 && r() < 0.14 && baseHeight(is.x, is.y) > 0.05)
    out.push({ id: `light:${i},${j}:${Math.round(is.x)}`, type: 'light', name: placeName(r) + ' Light', x: is.x, y: is.y, beam: r() * 6.28 });
  if (r() < 0.42) {
    const w = placeWreck(i, j, r, main, out, schools);
    if (w) out.push(w);
  }
  return out;
}
// a wreck in shallow water off the main island (or anywhere in an empty cell), away from ports
function placeWreck(i: number, j: number, r: Rng, main: Island | undefined, pois: Poi[], schools: boolean): Wreck | null {
  for (let q = 0; q < 20; q++) {
    let x, y;
    if (main) { const a = r() * 6.28, d = main.R * (1.12 + r() * 0.35); x = main.x + Math.cos(a) * d; y = main.y + Math.sin(a) * d; }
    else { x = i * CELL + CELL * (0.2 + 0.6 * r()); y = j * CELL + CELL * (0.2 + 0.6 * r()); }
    const h = baseHeight(x, y);
    if (h > -0.08 || h < -0.36) continue;
    if (pois.some(p => p.type === 'port' && Math.hypot(p.dock.x - x, p.dock.y - y) < 70)) continue;
    const dist = Math.hypot(x - HOME_ISLAND.x, y - HOME_ISLAND.y);
    const a = r() * 6.28;
    const w: Wreck = {
      id: `wreck:${i},${j}`, type: 'wreck', name: 'Wreck of the ' + SHIPS[Math.floor(r() * SHIPS.length)], x, y, dir: Math.floor(r() * 16),
      loot: 25 + Math.floor(r() * 40 + dist / 60), solid: { kind: 'circ', x, y, r: 12 },
    };
    if (!schools) return w;                                  // (its school is the last thing drawn from r)
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
  if (!L) { L = lightSchools(landmarks(i, j, true), i, j); poiCells.set(k, L); }
  return L;
}
/** points of interest within a square of half-size rad around (x, y); fills and returns `out` if given */
export function poisNear(x: number, y: number, rad: number, out: Poi[] = []): Poi[] {
  out.length = 0;
  const i0 = Math.floor((x - rad) / CELL) - 1, i1 = Math.floor((x + rad) / CELL) + 1;
  const j0 = Math.floor((y - rad) / CELL) - 1, j1 = Math.floor((y + rad) / CELL) + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const p of cellPois(i, j)) {
    if (Math.abs(p.x - x) < rad && Math.abs(p.y - y) < rad) out.push(p);
  }
  return out;
}
// the seeded home island always gets a port (Alderhaven)
export const homePort = (): Port => cellPois(0, 0).find((p): p is Port => p.type === 'port')!;

// ---------- fish schools + floating crates ----------
/** One fish of a school as it swims (runtime only). */
export interface Swimmer {
  x: number; y: number; vx: number; vy: number;
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
const FC_EDGE = 0.11;                          // schools keep this share of a cell clear at its edges: 2 x 33 covers the widest gap (~65)
interface FishCell { schools: School[]; crates: Crate[] }
const fishCells = new Map<number, FishCell>();
function makeSchool(id: string, x: number, y: number, sp: number, r: Rng, stock?: number): School {
  return { id, x, y, sp, stock: stock ?? 2 + Math.floor(r() * 3), max: stock ?? 3, respawn: 0, ph: r() * 6.28 };
}
// the summed directions from (x, y), out to `reach`, where the water is too shallow for a school; null if none
function landPull(x: number, y: number, reach: number): Point | null {
  let dx = 0, dy = 0, hit = heightAt(x, y) > SWIM_WATER;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
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
  const n = 3 + Math.floor(r() * 3), x0 = (i + FC_EDGE) * FC, y0 = (j + FC_EDGE) * FC, span = (1 - 2 * FC_EDGE) * FC;
  const box = [x0, y0, x0 + span, y0 + span];
  const landmarks = [BOSS, ...poisNear(x0 + span / 2, y0 + span / 2, FC).flatMap(p => p.school ? [p.school] : [])];
  for (let q = 0; q < n; q++) {
    // every other school tries to hug a coastline (if this cell has one) so shallow-water species get a home
    for (let tries = q % 2 ? 3 : 24; tries > 0; tries--) {
      const cx = x0 + span * r(), cy = y0 + span * r(), h = heightAt(cx, cy);
      if (h > -0.07 || (!(q % 2) && tries > 4 && h < -0.28)) continue;
      const sp = pickSpecies(h, Math.hypot(cx - HOME_ISLAND.x, cy - HOME_ISLAND.y), r, cx, cy);
      const home = settle(cx, cy, schoolReach(sp), box);
      if (!home || crowded(home.x, home.y, sp, schools) || crowded(home.x, home.y, sp, landmarks)) continue;
      const s = makeSchool(`s:${i},${j},${q}`, home.x, home.y, sp, r);
      s.max = s.stock;
      s.gold = !SPECIES[s.sp].legend && hash01(i * 7 + q, j, 53) < GOLD_SCHOOLS;
      schools.push(s);
      break;
    }
  }
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
/** fish schools in fish cells overlapping the square of half-size rad, plus the boss and landmark schools nearby; fills `out` if given */
export function schoolsNear(x: number, y: number, rad: number, out: School[] = []): School[] {
  out.length = 0;
  if (Math.abs(BOSS.x - x) < rad + 20 && Math.abs(BOSS.y - y) < rad + 20) out.push(BOSS);
  for (let j = Math.floor((y - rad) / FC); j <= Math.floor((y + rad) / FC); j++)
    for (let i = Math.floor((x - rad) / FC); i <= Math.floor((x + rad) / FC); i++) for (const s of fishCell(i, j).schools) out.push(s);
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
    const R = m && !m.islet ? (coastTable(m), m.R * m.grow) : 0;
    if (m && !m.islet && Math.hypot(m.x - x, m.y - y) < rad + R) out.push({ key: `${i},${j}`, i, j, x: m.x, y: m.y, R });
  }
  return out;
}
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
