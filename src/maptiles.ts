// CPU-drawn chart tiles (1/4 scale) for the minimap and the sea chart.
import { hex } from './config';
import { hash01 } from './noise';
import { heightAt } from './world';
import { biomeMix, warmth, coldness, type BiomeMix } from './biome';

type RGB = [number, number, number];
// colour per height band, from deep water to peaks: deep, mid, shallow, sand, grass, forest, rock
const ramp = (a: string[]): RGB[] => a.map(hex);
const MAPC = ramp(['#4f7389', '#5f879b', '#86b0bf', '#e6d6a6', '#86a65c', '#5e8046', '#8a949c']);
const MAPC_W = ramp(['#2f7f8f', '#3f97a3', '#7fcac6', '#f2e8c8', '#96bf5c', '#3f7f44', '#8a949c']);
const MAPC_C = ramp(['#465f73', '#556f82', '#8aa2b1', '#c2bba8', '#7f8f6a', '#344a3c', '#e2eaec']);
// biomes: aqua lagoons and white sand on reefs, dark teal and grey shingle on kelp coasts, black sand on the ember isles
const MAPC_R = ramp(['#2f7f93', '#2fa3ad', '#7fe0d6', '#f6efd8', '#7ec25a', '#2f7a40', '#8a949c']);
const MAPC_K = ramp(['#3c5f6a', '#3f6e72', '#6f9a94', '#a8a89e', '#6f8f5c', '#2f4a36', '#7a8288']);
const MAPC_V = ramp(['#3a5670', '#44657c', '#6f8ea0', '#4a4648', '#7a7a50', '#4a5236', '#4a4a52']);
// olive channels and mud flats in the mangroves; ice floes speckle the dark northern water
const MAPC_M = ramp(['#4d6b63', '#5f7a5c', '#86957a', '#7a6c52', '#4f7a3c', '#2f5029', '#7a8288']);
const ICE: RGB = hex('#e8f2f6');

/** world units per tile, and pixels per tile side */
export const MT = 128;
const MTP = 32;
/**
 * Baked tiles by key, least recently drawn first. Past MAX_TILES (about 4 MB of pixels), the oldest go, except tiles
 * drawn in the last second: a wide chart keeps every tile it shows, then shrinks back once it closes.
 */
const mtiles = new Map<number, { c: HTMLCanvasElement; t: number }>();
const MAX_TILES = 1024, RECENT_MS = 1000;
function evictOld(now: number): void {
  for (const [k, e] of mtiles) {
    if (mtiles.size <= MAX_TILES || now - e.t < RECENT_MS) return;
    mtiles.delete(k);
  }
}

function band(h: number): number {
  return h < -0.4 ? 0 : h < -0.15 ? 1 : h < 0 ? 2 : h < 0.1 ? 3 : h < 0.36 ? 4 : h < 0.74 ? 5 : 6;
}

/**
 * The chart tile at (tx, ty); with build = false only returns it if it is already cached. `lod` 1 is a half-size tile
 * (a quarter of the samples) for a zoomed-out chart, where each tile shows only a few screen pixels anyway.
 */
export function mapTile(tx: number, ty: number, build = true, lod: 0 | 1 = 0): HTMLCanvasElement | null {
  const k = ((tx + 50000) * 100000 + (ty + 50000)) * 2 + lod, now = performance.now(), P = MTP >> lod, px = 4 << lod;
  const cached = mtiles.get(k);
  if (cached) { mtiles.delete(k); cached.t = now; mtiles.set(k, cached); return cached.c; }
  if (!build) return null;
  const c = document.createElement('canvas');
  c.width = P; c.height = P;
  const g = c.getContext('2d')!, im = g.createImageData(P, P), d = im.data;
  // biomes vary slowly: sampled on a 9 x 9 grid and blended in between (per pixel, a wide chart drew in visibly)
  const G9 = 9, step = MT / (G9 - 1), grid: BiomeMix[] = [];
  for (let gj = 0; gj < G9; gj++) for (let gi = 0; gi < G9; gi++) grid.push(biomeMix(tx * MT + gi * step, ty * MT + gj * step));
  const mixAt = (lx: number, ly: number, k: keyof BiomeMix): number => {
    const fx = lx / step, fy = ly / step, i0 = Math.min(G9 - 2, Math.floor(fx)), j0 = Math.min(G9 - 2, Math.floor(fy)), u = fx - i0, v = fy - j0;
    const a = grid[j0 * G9 + i0][k], b = grid[j0 * G9 + i0 + 1][k], c2 = grid[(j0 + 1) * G9 + i0][k], e = grid[(j0 + 1) * G9 + i0 + 1][k];
    return (a + (b - a) * u) * (1 - v) + (c2 + (e - c2) * u) * v;
  };
  const col: RGB = [0, 0, 0];
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const lx = i * px + px / 2, ly = j * px + px / 2, wx = tx * MT + lx, wy = ty * MT + ly, h = heightAt(wx, wy), b = band(h);
    // palettes blend by weight (no dither: it read as cross-hatching over whole regions)
    const reef = mixAt(lx, ly, 'reef'), kelp = mixAt(lx, ly, 'kelp'), volc = mixAt(lx, ly, 'volcanic'), mang = mixAt(lx, ly, 'mangrove');
    const cold = coldness(wy), rest = Math.max(0, 1 - reef - kelp - volc - mang), wm = warmth(wy) * rest, cd = cold * rest, plain = Math.max(0, rest - wm - cd);
    for (let n = 0; n < 3; n++) {
      col[n] = MAPC[b][n] * plain + MAPC_W[b][n] * wm + MAPC_C[b][n] * cd + MAPC_R[b][n] * reef + MAPC_K[b][n] * kelp + MAPC_V[b][n] * volc + MAPC_M[b][n] * mang;
    }
    // ice floes: small ragged patches in the open northern water, not single specks
    if (b <= 1 && cold > 0.3) {
      const F = 44, gx = Math.floor(wx / F), gy = Math.floor(wy / F), cell = hash01(gx, gy, 91), edge = hash01(Math.floor(wx / 4), Math.floor(wy / 4), 92);
      const cx = (gx + 0.3 + 0.4 * hash01(gx, gy, 93)) * F, cy = (gy + 0.3 + 0.4 * hash01(gx, gy, 94)) * F, r = Math.hypot(wx - cx, wy - cy) / (F * 0.3);
      if (cell < 0.07 * (cold - 0.3) / 0.7 && r < 0.7 + 0.4 * edge) { col[0] = ICE[0]; col[1] = ICE[1]; col[2] = ICE[2]; }
    }
    const o = (j * P + i) * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  mtiles.set(k, { c, t: now });
  evictOld(now);
  return c;
}
