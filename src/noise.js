// Seeded noise: simplex (terrain), integer hashing (placement), value noise (animated water).
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';

export const SEED = 'bobber-run';
export const nA = createNoise2D(Alea(SEED, 'shape'));
export const nB = createNoise2D(Alea(SEED, 'warp'));
export const nC = createNoise2D(Alea(SEED, 'detail'));

export function fbm(n, x, y, oct) {
  let a = 1, f = 1, s = 0, t = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); t += a; a *= 0.5; f *= 2.03; }
  return s / t;
}

export function hash(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export const hash01 = (x, y, s) => hash(x, y, s) / 4294967296;

export function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const NG = 128, grid = new Float32Array(NG * NG);
{ const r = mulberry(1234); for (let i = 0; i < NG * NG; i++) grid[i] = r(); }
export function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & (NG - 1), x1 = (xi + 1) & (NG - 1), y0 = (yi & (NG - 1)) * NG, y1 = ((yi + 1) & (NG - 1)) * NG;
  const a = grid[y0 + x0], b = grid[y0 + x1], c = grid[y1 + x0], d = grid[y1 + x1];
  const t = a + (b - a) * fx, u = c + (d - c) * fx; return t + (u - t) * fy;
}
