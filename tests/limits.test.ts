import { expect, test } from 'bun:test';
import { SPECIES } from '../src/species';
import { MAX_KG, SPECIES_NAMES } from '../convex/limits';

// The server checks world records against its own copy of each species' weight limit and name; a species added to
// the game but not to convex/limits.ts would have every record refused and no name in the coast's news.
test('every species has a server weight limit above its largest normal catch', () => {
  for (const s of SPECIES) expect([s.id, MAX_KG[s.id] >= s.kg[1]]).toEqual([s.id, true]);
});
test('every species has its display name on the server', () => {
  for (const s of SPECIES) expect([s.id, SPECIES_NAMES[s.id]]).toEqual([s.id, s.name]);
});
