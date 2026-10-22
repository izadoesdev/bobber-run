// Saves, contracts and island purchases point at landmarks by id and at islands by cell, so within one world layout
// these never change: every port, lighthouse and wreck within 7 cells of home keeps its id, name and spot, and every
// claimable island its centre; and piers reach water, lights stand on land, wrecks lie in the sea. Changing the world
// on purpose means bumping WORLD in world.ts (older saves then forget places) and re-recording the fixture with it.
import { describe, expect, test } from 'bun:test';
import { WORLD, cellPois, claimableNear, heightAt, homesteadSite, regionSites } from '../src/world';
import fixture from './fixtures/landmarks.json';

const R = 7;
const live = new Map<string, ReturnType<typeof cellPois>[number]>();
for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) for (const p of cellPois(i, j)) live.set(p.id, p);

describe('landmarks', () => {
  test('the fixture belongs to the current world version', () => {
    expect(fixture.world).toBe(WORLD);
  });
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
  test("an owned island's homestead stands on its own land, clear of harbours and lighthouses", () => {
    const claims = claimableNear(280, 280, R * 560 + 280), bad: string[] = [];
    let placed = 0;
    for (const c of claims) {
      const s = homesteadSite(c);
      if (!s) continue;
      placed++;
      if (heightAt(s.x, s.y) < 0.05 || heightAt(s.x - 13, s.y - 3) < 0.05 || Math.hypot(s.x - c.x, s.y - c.y) > c.R) bad.push(c.key);
      for (const p of live.values()) if (p.type !== 'wreck' && Math.hypot(p.x - s.x, p.y - s.y) < 40) bad.push(`${c.key} by ${p.id}`);
    }
    expect(bad).toEqual([]);
    expect(placed / claims.length).toBeGreaterThan(0.97);       // nearly every island has room for one
  });
  test('every region has its village and every legend its spot, clear of harbours and lighthouses', () => {
    const s = regionSites(), bad: string[] = [];
    expect(s.map(x => x.id).sort()).toEqual(['cold-village', 'kelp-village', 'legend-crystalCave', 'legend-iceboundShip', 'legend-stoneCircle',
      'legend-sunkenTemple', 'legend-whaleFall', 'legend-wreckGraveyard', 'mangrove-village', 'reef-village', 'volcanic-village', 'warm-village']);
    for (const x of s) {
      const h = heightAt(x.x, x.y);
      if (x.kind === 'village' && h < 0.05) bad.push(`${x.id} in the water`);
      for (const p of live.values()) if (p.type !== 'wreck' && Math.hypot(p.x - x.x, p.y - x.y) < 80) bad.push(`${x.id} by ${p.id}`);
    }
    expect(bad).toEqual([]);
  });
});
