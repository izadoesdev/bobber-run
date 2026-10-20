// Seeded noise: simplex (terrain), integer hashing (placement), value noise (animated water).
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import Alea from 'alea';

const SEED = 'bobber-run';
export const nA = createNoise2D(Alea(SEED, 'shape'));
export const nB = createNoise2D(Alea(SEED, 'warp'));
export const nC = createNoise2D(Alea(SEED, 'detail'));

/** Fractal sum of `oct` octaves of `n`, normalised to the range of one octave. */
export function fbm(n: NoiseFunction2D, x: number, y: number, oct: number): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** 32-bit integer hash of a lattice point and a salt. */
export function hash(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export const hash01 = (x: number, y: number, s?: number): number => hash(x, y, s) / 4294967296;

/** Small seeded PRNG returning floats in [0, 1). */
export function mulberry(a: number): () => number {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

