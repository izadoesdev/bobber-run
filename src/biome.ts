// Biomes: regions of the sea that look and live differently, laid over the islands without moving them (island
// shapes, ports and claim keys never depend on this). A slow noise field picks coral shallows, kelp coasts and
// volcanic isles; latitude still sets warm and cold water, so reefs lean south and kelp leans north. Home waters
// stay plain so a new captain starts somewhere familiar, and the first regions begin a couple of cells out.
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';
import { clamp, smooth01 } from './config';

// latitude: home waters are temperate, the far north is cold, the far south warm
export const warmth = (y: number): number => clamp((y - 1500) / 1000, 0, 1);
export const coldness = (y: number): number => clamp((-y - 1300) / 1000, 0, 1);

/** Each biome's strength at a point, 0..1; together at most 1, and what's left over is plain temperate water. */
export interface BiomeMix { reef: number; kelp: number; volcanic: number }
export type BiomeId = 'home' | 'reef' | 'kelp' | 'volcanic' | 'warm' | 'cold' | 'open';

const nBio = createNoise2D(Alea('bobber-run', 'biome'));
const F = 1 / 1500;                                         // features a few cells across
const HOME = { x: 280, y: 280 };

export function biomeMix(x: number, y: number): BiomeMix {
  const d = Math.hypot(x - HOME.x, y - HOME.y), away = smooth01((d - 650) / 550);
  if (away <= 0) return { reef: 0, kelp: 0, volcanic: 0 };
  const wm = warmth(y), cd = coldness(y);
  const a = nBio(x * F, y * F), b = nBio(x * F + 57.3, y * F - 19.1), c = nBio(x * F * 1.1 - 91.4, y * F * 1.1 + 33.8);
  // how far past its threshold each biome is (in units of its fade width; above 1 it is fully there)
  const mr = (a - 0.28 + 0.3 * wm - 2 * cd) / 0.18, mk = (b - 0.28 + 0.2 * cd - 0.3 * wm) / 0.18 - cd, mv = (c - 0.36) / 0.18 - 2 * cd;
  // where two meet, each holds ground by how far ahead of the other it is, so borders blend over ~100 units
  // instead of flipping; deep inside one biome the others fade out entirely
  const lead = (m: number, o1: number, o2: number): number => smooth01(m) * smooth01((m - Math.max(o1, o2)) * 1.5 + 0.5);
  const reef = lead(mr, mk, mv), kelp = lead(mk, mr, mv), volcanic = lead(mv, mr, mk);
  const sum = reef + kelp + volcanic, k = away / Math.max(1, sum);
  return { reef: reef * k, kelp: kelp * k, volcanic: volcanic * k };
}

/** The region a point belongs to, for names, species and sea life. */
export function biomeAt(x: number, y: number): BiomeId {
  const m = biomeMix(x, y);
  if (m.reef > 0.5) return 'reef';
  if (m.kelp > 0.5) return 'kelp';
  if (m.volcanic > 0.5) return 'volcanic';
  if (coldness(y) > 0.5) return 'cold';
  if (warmth(y) > 0.5) return 'warm';
  return Math.hypot(x - HOME.x, y - HOME.y) < 1100 ? 'home' : 'open';
}

export const BIOME_NAME: Record<BiomeId, string> = {
  home: 'Alderhaven waters', reef: 'Coral shallows', kelp: 'Kelp coast', volcanic: 'Ember isles',
  warm: 'Southern seas', cold: 'Northern ice', open: 'Open coast',
};
