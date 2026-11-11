import { expect, test } from 'bun:test';
import { reported, SLACK_EARNED, EARNED_PER_MIN } from '../convex/statsRules';
import { REPORT_MIN_MS } from '../convex/limits';

const T = 1_700_000_000_000;

test('a report one second after the last counted one is ignored', () => {
  expect(reported({ caught: 0, earned: 0, at: T }, 1e9, 1e9, T + 1000)).toBeNull();
});

test('calling report every second cannot bank the slack over and over', () => {
  let s = { caught: 0, earned: 0, at: T };
  for (let i = 1; i <= 100; i++) {
    const now = T + i * 1000, n = reported(s, 1e9, 1e9, now);
    if (n) s = { ...n, at: now };
  }
  expect(s.earned).toBeLessThanOrEqual(SLACK_EARNED + EARNED_PER_MIN * 2);
});

test('a report exactly REPORT_MIN_MS later is accepted and capped', () => {
  const r = reported({ caught: 0, earned: 0, at: T }, 1e9, 1e9, T + REPORT_MIN_MS);
  expect(r?.earned).toBe(Math.floor(SLACK_EARNED + (REPORT_MIN_MS / 60_000) * EARNED_PER_MIN));
});

test('an honest report below the cap is stored as sent', () => {
  expect(reported({ caught: 10, earned: 500, at: T }, 12, 900, T + 60_000)).toEqual({ caught: 12, earned: 900 });
});

test('totals never go down', () => {
  expect(reported({ caught: 10, earned: 500, at: T }, 5, 100, T + 60_000)).toBeNull();
});

test('idle time banks at most 10 minutes', () => {
  const r = reported({ caught: 0, earned: 0, at: T }, 1e12, 1e12, T + 3 * 3600_000);
  expect(r?.earned).toBe(SLACK_EARNED + 10 * EARNED_PER_MIN);
});

test('NaN and Infinity are ignored', () => {
  const s = { caught: 0, earned: 0, at: T }, now = T + 60_000;
  for (const [c, e] of [[NaN, 1], [1, NaN], [Infinity, 1], [1, Infinity]]) expect(reported(s, c, e, now)).toBeNull();
});
