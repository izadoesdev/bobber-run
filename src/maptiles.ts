// The chart's colours: each height band's colour at a point, by region and island theme. The chart itself is drawn on
// the GPU (ui/chartgl.ts), which samples these per tile.
import { hex } from './config';
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
// olive channels and mud flats in the mangroves
const MAPC_M = ramp(['#4d6b63', '#5f7a5c', '#86957a', '#7a6c52', '#4f7a3c', '#2f5029', '#7a8288']);
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
