// CPU-drawn chart tiles (1/4 scale) for the minimap and the sea chart.
import { hex, bayer } from './config';
import { heightAt } from './world';
import { biomeMix, warmth, coldness } from './biome';

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

/** The chart tile at (tx, ty); with build = false only returns it if it is already cached. */
export function mapTile(tx: number, ty: number, build = true): HTMLCanvasElement | null {
  const k = (tx + 50000) * 100000 + (ty + 50000), now = performance.now();
  const cached = mtiles.get(k);
  if (cached) { mtiles.delete(k); cached.t = now; mtiles.set(k, cached); return cached.c; }
  if (!build) return null;
  const c = document.createElement('canvas');
  c.width = MTP; c.height = MTP;
  const g = c.getContext('2d')!, im = g.createImageData(MTP, MTP), d = im.data;
  for (let j = 0; j < MTP; j++) for (let i = 0; i < MTP; i++) {
    const wy = ty * MT + j * 4 + 2, h = heightAt(tx * MT + i * 4 + 2, wy), th = bayer(i, j);
    // biome, warm and cold palettes blend in with an ordered dither
    const bm = biomeMix(tx * MT + i * 4 + 2, wy);
    const pal = bm.reef > th ? MAPC_R : bm.kelp > th ? MAPC_K : bm.volcanic > th ? MAPC_V : warmth(wy) > th ? MAPC_W : coldness(wy) > th ? MAPC_C : MAPC;
    const col = pal[band(h)], o = (j * MTP + i) * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  mtiles.set(k, { c, t: now });
  evictOld(now);
  return c;
}
