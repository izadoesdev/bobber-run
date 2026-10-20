// Shared constants: logical view size, colour parsing, dithering.
// W x H is the view in world units (one world unit = one art pixel). main.js resizes it to fill the window.
export let W = 320, H = 200;
export function setView(w: number, h: number): void { W = w; H = h; }

/** '#rrggbb' -> [r, g, b] in 0..255 */
export const hex = (c: string): [number, number, number] =>
  [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// 4x4 ordered-dither thresholds, centred in each cell
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const BAYER = new Float32Array(B4);
export const bayer = (x: number, y: number): number => BAYER[((y & 3) << 2) | (x & 3)];

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const STEP = 1 / 120;                    // fixed physics step
