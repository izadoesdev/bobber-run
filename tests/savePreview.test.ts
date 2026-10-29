import { expect, test } from 'bun:test';
import { voyagePreview } from '../src/game/savePreview';

const dayLength = 480;

test('a saved voyage preview describes the saved boat and game day', () => {
  const raw = { clock: dayLength * 7 + 60, boatId: 'launch', stats: { caught: 18 },
    log: { mackerel: { n: 10, best: 1 }, perch: { n: 8, best: 1 } } };
  const before = structuredClone(raw);
  expect(voyagePreview(raw, dayLength)).toEqual({ day: 8, boat: 'Motor Launch', caught: 18, species: 2 });
  expect(raw).toEqual(before);
});

test('preview uses the same removed-boat fallback as save loading', () => {
  expect(voyagePreview({ boatId: 'context' }, dayLength)).toMatchObject({ boat: 'Rowboat' });
});

test('invalid numbers and malformed log entries do not leak into the preview', () => {
  for (const clock of [NaN, Infinity, -Infinity, -1000, 'yesterday']) {
    expect(voyagePreview({ clock, stats: { caught: Infinity }, log: { broken: null, mackerel: { n: 1, best: 1 } } }, dayLength))
      .toMatchObject({ day: 1, caught: 0, species: 1 });
  }
  expect(voyagePreview({ stats: { caught: -10 } }, dayLength)?.caught).toBe(0);
});

test('a missing or non-object save has no invented voyage summary', () => {
  for (const raw of [null, undefined, false, 12, 'a save', []]) expect(voyagePreview(raw, dayLength)).toBeNull();
});

test('the first day and exact day boundary use the in-game clock', () => {
  expect(voyagePreview({ clock: 0 }, dayLength)?.day).toBe(1);
  expect(voyagePreview({ clock: dayLength - 0.01 }, dayLength)?.day).toBe(1);
  expect(voyagePreview({ clock: dayLength }, dayLength)?.day).toBe(2);
});
