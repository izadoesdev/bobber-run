// Infinite world: island archipelago heightfield, cached height tiles, points of interest,
// fish schools and floating crates. Everything is deterministic from the seed.
import { nA, nB, nC, fbm, hash, mulberry } from './noise';
import { pickSpecies, SP, SPECIES } from './econ';
import type { Point, Poi, Port, Wreck, School, Crate } from './types';

const CELL = 560;                              // one archipelago cell
const HOME_ISLAND: Point = { x: 280, y: 280 };
const key = (i: number, j: number) => (i + 50000) * 100000 + (j + 50000);

// ---------- islands ----------
interface Island { x: number; y: number; R: number; peak: number; islet?: boolean }
const cells = new Map<number, Island[]>();
function cellIslands(i: number, j: number): Island[] {
  const k = key(i, j), cached = cells.get(k);
  if (cached) return cached;
  const r = mulberry(hash(i, j, 7)), L: Island[] = [];
  const ox = i * CELL, oy = j * CELL;
  let main: Island | null = null;
  if (i === 0 && j === 0) main = { x: HOME_ISLAND.x, y: HOME_ISLAND.y, R: 145, peak: 0.8 };
  else if (r() < 0.72) main = { x: ox + CELL * (0.3 + 0.4 * r()), y: oy + CELL * (0.3 + 0.4 * r()), R: 55 + Math.pow(r(), 1.4) * 160, peak: 0.55 + 0.45 * r() };
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
    L.push({ x, y, R: 12 + r() * 28, peak: sandbar ? 0.1 + 0.08 * r() : 0.45 + 0.4 * r(), islet: true });
  }
  cells.set(k, L);
  return L;
}

/** Terrain height: < 0 is water (deeper = more negative), > 0 is land. */
export function heightAt(x: number, y: number): number {
  // domain-warp the lookup so coastlines wander
  const wx = x + 36 * nB(x * 0.0042, y * 0.0042), wy = y + 36 * nB(x * 0.0042 + 31.7, y * 0.0042 - 12.3);
  const ci = Math.floor(wx / CELL), cj = Math.floor(wy / CELL);
  let h = -0.5 + 0.1 * nC(x * 0.0016, y * 0.0016);
  let shape: number | null = null, best = -9;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    for (const is of cellIslands(ci + di, cj + dj)) {
      const dx = wx - is.x, dy = wy - is.y, d2 = (dx * dx + dy * dy) / (is.R * is.R);
      if (d2 > 2.3) continue;
      if (shape === null) shape = fbm(nA, x * 0.009, y * 0.009, 3);
      const d = Math.sqrt(d2) * (1 + 0.3 * shape);
      const base = 1 - d * d, e = base > 0 ? is.peak * Math.pow(base, 1.4) : is.peak * base;
      if (e > best) best = e;
    }
  }
  if (best > -9) {
    let e = best;
    if (e > -0.25) { const k = Math.min(1, (e + 0.25) / 0.5); e += 0.15 * k * fbm(nC, x * 0.022, y * 0.022, 3); }
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
function makePort(i: number, j: number, home: boolean, r: Rng, s: Point, di: number, a: number): Port {
  const c = Math.cos(a), sn = Math.sin(a);
  const ax = s.x - c * 3, ay = s.y - sn * 3;
  const pr = mulberry(hash(i, j, 5));
  const mult: Record<number, number> = {};
  for (let k = 0; k < SPECIES.length; k++) mult[k] = 0.75 + pr() * 0.7;
  const shipyard = home || pr() < 0.45;
  return {
    id: `port:${i},${j}`, type: 'port', name: home ? 'Alderhaven' : placeName(r), x: ax, y: ay, dir: di, ang: a,
    end: { x: ax + c * 26, y: ay + sn * 26 }, dock: { x: ax + c * 44, y: ay + sn * 44 }, mult, shipyard,
    solid: { kind: 'seg', ax, ay, bx: ax + c * 27, by: ay + sn * 27, r: 3.5 },
  };
}
function genCellPois(i: number, j: number): Poi[] {
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
    const sx = x + Math.cos(a) * 34, sy = y + Math.sin(a) * 34;
    if (heightAt(sx, sy) < -0.06) w.school = makeSchool(`ws:${i},${j}`, sx, sy, pickSpecies(0, dist, r, sx, sy, 'wreck'), r, 2);
    return w;
  }
  return null;
}
// lighthouses attract beaconfish into the water at their feet
function lightSchools(L: Poi[], i: number, j: number): Poi[] {
  const r = mulberry(hash(i, j, 77));
  for (const p of L) if (p.type === 'light') for (let q = 0; q < 16; q++) {
    const a = q / 16 * 6.283, x = p.x + Math.cos(a) * 38, y = p.y + Math.sin(a) * 38;
    if (heightAt(x, y) < -0.08) { p.school = makeSchool(`ls:${p.id}`, x, y, pickSpecies(0, 0, r, x, y, 'light'), r, 3); break; }
  }
  return L;
}
export function cellPois(i: number, j: number): Poi[] {
  const k = key(i, j);
  let L = poiCells.get(k);
  if (!L) { L = lightSchools(genCellPois(i, j), i, j); poiCells.set(k, L); }
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
const FC = 300;                                // fish cell size
interface FishCell { schools: School[]; crates: Crate[] }
const fishCells = new Map<number, FishCell>();
function makeSchool(id: string, x: number, y: number, sp: number, r: Rng, stock?: number): School {
  return { id, x, y, sp, stock: stock ?? 2 + Math.floor(r() * 3), max: stock ?? 3, respawn: 0, ph: r() * 6.28 };
}
function genFishCell(i: number, j: number): FishCell {
  const r = mulberry(hash(i, j, 31)), schools: School[] = [], crates: Crate[] = [];
  const n = 3 + Math.floor(r() * 3);
  for (let q = 0; q < n; q++) {
    // every other school hugs a coastline (if this cell has one) so shallow-water species get a home
    let x = 0, y = 0, h = 0;
    for (let tries = q % 2 ? 1 : 10; tries > 0; tries--) {
      x = (i + 0.1 + 0.8 * r()) * FC; y = (j + 0.1 + 0.8 * r()) * FC; h = heightAt(x, y);
      if (q % 2 || (h > -0.28 && h < -0.07)) break;
    }
    if (h > -0.07) continue;
    const d = Math.hypot(x - HOME_ISLAND.x, y - HOME_ISLAND.y);
    const s = makeSchool(`s:${i},${j},${q}`, x, y, pickSpecies(h, d, r, x, y), r);
    s.max = s.stock;
    schools.push(s);
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
