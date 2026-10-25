import { describe, expect, test } from 'bun:test';
import { islandPrice, isClaimable, priceOfKey, mainIsland, CROWN_PRICE, BUILDINGS, BUILDING_IDS, cantBuild, islandIncome, titleOf, TITLES } from '../convex/islandRules';
import { claimableNear } from '../src/world';

describe('islands the server knows', () => {
  test("the server's main islands are the world's", () => {
    // the server prices and checks islands without the world generator: every claimable island must match it
    for (const c of claimableNear(0, 0, 12000)) {
      const m = mainIsland(c.i, c.j);
      expect(m).not.toBeNull();
      expect(m!.x).toBe(c.x); expect(m!.y).toBe(c.y); expect(m!.R).toBe(c.R);
    }
  });
  test('a cell with no main island has no price', () => {
    let none = 0;
    for (let i = -30; i < 30; i++) if (mainIsland(i, 7) === null) { none++; expect(islandPrice(i, 7)).toBeNull(); }
    expect(none).toBeGreaterThan(0);
  });
});

describe('island prices', () => {
  const priced: { p: number; R: number; d: number }[] = [];
  for (let j = -25; j <= 25; j++) for (let i = -25; i <= 25; i++) {
    const m = mainIsland(i, j), p = islandPrice(i, j);
    if (m && p !== null && (i || j)) priced.push({ p, R: m.R, d: Math.hypot(m.x - 280, m.y - 280) });
  }
  test('Alderhaven is the crown of the coast', () => {
    expect(islandPrice(0, 0)).toBe(CROWN_PRICE);
    for (const { p } of priced) expect(p).toBeLessThan(CROWN_PRICE);
  });
  test('an end-game sum: $100,000 at the least, in $5,000 steps', () => {
    for (const { p } of priced) { expect(p).toBeGreaterThanOrEqual(100_000); expect(p % 5000).toBe(0); }
  });
  test('bigger islands cost more, and the same island costs more nearer home', () => {
    const near = priced.filter(x => x.d < 3000), big = near.filter(x => x.R > 150), small = near.filter(x => x.R < 80);
    const mean = (a: { p: number }[]) => a.reduce((s, x) => s + x.p, 0) / a.length;
    expect(mean(big)).toBeGreaterThan(mean(small) * 2);
    const sameSize = (lo: number, hi: number) => priced.filter(x => x.R > 110 && x.R < 130 && x.d >= lo && x.d < hi);
    expect(mean(sameSize(0, 3000))).toBeGreaterThan(mean(sameSize(9000, 30000)));
  });
  test('keys', () => {
    expect(isClaimable('0,0')).toBe(true);
    expect(isClaimable('-12,7')).toBe(true);
    expect(isClaimable('1,2,3')).toBe(false);
    expect(isClaimable('x')).toBe(false);
    expect(priceOfKey('5,0')).toBe(islandPrice(5, 0));
  });
});

describe('buildings and titles', () => {
  test('every building that needs another names one that exists', () => {
    for (const b of BUILDING_IDS) { const n = BUILDINGS[b].needs; if (n) expect(BUILDING_IDS).toContain(n); }
  });
  test('built in order, and once', () => {
    expect(cantBuild('castle', [])).not.toBeNull();
    expect(cantBuild('castle', ['hall', 'keep'])).toBeNull();
    expect(cantBuild('dock', ['dock'])).toBe('Already built');
  });
  test('income grows with what is built and with the island, and a castle raises it', () => {
    const c = claimableNear(0, 0, 8000).filter(x => x.key !== '0,0').sort((a, b) => a.R - b.R), small = c[0], big = c[c.length - 1];
    expect(islandIncome(small.i, small.j, [])).toBe(0);
    const full = ['dock', 'fishery', 'market', 'garden'];
    expect(islandIncome(big.i, big.j, full)).toBeGreaterThan(islandIncome(small.i, small.j, full));
    expect(islandIncome(big.i, big.j, [...full, 'hall', 'keep', 'castle'])).toBeGreaterThan(islandIncome(big.i, big.j, full));
  });
  test('titles rise with worth', () => {
    expect(titleOf(0)).toBeNull();
    let last = -1;
    for (const [at, name] of TITLES) { expect(at).toBeGreaterThan(last); expect(titleOf(at)).toBe(name); last = at; }
  });
});
