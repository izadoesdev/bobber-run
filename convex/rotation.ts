// The weekly tide table: which species are "running" this week, the same for every sailor. Pure, so the game client
// (better bites and prices for running fish) and the server (weekly heaviest-catch boards) agree without asking.
import { MAX_KG, LEGENDS } from './limits';

const WEEK_MS = 7 * 86_400_000;
const EPOCH = Date.UTC(2026, 9, 19);   // Monday 19 October 2026, 00:00 UTC: week 0
export const RUNNING_PER_WEEK = 6;

/** The week number a moment falls in (weeks start Monday 00:00 UTC). */
export const weekOf = (ms: number): number => Math.floor((ms - EPOCH) / WEEK_MS);
/** When a week starts and ends, in ms. */
export const weekBounds = (week: number): { start: number; end: number } => ({ start: EPOCH + week * WEEK_MS, end: EPOCH + (week + 1) * WEEK_MS });

/** A small seeded random generator, so every machine draws the same species for a week. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * This week's running species: two small, two mid-sized and two big fish (by their weight limit), so every boat and
 * rod has something to chase. Legends never run; they stay rare.
 */
export function runningSpecies(week: number): string[] {
  const pool = Object.keys(MAX_KG).filter(id => !LEGENDS[id]).sort((a, b) => MAX_KG[a] - MAX_KG[b] || a.localeCompare(b));
  const third = Math.ceil(pool.length / 3), rnd = seeded(week * 2654435761 + 97), out: string[] = [];
  for (let band = 0; band < 3; band++) {
    const left = pool.slice(band * third, (band + 1) * third);
    for (let k = 0; k < RUNNING_PER_WEEK / 3 && left.length; k++) out.push(...left.splice(Math.floor(rnd() * left.length), 1));
  }
  return out;
}
