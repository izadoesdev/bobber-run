// Today at sea, the same for every sailor: derived only from the UTC clock. Three featured species sell double, a
// six-minute world frenzy comes round once an hour, and about one day in five is stormy.
import { hash, hash01, mulberry } from './noise';
import { SPECIES, HABITAT, SHIP_NEED } from './species';

const DAY_MS = 86_400_000, HOUR_MS = 3_600_000, FRENZY_MS = 6 * 60_000;
export const FEATURED_PRICE = 2;

// a starter can land these (low rod, small deck, no landmark, ship job or weather); grouped by where they live
const POOL = SPECIES.map((s, i) => [s, i] as const)
  .filter(([s]) => !s.legend && s.rod <= 1 && s.deck === 0 && !s.special && s.weather === 'any' && s.w > 0 && !SHIP_NEED[s.id]);
const place = (i: number): string => HABITAT[SPECIES[i].id] ?? (SPECIES[i].region === 'warm' || SPECIES[i].region === 'cold' ? SPECIES[i].region : 'home');

let memo = { day: NaN, featured: [] as number[] };
function featuredOn(day: number): number[] {
  if (memo.day === day) return memo.featured;
  const r = mulberry(hash(day, 0, 11)), left = POOL.map(([, i]) => i), out: number[] = [];
  while (out.length < 3 && left.length) {
    const i = left.splice(Math.floor(r() * left.length), 1)[0];
    if (!out.some(o => place(o) === place(i))) out.push(i);   // three different waters
  }
  memo = { day, featured: out };
  return out;
}
/** The window of this hour's world frenzy, or the next hour's once this one has passed. */
function frenzyAt(now: number): { start: number; end: number } {
  for (let h = Math.floor(now / HOUR_MS); ; h++) {
    const start = h * HOUR_MS + (hash(h, 0, 12) % 54) * 60_000;
    if (now < start + FRENZY_MS) return { start, end: start + FRENZY_MS };
  }
}
export function today(now = Date.now()): { day: number; featured: number[]; frenzy: { start: number; end: number }; stormy: boolean } {
  const day = Math.floor(now / DAY_MS);
  return { day, featured: featuredOn(day), frenzy: frenzyAt(now), stormy: hash01(day, 0, 13) < 0.2 };
}
export const isWorldFrenzy = (now = Date.now()): boolean => frenzyAt(now).start <= now;
export const featuredToday = (sp: number, now = Date.now()): boolean => featuredOn(Math.floor(now / DAY_MS)).includes(sp);
