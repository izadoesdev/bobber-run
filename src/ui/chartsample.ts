// What the chart's GPU terrain needs from the world for one tile: heights on a 33 x 33 grid (as half floats) and the
// region's seven colour bands on a 9 x 9 grid (RGBA, alpha 255). Pure world sampling, so it runs in the chart's
// worker (chartworker.ts) as well as on the main thread where there's no worker.
import { heightAt, claimableNear } from '../world';
import { chartBands } from '../maptiles';

export const N = 33, NC = 9, BANDS = 7;    // height samples per side, colour samples per side, colour bands
export const BASE = 128;                   // world units per tile side at level 0 (samples every 4 units)

// float to half float, for the R16F height atlas
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v: number): number {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}

const bands = new Float32Array(BANDS * 3);
/** Samples tile (l, tx, ty) into h (N x N half floats) and c (9 colour samples x 7 bands x 9 rows, RGBA). */
export function sampleTile(l: number, tx: number, ty: number, h: Uint16Array, c: Uint8Array): void {
  const side = BASE << l, step = side / (N - 1), x0 = tx * side, y0 = ty * side;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = half(heightAt(x0 + i * step, y0 + j * step));
  const cstep = side / (NC - 1), islands = claimableNear(x0 + side / 2, y0 + side / 2, side * 0.75 + 460);
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    chartBands(x0 + i * cstep, y0 + j * cstep, islands, bands);
    for (let b = 0; b < BANDS; b++) {
      const o = (j * NC * BANDS + b * NC + i) * 4;
      c[o] = bands[b * 3] * 255; c[o + 1] = bands[b * 3 + 1] * 255; c[o + 2] = bands[b * 3 + 2] * 255; c[o + 3] = 255;
    }
  }
}
