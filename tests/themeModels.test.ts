// The island themes place these models by name, many times over: every name must build, stay within its voxel
// budget, and have nothing hanging in the air (all voxels connected to the ground), bar a cherry's drifting petals.
import { describe, expect, test } from 'bun:test';
import { TREE_BUILD, TREE_KINDS, PROP_BUILD, PROP_KINDS, PROP_Z, LEGEND_BUILD, LEGEND_KINDS, LEGEND_Z, VILLAGE_THEMES, villageVox } from '../src/gl/meshes';
import type { Vox } from '../src/voxel';

/** Voxels not joined (26-connected) to the bottom layer. */
function floating(V: Vox): number {
  const seen = new Set<number>(), stack: number[][] = [], key = (u: number, v: number, z: number) => V.idx(u, v, z);
  let n = 0;
  V.each((u, v, z) => { n++; if (z === 0) { seen.add(key(u, v, z)); stack.push([u, v, z]); } });
  while (stack.length) {
    const [u, v, z] = stack.pop()!;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if (!V.inb(u + a, v + b, z + c) || !V.get(u + a, v + b, z + c) || seen.has(key(u + a, v + b, z + c))) continue;
      seen.add(key(u + a, v + b, z + c)); stack.push([u + a, v + b, z + c]);
    }
  }
  return n - seen.size;
}
const count = (V: Vox) => { let n = 0; V.each(() => n++); return n; };
const THEME_TREES = TREE_KINDS.slice(TREE_KINDS.indexOf('blossom'));
const PETALS: Record<string, number> = { blossom: 1, blossomB: 2 };

describe('island-theme models', () => {
  test('the contract names exist', () => {
    expect(THEME_TREES).toEqual(['blossom', 'blossomB', 'maple', 'mapleB', 'birchW', 'willow', 'bamboo', 'mushroom', 'mushroomB', 'sunflower', 'lavender', 'reeds', 'snag', 'cactus']);
    expect(TREE_KINDS).toContain('deadtree');
    expect(Object.keys(PROP_Z).sort()).toEqual([...PROP_KINDS].sort());
    expect(Object.keys(LEGEND_Z).sort()).toEqual([...LEGEND_KINDS].sort());
  });
  test('trees and props are small, grounded and within budget', () => {
    for (const k of THEME_TREES) { const V = TREE_BUILD[k](); expect(count(V), k).toBeLessThan(800); expect(floating(V), k).toBe(PETALS[k] ?? 0); }
    for (const k of PROP_KINDS) { const V = PROP_BUILD[k](); expect(count(V), k).toBeGreaterThan(40); expect(count(V), k).toBeLessThan(3000); expect(floating(V), k).toBe(0); }
  });
  test('every theme gets a grounded village, and an unknown theme the default one', () => {
    for (const t of VILLAGE_THEMES) { const V = villageVox(t); expect(count(V), t).toBeLessThan(5000); expect(floating(V), t).toBe(0); }
    expect(count(villageVox('nowhere'))).toBe(count(villageVox('pine')));
  });
  test('legends are grounded set pieces', () => {
    for (const k of LEGEND_KINDS) { const V = LEGEND_BUILD[k](); expect(count(V), k).toBeGreaterThan(500); expect(floating(V), k).toBe(0); }
  });
});
