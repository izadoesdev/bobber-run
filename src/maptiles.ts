// CPU-drawn chart tiles (1/4 scale) for the minimap and the sea chart.
import { hex, bayer } from './config';
import { heightAt } from './world';
import { warmth, coldness } from './econ';

type RGB = [number, number, number];
// colour per height band, from deep water to peaks: deep, mid, shallow, sand, grass, forest, rock
const ramp = (a: string[]): RGB[] => a.map(hex);
const MAPC = ramp(['#4f7389', '#5f879b', '#86b0bf', '#e6d6a6', '#86a65c', '#5e8046', '#8a949c']);
const MAPC_W = ramp(['#2f7f8f', '#3f97a3', '#7fcac6', '#f2e8c8', '#96bf5c', '#3f7f44', '#8a949c']);
const MAPC_C = ramp(['#465f73', '#556f82', '#8aa2b1', '#c2bba8', '#7f8f6a', '#344a3c', '#e2eaec']);

/** world units per tile, and pixels per tile side */
export const MT = 128, MTP = 32;
const mtiles = new Map<number, HTMLCanvasElement>();

function band(h: number): number {
  return h < -0.4 ? 0 : h < -0.15 ? 1 : h < 0 ? 2 : h < 0.1 ? 3 : h < 0.36 ? 4 : h < 0.74 ? 5 : 6;
}

/** The chart tile at (tx, ty); with build = false only returns it if it is already cached. */
export function mapTile(tx: number, ty: number, build = true): HTMLCanvasElement | null {
  const k = (tx + 50000) * 100000 + (ty + 50000);
  const cached = mtiles.get(k);
  if (cached || !build) return cached || null;
  const c = document.createElement('canvas');
  c.width = MTP; c.height = MTP;
  const g = c.getContext('2d')!, im = g.createImageData(MTP, MTP), d = im.data;
  for (let j = 0; j < MTP; j++) for (let i = 0; i < MTP; i++) {
    const wy = ty * MT + j * 4 + 2, h = heightAt(tx * MT + i * 4 + 2, wy), th = bayer(i, j);
    // warm/cold palettes blend in with an ordered dither
    const pal = warmth(wy) > th ? MAPC_W : coldness(wy) > th ? MAPC_C : MAPC;
    const col = pal[band(h)], o = (j * MTP + i) * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  mtiles.set(k, c);
  return c;
}
