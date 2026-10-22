// CPU-drawn chart tiles (1/4 scale) for the minimap and the sea chart.
import { hex } from './config';
import { hash01 } from './noise';
import { heightAt, claimableNear } from './world';
import { biomeMix, warmth, coldness, themeHold, THEMES, THEME_IDS, type BiomeMix, type IslandRef, type ThemeHold } from './biome';

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
// each island theme's own chart colours, from its ground and water palette, lifted to the chart's lighter, flatter look
const lift = (c: readonly number[], k: number, base: number): RGB => [0, 1, 2].map(i => Math.round((c[i] * k + base) * 255)) as RGB;
const THEME_RAMP: RGB[][] = THEME_IDS.map(id => {
  const T = THEMES[id], water = (c: readonly number[]) => lift(c, 0.72, 0.24), land = (c: readonly number[]) => lift(c, 0.9, 0.07);
  return [water(T.deep), water(T.mid), water(T.shallow), land(T.sand), land(T.grass), land(T.forest), land(T.rock)];
});
const hold: ThemeHold = { theme: 'home', w: 0, jitter: 0 };
const ROWS: Record<string, number> = Object.fromEntries(THEME_IDS.map((t, i) => [t, i]));

/**
 * Chart colour (0..255 rgb into out[o..o+2]) of height band b at latitude y: the region's ramps blended by the biome
 * mix m, warmth and cold, then the island theme `row` over them by its weight w.
 */
function bandColour(b: number, m: BiomeMix, y: number, row: number, w: number, out: { [i: number]: number }, o: number): void {
  const rest = Math.max(0, 1 - m.reef - m.kelp - m.volcanic - m.mangrove), wm = warmth(y) * rest, cd = coldness(y) * rest, plain = Math.max(0, rest - wm - cd), TR = THEME_RAMP[row][b];
  for (let n = 0; n < 3; n++) {
    const c = MAPC[b][n] * plain + MAPC_W[b][n] * wm + MAPC_C[b][n] * cd + MAPC_R[b][n] * m.reef + MAPC_K[b][n] * m.kelp + MAPC_V[b][n] * m.volcanic + MAPC_M[b][n] * m.mangrove;
    out[o + n] = c + (TR[n] - c) * w;
  }
}
/**
 * The chart's seven height-band colours at (x, y), as rgb 0..1 into out[0..20] (band b at out[3b..3b+2]), for drawing
 * the chart on the GPU: region mix, warmth and cold, and the island theme from the main islands near it
 * (world.claimableNear(x, y, 460) finds every one whose theme can reach). Bands, deepest first, by terrain height h
 * (heightAt): 0 deep water h < -0.4; 1 mid water -0.4..-0.15; 2 shallows -0.15..0; 3 sand 0..0.1; 4 grass 0.1..0.36;
 * 5 forest 0.36..0.74; 6 rock h >= 0.74. Ice floes are not included.
 */
export function chartBands(x: number, y: number, islands: readonly IslandRef[], out: Float32Array): void {
  const m = biomeMix(x, y);
  themeHold(x, y, islands, hold);
  for (let b = 0; b < 7; b++) bandColour(b, m, y, ROWS[hold.theme], hold.w, out, b * 3);
  for (let i = 0; i < 21; i++) out[i] /= 255;
}

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
  // island themes on the same grid: the nearest point's theme, its weight blended between points
  const islands = claimableNear(tx * MT + MT / 2, ty * MT + MT / 2, 460), trow = new Int8Array(G9 * G9), tw = new Float32Array(G9 * G9);
  for (let g = 0; g < G9 * G9; g++) {
    themeHold(tx * MT + (g % G9) * step, ty * MT + Math.floor(g / G9) * step, islands, hold);
    trow[g] = ROWS[hold.theme]; tw[g] = hold.w;
  }
  const isle = [0, 0];                                    // theme row, weight
  const isleAt = (lx: number, ly: number): void => {
    const fx = lx / step, fy = ly / step, i0 = Math.min(G9 - 2, Math.floor(fx)), j0 = Math.min(G9 - 2, Math.floor(fy)), u = fx - i0, v = fy - j0, o = j0 * G9 + i0;
    isle[0] = trow[o + (v < 0.5 ? 0 : G9) + (u < 0.5 ? 0 : 1)];
    isle[1] = (tw[o] + (tw[o + 1] - tw[o]) * u) * (1 - v) + (tw[o + G9] + (tw[o + G9 + 1] - tw[o + G9]) * u) * v;
  };
  const mixAt = (lx: number, ly: number, k: keyof BiomeMix): number => {
    const fx = lx / step, fy = ly / step, i0 = Math.min(G9 - 2, Math.floor(fx)), j0 = Math.min(G9 - 2, Math.floor(fy)), u = fx - i0, v = fy - j0;
    const a = grid[j0 * G9 + i0][k], b = grid[j0 * G9 + i0 + 1][k], c2 = grid[(j0 + 1) * G9 + i0][k], e = grid[(j0 + 1) * G9 + i0 + 1][k];
    return (a + (b - a) * u) * (1 - v) + (c2 + (e - c2) * u) * v;
  };
  const col: RGB = [0, 0, 0], mix: BiomeMix = { reef: 0, kelp: 0, volcanic: 0, mangrove: 0 };
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const lx = i * px + px / 2, ly = j * px + px / 2, wx = tx * MT + lx, wy = ty * MT + ly, h = heightAt(wx, wy), b = band(h);
    // palettes blend by weight (no dither: it read as cross-hatching over whole regions)
    mix.reef = mixAt(lx, ly, 'reef'); mix.kelp = mixAt(lx, ly, 'kelp'); mix.volcanic = mixAt(lx, ly, 'volcanic'); mix.mangrove = mixAt(lx, ly, 'mangrove');
    isleAt(lx, ly);
    bandColour(b, mix, wy, isle[0], isle[1], col, 0);
    const cold = coldness(wy);
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
