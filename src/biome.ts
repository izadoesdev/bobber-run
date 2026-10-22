// Regions: the sea is divided into large named regions, a few thousand units across, laid out in latitude bands so the
// climate runs smoothly from the ice of the far north through the temperate middle to the warm south. Each region has
// a biome (coral shallows, kelp coast, ember isles, mangroves, or none) and a family of island themes (see below);
// ember isles keep to the temperate middle, so they never touch ice or the warm south. Latitude also sets warm and cold
// water for the fish. Home waters stay plain.
import { createNoise2D } from 'simplex-noise';
import Alea from 'alea';
import { clamp, smooth01 } from './config';
import { hash01 } from './noise';

// latitude: home waters are temperate, the far north is cold, the far south warm
export const warmth = (y: number): number => clamp((y - 1500) / 1000, 0, 1);
export const coldness = (y: number): number => clamp((-y - 1300) / 1000, 0, 1);

/** Each biome's strength at a point, 0..1; together at most 1, and what's left over is plain temperate water. */
export interface BiomeMix { reef: number; kelp: number; volcanic: number; mangrove: number }
export type BiomeId = 'home' | 'reef' | 'kelp' | 'volcanic' | 'mangrove' | 'warm' | 'cold' | 'open';

const nBio = createNoise2D(Alea('bobber-run', 'biome'));
const HOME = { x: 280, y: 280 };

// ---------- regions ----------
type Mixed = keyof BiomeMix;
/** A kind of region: its name, dominant island theme, the related themes that turn up in it, and its biome. */
interface Template { name: string; theme: ThemeId; related: readonly ThemeId[]; biome: BiomeId }
const tpl = (name: string, theme: ThemeId, related: ThemeId[], biome: BiomeId): Template => ({ name, theme, related, biome });
const GLACIER = tpl('Glacier Sound', 'glacier', ['fjord'], 'cold'), FROZEN = tpl('Frozen Reach', 'glacier', ['fjord'], 'cold');
const FJORDS = tpl('Fjordlands', 'fjord', ['glacier', 'birch'], 'kelp');
const PINES = tpl('Pinewood Isles', 'pine', ['birch', 'autumn'], 'kelp'), BIRCHES = tpl('Birchholm', 'birch', ['pine', 'autumn'], 'open');
const CHALK = tpl('Chalk Downs', 'chalk', ['meadow', 'pine'], 'kelp'), BOG = tpl('Bogmoor', 'bog', ['pine', 'birch'], 'open');
const ALDER = tpl('Alderhaven Reach', 'meadow', ['blossom', 'autumn'], 'home'), AMBER = tpl('Amber Isles', 'autumn', ['meadow', 'pine'], 'open');
const EMBER = tpl('Ember Reach', 'blacksand', ['basalt', 'fungal'], 'volcanic'), BASALT = tpl('Basalt Shelf', 'basalt', ['blacksand'], 'volcanic'), FUNGAL = tpl('Fungal Hollows', 'fungal', ['basalt', 'bog'], 'volcanic');
const BLOSSOM = tpl('Blossom Coast', 'blossom', ['meadow', 'autumn'], 'reef'), MEADOW = tpl('Meadowmere', 'meadow', ['blossom', 'chalk'], 'open');
const MANGROVE = tpl('Mangrove Channels', 'mangrove', ['bog'], 'mangrove'), DELTA = tpl('Mangrove Delta', 'mangrove', ['bamboo'], 'mangrove');
const ATOLLS = tpl('Sunlit Atolls', 'atoll', ['dunes', 'bamboo'], 'reef'), DUNES = tpl('Dune Coast', 'dunes', ['mesa', 'atoll'], 'warm');
const MESAS = tpl('Red Mesas', 'mesa', ['dunes'], 'warm'), BAMBOO = tpl('Bamboo Reach', 'bamboo', ['atoll', 'mangrove'], 'reef');
/**
 * The bands, north to south: where each ends (y), how wide its regions run, and the kinds of region along it, in
 * order (a region k along the band takes kinds[k mod n], so neighbours differ). The middle band holds Alderhaven
 * (its region 0) and the ember isles; it touches only temperate bands.
 */
const BANDS: { y1: number; w: number; kinds: Template[] }[] = [
  { y1: -5200, w: 3000, kinds: [FROZEN, GLACIER] },
  { y1: -3200, w: 3200, kinds: [GLACIER, FJORDS, GLACIER, FJORDS, FJORDS] },
  { y1: -1150, w: 3200, kinds: [PINES, BIRCHES, CHALK, PINES, BOG] },
  { y1: 750, w: 3200, kinds: [ALDER, AMBER, FUNGAL, BLOSSOM, BASALT, EMBER] },
  { y1: 2600, w: 3200, kinds: [MEADOW, CHALK, MANGROVE, MEADOW, BLOSSOM] },
  { y1: 5200, w: 3200, kinds: [ATOLLS, MESAS, BAMBOO, DUNES, ATOLLS, DELTA] },
  { y1: Infinity, w: 3000, kinds: [DUNES, ATOLLS, MESAS] },
];
/** A named region. */
export interface Region { id: string; name: string; theme: ThemeId; related: readonly ThemeId[]; biome: BiomeId; centre: { x: number; y: number } }
const regions = new Map<number, Region>();
const bandTop = (b: number): number => b === 0 ? -Infinity : BANDS[b - 1].y1;
// band edges and region edges wander, so no border runs ruler-straight
const wobbleY = (x: number): number => 200 * nBio(x / 1900, 7.7);
const wobbleX = (y: number): number => 300 * nBio(3.3, y / 1700);
/** Where region k of band b is centred along it: Alderhaven's region sits on home, the rest jittered. */
const seedX = (b: number, k: number): number => HOME.x + k * BANDS[b].w + (k ? (hash01(b, k, 301) - 0.5) * 0.5 * BANDS[b].w : 0);
const kindOf = (b: number, k: number): Template => { const L = BANDS[b].kinds; return L[((k % L.length) + L.length) % L.length]; };
function region(b: number, k: number): Region {
  const key = b * 100000 + k;
  let r = regions.get(key);
  if (r) return r;
  const T = kindOf(b, k), top = Math.max(bandTop(b), -6000), bot = Math.min(BANDS[b].y1, 6000);
  // the regions in reach go by their plain name; a twin across home, or one far along the band, says which way it lies
  const side = k < 0 ? 'West ' : 'East ', name = (Math.abs(k) >= 2 ? 'Far ' + side : k && kindOf(b, -k) === T ? side : '') + T.name;
  r = { id: `${b}:${k}`, name, theme: T.theme, related: T.related, biome: T.biome, centre: { x: seedX(b, k), y: (top + bot) / 2 } };
  regions.set(key, r);
  return r;
}
/** Where a point lies: its band and region along it, and the nearest border: how far, and the region across it. */
interface Place { band: number; k: number; edge: number; nb: number; nk: number }
const place: Place = { band: 0, k: 0, edge: 0, nb: 0, nk: 0 };
const cell = { k: 0, side: 0, across: 0 };
/** Region index along band b at x (the nearest seed), how far its side edge is, and the region past that edge. */
function cellIn(b: number, x: number): typeof cell {
  const k0 = Math.round((x - HOME.x) / BANDS[b].w);
  let d1 = Infinity, d2 = Infinity;
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const d = Math.abs(x - seedX(b, k));
    if (d < d1) { cell.across = cell.k; d2 = d1; cell.k = k; d1 = d; } else if (d < d2) { cell.across = k; d2 = d; }
  }
  cell.side = (d2 - d1) / 2;
  return cell;
}
function locate(x: number, y: number): Place {
  const yy = y + wobbleY(x), xx = x + wobbleX(y);
  let b = 0;
  while (yy >= BANDS[b].y1) b++;
  const c = cellIn(b, xx), up = yy - bandTop(b), down = BANDS[b].y1 - yy;
  place.band = b; place.k = c.k; place.edge = c.side; place.nb = b; place.nk = c.across;
  if (up < place.edge) { place.edge = up; place.nb = b - 1; place.nk = cellIn(b - 1, xx).k; }
  if (down < place.edge) { place.edge = down; place.nb = b + 1; place.nk = cellIn(b + 1, xx).k; }
  return place;
}
/** The named region at (x, y): for chart names, the entry banner, and everything that varies by region. */
export function regionAt(x: number, y: number): Region { const p = locate(x, y); return region(p.band, p.k); }

/**
 * The volcanic weight of the biome field before regions (the slow noise blobs), kept only so world.ts can keep its
 * volcano relief, and with it heightAt, exactly as it was. Nothing else should read it.
 */
export function legacyVolcanic(x: number, y: number): number {
  const d = Math.hypot(x - HOME.x, y - HOME.y), away = smooth01((d - 650) / 550), F = 1 / 1500;
  if (away <= 0) return 0;
  const wm = warmth(y), cd = coldness(y), lead = (m: number, ...o: number[]): number => smooth01(m) * smooth01((m - Math.max(...o)) * 1.5 + 0.5);
  const a = nBio(x * F, y * F), b = nBio(x * F + 57.3, y * F - 19.1), c = nBio(x * F * 1.1 - 91.4, y * F * 1.1 + 33.8), e = nBio(x * F * 1.3 + 140.2, y * F * 1.3 - 77.7);
  const south = smooth01((y - 700) / 600) * (1 - smooth01((y - 3200) / 800));
  const mr = (a - 0.28 + 0.3 * wm - 2 * cd) / 0.18, mk = (b - 0.28 + 0.2 * cd - 0.3 * wm) / 0.18 - cd, mv = (c - 0.36) / 0.18 - 2 * cd, mm = (e - 0.2) / 0.18 * south - 2 * (1 - south);
  const reef = lead(mr, mk, mv, mm), kelp = lead(mk, mr, mv, mm), volcanic = lead(mv, mr, mk, mm), mangrove = lead(mm, mr, mk, mv);
  return volcanic * away / Math.max(1, reef + kelp + volcanic + mangrove);
}

// Each island belongs to one region: around an island the field is read at its centre, so no island is half coral
// and half ash. world.ts registers how to find that island (it imports this file, so this one can't import it).
type Anchor = (x: number, y: number) => { x: number; y: number; w: number } | null;
let anchor: Anchor = () => null;
export function setBiomeAnchor(f: Anchor): void { anchor = f; }

export function biomeMix(x: number, y: number): BiomeMix {
  const at = anchor(x, y);
  if (at) { x += (at.x - x) * at.w; y += (at.y - y) * at.w; }
  return fieldMix(x, y);
}
const BLEND = 220;                                          // biomes blend over this far either side of a region border
function fieldMix(x: number, y: number): BiomeMix {
  const m = { reef: 0, kelp: 0, volcanic: 0, mangrove: 0 };
  const d = Math.hypot(x - HOME.x, y - HOME.y), away = smooth01((d - 650) / 550);
  if (away <= 0) return m;
  const p = locate(x, y), own = region(p.band, p.k).biome, across = region(p.nb, p.nk).biome, t = 0.5 + 0.5 * smooth01(p.edge / BLEND);
  if (own in m) m[own as Mixed] += t * away;
  if (across in m) m[across as Mixed] += (1 - t) * away;
  return m;
}

/** The region a point belongs to, for names, species and sea life. */
export function biomeAt(x: number, y: number): BiomeId {
  const m = biomeMix(x, y);
  if (m.reef > 0.5) return 'reef';
  if (m.kelp > 0.5) return 'kelp';
  if (m.volcanic > 0.5) return 'volcanic';
  if (m.mangrove > 0.5) return 'mangrove';
  if (coldness(y) > 0.5) return 'cold';
  if (warmth(y) > 0.5) return 'warm';
  return Math.hypot(x - HOME.x, y - HOME.y) < 1100 ? 'home' : 'open';
}

export const BIOME_NAME: Record<BiomeId, string> = {
  home: 'Alderhaven waters', reef: 'Coral shallows', kelp: 'Kelp coast', volcanic: 'Ember isles', mangrove: 'Mangrove channels',
  warm: 'Southern seas', cold: 'Ice floes', open: 'Open coast',
};

// ---------- island themes ----------
// Every main island gets one theme, mostly its region's (see islandTheme), and a whole island (and the islets that
// ring it) shares one look. A theme is data: ground and water
// colours for the ground shader and the chart, what grows there, what stands on its shores, and its air. Alderhaven
// keeps the plain home look. Adding a theme is adding a record here.
export type ThemeId = 'home' | 'meadow' | 'pine' | 'blossom' | 'autumn' | 'birch' | 'bog' | 'chalk' | 'bamboo' | 'atoll' | 'dunes'
  | 'mesa' | 'basalt' | 'blacksand' | 'fungal' | 'fjord' | 'glacier' | 'mangrove';
type RGB = readonly [number, number, number];
/** What grows or stands somewhere, with relative odds; kinds a mesh set lacks are swapped or skipped by the renderer. */
export type Odds = readonly (readonly [string, number])[];
/** Ambient effects, each 0..1. */
export interface Atmos { fog: number; haze: number; snow: number; ash: number; leaves: number; petals: number; spores: number; fireflies: number }
export interface Theme {
  name: string;
  /** ground colours: wet sand, beach, the other beach (speckle and whole stretches), grass, its patches, forest floor, rock, cliff strata, flowers */
  wet: RGB; sand: RGB; sand2: RGB; grass: RGB; grass2: RGB; forest: RGB; rock: RGB; cliff: RGB; cliff2: RGB; accent: RGB;
  /** water around the island, shallow to deep */
  shallow: RGB; mid: RGB; deep: RGB;
  /** shape of the ground: extra beach width, grass2 patch share, flower density, sand2 speckle share */
  beach: number; patch: number; flowers: number; speckle: number;
  /** where bare rock starts (height), snow cover, rocky outcrops in the grass, night glow of the flowers */
  rockAt: number; snow: number; outcrops: number; glow: number;
  /** water clarity (0.5 as home), share of coast beached in sand2, cliff strata strength */
  clarity: number; altBeach: number; bands: number;
  /** vegetation per height band (shore, lowland, upland) with the chance a spot holds anything */
  shore: Odds; shoreD: number; low: Odds; lowD: number; high: Odds; highD: number;
  /** props on land and in the water round it, with the chance per spot */
  land: Odds; landD: number; sea: Odds; seaD: number;
  atmos: Partial<Atmos>;
}
const c3 = (r: number, g: number, b: number): RGB => [r, g, b];
// the common water of temperate islands
const W_T = { shallow: c3(.34, .66, .70), mid: c3(.17, .43, .55), deep: c3(.07, .22, .35) };
const BASE = { beach: 0, patch: 0.3, flowers: 0.015, speckle: 0, rockAt: 0.72, snow: 0, outcrops: 0, glow: 0, clarity: 0.5, altBeach: 0.15, bands: 0.5,
  shore: [] as Odds, shoreD: 0, land: [] as Odds, landD: 0, sea: [] as Odds, seaD: 0, atmos: {} };
export const THEMES: Record<ThemeId, Theme> = {
  home: { ...BASE, name: 'Home', wet: c3(.66, .58, .42), sand: c3(.88, .79, .57), sand2: c3(.67, .63, .56), grass: c3(.45, .61, .29), grass2: c3(.66, .64, .36),
    forest: c3(.24, .38, .21), rock: c3(.52, .55, .58), cliff: c3(.50, .47, .43), cliff2: c3(.62, .58, .52), accent: c3(.98, .82, .30), ...W_T,
    low: [['round', 2], ['bush', 2], ['berrybush', 1]], lowD: 0.17, high: [['pine', 2], ['round', 1]], highD: 0.72 },
  meadow: { ...BASE, name: 'Meadow', wet: c3(.62, .57, .42), sand: c3(.90, .82, .60), sand2: c3(.80, .76, .66), grass: c3(.50, .68, .30), grass2: c3(.64, .74, .32),
    forest: c3(.27, .45, .22), rock: c3(.56, .57, .56), cliff: c3(.55, .50, .44), cliff2: c3(.66, .61, .53), accent: c3(.97, .86, .35),
    shallow: c3(.32, .70, .70), mid: c3(.15, .46, .56), deep: c3(.06, .23, .36),
    beach: 0.02, patch: 0.5, flowers: 0.07, speckle: 0.15, outcrops: 0.15,
    low: [['round', 3], ['bush', 3], ['berrybush', 2], ['sunflower', 3], ['lavender', 2]], lowD: 0.13,
    high: [['round', 4], ['roundB', 2], ['pine', 1], ['blossom', 1]], highD: 0.45,
    land: [['standingStones', 1], ['hut', 1]], landD: 0.25, sea: [['log', 1]], seaD: 0.03, atmos: { fireflies: 0.6, petals: 0.15 } },
  pine: { ...BASE, name: 'Pinewood', wet: c3(.52, .50, .44), sand: c3(.72, .67, .56), sand2: c3(.56, .55, .52), grass: c3(.34, .48, .27), grass2: c3(.46, .38, .24),
    forest: c3(.17, .29, .18), rock: c3(.55, .56, .58), cliff: c3(.50, .50, .50), cliff2: c3(.63, .63, .62), accent: c3(.88, .90, .94),
    shallow: c3(.28, .56, .58), mid: c3(.12, .36, .44), deep: c3(.05, .18, .27),
    beach: -0.02, patch: 0.45, flowers: 0.01, speckle: 0.5, rockAt: 0.66, outcrops: 0.45, clarity: 0.4, altBeach: 0.35, bands: 0.3,
    shore: [['boulders', 1]], shoreD: 0.03, low: [['pine', 4], ['fern', 2], ['bush', 1], ['rock', 1]], lowD: 0.22,
    high: [['pine', 5], ['pineB', 3], ['round', 1]], highD: 0.82,
    land: [['log', 3], ['hut', 1], ['totem', 1]], landD: 0.35, sea: [['log', 2], ['weedMat', 1]], seaD: 0.09, atmos: { fog: 0.25 } },
  blossom: { ...BASE, name: 'Blossom', wet: c3(.66, .60, .48), sand: c3(.93, .86, .70), sand2: c3(.94, .80, .78), grass: c3(.54, .71, .38), grass2: c3(.86, .68, .72),
    forest: c3(.36, .50, .30), rock: c3(.62, .60, .60), cliff: c3(.60, .54, .50), cliff2: c3(.70, .64, .60), accent: c3(.98, .68, .80),
    shallow: c3(.38, .74, .76), mid: c3(.18, .50, .60), deep: c3(.07, .25, .38),
    beach: 0.02, patch: 0.35, flowers: 0.1, speckle: 0.25, rockAt: 0.78, outcrops: 0.1, clarity: 0.55, altBeach: 0.2, bands: 0.2,
    low: [['blossom', 4], ['blossomB', 1], ['bush', 2], ['round', 1]], lowD: 0.17, high: [['blossom', 3], ['blossomB', 2], ['round', 2], ['pine', 1]], highD: 0.6,
    land: [['ruinColumn', 2], ['ruinArch', 1], ['standingStones', 1]], landD: 0.25, sea: [], seaD: 0, atmos: { petals: 1 } },
  autumn: { ...BASE, name: 'Autumn', wet: c3(.60, .52, .40), sand: c3(.86, .75, .55), sand2: c3(.74, .54, .36), grass: c3(.60, .60, .30), grass2: c3(.78, .50, .22),
    forest: c3(.44, .32, .18), rock: c3(.55, .52, .50), cliff: c3(.56, .48, .40), cliff2: c3(.66, .56, .46), accent: c3(.94, .44, .16),
    shallow: c3(.30, .60, .62), mid: c3(.14, .40, .50), deep: c3(.06, .21, .33),
    patch: 0.55, flowers: 0.08, speckle: 0.2, outcrops: 0.2, clarity: 0.45, altBeach: 0.15, bands: 0.3,
    low: [['maple', 3], ['mapleB', 1], ['berrybush', 2], ['round', 1]], lowD: 0.17, high: [['maple', 3], ['mapleB', 3], ['pine', 2], ['roundB', 1]], highD: 0.72,
    land: [['log', 2], ['standingStones', 1]], landD: 0.25, sea: [['log', 2]], seaD: 0.075, atmos: { leaves: 1, fog: 0.1 } },
  birch: { ...BASE, name: 'Birchwood', wet: c3(.60, .58, .50), sand: c3(.82, .78, .66), sand2: c3(.66, .66, .62), grass: c3(.56, .66, .36), grass2: c3(.72, .70, .44),
    forest: c3(.40, .50, .30), rock: c3(.62, .63, .64), cliff: c3(.58, .57, .55), cliff2: c3(.70, .69, .66), accent: c3(.96, .96, .90),
    shallow: c3(.34, .62, .66), mid: c3(.16, .40, .50), deep: c3(.07, .21, .32),
    beach: 0.01, patch: 0.45, flowers: 0.05, speckle: 0.35, outcrops: 0.25, altBeach: 0.25, bands: 0.2,
    low: [['birchW', 3], ['birch', 3], ['fern', 3], ['bush', 1]], lowD: 0.2, high: [['birchW', 3], ['birch', 3], ['pine', 2]], highD: 0.66,
    land: [['log', 2], ['standingStones', 1]], landD: 0.2, sea: [['log', 1]], seaD: 0.045, atmos: { leaves: 0.35 } },
  bog: { ...BASE, name: 'Bog', wet: c3(.30, .27, .20), sand: c3(.44, .38, .27), sand2: c3(.36, .33, .24), grass: c3(.40, .45, .23), grass2: c3(.50, .36, .26),
    forest: c3(.22, .28, .16), rock: c3(.44, .44, .40), cliff: c3(.40, .37, .32), cliff2: c3(.48, .44, .38), accent: c3(.93, .91, .85),
    shallow: c3(.32, .40, .26), mid: c3(.18, .27, .22), deep: c3(.08, .16, .16),
    beach: -0.03, patch: 0.6, flowers: 0.05, speckle: 0.3, rockAt: 0.78, outcrops: 0.1, clarity: 0.25, altBeach: 0.1, bands: 0.1,
    shore: [['reeds', 4], ['fern', 1]], shoreD: 0.25, low: [['reeds', 4], ['fern', 2], ['deadtree', 1], ['bush', 1], ['willow', 1]], lowD: 0.2,
    high: [['willow', 2], ['pine', 2], ['deadtree', 1], ['fern', 2]], highD: 0.32,
    land: [['standingStones', 2], ['log', 2], ['shack', 1]], landD: 0.25, sea: [['lilyPad', 4], ['weedMat', 1], ['log', 1]], seaD: 0.24, atmos: { fog: 0.8, fireflies: 0.8 } },
  chalk: { ...BASE, name: 'Chalk downs', wet: c3(.74, .72, .66), sand: c3(.90, .88, .80), sand2: c3(.62, .61, .58), grass: c3(.50, .66, .34), grass2: c3(.68, .74, .42),
    forest: c3(.30, .46, .24), rock: c3(.88, .87, .82), cliff: c3(.92, .91, .86), cliff2: c3(.80, .78, .72), accent: c3(.70, .58, .92),
    shallow: c3(.48, .82, .78), mid: c3(.22, .58, .62), deep: c3(.08, .30, .40),
    beach: -0.01, patch: 0.3, flowers: 0.04, speckle: 0.4, rockAt: 0.6, outcrops: 0.35, clarity: 0.45, altBeach: 0.3, bands: 0.7,
    low: [['bush', 2], ['round', 1], ['rock', 1], ['lavender', 1]], lowD: 0.07, high: [['round', 3], ['roundB', 1], ['bush', 2]], highD: 0.25,
    land: [['chalkRock', 4], ['standingStones', 2]], landD: 0.35, sea: [['seastack', 2], ['weedMat', 1]], seaD: 0.09, atmos: { fog: 0.15 } },
  bamboo: { ...BASE, name: 'Bamboo', wet: c3(.58, .46, .34), sand: c3(.84, .70, .52), sand2: c3(.72, .44, .30), grass: c3(.40, .66, .30), grass2: c3(.56, .74, .30),
    forest: c3(.18, .42, .20), rock: c3(.50, .52, .48), cliff: c3(.54, .46, .38), cliff2: c3(.64, .54, .44), accent: c3(.98, .62, .30),
    shallow: c3(.30, .72, .66), mid: c3(.12, .50, .52), deep: c3(.05, .26, .36),
    patch: 0.4, flowers: 0.03, speckle: 0.2, rockAt: 0.7, outcrops: 0.2, clarity: 0.55, altBeach: 0.25, bands: 0.3,
    low: [['bamboo', 5], ['fern', 2], ['palm', 1]], lowD: 0.3, high: [['bamboo', 4], ['roundB', 2], ['fern', 1]], highD: 0.8,
    land: [['hut', 2], ['totem', 1], ['ruinColumn', 1]], landD: 0.25, sea: [['lilyPad', 1], ['log', 1]], seaD: 0.045, atmos: { haze: 0.3, fireflies: 0.5 } },
  atoll: { ...BASE, name: 'Atoll', wet: c3(.80, .76, .62), sand: c3(.98, .95, .84), sand2: c3(.97, .86, .80), grass: c3(.42, .72, .32), grass2: c3(.62, .78, .36),
    forest: c3(.14, .44, .22), rock: c3(.70, .68, .60), cliff: c3(.76, .72, .62), cliff2: c3(.84, .80, .70), accent: c3(.98, .50, .60),
    shallow: c3(.30, .88, .84), mid: c3(.08, .62, .70), deep: c3(.04, .30, .46),
    beach: 0.06, patch: 0.3, flowers: 0.03, speckle: 0.15, rockAt: 0.78, outcrops: 0.05, clarity: 0.85, altBeach: 0.3, bands: 0.2,
    shore: [['palm', 4], ['fern', 1]], shoreD: 0.16, low: [['palm', 4], ['fern', 3], ['bush', 1]], lowD: 0.2, high: [['palm', 2], ['round', 2], ['fern', 2]], highD: 0.5,
    land: [['hut', 2], ['totem', 1]], landD: 0.2, sea: [['whaleBones', 1]], seaD: 0.024, atmos: { haze: 0.5 } },
  dunes: { ...BASE, name: 'Dunes', wet: c3(.78, .68, .48), sand: c3(.95, .84, .60), sand2: c3(.90, .74, .50), grass: c3(.86, .76, .52), grass2: c3(.60, .64, .34),
    forest: c3(.62, .60, .36), rock: c3(.74, .62, .46), cliff: c3(.78, .64, .46), cliff2: c3(.88, .74, .54), accent: c3(.96, .86, .40),
    shallow: c3(.36, .80, .78), mid: c3(.12, .56, .64), deep: c3(.04, .28, .42),
    beach: 0.1, patch: 0.4, flowers: 0.008, speckle: 0.3, rockAt: 0.78, outcrops: 0.1, clarity: 0.7, altBeach: 0.1, bands: 0.5,
    shore: [['reeds', 1]], shoreD: 0.03, low: [['reeds', 3], ['ashbush', 2], ['cactus', 1], ['palm', 1]], lowD: 0.06, high: [['palm', 2], ['ashbush', 2], ['cactus', 1]], highD: 0.1,
    land: [['whaleBones', 2], ['ruinColumn', 1], ['ruinArch', 1]], landD: 0.2, sea: [['whaleBones', 1]], seaD: 0.024, atmos: { haze: 0.9 } },
  mesa: { ...BASE, name: 'Mesa', wet: c3(.62, .42, .30), sand: c3(.86, .62, .42), sand2: c3(.78, .48, .32), grass: c3(.70, .52, .34), grass2: c3(.56, .58, .34),
    forest: c3(.48, .46, .26), rock: c3(.72, .40, .26), cliff: c3(.74, .42, .27), cliff2: c3(.90, .66, .44), accent: c3(.96, .80, .36),
    shallow: c3(.40, .70, .66), mid: c3(.14, .48, .56), deep: c3(.05, .25, .38),
    patch: 0.5, flowers: 0.015, speckle: 0.3, rockAt: 0.42, outcrops: 0.45, clarity: 0.55, altBeach: 0.2, bands: 1,
    low: [['cactus', 3], ['ashbush', 3], ['deadtree', 1], ['rock', 1]], lowD: 0.08, high: [['cactus', 2], ['rock', 2], ['ashbush', 2], ['boulders', 1]], highD: 0.1,
    land: [['mesaRock', 5], ['ruinArch', 1]], landD: 0.4, sea: [['seastack', 2]], seaD: 0.06, atmos: { haze: 0.7 } },
  basalt: { ...BASE, name: 'Basalt', wet: c3(.22, .22, .24), sand: c3(.32, .32, .34), sand2: c3(.42, .42, .44), grass: c3(.34, .48, .32), grass2: c3(.46, .56, .36),
    forest: c3(.20, .32, .22), rock: c3(.27, .28, .31), cliff: c3(.25, .26, .29), cliff2: c3(.33, .34, .37), accent: c3(.82, .84, .90),
    shallow: c3(.22, .46, .54), mid: c3(.10, .30, .40), deep: c3(.05, .15, .26),
    beach: -0.02, patch: 0.5, flowers: 0.02, speckle: 0.4, rockAt: 0.5, outcrops: 0.6, clarity: 0.45, altBeach: 0.2, bands: 0.6,
    low: [['fern', 2], ['rock', 2], ['boulders', 2], ['bush', 1]], lowD: 0.1, high: [['pine', 2], ['rock', 2], ['boulders', 1]], highD: 0.18,
    land: [['basalt', 5]], landD: 0.5, sea: [['seastack', 2], ['basalt', 1]], seaD: 0.09, atmos: { fog: 0.3 } },
  blacksand: { ...BASE, name: 'Black sand', wet: c3(.12, .11, .12), sand: c3(.19, .18, .19), sand2: c3(.30, .28, .28), grass: c3(.32, .54, .28), grass2: c3(.42, .58, .30),
    forest: c3(.12, .36, .18), rock: c3(.24, .23, .25), cliff: c3(.22, .21, .22), cliff2: c3(.30, .28, .28), accent: c3(.98, .46, .30),
    shallow: c3(.22, .50, .60), mid: c3(.08, .30, .44), deep: c3(.04, .14, .26),
    beach: 0.02, patch: 0.35, flowers: 0.03, speckle: 0.4, rockAt: 0.45, outcrops: 0.3, clarity: 0.5, altBeach: 0.1, bands: 0.3,
    shore: [['palm', 2]], shoreD: 0.08, low: [['palm', 2], ['fern', 4], ['bush', 2]], lowD: 0.22, high: [['round', 3], ['roundB', 2], ['fern', 2], ['palm', 1]], highD: 0.7,
    land: [['basalt', 2], ['steamVent', 1], ['totem', 1]], landD: 0.25, sea: [['steamVent', 2], ['seastack', 1]], seaD: 0.09, atmos: { ash: 0.4, haze: 0.2 } },
  fungal: { ...BASE, name: 'Fungal', wet: c3(.24, .20, .26), sand: c3(.42, .36, .42), sand2: c3(.30, .26, .34), grass: c3(.30, .37, .40), grass2: c3(.44, .30, .48),
    forest: c3(.20, .20, .28), rock: c3(.30, .28, .34), cliff: c3(.28, .26, .32), cliff2: c3(.36, .32, .40), accent: c3(.40, .95, .85),
    shallow: c3(.26, .44, .52), mid: c3(.12, .26, .38), deep: c3(.06, .12, .24),
    beach: -0.01, patch: 0.55, flowers: 0.05, speckle: 0.4, rockAt: 0.5, outcrops: 0.25, glow: 1, clarity: 0.4, altBeach: 0.2, bands: 0.2,
    low: [['mushroom', 4], ['mushroomB', 1], ['fern', 3], ['snag', 1]], lowD: 0.14, high: [['mushroomB', 2], ['mushroom', 2], ['snag', 2], ['fern', 1]], highD: 0.3,
    land: [['crystal', 3], ['ruinColumn', 1]], landD: 0.25, sea: [['steamVent', 1]], seaD: 0.03, atmos: { spores: 1, ash: 0.15, fog: 0.2 } },
  fjord: { ...BASE, name: 'Fjord', wet: c3(.42, .43, .42), sand: c3(.58, .58, .55), sand2: c3(.46, .47, .47), grass: c3(.36, .48, .32), grass2: c3(.48, .52, .38),
    forest: c3(.15, .27, .19), rock: c3(.48, .50, .53), cliff: c3(.44, .45, .48), cliff2: c3(.56, .57, .60), accent: c3(.88, .90, .96),
    shallow: c3(.22, .46, .48), mid: c3(.09, .27, .33), deep: c3(.04, .12, .19),
    beach: -0.03, patch: 0.3, flowers: 0.015, speckle: 0.5, rockAt: 0.55, snow: 0.25, outcrops: 0.45, clarity: 0.35, altBeach: 0.2, bands: 0.4,
    low: [['pine', 3], ['birch', 2], ['fern', 1], ['rock', 1]], lowD: 0.2, high: [['pine', 4], ['pineB', 3], ['snowpine', 1]], highD: 0.75,
    land: [['hut', 1], ['totem', 1], ['standingStones', 1]], landD: 0.2, sea: [['seastack', 2], ['log', 1], ['weedMat', 1], ['whaleBones', 1]], seaD: 0.09, atmos: { fog: 0.7, snow: 0.3 } },
  glacier: { ...BASE, name: 'Glacier', wet: c3(.78, .86, .90), sand: c3(.86, .90, .92), sand2: c3(.70, .76, .80), grass: c3(.90, .94, .97), grass2: c3(.78, .86, .93),
    forest: c3(.80, .88, .94), rock: c3(.56, .62, .68), cliff: c3(.62, .76, .86), cliff2: c3(.82, .92, .97), accent: c3(.70, .86, .98),
    shallow: c3(.58, .76, .80), mid: c3(.32, .52, .60), deep: c3(.12, .24, .32),
    beach: -0.02, patch: 0.4, flowers: 0.02, speckle: 0.2, rockAt: 0.7, snow: 1, outcrops: 0.35, clarity: 0.25, altBeach: 0.2, bands: 0.5,
    low: [['rock', 2], ['boulders', 1], ['snowpine', 1]], lowD: 0.05, high: [['snowpine', 1], ['rock', 1]], highD: 0.06,
    land: [['crystal', 2], ['whaleBones', 1]], landD: 0.2, sea: [['iceberg', 4], ['whaleBones', 1]], seaD: 0.15, atmos: { snow: 1, fog: 0.3 } },
  mangrove: { ...BASE, name: 'Mangrove', wet: c3(.25, .22, .15), sand: c3(.33, .28, .19), sand2: c3(.42, .36, .24), grass: c3(.22, .40, .17), grass2: c3(.30, .44, .20),
    forest: c3(.08, .25, .11), rock: c3(.40, .40, .36), cliff: c3(.38, .34, .28), cliff2: c3(.46, .42, .34), accent: c3(.96, .80, .40),
    shallow: c3(.42, .46, .25), mid: c3(.24, .34, .22), deep: c3(.11, .22, .17),
    beach: -0.02, flowers: 0.01, speckle: 0.5, clarity: 0.2, altBeach: 0, bands: 0.2,
    low: [['mangrove', 3], ['fern', 2], ['round', 1]], lowD: 0.3, high: [['roundB', 2], ['fern', 1], ['willow', 1]], highD: 0.6,
    land: [['shack', 2], ['log', 1]], landD: 0.2, sea: [['lilyPad', 3], ['log', 1]], seaD: 0.15, atmos: { fireflies: 1, haze: 0.3 } },
};
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

// Which themes may sit side by side: neighbouring regions blend through these (the next theme along the shortest path
// from one region's theme toward the other's), so ice never meets sand and the ember isles meet only basalt, chalk or bog.
const NEXT_TO: [ThemeId, ThemeId][] = [
  ['glacier', 'fjord'], ['fjord', 'birch'], ['birch', 'pine'], ['pine', 'meadow'], ['meadow', 'blossom'], ['blossom', 'bamboo'],
  ['bamboo', 'atoll'], ['atoll', 'dunes'], ['dunes', 'mesa'], ['autumn', 'pine'], ['autumn', 'birch'], ['autumn', 'meadow'],
  ['chalk', 'meadow'], ['chalk', 'pine'], ['bog', 'pine'], ['bog', 'birch'], ['bog', 'mangrove'], ['mangrove', 'bamboo'], ['mangrove', 'blossom'],
  ['basalt', 'blacksand'], ['basalt', 'fungal'], ['basalt', 'chalk'], ['basalt', 'bog'], ['blacksand', 'chalk'], ['blacksand', 'bog'],
  ['fungal', 'bog'], ['fungal', 'chalk'], ['home', 'meadow'],
];
const steps = new Map<string, ThemeId>();
/** The theme one step from `a` toward `b` along NEXT_TO (b itself when they may touch, a when nothing links them). */
export function stepToward(a: ThemeId, b: ThemeId): ThemeId {
  if (a === b) return a;
  const key = a + '>' + b, known = steps.get(key);
  if (known) return known;
  const prev = new Map<ThemeId, ThemeId>([[b, b]]), queue: ThemeId[] = [b];   // search back from b, so the first hop from a is read off directly
  while (queue.length && !prev.has(a)) {
    const t = queue.shift()!;
    for (const [u, v] of NEXT_TO) for (const [p, q] of [[u, v], [v, u]] as const) if (p === t && !prev.has(q)) { prev.set(q, t); queue.push(q); }
  }
  const next = prev.get(a) ?? a;
  steps.set(key, next);
  return next;
}
const BRIDGE = 200;                                          // how far inside a region its border islands turn toward the neighbour's theme
const themeCache = new Map<number, ThemeId>();
/**
 * The theme of the main island centred at (cx, cy). Most of a region's islands take its theme; patches of it (a slow
 * noise, so they cluster) take one of its related themes; and near a border with a region of another theme, islands
 * take the theme that bridges the two, so neighbouring regions meet through compatible looks.
 */
export function islandTheme(cx: number, cy: number): ThemeId {
  const ix = Math.round(cx), iy = Math.round(cy), key = ix * 65536 + iy;
  let t = themeCache.get(key);
  if (t) return t;
  if (Math.hypot(cx - HOME.x, cy - HOME.y) < 1) t = 'home';
  else {
    const p = locate(cx, cy), R = region(p.band, p.k), N = region(p.nb, p.nk);
    if (p.edge < BRIDGE && N.theme !== R.theme && stepToward(R.theme, N.theme) !== N.theme) t = stepToward(R.theme, N.theme);
    else {
      const n = 0.5 + 0.5 * nBio(cx / 1500 + 31.1, cy / 1500 - 17.3);
      t = n > 0.9 && R.related[0] ? R.related[0] : n < 0.08 && R.related[1] ? R.related[1] : R.theme;
    }
  }
  themeCache.set(key, t);
  return t;
}
/** A small per-island shade (0..1) that nudges its colours, so two islands of one theme still differ. */
export const islandJitter = (cx: number, cy: number): number => hash01(Math.round(cx), Math.round(cy), 917);

/** A main island near a point: its centre and radius. */
export interface IslandRef { x: number; y: number; R: number }
/** The island theme holding a point, and how strongly (0 at sea .. 1 on and around the island). */
export interface ThemeHold { theme: ThemeId; w: number; jitter: number }
/** How much an island's theme holds s radii from its centre: all of it within 1.3, fading out by 2.2. */
const reach = (s: number): number => 1 - smooth01((s - 1.3) / 0.9);
/**
 * The theme at (x, y) given the main islands near it (from world.claimableNear). The island nearest in units of its
 * radius holds the point; where its land or water meets an island of another theme, it holds only by how much nearer
 * it is, so two themes never meet edge to edge (a narrow strip of the region's own look runs between them).
 * Alderhaven holds with weight 0, keeping the plain home look.
 */
export function themeHold(x: number, y: number, islands: readonly IslandRef[], out: ThemeHold): ThemeHold {
  let s1 = Infinity, best: IslandRef | null = null;
  for (const is of islands) { const s = Math.hypot(x - is.x, y - is.y) / is.R; if (s < s1) { s1 = s; best = is; } }
  if (!best || s1 > 2.2) { out.theme = 'home'; out.w = 0; out.jitter = 0; return out; }
  const theme = islandTheme(best.x, best.y);
  let s2 = Infinity;
  for (const is of islands) if (is !== best && islandTheme(is.x, is.y) !== theme) s2 = Math.min(s2, Math.hypot(x - is.x, y - is.y) / is.R);
  out.theme = theme; out.jitter = islandJitter(best.x, best.y);
  out.w = theme === 'home' ? 0 : reach(s1) * smooth01((s2 - s1) / 0.3);
  return out;
}
/**
 * The nearest island's theme and how strongly it holds at (x, y), through the same island anchor biomeMix uses (no
 * island list needed, but it switches islands abruptly where two meet: fine for ambience, not for colours).
 */
export function themeHoldAt(x: number, y: number, out: ThemeHold): ThemeHold {
  const at = anchor(x, y);
  out.theme = at ? islandTheme(at.x, at.y) : 'home'; out.jitter = at ? islandJitter(at.x, at.y) : 0;
  out.w = at && out.theme !== 'home' ? at.w : 0;
  return out;
}
/** The theme of the place at (x, y): its island's on and around an island (Alderhaven's is 'home'), else the sea region's. */
export function themeAt(x: number, y: number): ThemeId {
  const at = anchor(x, y);
  return at && at.w > 0.5 ? islandTheme(at.x, at.y) : regionAt(x, y).theme;
}
