import { expect, test } from 'bun:test';
import { PACKS } from '../src/content/packs';
import { SPECIES } from '../src/species';
import type { BiomeId } from '../src/biome';

// Every content pack, checked: a typo in a species id, a character name or a region should fail here, not in a quest.
const REGIONS: BiomeId[] = ['home', 'reef', 'kelp', 'volcanic', 'mangrove', 'warm', 'cold', 'open'];
const species = new Set(SPECIES.map(s => s.id));

test('pack and quest ids are unique', () => {
  expect(new Set(PACKS.map(p => p.id)).size).toBe(PACKS.length);
  const qs = PACKS.flatMap(p => p.quests.map(q => `${p.id}/${q.id}`));
  expect(new Set(qs).size).toBe(qs.length);
});
for (const p of PACKS) test(`pack "${p.id}" is well formed`, () => {
  const who = new Set(p.characters.map(c => c.id));
  expect(p.quests.length).toBeGreaterThan(0);
  if (p.unlock.region) expect(REGIONS).toContain(p.unlock.region);
  for (const q of p.quests) {
    expect(who.has(q.by), `${q.id}: giver ${q.by}`).toBe(true);
    expect(q.intro.length + q.outro.length, `${q.id}: has lines`).toBeGreaterThan(0);
    for (const l of [...q.intro, ...q.outro]) { const m = /^([a-z0-9-]+): /.exec(l); if (m) expect(who.has(m[1]), `${q.id}: speaker ${m[1]}`).toBe(true); }
    const o = q.obj;
    if ('catch' in o) {
      expect(o.catch).toBeGreaterThan(0);
      if (o.species) expect(species.has(o.species), `${q.id}: species ${o.species}`).toBe(true);
      if (o.region) expect(REGIONS).toContain(o.region);
    } else if ('sell' in o) expect(o.sell).toBeGreaterThan(0);
    else if ('chart' in o) expect(o.chart).toBeGreaterThan(0);
    else if ('visit' in o) expect(Number.isFinite(o.visit.x) && Number.isFinite(o.visit.y) && !!o.place).toBe(true);
    expect((q.reward.coins ?? 0) >= 0 && (q.reward.coins ?? 0) <= 5000, `${q.id}: reward`).toBe(true);
  }
});
