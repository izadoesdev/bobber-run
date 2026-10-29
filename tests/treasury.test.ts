import { expect, test } from 'bun:test';
import { accrueTreasury, TREASURY_MIN } from '../src/game/treasury';

test('income accumulates fractionally and stops at the treasury capacity', () => {
  expect(accrueTreasury(0.25, 60, 0.5)).toBe(0.75);
  expect(accrueTreasury(100, 60, 60)).toBe(160);
  expect(accrueTreasury(0, 60, 10_000_000)).toBe(60 * TREASURY_MIN);
});

test('live and offline income use the same rule', () => {
  let live = 12.5;
  for (let i = 0; i < 600; i++) live = accrueTreasury(live, 17, 0.1);
  expect(live).toBeCloseTo(accrueTreasury(12.5, 17, 60), 8);
});

test('a lower income rate does not confiscate already banked coins', () => {
  expect(accrueTreasury(1000, 1, 60)).toBe(1000);
  expect(accrueTreasury(1000, 0, 60)).toBe(1000);
});

test('bad clocks and malformed balances cannot mint money or poison the treasury', () => {
  for (const dt of [-60, NaN, Infinity]) expect(accrueTreasury(10, 60, dt)).toBe(10);
  for (const rate of [-1, NaN, Infinity]) expect(accrueTreasury(10, rate, 60)).toBe(10);
  for (const balance of [-1, NaN, Infinity]) expect(accrueTreasury(balance, 60, 0)).toBe(0);
});
