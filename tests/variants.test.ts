import { expect, test } from 'bun:test';
import { SPECIES, SP, rollVariant, type VariantId } from '../src/species';
import { mulberry } from '../src/noise';

const calm = { storm: false, biome: 'home' as const, night: false };
function tally(sp: number, ctx: Parameters<typeof rollVariant>[1], n = 200_000): Record<string, number> {
  const r = mulberry(42), out: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const v = rollVariant(sp, ctx, r()) ?? 'none'; out[v] = (out[v] ?? 0) + 1 / n; }
  return out;
}

test('legends and the boss never vary', () => {
  for (const [i, s] of SPECIES.entries()) if (s.legend || s.fight === 'boss')
    for (let r = 0; r < 1; r += 0.001) expect(rollVariant(i, { storm: true, biome: 'volcanic', night: true }, r)).toBeNull();
});
test('most catches are ordinary; variants come at roughly their odds', () => {
  const t = tally(SP.sardine, calm);
  expect(t.none).toBeGreaterThan(0.86);
  expect(t.big).toBeCloseTo(0.06, 2);
  expect(t.tiny).toBeCloseTo(0.06, 2);
  expect(t.albino).toBeGreaterThan(0.004);
  expect(t.albino).toBeLessThan(0.01);
  for (const v of ['storm', 'ember', 'frost', 'coral'] as VariantId[]) expect(t[v]).toBeUndefined();
});
test('storm and biome variants only appear in their conditions', () => {
  expect(tally(SP.sardine, { ...calm, storm: true }).storm).toBeCloseTo(0.08, 2);
  const ember = tally(SP.embersnap, { ...calm, biome: 'volcanic' });
  expect(ember.ember).toBeCloseTo(0.05, 2);
  expect(ember.frost).toBeUndefined();
  expect(tally(SP.polarcod, { ...calm, biome: 'cold' }).frost).toBeCloseTo(0.05, 2);
});
