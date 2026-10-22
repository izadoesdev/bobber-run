import { describe, expect, test } from 'bun:test';
import { claimableNear } from '../src/world';
import { THEMES, THEME_IDS, biomeMix, coldness, warmth, islandTheme, regionAt, themeAt, themeHold, type ThemeHold, type ThemeId } from '../src/biome';
import { atmosAt } from '../src/weather';
import type { Atmos } from '../src/biome';
import * as MS from '../src/gl/meshes';

const HOME = { x: 280, y: 280 };
const islands = claimableNear(HOME.x, HOME.y, 4200);
const hold = (): ThemeHold => ({ theme: 'home', w: 0, jitter: 0 });
const air = (): Atmos => ({ fog: 0, haze: 0, snow: 0, ash: 0, leaves: 0, petals: 0, spores: 0, fireflies: 0 });

describe('island themes', () => {
  test('every theme is a complete record the shader and chart can read', () => {
    for (const id of THEME_IDS) {
      const T = THEMES[id];
      for (const c of [T.wet, T.sand, T.sand2, T.grass, T.grass2, T.forest, T.rock, T.cliff, T.cliff2, T.accent, T.shallow, T.mid, T.deep])
        for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      for (const v of [T.patch, T.flowers, T.speckle, T.rockAt, T.snow, T.outcrops, T.glow, T.clarity, T.altBeach, T.bands]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      for (const [, w] of [...T.shore, ...T.low, ...T.high, ...T.land, ...T.sea]) expect(w).toBeGreaterThan(0);
    }
    expect(THEME_IDS.length).toBeLessThanOrEqual(255);             // one byte per texel holds the theme row
  });
  test('Alderhaven keeps the plain home look', () => {
    expect(islandTheme(HOME.x, HOME.y)).toBe('home');
    expect(themeAt(HOME.x, HOME.y)).toBe('home');
    expect(themeHold(HOME.x, HOME.y + 40, islands, hold()).w).toBe(0);
  });
  test('the world shows every theme, and none dominates', () => {
    const count = new Map<ThemeId, number>(), wide = claimableNear(HOME.x, HOME.y, 7000);
    for (const c of wide) count.set(islandTheme(c.x, c.y), (count.get(islandTheme(c.x, c.y)) ?? 0) + 1);
    expect(count.size).toBe(THEME_IDS.length);
    for (const n of count.values()) expect(n / wide.length).toBeLessThan(0.25);
  });
  // the same measure as scripts/probes/scatter.ts: islands read as regions, not a scatter
  test('neighbouring islands share a region: same theme, same climate, and no ice next to sand or fire', () => {
    const FAM: Record<string, string> = { home: 'T', meadow: 'T', blossom: 'T', autumn: 'T', pine: 'T', birch: 'T', bog: 'T', chalk: 'T',
      dunes: 'W', mesa: 'W', bamboo: 'W', atoll: 'W', fjord: 'C', glacier: 'C', basalt: 'V', blacksand: 'V', fungal: 'V', mangrove: 'M' };
    const isl = claimableNear(0, 0, 4500).map(c => ({ x: c.x, y: c.y, t: islandTheme(c.x, c.y) }));
    let pairs = 0, same = 0, fam = 0;
    const clash = new Set<string>();
    for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) {
      const a = isl[i], b = isl[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 700) continue;
      pairs++; if (a.t === b.t) same++;
      if (FAM[a.t] === FAM[b.t]) fam++; else clash.add([FAM[a.t], FAM[b.t]].sort().join(''));
    }
    expect(same / pairs).toBeGreaterThanOrEqual(0.65);
    expect(fam / pairs).toBeGreaterThanOrEqual(0.9);
    for (const k of ['CW', 'CV', 'VW']) expect(clash.has(k), k).toBe(false);
  });
  test('themes follow latitude: no glaciers in the south, no deserts or atolls in the far north', () => {
    for (const c of islands) {
      const t = islandTheme(c.x, c.y);
      if (c.y > 2600) expect(['glacier', 'fjord', 'basalt']).not.toContain(t);
      if (c.y < -2400) expect(['atoll', 'dunes', 'mesa', 'bamboo', 'mangrove']).not.toContain(t);
    }
  });
  test('two themes never meet edge to edge: where the theme changes, its weight is near zero', () => {
    let flips = 0;
    for (let y = -3000; y <= 3000; y += 37) {
      let prev: ThemeHold | null = null;
      for (let x = -3000; x <= 3000; x += 3) {
        const h = themeHold(x, y, claimableNear(x, y, 460), hold());
        if (prev && prev.theme !== h.theme) { flips++; expect(Math.max(prev.w, h.w)).toBeLessThan(0.12); }
        prev = h;
      }
    }
    expect(flips).toBeGreaterThan(20);
  });
});

describe('regions', () => {
  test('home sits in Alderhaven Reach; every region in reach has a name, a theme and a biome', () => {
    const home = regionAt(HOME.x, HOME.y);
    expect(home.name).toBe('Alderhaven Reach');
    expect(home.biome).toBe('home');
    const names = new Set<string>();
    for (let x = -4000; x <= 4500; x += 250) for (let y = -4000; y <= 4500; y += 250) {
      const r = regionAt(x, y);
      expect(THEMES[r.theme]).toBeDefined();
      names.add(r.id + r.name);
    }
    expect(new Set([...names].map(n => n.replace(/^[-0-9:]+/, ''))).size).toBe(names.size);   // no two regions in reach share a name
  });
  test('the ember isles keep to the temperate middle: never in cold or warm water', () => {
    for (let x = -6000; x <= 6000; x += 97) for (let y = -6000; y <= 6000; y += 97)
      if (biomeMix(x, y).volcanic > 0.05) { expect(coldness(y)).toBeLessThan(0.35); expect(warmth(y)).toBeLessThan(0.35); }
  });
});

describe('atmosphere', () => {
  test('stays in range everywhere', () => {
    const a = air();
    for (let x = -3000; x <= 3000; x += 500) for (let y = -3500; y <= 3500; y += 500) {
      atmosAt(x, y, a);
      for (const v of Object.values(a)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
  test('the far north snows, the home waters are clear, and each island carries its theme’s air', () => {
    expect(atmosAt(HOME.x, HOME.y - 300, air()).snow).toBe(0);
    expect(atmosAt(HOME.x, -3200, air()).snow).toBeGreaterThan(0.4);
    for (const c of islands) {
      const t = islandTheme(c.x, c.y), a = atmosAt(c.x, c.y, air());
      if (t === 'blossom') expect(a.petals).toBeGreaterThan(0.8);
      if (t === 'fungal') expect(a.spores).toBeGreaterThan(0.8);
      if (t === 'bog') expect(a.fog).toBeGreaterThan(0.6);
    }
  });
});

describe('theme data matches the meshes', () => {
  test('every tree and prop a theme names is a mesh the renderer can draw', () => {
    const trees = new Set<string>(MS.TREE_KINDS), props = new Set<string>(MS.PROP_KINDS);
    for (const id of THEME_IDS) {
      const T = THEMES[id];
      for (const [k] of [...T.shore, ...T.low, ...T.high]) expect(trees.has(k), `${id} grows ${k}`).toBe(true);
      for (const [k] of [...T.land, ...T.sea]) expect(props.has(k), `${id} places ${k}`).toBe(true);
    }
  });
});
