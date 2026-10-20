// Biomes: regions that look and live differently. A slow noise field picks coral shallows, kelp coasts, ember isles
// and (south of home) mangroves; latitude sets warm and cold water, and the far north is the ice floes. Home waters
// stay plain, and the regions start a couple of cells out.
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';
import { clamp, smooth01 } from './config';

// latitude: home waters are temperate, the far north is cold, the far south warm
export const warmth = (y: number): number => clamp((y - 1500) / 1000, 0, 1);
export const coldness = (y: number): number => clamp((-y - 1300) / 1000, 0, 1);

/** Each biome's strength at a point, 0..1; together at most 1, and what's left over is plain temperate water. */
export interface BiomeMix { reef: number; kelp: number; volcanic: number; mangrove: number }
export type BiomeId = 'home' | 'reef' | 'kelp' | 'volcanic' | 'mangrove' | 'warm' | 'cold' | 'open';

const nBio = createNoise2D(Alea('bobber-run', 'biome'));
const F = 1 / 1500;                                         // features a few cells across
const HOME = { x: 280, y: 280 };

// Each island belongs to one region: around an island the field is read at its centre, so no island is half coral
// and half ash. world.ts registers how to find that island (it imports this file, so this one can't import it).
type Anchor = (x: number, y: number) => { x: number; y: number; w: number } | null;
let anchor: Anchor = () => null;
export function setBiomeAnchor(f: Anchor): void { anchor = f; }

export function biomeMix(x: number, y: number): BiomeMix {
  const at = anchor(x, y);
  if (at) { x += (at.x - x) * at.w; y += (at.y - y) * at.w; }
  return fieldMix(x, y);
}
function fieldMix(x: number, y: number): BiomeMix {
  const d = Math.hypot(x - HOME.x, y - HOME.y), away = smooth01((d - 650) / 550);
  if (away <= 0) return { reef: 0, kelp: 0, volcanic: 0, mangrove: 0 };
  const wm = warmth(y), cd = coldness(y);
  const a = nBio(x * F, y * F), b = nBio(x * F + 57.3, y * F - 19.1), c = nBio(x * F * 1.1 - 91.4, y * F * 1.1 + 33.8);
  const e = nBio(x * F * 1.3 + 140.2, y * F * 1.3 - 77.7);
  // mangroves keep to a band south of home, from about y = 900 down into the warm water
  const south = smooth01((y - 700) / 600) * (1 - smooth01((y - 3200) / 800));
  // how far past its threshold each biome is (in units of its fade width; above 1 it is fully there)
  const mr = (a - 0.28 + 0.3 * wm - 2 * cd) / 0.18, mk = (b - 0.28 + 0.2 * cd - 0.3 * wm) / 0.18 - cd, mv = (c - 0.36) / 0.18 - 2 * cd;
  const mm = (e - 0.2) / 0.18 * south - 2 * (1 - south);
  // where two meet, each holds ground by how far ahead of the other it is, so borders blend over ~100 units
  // instead of flipping; deep inside one biome the others fade out entirely
  const lead = (m: number, ...others: number[]): number => smooth01(m) * smooth01((m - Math.max(...others)) * 1.5 + 0.5);
  const reef = lead(mr, mk, mv, mm), kelp = lead(mk, mr, mv, mm), volcanic = lead(mv, mr, mk, mm), mangrove = lead(mm, mr, mk, mv);
  const sum = reef + kelp + volcanic + mangrove, k = away / Math.max(1, sum);
  return { reef: reef * k, kelp: kelp * k, volcanic: volcanic * k, mangrove: mangrove * k };
}

/** The region a point belongs to, for names, species and sea life. */
export function biomeAt(x: number, y: number): BiomeId {
  const m = biomeMix(x, y);
  if (m.reef > 0.5) return 'reef';
  if (m.kelp > 0.5) return 'kelp';
  if (m.volcanic > 0.5) return 'volcanic';
  if (m.mangrove > 0.5) return 'mangrove';
  if (coldness(y) > 0.5) return 'cold';
  if (warmth(y) > 0.5) return 'warm';
  return Math.hypot(x - HOME.x, y - HOME.y) < 1100 ? 'home' : 'open';
}

export const BIOME_NAME: Record<BiomeId, string> = {
  home: 'Alderhaven waters', reef: 'Coral shallows', kelp: 'Kelp coast', volcanic: 'Ember isles', mangrove: 'Mangrove channels',
  warm: 'Southern seas', cold: 'Ice floes', open: 'Open coast',
};
