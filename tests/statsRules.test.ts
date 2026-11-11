import { expect, test } from 'bun:test';
import { reported, EARNED_PER_MIN, CAUGHT_PER_MIN, BANK_MS, START_MS } from '../convex/statsRules';

const T = 1_700_000_000_000, HUGE = 1e12;
/** Report `HUGE` totals every `everyMs` for `forMs`, starting from an empty bank, and return what got counted. */
function hammer(everyMs: number, forMs: number) {
  let s = { caught: 0, earned: 0, at: T };
  for (let t = everyMs; t <= forMs; t += everyMs) s = reported(s, HUGE, HUGE, T + t) ?? s;
  return s;
}

test('reporting every second counts no more than the rate allows', () => {
  expect(hammer(1000, 100_000).earned).toBeLessThanOrEqual(EARNED_PER_MIN * 100 / 60);
  expect(hammer(1000, 100_000).caught).toBeLessThanOrEqual(CAUGHT_PER_MIN * 100 / 60);
});
test('reporting every 55 s for an hour counts no more than an hour at the rate', () => {
  expect(hammer(55_000, 3_600_000).earned).toBeLessThanOrEqual(EARNED_PER_MIN * 60);
});
test('however often a client reports, it ends up with the same total', () => {
  const slow = hammer(60_000, 600_000).earned, fast = hammer(500, 600_000).earned;
  expect(slow).toBe(EARNED_PER_MIN * 10);
  expect(Math.abs(slow - fast)).toBeLessThan(EARNED_PER_MIN / 60);          // within a second's worth of rounding
});
test('an honest report below the allowance is stored as sent and keeps the rest of the bank', () => {
  expect(reported({ caught: 10, earned: 500, at: T }, 12, 900, T + 60_000)).toEqual({ caught: 12, earned: 900, at: T + 3000 });
});
test('a second report a moment later still counts, as before a purchase', () => {
  const first = reported({ caught: 10, earned: 500, at: T }, 12, 900, T + 60_000)!;
  expect(reported(first, 12, 5000, T + 61_000)).toMatchObject({ caught: 12, earned: 5000 });
});
test('totals never go down', () => {
  expect(reported({ caught: 10, earned: 500, at: T }, 5, 100, T + 60_000)).toBeNull();
});
test('idle time banks at most BANK_MS', () => {
  expect(reported({ caught: 0, earned: 0, at: T }, HUGE, HUGE, T + 3 * 3_600_000)).toEqual({ caught: CAUGHT_PER_MIN * 10, earned: EARNED_PER_MIN * 10, at: T + 3 * 3_600_000 });
  expect(BANK_MS).toBe(600_000);
});
test("a new player's bank lets their first report count at once", () => {
  expect(reported({ caught: 0, earned: 0, at: T - START_MS }, HUGE, HUGE, T)).toMatchObject({ caught: 66, earned: 20_000 });
});
test('NaN and Infinity are ignored', () => {
  const s = { caught: 0, earned: 0, at: T }, now = T + 60_000;
  for (const [c, e] of [[NaN, 1], [1, NaN], [Infinity, 1], [1, Infinity]]) expect(reported(s, c, e, now)).toBeNull();
});
test('a row stamped in the future gets no allowance', () => {
  expect(reported({ caught: 0, earned: 0, at: T + 60_000 }, HUGE, HUGE, T)).toBeNull();
});
