import { describe, expect, test } from 'bun:test';
import { SPECIES, SP } from '../src/econ';
import { biomeMix } from '../src/biome';
import { cellPois, schoolsNear } from '../src/world';

// the hold, contracts and port prices store species by index, so the original 43 must never move
const ORIGINAL = ['anchovy', 'sardine', 'mullet', 'flounder', 'mackerel', 'herring', 'crab', 'squid', 'rtrout', 'cod', 'duskfin', 'lantern',
  'stormeel', 'tuna', 'opah', 'marlin', 'swordfish', 'perch', 'bass', 'halibut', 'salmon', 'char', 'pollock', 'wolffish', 'monkfish', 'puffer',
  'parrot', 'angel', 'barracuda', 'mahi', 'sailfish', 'moray', 'grouper', 'beacon', 'ghost', 'oarfish', 'crystal', 'goldmahi', 'oldone', 'manta',
  'goliath', 'gsquid', 'sunfish'];
const HABITAT: Record<string, 'reef' | 'kelp' | 'volcanic'> = {
  clown: 'reef', tang: 'reef', lionfish: 'reef', octopus: 'reef', reefshark: 'reef',
  rockfish: 'kelp', opaleye: 'kelp', kelpbass: 'kelp', lingcod: 'kelp', seabassgiant: 'kelp',
  embersnap: 'volcanic', ventcrab: 'volcanic', blackgrouper: 'volcanic', cindereel: 'volcanic',
};

describe('species catalogue', () => {
  test('ids are unique and the original species keep their places', () => {
    expect(new Set(SPECIES.map(s => s.id)).size).toBe(SPECIES.length);
    expect(SPECIES.slice(0, ORIGINAL.length).map(s => s.id)).toEqual(ORIGINAL);
  });
  test('home waters keep their everyday fish and no biome fish', () => {
    const ids = new Set(schoolsNear(280, 280, 450).map(s => SPECIES[s.sp].id));
    for (const id of ['anchovy', 'mackerel', 'perch', 'flounder']) expect(ids.has(id)).toBe(true);
    for (const id of Object.keys(HABITAT)) expect(ids.has(id)).toBe(false);
  });
  test('biome fish only swim where their biome is strong', () => {
    // a school settles a few steps from where it was picked, so one right on a border may end up just outside it
    let seen = 0, inside = 0;
    for (let x = -3000; x <= 3600; x += 600) for (let y = -2400; y <= 3600; y += 600) {
      for (const s of schoolsNear(x, y, 300)) {
        const hab = HABITAT[SPECIES[s.sp].id];
        if (!hab) continue;
        seen++;
        if (biomeMix(s.x, s.y)[hab] >= 0.35) inside++;
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(inside / seen).toBeGreaterThan(0.95);
  });
});

describe('ports', () => {
  test("adding species doesn't reshuffle existing ports (values from before biomes)", () => {
    const home = cellPois(0, 0).find(p => p.type === 'port');
    const pen = cellPois(-2, 1).find(p => p.type === 'port');
    if (home?.type !== 'port' || pen?.type !== 'port') throw new Error('ports moved');
    expect(home.shipyard).toBe(true);
    expect(home.mult[SP.anchovy]).toBeCloseTo(1.247025, 5);
    expect(home.mult[SP.perch]).toBeCloseTo(0.764456, 5);
    expect(home.mult[SP.sunfish]).toBeCloseTo(1.409969, 5);
    expect(pen.name).toBe('Penstead');
    expect(pen.shipyard).toBe(false);
    expect(pen.mult[SP.anchovy]).toBeCloseTo(0.815735, 5);
    for (const id of Object.keys(HABITAT)) { expect(home.mult[SP[id]]).toBeGreaterThanOrEqual(0.75); expect(home.mult[SP[id]]).toBeLessThan(1.45); }
  });
});
