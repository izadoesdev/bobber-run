import { expect, test } from 'bun:test';
import { BOATS } from '../src/econ';
import { BOAT_MODELS, decorate, M, PLAIN } from '../src/models';

for (const boat of BOATS) {
  test(`${boat.name}: paint and plating preserve the superstructure and base model`, () => {
    const model = BOAT_MODELS[boat.id], original = model.vox.d.slice();
    const plain = decorate(boat.id, PLAIN);
    const painted = decorate(boat.id, { ...PLAIN, paint: 'crimson' });
    const plated = decorate(boat.id, { ...PLAIN, plate: 2 });
    const hullEnd = model.outlineZ * plain.nu * plain.nv;
    expect(painted.d.slice(hullEnd)).toEqual(plain.d.slice(hullEnd));
    expect(plated.d.slice(hullEnd)).toEqual(plain.d.slice(hullEnd));
    expect(painted.d.slice(0, hullEnd)).not.toEqual(plain.d.slice(0, hullEnd));
    expect(plated.d.slice(0, hullEnd)).not.toEqual(plain.d.slice(0, hullEnd));
    expect(model.vox.d).toEqual(original);
    expect(plain.rad).toBeGreaterThan(0);
    expect(plain.n.length).toBe(plain.d.length * 3);
  });
}

test('the upgraded launch replaces its single outboard with two mounted engines', () => {
  const plain = decorate('launch', PLAIN), upgraded = decorate('launch', { ...PLAIN, prop: 3 });
  expect(plain.get(-17, 0, 8)).toBe(M.white);
  expect(upgraded.get(-17, 0, 8)).toBe(0);
  for (const side of [-3, 3]) {
    expect(upgraded.get(-17, side, 8)).toBe(M.white);
    expect(upgraded.get(-17, side, 1)).toBe(M.iron);
    expect(upgraded.get(-15, side, 5)).toBe(M.iron);
  }
});

test('the trawler gantry is supported on both sides of its working deck', () => {
  const boat = BOAT_MODELS.trawler.vox;
  for (const side of [-6, 6]) {
    expect(boat.get(6, side, 5)).not.toBe(0);
    for (let z = 6; z <= 22; z++) expect(boat.get(6, side, z)).toBe(M.orange);
  }
  expect(boat.get(6, 0, 23)).toBe(M.orange);
});
