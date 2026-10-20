// Saves, contracts and island purchases point at landmarks by id and at islands by cell, so the terrain may change
// its looks but never these: every port, lighthouse and wreck within 7 cells of home keeps its id, name and spot,
// every claimable island keeps its centre, and in the live terrain piers still reach water, lights stand on land and
// wrecks lie in the sea. The fixture was recorded from the world before coves, headlands and mountains.
import { describe, expect, test } from 'bun:test';
import { cellPois, claimableNear, heightAt } from '../src/world';
import fixture from './fixtures/landmarks.json';

const R = 7;
const live = new Map<string, ReturnType<typeof cellPois>[number]>();
for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) for (const p of cellPois(i, j)) live.set(p.id, p);

describe('landmarks', () => {
  test('every landmark keeps its id, name and spot', () => {
    const pinned = Object.entries(fixture.pois as Record<string, [string, string, number, number]>);
    expect(live.size).toBe(pinned.length);
    for (const [id, [, name, x, y]] of pinned) {
      const p = live.get(id);
      expect(p, id).toBeDefined();
      expect(p!.name).toBe(name);
      expect(Math.hypot(Math.round(p!.x) - x, Math.round(p!.y) - y)).toBeLessThan(2);
    }
  });
  test('every claimable island keeps its centre', () => {
    const now = new Map(claimableNear(280, 280, R * 560 + 280).map(c => [c.key, [Math.round(c.x), Math.round(c.y)]]));
    for (const [key, x, y] of fixture.claims as [string, number, number][]) expect(now.get(key), key).toEqual([x, y]);
  });
  test('piers reach open water, lights stand on land, wrecks lie in the sea', () => {
    const bad: string[] = [];
    for (const p of live.values()) {
      if (p.type === 'port' && (heightAt(p.dock.x, p.dock.y) > -0.05 || heightAt(p.end.x, p.end.y) > 0)) bad.push(p.id);
      if (p.type === 'light' && heightAt(p.x, p.y) < 0.02) bad.push(p.id);
      if (p.type === 'wreck' && heightAt(p.x, p.y) > -0.04) bad.push(p.id);
    }
    expect(bad).toEqual([]);
  });
});
