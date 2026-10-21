import { expect, test } from 'bun:test';
import { today, isWorldFrenzy, featuredToday } from '../src/today';
import { SPECIES } from '../src/species';

const DAY = 86_400_000, HOUR = 3_600_000, T0 = Date.UTC(2026, 9, 21, 9, 30);

test('the same moment gives the same day for everyone, and days differ', () => {
  expect(today(T0)).toEqual(today(T0));
  expect(today(T0).featured).toEqual(today(T0 + 5 * HOUR).featured);   // stable through the UTC day
  const days = Array.from({ length: 30 }, (_, i) => today(T0 + i * DAY).featured.join());
  expect(new Set(days).size).toBeGreaterThan(20);
});
test('featured: three different, valid, starter-catchable species from different waters', () => {
  for (let i = 0; i < 200; i++) {
    const { featured } = today(T0 + i * DAY);
    expect(featured.length).toBe(3);
    expect(new Set(featured).size).toBe(3);
    for (const sp of featured) {
      const s = SPECIES[sp];
      expect(s).toBeDefined();
      expect(s.legend || s.special || s.deck > 0 || s.rod > 1 || s.weather !== 'any').toBeFalsy();
      expect(featuredToday(sp, T0 + i * DAY)).toBe(true);
    }
  }
});
test('the world frenzy is a 6-minute window inside each hour, current or next', () => {
  for (let m = 0; m < 24 * 60 * 3; m += 7) {
    const now = T0 + m * 60_000, { start, end } = today(now).frenzy;
    expect(end - start).toBe(6 * 60_000);
    expect(now).toBeLessThan(end);
    expect(Math.floor(start / HOUR)).toBe(Math.floor((end - 1) / HOUR));   // never straddles the hour
    expect(start - now).toBeLessThan(2 * HOUR);
    expect(isWorldFrenzy(now)).toBe(now >= start);
  }
  const starts = new Set(Array.from({ length: 24 }, (_, h) => today(T0 + h * HOUR).frenzy.start % HOUR));
  expect(starts.size).toBeGreaterThan(5);   // the minute moves from hour to hour
});
test('about one day in five is stormy', () => {
  let n = 0;
  for (let i = 0; i < 1000; i++) if (today(T0 + i * DAY).stormy) n++;
  expect(n).toBeGreaterThan(150);
  expect(n).toBeLessThan(250);
});
