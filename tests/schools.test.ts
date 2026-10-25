// Schools move on the game clock: rare roamers travel loops and hotspot clusters drift while they're up. Wherever
// they go, their home must stay over open water, or their fish are dragged across islands.
import { describe, expect, test } from 'bun:test';
import { heightAt, schoolsNear, tickHotspots } from '../src/world';
import { SPECIES } from '../src/species';

describe('moving schools', () => {
  test('roamers and drifting hotspots keep their homes over open water, and roamers are swimmers', () => {
    let roamers = 0, drifted = 0;
    const start = new Map<string, [number, number]>();
    for (let t = 0; t <= 3600; t += 45) {
      tickHotspots(t);
      for (let x = -2800; x <= 2800; x += 1400) for (let y = -2800; y <= 2800; y += 1400) for (const s of schoolsNear(x, y, 700)) {
        if (s.boss || s.stock <= 0 || s.spooked !== undefined) continue;
        const roam = s.id.startsWith('r:');
        if (roam) { roamers++; expect(['crawler', 'bottom', 'bait']).not.toContain(SPECIES[s.sp].role); }
        else if (!s.id.startsWith('h:')) continue;
        const key = `${s.id}|${s.sp}`, p0 = start.get(key) ?? start.set(key, [s.x, s.y]).get(key)!;
        if (!roam && Math.hypot(s.x - p0[0], s.y - p0[1]) > 20) drifted++;
        expect(heightAt(s.x, s.y)).toBeLessThan(roam ? -0.2 : -0.09);
      }
    }
    expect(roamers).toBeGreaterThan(30);
    expect(drifted).toBeGreaterThan(30);
  }, 30_000);
});
