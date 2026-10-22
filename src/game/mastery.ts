// Mastery: how well you know each species, read from the logbook. Catching 5, 25 and 100 of a species earns its
// Bronze, Silver and Gold grade, announced on the catch that reaches it; collecting across species earns paints
// that can't be bought. Nothing new is saved: grades come from the logbook's counts, earned paints go in G.paints.
import { SPECIES } from '../species';
import { PAINTS } from '../econ';
import { sfx } from '../audio';
import type { LogEntry } from '../types';
import { G } from './state';
import { toast } from './feedback';

export const GRADES = [{ name: 'Bronze', at: 5 }, { name: 'Silver', at: 25 }, { name: 'Gold', at: 100 }] as const;
/** 0 (not yet) to 3 (Gold): a species' mastery grade from how many you've caught. */
export const grade = (n: number): number => GRADES.filter(g => n >= g.at).length;

const entries = (): LogEntry[] => Object.values(G.log);
/** Collections across the logbook, and the paint each earns. */
export const COLLECTIONS: { paint: string; what: string; want: number; have: () => number }[] = [
  { paint: 'pearl', what: 'Catch 5 kinds of variant', want: 5, have: () => new Set(entries().flatMap(e => e.vars ?? [])).size },
  { paint: 'trophyred', what: 'Land a trophy of 10 species', want: 10, have: () => entries().filter(e => e.trophy).length },
  { paint: 'kingfisher', what: 'Reach Gold mastery with 10 species', want: 10, have: () => entries().filter(e => grade(e.n) === 3).length },
];

/** After a catch of species `spIdx`, whose logbook count was `before`: announce a new grade, and grant any paint just earned. */
export function masteryAfterCatch(spIdx: number, before: number): void {
  const sp = SPECIES[spIdx], g = grade(G.log[sp.id]?.n ?? 0);
  if (g > grade(before)) { toast(`${sp.name} mastery: ${GRADES[g - 1].name}`, 'good'); sfx('levelup', 0.6); }
  for (const c of COLLECTIONS) {
    if (G.paints.includes(c.paint) || c.have() < c.want) continue;
    G.paints.push(c.paint);
    toast(`You earned the ${PAINTS.find(p => p.id === c.paint)?.name ?? c.paint} paint: ${c.what.toLowerCase()}`, 'good');
  }
}
