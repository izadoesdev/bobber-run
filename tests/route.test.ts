import { expect, test } from 'bun:test';
import { G } from '../src/game/state';
import { heightAt, homePort } from '../src/world';
import { planRoute, clearLine } from '../src/game/route';
import { seaPropsNear } from '../src/seaprops';
import type { Point } from '../src/types';

// Routes round islands for a ship: every point on open water with room for the hull, evenly spaced, kept off the
// coast, and planned quickly. Trips are pairs of open-water points near home whose
// straight line crosses land.
G.story = { i: 99, base: {}, shown: true } as typeof G.story;          // every region open
const water = (x: number, y: number): boolean => heightAt(x, y) < -0.07;
function trips(n: number): [Point, Point][] {
  const out: [Point, Point][] = [];
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  while (out.length < n) {
    const a = { x: 280 + (r() - 0.5) * 2400, y: 280 + (r() - 0.5) * 2400 }, ang = r() * 6.28, d = 300 + r() * 900;
    const b = { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
    if (water(a.x, a.y) && water(b.x, b.y) && !clearLine(a, b)) out.push([a, b]);
  }
  return out;
}
/** The distance from (x, y) to the nearest land, searched out to `max`. */
function shore(x: number, y: number, max = 40): number {
  for (let r = 2; r <= max; r += 2) for (let k = 0; k < 16; k++) if (!water(x + Math.cos(k / 16 * 6.28) * r, y + Math.sin(k / 16 * 6.28) * r)) return r;
  return max;
}
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;


test('ship routes keep to open water with room for the hull, evenly spaced, and off the coast', () => {
  const pad = 12, list = trips(40), clearNew: number[] = [];
  let found = 0, t0 = performance.now(), tPlan = 0;
  for (const [a, b] of list) {
    seaPropsNear(a.x, a.y, 330);                                      // the sea round the boat is built in a game; time the plan, not that
    const tp = performance.now(), plan = planRoute(a, b, pad);
    tPlan += performance.now() - tp;
    if (!plan) continue;
    found++;
    let prev: Point = a;
    for (const p of plan.pts) {
      expect(water(p.x, p.y)).toBe(true);
      expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(13);
      prev = p;
    }
    clearNew.push(Math.min(...plan.pts.slice(0, -1).map(p => shore(p.x, p.y))));      // closest it comes to land
  }
  const ms = tPlan / list.length;
  void t0;
  console.log(`routes ${found}/${list.length}, closest to land on average ${mean(clearNew).toFixed(1)} (the old tight routes: 11.6), ${ms.toFixed(1)} ms a plan`);
  expect(found / list.length).toBeGreaterThan(0.9);
  expect(mean(clearNew)).toBeGreaterThan(16);                     // mid-channel: the old corner-hugging planner managed 11.6
  expect(ms).toBeLessThan(40);
}, 60_000);

test('a long trip plans on a coarser grid instead of giving up', () => {
  const a = homePort().dock;
  let b: Point | null = null;
  for (let k = 0; k < 64 && !b; k++) { const p = { x: 280 + Math.cos(k / 64 * 6.28) * 7000, y: 280 + Math.sin(k / 64 * 6.28) * 7000 }; if (water(p.x, p.y)) b = p; }
  const plan = planRoute(a, b!, 10);
  expect(plan).not.toBeNull();
  expect(Math.hypot(plan!.end.x - b!.x, plan!.end.y - b!.y)).toBeLessThan(100);
  expect(plan!.pts.every(p => water(p.x, p.y))).toBe(true);
});

test('a waypoint by the shore is reached, not stopped short of', () => {
  // points in the water just off a coast, planned to from open water a few hundred units out
  let s = 3, n = 0, near = 0;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 4000 && n < 25; t++) {
    const g = { x: 280 + (r() - 0.5) * 4000, y: 280 + (r() - 0.5) * 4000 };
    if (!water(g.x, g.y) || shore(g.x, g.y) > 14) continue;
    const ang = r() * 6.28, a = { x: g.x + Math.cos(ang) * 400, y: g.y + Math.sin(ang) * 400 };
    if (heightAt(a.x, a.y) > -0.2) continue;
    const plan = planRoute(a, g, 12);
    if (!plan) continue;
    n++;
    if (Math.hypot(plan.end.x - g.x, plan.end.y - g.y) < 30) near++;
  }
  expect(n).toBeGreaterThan(15);
  expect(near / n).toBeGreaterThan(0.9);
});

test('a long route never crosses land between its dots', () => {
  let s = 19, n = 0;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 4000 && n < 12; t++) {
    const a = { x: (r() - 0.5) * 9000, y: (r() - 0.5) * 9000 }, ang = r() * 6.28, b = { x: a.x + Math.cos(ang) * 7000, y: a.y + Math.sin(ang) * 7000 };
    if (heightAt(a.x, a.y) > -0.15 || heightAt(b.x, b.y) > -0.15 || clearLine(a, b)) continue;
    const plan = planRoute(a, b, 12);
    if (!plan) continue;
    n++;
    let prev: Point = a;
    for (const p of plan.pts) {
      const m = Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 2);
      for (let k = 1; k <= m; k++) expect(heightAt(prev.x + (p.x - prev.x) * k / m, prev.y + (p.y - prev.y) * k / m)).toBeLessThan(-0.045);
      prev = p;
    }
  }
  expect(n).toBeGreaterThan(8);
}, 60_000);
