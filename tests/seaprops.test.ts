import { describe, expect, test } from 'bun:test';
import { seaPropsNear, type SeaProp } from '../src/seaprops';
import { heightAt, poisNear, claimableNear } from '../src/world';
import { chartBands } from '../src/maptiles';

const ICE = new Set(['floeS', 'floeM', 'floeL', 'berg', 'iceberg']);
const landWithin = (x: number, y: number, d: number): boolean => {
  for (let t = 4; t <= d; t += 4) for (let k = 0; k < 32; k++) { const a = k * Math.PI / 16; if (heightAt(x + Math.cos(a) * t, y + Math.sin(a) * t) > 0) return true; }
  return false;
};

describe('sea props', () => {
  // the cold north, where the ice is, and the warm south
  const north = seaPropsNear(1000, -2200, 900, [], true), south = seaPropsNear(300, 2300, 900, [], true);
  test('the same sea every time, and solid ones carry their scaled footprint', () => {
    const again = seaPropsNear(1000, -2200, 900, [], true);
    expect(again.map(p => `${p.kind}${p.x},${p.y}`)).toEqual(north.map(p => `${p.kind}${p.x},${p.y}`));
    expect(north.filter(p => ICE.has(p.kind)).length).toBeGreaterThan(10);
    for (const p of [...north, ...south]) {
      expect(heightAt(p.x, p.y)).toBeLessThan(0);
      if (p.r > 0) expect(p.r).toBeGreaterThan(2 * p.scale);
    }
    expect(seaPropsNear(1000, -2200, 900).every(p => p.r > 0)).toBe(true);   // physics gets only the solid ones
  });
  test('ice keeps to cold coasts, leaving open channels clear', () => {
    for (const p of north.filter(q => ICE.has(q.kind))) expect(landWithin(p.x, p.y, 90)).toBe(true);
  });
  test('nothing solid near a harbour or lighthouse', () => {
    for (const p of [...north, ...south].filter((q: SeaProp) => q.r > 0))
      for (const q of poisNear(p.x, p.y, 120)) if (q.type !== 'wreck') expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(105);
  });
});

describe('chart bands', () => {
  test('seven colours in 0..1, the home look at Alderhaven', () => {
    const out = new Float32Array(21);
    chartBands(280, 300, claimableNear(280, 300, 460), out);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect([...out.slice(12, 15)].map(v => Math.round(v * 255))).toEqual([0x86, 0xa6, 0x5c]);   // home grass
  });
});
