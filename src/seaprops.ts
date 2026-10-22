// Things standing or floating in the sea, placed per height tile from the seed: ice floes and bergs in the cold north,
// and each island theme's sea props (sea stacks, whale bones, basalt, flotsam, steam vents). Pure and deterministic, so
// the renderer draws them and the game's physics can collide with the solid ones. Nothing solid goes in a strait, near
// a harbour or lighthouse, or by a village's jetty, and ice keeps to clusters near cold coasts: open channels stay clear.
import { TS, TN, getTile, hAt, claimableNear, poisNear, regionSites, type HeightTile } from './world';
import { biomeMix, coldness, themeHold, THEMES, type Odds, type ThemeHold } from './biome';
import { hash01 } from './noise';
import { smooth01 } from './config';
import type { Poi } from './types';

export type SeaPropKind = 'floeS' | 'floeM' | 'floeL' | 'berg' | 'iceberg' | 'seastack' | 'whaleBones' | 'basalt' | 'log' | 'weedMat' | 'lilyPad' | 'steamVent';
export interface SeaProp {
  kind: SeaPropKind; x: number; y: number;
  /** the solid footprint: a hull collides with a circle of radius r (world units, scale applied) at (x, y); 0 if boats pass through */
  r: number;
  yaw: number; scale: number;
}
// solid footprint radius of each kind at scale 1 (from its voxel model); flotsam and vents are passable
const SOLID_R: Partial<Record<SeaPropKind, number>> = { iceberg: 10, berg: 5, floeL: 6.5, floeM: 4.5, floeS: 2.6, seastack: 4.5, whaleBones: 6, basalt: 6.5 };
// where a theme's sea prop goes: afloat in the shallows, hugging the shore, standing off a coast, or among cold-coast ice
type Berth = 'float' | 'shore' | 'off' | 'ice';
const BERTH: Record<string, Berth> = { log: 'float', weedMat: 'float', lilyPad: 'float', steamVent: 'shore', whaleBones: 'shore', basalt: 'shore', seastack: 'off', iceberg: 'ice' };
const BIG = new Set<SeaPropKind>(['iceberg', 'seastack']);   // these come in sizes; the rest at the size they were built
// the open sea's own flotsam where no island theme holds
const KELP_SEA: Odds = [['weedMat', 1]], MANGROVE_SEA: Odds = [['lilyPad', 3], ['log', 1]];

/** Land within d of (x, y), sampled along eight directions every 8 units. */
function landWithin(x: number, y: number, d: number): boolean {
  for (let t = Math.min(8, d); ; t = Math.min(t + 8, d)) {
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (hAt(x + Math.cos(a) * t, y + Math.sin(a) * t) > 0) return true; }
    if (t >= d) return false;
  }
}
/** In a strait: land within d on both sides along some axis, so something solid here could close the way through. */
function inStrait(x: number, y: number, d: number): boolean {
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(k * Math.PI / 4), s = Math.sin(k * Math.PI / 4);
    let a = false, b = false;
    for (let t = 8; t <= d && !(a && b); t += 8) { a ||= hAt(x + c * t, y + s * t) > 0; b ||= hAt(x - c * t, y - s * t) > 0; }
    if (a && b) return true;
  }
  return false;
}
/** Ice comes in clusters: a slow lattice noise, high in about a third of the sea. */
function cluster(x: number, y: number): number {
  const fx = x / 150, fy = y / 150, i = Math.floor(fx), j = Math.floor(fy), u = smooth01(fx - i), v = smooth01(fy - j);
  const a = hash01(i, j, 88), b = hash01(i + 1, j, 88), c = hash01(i, j + 1, 88), e = hash01(i + 1, j + 1, 88);
  return (a + (b - a) * u) * (1 - v) + (c + (e - c) * u) * v;
}
/** Whether ice may sit here: in a cluster, by (not on) a cold coast, and out of straits. */
const iceSpot = (x: number, y: number): boolean => cluster(x, y) > 0.55 && !landWithin(x, y, 14) && landWithin(x, y, 80) && !inStrait(x, y, 90);

// one candidate per GS x GS cell, hashed into place; fn gets spots inside the tile with their height
function spots(t: HeightTile, GS: number, salt: number, fn: (px: number, py: number, gx: number, gy: number, h: number) => void): void {
  const x0 = t.tx * TS, y0 = t.ty * TS;
  for (let gy = Math.floor(y0 / GS); gy <= Math.floor((y0 + TS - 1) / GS); gy++) for (let gx = Math.floor(x0 / GS); gx <= Math.floor((x0 + TS - 1) / GS); gx++) {
    const px = gx * GS + Math.floor(hash01(gx, gy, salt) * GS), py = gy * GS + Math.floor(hash01(gx, gy, salt + 1) * GS);
    if (px >= x0 && px < x0 + TS && py >= y0 && py < y0 + TS) fn(px, py, gx, gy, t.h[(py - y0 + 1) * TN + px - x0 + 1]);
  }
}
const pick = (L: Odds, r: number): string => { let t = 0; for (const [, w] of L) t += w; let v = r * t; for (const [k, w] of L) { v -= w; if (v <= 0) return k; } return L[0][0]; };
const cache = new WeakMap<HeightTile, SeaProp[]>(), hold: ThemeHold = { theme: 'home', w: 0, jitter: 0 }, poiScratch: Poi[] = [];

function tileSea(t: HeightTile): SeaProp[] {
  let L = cache.get(t);
  if (L) return L;
  const out: SeaProp[] = [], cx = t.tx * TS + TS / 2, cy = t.ty * TS + TS / 2;
  const islands = claimableNear(cx, cy, 460), pois = poisNear(cx, cy, TS + 100, poiScratch).filter(p => p.type !== 'wreck');
  const sites = regionSites().filter(s => Math.abs(s.x - cx) < TS + 60 && Math.abs(s.y - cy) < TS + 60);
  // boats need their way into every harbour and past every lighthouse, and a village's jetty its water
  const keepClear = (x: number, y: number): boolean => pois.some(p => Math.hypot(p.x - x, p.y - y) < 110) || sites.some(s => Math.hypot(s.x - x, s.y - y) < 55);
  const add = (kind: SeaPropKind, x: number, y: number, r1: number, r2: number): boolean => {
    const solid = SOLID_R[kind] ?? 0;
    if (solid && keepClear(x, y)) return false;
    const scale = BIG.has(kind) ? 1 + r1 * 0.4 : kind.startsWith('floe') || kind === 'berg' ? 0.8 + r1 * 0.5 : 1;
    out.push({ kind, x: x + 0.5, y: y + 0.5, r: solid * scale, yaw: r2 * 6.283, scale });
    return true;
  };
  // floes and small bergs: rafts of sea ice, more the colder it is
  if (coldness(t.ty * TS + TS) > 0.05) spots(t, 22, 81, (px, py, gx, gy, h) => {
    const cd = coldness(py);
    if (-h < 0.06 || cd < 0.4 || hash01(gx, gy, 83) > 0.35 * smooth01((cd - 0.4) / 0.4)) return;
    const bm = biomeMix(px, py);
    if (bm.kelp > 0.3 || bm.reef > 0.3 || !iceSpot(px, py)) return;
    const rk = hash01(gx, gy, 84);
    add(rk < 0.15 ? 'berg' : rk < 0.5 ? 'floeS' : rk < 0.8 ? 'floeM' : 'floeL', px, py, hash01(gx, gy, 85), hash01(gx, gy, 86));
  });
  // each island theme's sea props, and the open sea's flotsam on kelp coasts and in the mangroves
  spots(t, 18, 141, (px, py, gx, gy, h) => {
    const depth = -h;
    if (depth < 0.01 || depth > 0.6) return;
    themeHold(px, py, islands, hold);
    let list: Odds, odds: number;
    if (hold.w > 0.3) { const T = THEMES[hold.theme]; list = T.sea; odds = T.seaD * hold.w; }
    else {
      const bm = biomeMix(px, py);
      if (bm.kelp > 0.5) { list = KELP_SEA; odds = 0.06; } else if (bm.mangrove > 0.5) { list = MANGROVE_SEA; odds = 0.15; } else return;
    }
    if (!list.length || hash01(gx, gy, 142) > odds) return;
    const kind = pick(list, hash01(gx, gy, 143)) as SeaPropKind, berth = BERTH[kind] ?? 'float';
    if (berth === 'float' && depth > 0.3) return;
    if (berth === 'shore' && (depth > 0.12 || !landWithin(px, py, 10) || inStrait(px, py, 40))) return;
    if (berth === 'off' && (depth < 0.04 || depth > 0.3 || !landWithin(px, py, 30) || inStrait(px, py, 70))) return;
    if (berth === 'ice' && (depth < 0.1 || !iceSpot(px, py))) return;
    add(kind, px, py, hash01(gx, gy, 144), hash01(gx, gy, 145));
  });
  cache.set(t, out);
  return out;
}

/**
 * The sea props within the square of half-size rad around (x, y), filling `out` (the entries are shared: don't change
 * them). Only the solid ones (r > 0), unless `all`: the renderer asks for all, physics for the solid ones.
 */
export function seaPropsNear(x: number, y: number, rad: number, out: SeaProp[] = [], all = false): SeaProp[] {
  out.length = 0;
  for (let ty = Math.floor((y - rad) / TS); ty <= Math.floor((y + rad) / TS); ty++) for (let tx = Math.floor((x - rad) / TS); tx <= Math.floor((x + rad) / TS); tx++)
    for (const p of tileSea(getTile(tx, ty))) if ((all || p.r > 0) && Math.abs(p.x - x) < rad && Math.abs(p.y - y) < rad) out.push(p);
  return out;
}
