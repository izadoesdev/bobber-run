// Shared constants: logical view size, palette, dithering.
// W x H is the view in world units (one world unit = one art pixel). main.js resizes it to fill the window.
export let W = 320, H = 200;
export function setView(w, h) { W = w; H = h; }

export const P = {
  bg: '#f4f1ea', ink: '#1b2a33', ink2: '#26394a',
  w0: '#4f7389', w1: '#5f879b', w2: '#729dae', w3: '#86b0bf', w4: '#b4d0d8', foam: '#e6efec',
  wood0: '#8a6236', wood1: '#b4874a', wood2: '#c89a5a', wood3: '#dcb074',
  red: '#c0493a', white: '#efe9dc', gray0: '#5c6670', gray1: '#8a949c', gray2: '#b3bbc0',
  yellow: '#e2b94a', gold: '#f0cf6a', green: '#86a65c', blue: '#3f5f8a', beam: '#f3ecc8',
};
export const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const BAYER = new Float32Array(B4);
export const bayer = (x, y) => BAYER[((y & 3) << 2) | (x & 3)];

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const STEP = 1 / 120;                    // fixed physics step
