// Shared constants and small helpers: logical view size, colours, maths, money.
// W x H is the view in world units (one world unit = one art pixel). main.ts resizes it to fill the window.
export let W = 320, H = 200;
export function setView(w: number, h: number): void { W = w; H = h; }

/** '#rrggbb' -> [r, g, b] in 0..255 */
export const hex = (c: string): [number, number, number] =>
  [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** [r, g, b] (clamped to 0..255) -> '#rrggbb' */
export const toHex = (rgb: number[]): string => '#' + rgb.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export const clamp = (v: number, a: number, b: number): number => v < a ? a : v > b ? b : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const frac = (x: number): number => x - Math.floor(x);
/** Smoothstep of x clamped to 0..1. */
export const smooth01 = (x: number): number => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** Compass direction from (x0, y0) to (x1, y1), in words. */
export const dirTo = (x0: number, y0: number, x1: number, y1: number): string => COMPASS[(Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) + 8) % 8];
/** An angle difference brought into -π..π. */
export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
// one formatter for every price: toLocaleString builds a new one per call, and menus redraw every frame
const thousands = new Intl.NumberFormat('en-US');
export const money = (n: number): string => '$' + thousands.format(Math.round(n));
export const STEP = 1 / 120;                    // fixed physics step
