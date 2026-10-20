// Species, boats, upgrades, paints (pure data + helpers).
import type {
  BaitKind, BoatDef, Env, FightStyle, FishShape, Landmark, Paint, Project, Region, Species, Supply, TimeOfDay,
  Upgrade, UpgradeCategory, UpgradeKey, WeatherNeed,
} from './types';

type Zone = Species['zone'];
type Extra = { region?: Region; weather?: WeatherNeed; special?: Landmark | null; legend?: boolean };
type Palette = Species['c'];

// fight difficulty: tougher with the rod level a species needs, and a little with its value
const difficulty = (rod: number, base: number): number => Math.min(0.95, 0.12 + rod * 0.18 + Math.min(0.2, base / 900));

// region: 'any' | 'temperate' (fades out in the far north/south) | 'cold' (north) | 'warm' (south)
// time: 'any' | 'day' | 'night' | 'twilight'   weather: 'any' | 'rain' (rain or storm) | 'storm'
// special: wreck/light schools only spawn at those landmarks
const S = (id: string, name: string, base: number, kg: [number, number], rod: number, w: number, time: TimeOfDay, shape: FishShape,
  c: Palette, fight: FightStyle, where: string, zone: Zone, extra: Extra = {}): Species =>
  ({ id, name, base, kg, rod, w, time, shape, c, fight, where, zone, region: 'any', weather: 'any', special: null, diff: difficulty(rod, base), ...extra });
const shallow = (t: number): Zone => h => h > t;
const deep = (t: number, minDist = 0): Zone => (h, d) => h < t && d > minDist;
export const SPECIES: Species[] = [
  // ---- everywhere ----
  S('anchovy', 'Anchovy', 3, [0.02, 0.06], 0, 5, 'any', 'slim', ['#3f5f8a', '#b3bbc0', '#efe9dc', '#5b7fae'], 'darter', 'Shallows', shallow(-0.25)),
  S('sardine', 'Sardine', 4, [0.05, 0.25], 0, 5, 'any', 'slim', ['#3f5f8a', '#8a949c', '#e6efec', '#5b7fae'], 'steady', 'Shallows', shallow(-0.22)),
  S('mullet', 'Mullet', 8, [0.4, 3], 0, 3, 'day', 'long', ['#5c6670', '#8a949c', '#d3d8da', '#4f5a52'], 'jumper', 'Shallows by day', shallow(-0.24)),
  S('flounder', 'Flounder', 9, [0.3, 2], 0, 3, 'day', 'flat', ['#7a6a4a', '#a8956a', '#efe9dc', '#6e5f40'], 'steady', 'Sandy shallows', shallow(-0.2)),
  S('mackerel', 'Mackerel', 10, [0.3, 1.5], 0, 3, 'any', 'slim', ['#26394a', '#5b7fae', '#e6efec', '#3f5f8a'], 'darter', 'Open water', deep(-0.15)),
  S('herring', 'Herring', 9, [0.2, 0.8], 0, 2.5, 'night', 'slim', ['#5c6670', '#b3bbc0', '#efe9dc', '#8a949c'], 'darter', 'Open water at night', deep(-0.1)),
  S('crab', 'Blue Crab', 14, [0.2, 0.9], 1, 3, 'night', 'crab', ['#2b4566', '#3f5f8a', '#e6d6a6', '#c0493a'], 'steady', 'Shallows at night', shallow(-0.22)),
  S('squid', 'Squid', 22, [0.3, 2], 1, 2, 'night', 'squid', ['#7e2c25', '#d8665a', '#f2c8b8', '#a23d33'], 'darter', 'Offshore at night', deep(-0.2, 700)),
  S('rtrout', 'Rain Trout', 34, [0.5, 4], 1, 4, 'any', 'long', ['#4f7044', '#d8665a', '#efe9dc', '#86a65c'], 'jumper', 'Shallows when it rains', shallow(-0.26), { weather: 'rain' }),
  S('cod', 'Cod', 25, [1, 8], 1, 3, 'any', 'long', ['#6e5f40', '#c8b47c', '#efe9dc', '#9a8a5a'], 'steady', 'Deep water, far out', deep(-0.3, 1100)),
  S('duskfin', 'Duskfin', 48, [0.3, 2], 2, 2, 'twilight', 'slim', ['#7e2c25', '#d8665a', '#f2c8b8', '#f0cf6a'], 'darter', 'Open water at dusk or dawn', deep(-0.1, 800)),
  S('lantern', 'Lanternfish', 45, [0.1, 0.6], 2, 2, 'night', 'glow', ['#14212a', '#2b4566', '#5b7fae', '#f0cf6a'], 'darter', 'Deep water at night', deep(-0.38, 1300)),
  S('stormeel', 'Thunder Eel', 120, [3, 20], 3, 2, 'any', 'eel', ['#14212a', '#2b4566', '#5b7fae', '#f0cf6a'], 'erratic', 'Open water in storms', deep(-0.3, 1200), { weather: 'storm' }),
  S('tuna', 'Bluefin Tuna', 60, [20, 250], 3, 2, 'day', 'tuna', ['#1f2c48', '#3f5f8a', '#d3d8da', '#e2b94a'], 'generic', 'Open ocean', deep(-0.42, 2100)),
  S('opah', 'Moonfish', 85, [10, 60], 3, 1, 'night', 'round', ['#7e2c25', '#d8665a', '#f0cf6a', '#c0493a'], 'generic', 'Open ocean at night', deep(-0.42, 2400)),
  S('marlin', 'Marlin', 110, [50, 400], 4, 1, 'day', 'bill', ['#14213a', '#2b4566', '#b3bbc0', '#3f5f8a'], 'jumper', 'The far ocean', deep(-0.42, 3200)),
  S('swordfish', 'Swordfish', 140, [60, 350], 4, 1, 'night', 'bill', ['#26394a', '#5c6670', '#b3bbc0', '#33454f'], 'jumper', 'Far ocean at night', deep(-0.42, 3000)),
  // ---- temperate home waters ----
  S('perch', 'Perch', 7, [0.2, 1.2], 0, 4, 'day', 'perch', ['#4f7044', '#86a65c', '#e6d6a6', '#c0493a'], 'steady', 'Shallows near home', (h, d) => h > -0.26 && d < 1600, { region: 'temperate' }),
  S('bass', 'Sea Bass', 17, [0.8, 4], 1, 3, 'any', 'perch', ['#33454f', '#8a949c', '#d3d8da', '#5c6670'], 'generic', 'Offshore', deep(-0.1, 650), { region: 'temperate' }),
  S('halibut', 'Halibut', 38, [2, 25], 2, 2, 'day', 'flat', ['#4a3a2a', '#8f7a5a', '#efe9dc', '#5e4a36'], 'steady', 'Deep water, far out', deep(-0.32, 1500), { region: 'temperate' }),
  S('salmon', 'Salmon', 32, [2, 12], 2, 2, 'any', 'long', ['#4f6a7a', '#d8665a', '#f2d0c0', '#8a949c'], 'jumper', 'Shallows, far out', (h, d) => h > -0.26 && d > 1600, { region: 'temperate' }),
  // ---- cold north ----
  S('char', 'Arctic Char', 28, [0.5, 6], 1, 4, 'any', 'long', ['#3a5068', '#8a949c', '#e6a08a', '#c0493a'], 'jumper', 'Cold northern shallows', shallow(-0.28), { region: 'cold' }),
  S('pollock', 'Pollock', 18, [1, 10], 1, 4, 'any', 'long', ['#3d4c56', '#6d7780', '#d3d8da', '#5c6670'], 'steady', 'Cold northern water', deep(-0.2), { region: 'cold' }),
  S('wolffish', 'Wolffish', 48, [3, 18], 2, 3, 'any', 'eel', ['#33454f', '#5c6670', '#b3bbc0', '#26394a'], 'darter', 'Cold deep water', deep(-0.3), { region: 'cold' }),
  S('monkfish', 'Monkfish', 52, [3, 40], 2, 3, 'night', 'flat', ['#4a3a2a', '#6e5f40', '#a8956a', '#33281c'], 'steady', 'Cold deep water at night', deep(-0.35), { region: 'cold' }),
  // ---- warm south ----
  S('puffer', 'Pufferfish', 20, [0.3, 2], 1, 4, 'any', 'puffer', ['#a8822c', '#e2c46a', '#efe9dc', '#8a6236'], 'erratic', 'Warm southern shallows', shallow(-0.3), { region: 'warm' }),
  S('parrot', 'Parrotfish', 26, [1, 6], 1, 4, 'day', 'perch', ['#2f8f7f', '#4fb3a0', '#e2b94a', '#d8665a'], 'steady', 'Warm reefs by day', shallow(-0.25), { region: 'warm' }),
  S('angel', 'Angelfish', 30, [0.2, 1.2], 1, 3, 'day', 'angel', ['#1b2a33', '#e2b94a', '#efe9dc', '#3f5f8a'], 'darter', 'Warm reefs by day', shallow(-0.25), { region: 'warm' }),
  S('barracuda', 'Barracuda', 40, [2, 20], 2, 3, 'any', 'long', ['#5c6670', '#b3bbc0', '#efe9dc', '#26394a'], 'darter', 'Warm open water', deep(-0.12), { region: 'warm' }),
  S('mahi', 'Mahi-mahi', 45, [3, 25], 2, 3, 'day', 'tuna', ['#2f6f3f', '#7fbf4f', '#f0cf6a', '#3f97a3'], 'jumper', 'Warm open water by day', deep(-0.15), { region: 'warm' }),
  S('sailfish', 'Sailfish', 95, [20, 90], 3, 2, 'day', 'bill', ['#1f2c48', '#3f5f8a', '#d3d8da', '#5b7fae'], 'jumper', 'Far warm ocean', deep(-0.35, 2000), { region: 'warm' }),
  // ---- landmark dwellers ----
  S('moray', 'Moray Eel', 55, [2, 15], 2, 3, 'any', 'eel', ['#4a5a2a', '#6e7a3a', '#a8b070', '#3a4a20'], 'darter', 'Inside sunken wrecks', () => false, { special: 'wreck' }),
  S('grouper', 'Grouper', 60, [5, 60], 2, 3, 'day', 'perch', ['#5e4a36', '#8f7a5a', '#d6c38c', '#4a3a2a'], 'steady', 'Around wrecks by day', () => false, { special: 'wreck' }),
  S('beacon', 'Beaconfish', 62, [0.5, 3], 2, 3, 'night', 'glow', ['#2b4566', '#5b7fae', '#d3d8da', '#fff6d6'], 'darter', 'Below lighthouses at night', () => false, { special: 'light' }),
  // ---- legends ----
  S('ghost', 'Ghost Carp', 180, [5, 30], 4, 1, 'any', 'carp', ['#b3bbc0', '#e6efec', '#fff6d6', '#d3d8da'], 'erratic', 'Near far-off wrecks', () => false, { special: 'wreck', legend: true }),
  S('oarfish', 'Oarfish', 420, [50, 250], 4, 0.35, 'any', 'eel', ['#8a949c', '#d3d8da', '#efe9dc', '#c0493a'], 'erratic', 'Deep ocean in storms', deep(-0.42, 2600), { weather: 'storm', legend: true }),
  S('crystal', 'Crystal Squid', 360, [5, 30], 4, 0.35, 'night', 'squid', ['#86b0bf', '#b4d0d8', '#e6efec', '#efe9dc'], 'erratic', 'Far cold ocean at night', deep(-0.42, 2400), { region: 'cold', legend: true }),
  S('goldmahi', 'Golden Mahi', 380, [15, 40], 4, 0.35, 'day', 'tuna', ['#a47f22', '#f0cf6a', '#fff6d6', '#e2b94a'], 'jumper', 'Far warm ocean, rarely', deep(-0.4, 2400), { region: 'warm', legend: true }),
  S('oldone', 'The Old One', 2400, [400, 900], 4, 0, 'night', 'levi', ['#14212a', '#33454f', '#8a949c', '#a23d33'], 'boss', 'Its lair, at night', () => false, { legend: true }),
];
/** species id -> index into SPECIES */
export const SP: Record<string, number> = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));

// regions by latitude: home waters are temperate, the far north is cold, the far south warm
const clamp01 = (v: number): number => v < 0 ? 0 : v > 1 ? 1 : v;
export const warmth = (y: number): number => clamp01((y - 1500) / 1000);
export const coldness = (y: number): number => clamp01((-y - 1300) / 1000);
function regionWeight(s: Species, y: number): number {
  const wm = warmth(y), cd = coldness(y);
  switch (s.region) {
    case 'warm': return wm > 0.4 ? 1 : 0;
    case 'cold': return cd > 0.4 ? 1 : 0;
    case 'temperate': return 1 - Math.max(wm, cd);
    default: return 1;
  }
}
/** Weighted random species index for a school at height h, distance d from home (or at a landmark).
 *  Only latitude (y) matters for regions; x is accepted so callers can pass a position. */
export function pickSpecies(h: number, d: number, r: () => number, _x = 0, y = 0, special: Landmark | null = null): number {
  const candidates: [Species, number][] = [];
  let total = 0;
  for (const s of SPECIES) {
    if (s.special !== special || (!special && !s.zone(h, d))) continue;
    if (special === 'wreck' && s.id === 'ghost' && d < 1500) continue;   // the Ghost Carp keeps to far-off wrecks
    const w = s.w * regionWeight(s, y);
    if (w > 0) { candidates.push([s, w]); total += w; }
  }
  let v = r() * total;
  for (const [s, w] of candidates) { v -= w; if (v <= 0) return SP[s.id]; }
  return special === 'wreck' ? SP.moray : special === 'light' ? SP.beacon : SP.sardine;
}
/** Whether species `sp` bites in these conditions. */
export function activeAt(sp: number, env: Env): boolean {
  const s = SPECIES[sp];
  const timeOk = s.time === 'any' || (s.time === 'night' ? env.night : s.time === 'day' ? !env.night : env.twilight);
  const weatherOk = s.weather === 'any' || (s.weather === 'storm' ? env.weather === 'storm' : env.weather === 'rain' || env.weather === 'storm');
  return timeOk && weatherOk;
}
export const fmtKg = (kg: number): string => kg < 10 ? kg.toFixed(1) + ' kg' : Math.round(kg) + ' kg';

export const BOATS: BoatDef[] = [
  { id: 'row',     name: 'Rowboat',      cost: 0,    speed: 1.0,  accel: 1.0, turn: 1.0,  hold: 4,  hp: 100, L: 13.5, B: 5.8, prop: 'OARS',   sonar: 0, net: 0, what: 'Quiet: easier perfect strikes' },
  { id: 'skiff',   name: 'Sail Skiff',   cost: 450,  speed: 1.45, accel: 0.9, turn: 0.95, hold: 7,  hp: 140, L: 16.5, B: 6.4, prop: 'SAIL',   sonar: 0, net: 0, what: 'Sails: fast across the wind' },
  { id: 'launch',  name: 'Motor Launch', cost: 2200, speed: 1.95, accel: 1.5, turn: 1.05, hold: 10, hp: 210, L: 17.5, B: 7,   prop: 'ENGINE', sonar: 0, net: 0, what: 'Engine: fast, but spooks fish' },
  { id: 'trawler', name: 'Trawler',      cost: 6000, speed: 2.15, accel: 0.8, turn: 0.75, hold: 18, hp: 360, L: 23,   B: 9,   prop: 'ENGINE', sonar: 1, net: 3, what: 'Big nets + sonar built in', req: 'pier' },
  // the big ships: unlocked by restoring Alderhaven's harbour, not by money alone
  { id: 'schooner', name: 'Schooner',     cost: 14000, speed: 2.4, accel: 0.85, turn: 0.62, hold: 26, hp: 520, L: 32, B: 10, prop: 'SAIL', sonar: 1, net: 0, crew: 1, what: 'Two masts, very fast across the wind, sails with a deckhand', req: 'drydock' },
  { id: 'drifter',  name: 'Steam Drifter', cost: 28000, speed: 2.3, accel: 0.7, turn: 0.62, hold: 34, hp: 700, L: 36, B: 11, prop: 'ENGINE', sonar: 2, net: 3, keel: 1, what: 'Steam power and huge nets. Rides out storms', req: 'drydock' },
  { id: 'flagship', name: 'Flagship',      cost: 60000, speed: 2.6, accel: 0.75, turn: 0.62, hold: 50, hp: 1000, L: 46, B: 14, prop: 'ENGINE', sonar: 3, net: 3, keel: 2, crew: 2, harpoon: 1, what: 'The finest ship afloat: harpoon, sonar dome and a crew of three', req: 'lights' },
];
// Restoring Alderhaven: the long goal. Each project takes coins and donated fish, unlocks something, and the last one ends the story.
// need: { any: n } fish of any kind; { kinds: n } different species; { trophy: n } trophy fish; { sp: id, n } a particular species
export const PROJECTS: Project[] = [
  { id: 'pier', name: 'Mend the pier', cost: 250, need: { any: 5 }, gives: 'The shipyard can build the Trawler', what: 'Rotten planks and a sagging quay. The harbourmaster needs coin and a few fish to feed the carpenters.' },
  { id: 'market', name: 'Raise the fish market', cost: 1500, need: { kinds: 6 }, gives: 'Opens the Fleet Office: send spare boats out to fish for you', what: 'A covered market hall with a slab for every kind of fish. Bring six different species to stock it.' },
  { id: 'drydock', name: 'Build the dry dock', cost: 5000, need: { trophy: 3 }, gives: 'Big ships: the Schooner and Steam Drifter, and dry dock upgrades', what: 'A stone dock deep enough for real ships. Shipwrights want proof of serious anglers: three trophy fish.' },
  { id: 'lights', name: 'Light the coast', cost: 12000, need: { sp: 'beacon', n: 3 }, gives: 'Charts every lighthouse nearby, and the Flagship', what: 'Relight the old lighthouse chain. The keepers say beaconfish oil burns brightest.' },
  { id: 'grand', name: 'The Grand Harbour', cost: 30000, need: { sp: 'oldone', n: 1 }, gives: 'Alderhaven becomes the greatest harbour on the coast', what: 'Banners, a festival, and the Old One mounted over the harbour gate. Bring it home.' },
];
// upgrade tracks, grouped into shop categories; `lv` describes what each level does.
export const UPGRADES: Record<UpgradeKey, Upgrade> = {
  prop:     { name: b => ({ OARS: 'Oars', SAIL: 'Sails', ENGINE: 'Engine' } as const)[b.prop], cat: 'VESSEL', costs: [60, 200, 600, 1600], lv: ['+12% top speed', '+24% top speed', '+36% top speed', '+48% top speed'] },
  hull:     { name: () => 'Plating', cat: 'VESSEL', costs: [70, 220, 650, 1700], lv: ['Copper: +25% hull', 'Iron: +50% hull', 'Steel: +75% hull', 'Gilded: +100% hull'] },
  hold:     { name: () => 'Hold', cat: 'VESSEL', costs: [50, 170, 500, 1400], lv: ['+2 fish slots', '+4 fish slots', '+6 fish slots', '+8 fish slots'] },
  bilge:    { name: () => 'Bilge Pump', cat: 'VESSEL', costs: [220, 800], lv: ['Slowly patches the hull at sea', 'Patches the hull quickly'] },
  anchor:   { name: () => 'Anchor', cat: 'VESSEL', costs: [180], lv: ['No drifting while fishing or stopped'] },
  net:      { name: () => 'Drift Net', cat: 'VESSEL', costs: [300, 900, 2200], lv: ['Nets small fish while you drift', 'Nets faster', 'Nets fastest'] },
  rod:      { name: () => 'Rod', cat: 'TACKLE', costs: [80, 260, 800, 2200], lv: ['Rod level 2: bigger fish', 'Rod level 3: offshore fish', 'Rod level 4: ocean giants', 'Rod level 5: legends'] },
  reel:     { name: () => 'Reel', cat: 'TACKLE', costs: [110, 380, 1100], lv: ['Reel in 12% faster', 'Reel in 24% faster', 'Reel in 36% faster'] },
  line:     { name: () => 'Braided Line', cat: 'TACKLE', costs: [130, 420, 1200], lv: ['Line takes 12% more strain', '24% more strain', '36% more strain'] },
  tackle:   { name: () => 'Tackle Box', cat: 'TACKLE', costs: [120, 450, 1300], lv: ['Bites 12% faster', 'Bites 24% faster, wider perfect', 'Bites 36% faster, widest perfect'] },
  ice:      { name: () => 'Ice Box', cat: 'TACKLE', costs: [90, 350, 1100], lv: ['Chilled fish sell for 5% more', 'Chilled fish sell for 10% more', 'Chilled fish sell for 15% more'] },
  sonar:    { name: () => 'Sonar', cat: 'NAVIGATION', costs: [150, 600, 1800], lv: ['Schools on the minimap', 'Species on the minimap', 'Legends on the chart'] },
  lantern:  { name: () => 'Lantern', cat: 'NAVIGATION', costs: [100, 400, 1200], lv: ['Brighter light at night', 'Wide light', 'Floodlight'] },
  spyglass: { name: () => 'Spyglass', cat: 'NAVIGATION', costs: [140, 600], lv: ['Chart landmarks from farther', 'See what swims in schools'] },
  sextant:  { name: () => 'Sextant', cat: 'NAVIGATION', costs: [200, 700], lv: ['Points to the nearest uncharted place', 'Marks uncharted places on the chart'] },
  radio:    { name: () => 'Radio', cat: 'NAVIGATION', costs: [250, 900], lv: ['More feeding frenzy tips', 'Weather forecast'] },
  deckhand: { name: () => 'Deckhand', cat: 'CREW', costs: [400, 1400], lv: ['25% chance of a bonus catch', '40% bonus, sets the hook for you'] },
  cook:     { name: () => 'Cook', cat: 'CREW', costs: [350, 1200], lv: ['Smoked fish sell for 10% more', 'Smoked fish sell for 20% more'] },
  quarter:  { name: () => 'Quartermaster', cat: 'CREW', costs: [300, 1000], lv: ['+1 contract slot, +15% rewards', '+2 contract slots, +30% rewards'] },
  // dry dock upgrades (need the dry dock project)
  pots:     { name: () => 'Crab Pots', cat: 'VESSEL', req: 'drydock', costs: [900, 2600, 6000], lv: ['A pot line hauls a crab every four minutes', 'Hauls every two and a half minutes', 'Hauls every minute'] },
  keel:     { name: () => 'Storm Keel', cat: 'VESSEL', req: 'drydock', costs: [1200, 3500], lv: ['Storm gusts push you half as much', 'Storms cannot push you, and +25% hull'] },
  harpoon:  { name: () => 'Harpoon Gun', cat: 'TACKLE', req: 'drydock', costs: [1500, 4000], lv: ['Legends and ocean giants tire 25% faster', 'They tire 50% faster and pull less'] },
  bell:     { name: () => 'Diving Bell', cat: 'NAVIGATION', req: 'drydock', costs: [2000, 5000], lv: ['Dive each wreck again once a day', 'Deeper dives bring up twice the salvage'] },
};
/** Every upgrade key, in shop order. */
export const UPGRADE_KEYS = Object.keys(UPGRADES) as UpgradeKey[];
export const UP_CATS: UpgradeCategory[] = ['VESSEL', 'TACKLE', 'NAVIGATION', 'CREW'];
export const BAIT_KINDS: BaitKind[] = ['shrimp', 'glow', 'chum'];
export const SUPPLIES: Record<BaitKind, Supply> = {
  shrimp: { name: 'Shrimp Bait', n: 5, cost: 25, what: 'Faster bites and more trophies' },
  glow: { name: 'Glow Lures', n: 3, cost: 60, what: 'Big trophy chance, double bites at night' },
  chum: { name: 'Chum Bucket', n: 2, cost: 80, what: 'Press C near a school to start a feeding frenzy' },
};
export const PAINTS: Paint[] = [
  { id: 'classic', name: 'Classic', cost: 0 },
  { id: 'seafoam', name: 'Seafoam', cost: 120, ramp: ['#3f7a6a', '#5fa38c', '#8ac7ae'] },
  { id: 'crimson', name: 'Crimson', cost: 140, ramp: ['#6e2420', '#a2342c', '#c8503e'] },
  { id: 'midnight', name: 'Midnight', cost: 160, ramp: ['#141c2c', '#22304a', '#34486a'] },
  { id: 'sunny', name: 'Sunflower', cost: 160, ramp: ['#a47f22', '#d9ae3e', '#f0cf6a'] },
  { id: 'gold', name: 'Gilded', cost: 5000, ramp: ['#8a6a1e', '#c49a32', '#f0cf6a'] },
];
