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

/** [r, g, b] (clamped to 0..255) -> '#rrggbb' */
export const toHex = (rgb: number[]): string => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const frac = (x: number): number => x - Math.floor(x);
/** Smoothstep of x clamped to 0..1. */
export const smooth01 = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
/** An angle difference brought into -π..π. */
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** Compass direction from (x0, y0) to (x1, y1), in words. */
export const dirTo = (x0: number, y0: number, x1: number, y1: number): string => COMPASS[(Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) + 8) % 8];
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
// one formatter for every price: toLocaleString builds a new one per call, and menus redraw every frame
const thousands = new Intl.NumberFormat('en-US');
export const money = (n: number): string => '$' + thousands.format(Math.round(n));
export const STEP = 1 / 120;                    // fixed physics step
