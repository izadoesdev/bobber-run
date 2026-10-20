import { expect, test } from 'bun:test';
import { runningSpecies, weekOf, weekBounds, RUNNING_PER_WEEK } from '../convex/rotation';
import { MAX_KG, LEGENDS } from '../convex/limits';

test('weeks start on Monday 00:00 UTC', () => {
  expect(weekOf(Date.UTC(2026, 9, 19))).toBe(0);
  expect(weekOf(Date.UTC(2026, 9, 25, 23, 59))).toBe(0);
  expect(weekOf(Date.UTC(2026, 9, 26))).toBe(1);
  expect(weekBounds(1).start).toBe(Date.UTC(2026, 9, 26));
});
test('every week runs six different, known, non-legendary species, the same on every call', () => {
  for (let w = 0; w < 104; w++) {
    const s = runningSpecies(w);
    expect(s.length).toBe(RUNNING_PER_WEEK);
    expect(new Set(s).size).toBe(RUNNING_PER_WEEK);
    for (const id of s) { expect(id in MAX_KG).toBe(true); expect(LEGENDS[id]).toBeUndefined(); }
    expect(runningSpecies(w)).toEqual(s);
  }
});
test('weeks mix small and big fish, and change from week to week', () => {
  const w0 = runningSpecies(0), sorted = Object.keys(MAX_KG).filter(id => !LEGENDS[id]).sort((a, b) => MAX_KG[a] - MAX_KG[b]);
  const rank = (id: string) => sorted.indexOf(id) / sorted.length;
  expect(Math.min(...w0.map(rank))).toBeLessThan(1 / 3);
  expect(Math.max(...w0.map(rank))).toBeGreaterThanOrEqual(2 / 3);
  const distinct = new Set(Array.from({ length: 8 }, (_, w) => runningSpecies(w).join()));
  expect(distinct.size).toBe(8);
});
