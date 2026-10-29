import * as v from 'valibot';
import { BOATS } from '../econ';
import { saveSchema } from './saveSchema';

const previewSchema = v.object({
  boatId: saveSchema.entries.boatId,
  stats: saveSchema.entries.stats,
  log: saveSchema.entries.log,
  clock: v.fallback(v.pipe(v.number(), v.finite(), v.minValue(0)), 0),
});

export interface VoyagePreview {
  day: number;
  caught: number;
  species: number;
  boat: string;
}

export function voyagePreview(raw: unknown, secondsPerDay: number): VoyagePreview | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const saved = v.parse(previewSchema, raw);
  const boat = BOATS.find(b => b.id === saved.boatId) ?? BOATS[0];
  return {
    day: Math.floor(saved.clock / secondsPerDay) + 1,
    caught: Math.max(0, saved.stats.caught ?? 0),
    species: Object.keys(saved.log).length,
    boat: boat.name,
  };
}
