import { expect, test } from 'bun:test';
import { separateFish, shoalPositions } from '../src/game/shoal';

const openWater = (): boolean => true;

test('initial shoals are deterministic, spread out and inside their swimming grounds', () => {
  const home = { x: 25, y: -70 }, radius = 40, gap = 5;
  const points = shoalPositions(home, radius, 40, gap, 0.8, openWater);
  expect(points).toHaveLength(40);
  expect(points).toEqual(shoalPositions(home, radius, 40, gap, 0.8, openWater));
  for (let i = 0; i < points.length; i++) {
    expect(Math.hypot(points[i].x - home.x, points[i].y - home.y)).toBeLessThan(radius);
    for (const p of points.slice(i + 1)) expect(Math.hypot(p.x - points[i].x, p.y - points[i].y)).toBeGreaterThanOrEqual(gap);
  }
});

test('a blocked coast never turns missing shoal slots into a pile at the centre', () => {
  const points = shoalPositions({ x: 0, y: 0 }, 20, 70, 6, 0, (x, y) => x > 2 && y < 4);
  expect(points.length).toBeGreaterThan(0);
  expect(points.length).toBeLessThan(70);
  for (const p of points) { expect(p.x).toBeGreaterThan(2); expect(p.y).toBeLessThan(4); }
  expect(shoalPositions({ x: 0, y: 0 }, 20, 70, 6, 0, () => false)).toEqual([]);
});

test('coincident fish from different schools separate by their body radii', () => {
  const bodies = [{ point: { x: 0, y: 0 }, radius: 4 }, { point: { x: 0, y: 0 }, radius: 6 }];
  separateFish(bodies, openWater);
  expect(Math.hypot(bodies[0].point.x - bodies[1].point.x, bodies[0].point.y - bodies[1].point.y)).toBe(10);
});

test('when the coast blocks one fish, the fish in open water makes room instead', () => {
  const bodies = [{ point: { x: 1, y: 0 }, radius: 4 }, { point: { x: 3, y: 0 }, radius: 4 }];
  separateFish(bodies, x => x >= 0);
  expect(bodies[0].point.x).toBe(1);
  expect(bodies[1].point.x).toBe(9);
});

test('isolated fish do not drift just because collision avoidance runs', () => {
  const bodies = [{ point: { x: -50, y: 20 }, radius: 4 }, { point: { x: 20, y: -60 }, radius: 6 }];
  const original = structuredClone(bodies);
  separateFish(bodies, openWater);
  expect(bodies).toEqual(original);
});
