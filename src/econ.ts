// Boats, harbour projects, upgrades, supplies and paints (pure data). Fish species live in ./species.
import type { BaitKind, BoatDef, BoatId, Paint, Project, Supply, Upgrade, UpgradeCategory, UpgradeKey } from './types';

export { SPECIES, SP, pickSpecies, activeAt, fmtKg } from './species';

export const BOATS: BoatDef[] = [
  { id: 'row',     name: 'Rowboat',      cost: 0,    speed: 1.0,  accel: 1.0, turn: 1.0,  hold: 4,  hp: 100, L: 13.5, B: 5.8, prop: 'OARS',   sonar: 0, net: 0, what: 'Quiet oars give you 60% more time for a perfect strike' },
  { id: 'skiff',   name: 'Sail Skiff',   cost: 450,  speed: 1.45, accel: 0.9, turn: 0.95, hold: 7,  hp: 140, L: 16.5, B: 6.4, prop: 'SAIL',   sonar: 0, net: 0, what: 'Sails: fastest when the wind blows from the side' },
  { id: 'boatdev', name: 'boat.dev Sloop', cost: 900, speed: 1.7, accel: 1.15, turn: 1.15, hold: 8, hp: 150, L: 15, B: 5.5, prop: 'SAIL', sonar: 1, net: 0, what: 'The boat from boat.dev: cheap, quick under sail, and sonar built in. The most boat for the coin' },
  { id: 'launch',  name: 'Motor Launch', cost: 1800, speed: 1.95, accel: 1.5, turn: 1.05, hold: 10, hp: 210, L: 17.5, B: 7,   prop: 'ENGINE', sonar: 0, net: 0, what: 'Engine: fast in any direction, but speeding near fish scares them away' },
  { id: 'trawler', name: 'Trawler',      cost: 5000, speed: 2.15, accel: 0.8, turn: 0.75, hold: 18, hp: 360, L: 23,   B: 9,   prop: 'ENGINE', sonar: 1, net: 3, deck: 1, what: 'A sturdy engine boat, big enough to land sea giants', req: 'pier' },
  { id: 'speedboat', name: 'Speedboat',  cost: 7500, speed: 2.75, accel: 2.0, turn: 1.15, hold: 9,  hp: 240, L: 15,   B: 5.5, prop: 'ENGINE', sonar: 0, net: 0, special: 'boost', what: 'Twin outboards: crosses the sea in no time, but carries little. Press K to open the throttles wide for a burst of speed, to outrun anything afloat', req: 'pier' },
  { id: 'catamaran', name: 'Catamaran',  cost: 11000, speed: 2.55, accel: 1.1, turn: 0.9, hold: 16, hp: 320, L: 20,   B: 9,   prop: 'SAIL',   sonar: 0, net: 0, keel: 1, gale: true, what: 'Two light hulls that fly in a blow: the harder the wind, the faster she goes, and in a storm she outruns every other sail. Steady in a gale besides', req: 'pier' },
  // the big ships: unlocked by restoring Alderhaven's harbour, not by money alone
  { id: 'schooner', name: 'Schooner',     cost: 15000, speed: 2.4, accel: 0.85, turn: 0.62, hold: 26, hp: 520, L: 32, B: 10, prop: 'SAIL', sonar: 1, net: 0, crew: 1, deck: 1, reach: true, what: 'Two masts and a gaff rig that loves a reach: with the wind on her beam she is the fastest ship afloat, even past the racing yacht', req: 'drydock' },
  { id: 'drifter',  name: 'Steam Drifter', cost: 25000, speed: 2.3, accel: 0.7, turn: 0.62, hold: 34, hp: 700, L: 36, B: 11, prop: 'ENGINE', sonar: 2, net: 3, keel: 1, deck: 1, what: 'Steam power that rides out the worst storms', req: 'drydock' },
  { id: 'research', name: 'Research Vessel', cost: 32000, speed: 2.2, accel: 0.9, turn: 0.75, hold: 22, hp: 560, L: 28, B: 9, prop: 'ENGINE', sonar: 3, net: 0, deck: 1, special: 'ping', what: 'The best sonar afloat: every school by species, and legendary fish starred on the chart. Press K for a long-range ping that charts every school for 900 m round her and names the nearest', req: 'drydock' },
  { id: 'flagship', name: 'Flagship',      cost: 50000, speed: 2.6, accel: 0.75, turn: 0.62, hold: 50, hp: 1000, L: 46, B: 14, prop: 'ENGINE', sonar: 3, net: 3, keel: 2, crew: 2, harpoon: 1, deck: 2, command: 0.5, what: 'The finest working ship afloat, fully crewed, with a deck for the very largest fish. She leads your fleet: while you sail her, every boat fishing for you brings in half as much again', req: 'lights' },
  { id: 'icebreaker', name: 'Icebreaker',  cost: 70000, speed: 2.0, accel: 0.6, turn: 0.55, hold: 36, hp: 1500, L: 34, B: 11.5, prop: 'ENGINE', sonar: 2, net: 0, keel: 2, deck: 2, ice: true, what: 'A reinforced bow: ice floes and bergs part for it, and the far north opens up', req: 'lights' },
  { id: 'yacht',    name: 'Sailing Yacht', cost: 85000, speed: 2.85, accel: 0.95, turn: 0.7, hold: 24, hp: 700, L: 30, B: 8, prop: 'SAIL', sonar: 1, net: 0, crew: 1, luxury: 0.15, point: true, what: 'A racing yacht with a teak deck: the fastest sail downwind, she points higher into the wind than any other, and catches sell for 15% more', req: 'lights' },
  // fighting ships: guns built in, crews drilled to reload fast, tough hulls and small holds
  { id: 'cutter', name: 'Revenue Cutter', cost: 3200, speed: 1.85, accel: 1.2, turn: 1.15, hold: 6, hp: 300, L: 17, B: 6.2, prop: 'SAIL', sonar: 0, net: 0, point: true, arms: { cannon: 1, swivel: 1 }, gunnery: 0.8, signature: 'chaser', what: 'A fast fore-and-aft cutter built to chase smugglers: a long bow chaser that fires dead ahead as you run a pirate down, a broadside gun and a swivel, and she points high into the wind' },
  { id: 'patrol', name: 'Coast Guard Cutter', cost: 16000, speed: 2.3, accel: 1.1, turn: 0.85, hold: 10, hp: 720, L: 26, B: 7.5, prop: 'ENGINE', sonar: 1, net: 0, crew: 1, arms: { cannon: 2, swivel: 1, kegs: 1 }, gunnery: 0.75, marque: 0.5, signature: 'boarders', what: 'A fast white patrol cutter with a boarding team: lay her alongside a beaten pirate to grapple and take her, and half again the bounty on every pirate. Deck guns, a swivel and kegs', req: 'drydock' },
  { id: 'gunboat', name: 'Rocket Gunboat', cost: 26000, speed: 2.2, accel: 1.0, turn: 0.8, hold: 8, hp: 850, L: 22, B: 7, prop: 'ENGINE', sonar: 1, net: 0, crew: 1, arms: { cannon: 1, swivel: 1, mortar: 2 }, gunnery: 0.8, marque: 0.25, signature: 'barrage', what: 'A steel gunboat with two rocket racks: each salvo is a barrage of three rockets walked along a ship\'s course, so turning won\'t save her. A light gun and a swivel besides', req: 'drydock' },
  { id: 'dreadnought', name: 'Dreadnought', cost: 110000, speed: 2.3, accel: 0.6, turn: 0.5, hold: 18, hp: 3200, L: 46, B: 11, prop: 'ENGINE', sonar: 2, net: 0, crew: 3, keel: 2, arms: { swivel: 2, ram: 1 }, armour: 0.4, gunnery: 0.7, marque: 0.25, signature: 'turret', what: 'A steel battleship: three big-gun turrets that train onto a pirate on any bearing and fire together, armour that turns 40% of every hit (and won\'t burn), and a ram bow. A beaten pirate who takes a salvo strikes her colours rather than fight on', req: 'lights' },
  { id: 'destroyer', name: 'Destroyer', cost: 180000, speed: 2.8, accel: 1.3, turn: 0.95, hold: 8, hp: 1100, L: 32, B: 6.5, prop: 'ENGINE', sonar: 2, net: 0, crew: 2, keel: 1, arms: { cannon: 1, swivel: 2 }, gunnery: 0.6, marque: 0.25, signature: 'torpedo', what: 'A lean steel torpedo-boat destroyer, the fastest warship afloat: torpedoes from her bow tubes run straight and slow under the water and hit like nothing else, angling a little to meet a ship you point her at. Quick-firing guns besides', req: 'grand' },
  { id: 'missile', name: 'Missile Cruiser', cost: 320000, speed: 2.6, accel: 1.0, turn: 0.75, hold: 14, hp: 2600, L: 40, B: 9, prop: 'ENGINE', sonar: 3, net: 0, crew: 3, keel: 2, arms: { swivel: 2 }, armour: 0.25, gunnery: 0.6, marque: 0.25, signature: 'missile', what: 'The most advanced warship afloat: guided missiles leap from her deck and home on a pirate wherever she is, whatever she does, and armour besides', req: 'grand' },
  { id: 'carrier', name: 'Aircraft Carrier', cost: 480000, speed: 2.45, accel: 0.6, turn: 0.45, hold: 16, hp: 3600, L: 58, B: 13, prop: 'ENGINE', sonar: 3, net: 0, crew: 3, keel: 2, arms: { swivel: 2 }, armour: 0.2, gunnery: 0.7, marque: 0.25, signature: 'air', what: 'A flat-top with an air wing of three jets: launch one and it flies off to the nearest pirate up to 110 m away, far past any gun, over land or sea, bombs her pass after pass, then comes home to land and rearm. Only light guns besides: keep your distance and let the planes fight', req: 'grand' },
  // the yachts of a kingdom
  { id: 'motoryacht', name: 'Motor Yacht', cost: 60000, speed: 2.7, accel: 1.0, turn: 0.65, hold: 34, hp: 1000, L: 38, B: 11, prop: 'ENGINE', sonar: 2, net: 0, crew: 2, deck: 1, luxury: 0.2, lights: true, what: 'Three decks of glass and teak, and guests aboard: catches sell for 20% more. Underwater lights glow round her hull at night, showing the fish far round her, and fish in their light bite sooner', req: 'drydock' },
  { id: 'superyacht', name: 'Superyacht', cost: 650000, speed: 2.85, accel: 0.9, turn: 0.6, hold: 50, hp: 1800, L: 52, B: 13, prop: 'ENGINE', sonar: 3, net: 0, keel: 2, crew: 2, harpoon: 1, deck: 2, luxury: 0.4, special: 'heli', what: 'The jewel of a kingdom, with a pool and her own helicopter: at sea it flies your catch to the nearest charted harbour and sells it there, so you can fish on without putting in, and catches sell for 40% more', req: 'grand' },
  { id: 'liner', name: 'Ocean Liner', cost: 1500000, speed: 2.9, accel: 0.55, turn: 0.4, hold: 64, hp: 2600, L: 70, B: 15, prop: 'ENGINE', sonar: 3, net: 0, keel: 2, crew: 2, harpoon: 1, deck: 2, luxury: 0.5, fares: 1.5, what: 'A cruise liner of a dozen decks, with pools, a water slide and a thousand guests: passengers board at every harbour and pay their fare when you dock at another one at least 50 m away (the further, the more), and her dining rooms pay half again for every catch you sell', req: 'grand' },
];
/** What a spare boat brings in per minute while you sail another one (the Fleet Office), and how many minutes it can hold. */
export const FLEET_PER_MIN: Record<BoatId, number> = {
  row: 8, skiff: 18, boatdev: 25, launch: 35, trawler: 70, speedboat: 50, catamaran: 85, schooner: 110, drifter: 160, research: 150,
  flagship: 240, icebreaker: 210, yacht: 220, motoryacht: 300, superyacht: 520, liner: 800, cutter: 22, patrol: 90, gunboat: 80, dreadnought: 220, destroyer: 240, missile: 300, carrier: 340,
};
export const FLEET_HOLD_MIN = 10;
/**
 * Upgrades fitted to a boat rather than carried by you: each boat keeps its own levels of these, and a new boat comes
 * bare. Your fishing gear and crew (rod, reel, line, tackle, spyglass, sextant, deckhand, cook) go with you to any boat.
 */
export const BOAT_PARTS: readonly UpgradeKey[] = ['prop', 'hull', 'hold', 'bilge', 'anchor', 'net', 'ice', 'sonar', 'lantern', 'radio', 'quarter', 'pots', 'keel', 'harpoon', 'bell', 'cannon', 'swivel', 'mortar', 'kegs', 'ram'];
// Restoring Alderhaven: the long goal. Each project takes coins and donated fish, unlocks something, and the last one ends the story.
// need: { any: n } fish of any kind; { kinds: n } different species; { trophy: n } trophy fish; { sp: id, n } a particular species
export const PROJECTS: Project[] = [
  { id: 'pier', name: 'Mend the pier', cost: 250, need: { any: 4 }, gives: 'The shipyard can build the Trawler', what: 'The pier is rotten and sagging. The carpenters will fix it for coins and a few fish.' },
  { id: 'market', name: 'Raise the fish market', cost: 1500, need: { kinds: 6 }, gives: 'A Fleet tab in every port: boats you are not sailing fish for you', what: 'A covered market hall, with a stall for every kind of fish.' },
  { id: 'drydock', name: 'Build the dry dock', cost: 4000, need: { trophy: 3 }, gives: 'The Schooner, Steam Drifter and 4 dry dock upgrades', what: 'A stone dock big enough to build large ships. The shipwrights want trophy fish as proof that you fish seriously.' },
  { id: 'lights', name: 'Light the coast', cost: 10000, need: { sp: 'beacon', n: 3 }, gives: 'The Flagship, and every nearby lighthouse charted', what: 'Light the lighthouses again with Beaconfish oil. Beaconfish bite below lighthouses at night.' },
  { id: 'grand', name: 'The Grand Harbour', cost: 30000, need: { sp: 'oldone', n: 1 }, gives: 'The greatest harbour on the coast, and the finale', what: 'Banners, a festival, and the Old One watching over the harbour gate. Catch it at its lair, which is marked on your chart.' },
];
/** What each level of these upgrades adds: top speed and hull (fractions), fish carried, line strain and sale value. */
export const UPGRADE_STEP = { prop: 0.12, hull: 0.25, hold: 2, line: 0.12, ice: 0.05 } as const;
// Upgrade tracks, grouped into shop categories. `lv[i]` says, in plain words, what owning level i+1 does;
// the shop adds the exact before and after numbers (see upgradeStat in game/rules).
export const UPGRADES: Record<UpgradeKey, Upgrade> = {
  prop:     { name: b => ({ OARS: 'Oars', SAIL: 'Sails', ENGINE: 'Engine' } as const)[b.prop], cat: 'VESSEL', costs: [60, 200, 1000, 4000], lv: ['Top speed +12%', 'Top speed +24%', 'Top speed +36%', 'Top speed +48%'] },
  hull:     { name: () => 'Plating', cat: 'VESSEL', costs: [70, 220, 900, 3000], lv: ['Copper: +25% hull, 12% less crash damage', 'Iron: +50% hull, 24% less crash damage, and a pump patches the hull at sea', 'Steel: +75% hull, 36% less crash damage, a faster pump', 'Gilded: +100% hull, 48% less crash damage, the fastest pump'] },
  hold:     { name: () => 'Hold', cat: 'VESSEL', costs: [50, 170, 800, 3000], lv: ['Carry 2 more fish', 'Carry 4 more fish', 'Carry 6 more fish', 'Carry 8 more fish'] },
  bilge:    { name: () => 'Bilge Pump', cat: 'VESSEL', costs: [200, 1000], lv: ['Repairs 1 hull point every 4 seconds at sea', 'Repairs 1 hull point every 1.4 seconds at sea'] },
  anchor:   { name: () => 'Anchor', cat: 'VESSEL', costs: [150], lv: ['Storm gusts no longer push you while you fish or sit still'] },
  net:      { name: () => 'Drift Net', cat: 'VESSEL', costs: [200, 600, 1500], lv: ['While you drift slowly over small fish, the net catches one every 3.6 seconds', 'Catches one every 2.9 seconds', 'Catches one every 2.2 seconds'] },
  rod:      { name: () => 'Rod', cat: 'TACKLE', costs: [80, 260, 1200, 4000], lv: ['Level 2 rod: crabs, squid, cod and more', 'Level 3 rod: offshore fish like halibut and salmon', 'Level 4 rod: ocean giants like tuna', 'Level 5 rod: marlin, swordfish and the legends'] },
  reel:     { name: () => 'Reel', cat: 'TACKLE', costs: [120, 600, 3000], lv: ['Reeling lands fish 12% faster', 'Reeling lands fish 24% faster', 'Reeling lands fish 36% faster'] },
  line:     { name: () => 'Braided Line', cat: 'TACKLE', costs: [130, 600, 3000], lv: ['The line takes 12% more strain before it snaps', '24% more strain before it snaps', '36% more strain before it snaps'] },
  tackle:   { name: () => 'Tackle Box', cat: 'TACKLE', costs: [120, 600, 3000], lv: ['Bites come 12% sooner', 'Bites come 24% sooner, and 0.05 s more for a perfect strike', 'Bites come 36% sooner, and 0.1 s more for a perfect strike'] },
  ice:      { name: () => 'Ice Box', cat: 'TACKLE', costs: [100, 500, 2500], lv: ['Every fish sells for 5% more', 'Every fish sells for 10% more', 'Every fish sells for 15% more'] },
  sonar:    { name: () => 'Sonar', cat: 'NAVIGATION', costs: [150, 600, 2000], lv: ['Shows schools of fish on your minimap and chart', 'Colours each school by species', 'Marks legendary fish with a star on the chart'] },
  lantern:  { name: () => 'Lantern', cat: 'NAVIGATION', costs: [100, 400, 1200], lv: ['Your night light reaches 1.9 times as far, so you spot schools in the dark', 'Night light reaches 2.8 times as far', 'Night light reaches 3.7 times as far'] },
  spyglass: { name: () => 'Spyglass', cat: 'NAVIGATION', costs: [140, 600], lv: ['Chart places from 1.5 times as far away', 'Chart places from twice as far away, and see the species of nearby schools'] },
  sextant:  { name: () => 'Sextant', cat: 'NAVIGATION', costs: [200, 800], lv: ['Your minimap points to the nearest uncharted place', 'Your chart also marks every uncharted place in open waters'] },
  radio:    { name: () => 'Radio', cat: 'NAVIGATION', costs: [250, 1500], lv: ['Feeding frenzies come 25% more often', 'Also shows the weather forecast while you sail'] },
  deckhand: { name: () => 'Deckhand', cat: 'CREW', costs: [300, 2000], lv: ['25% chance to land a second, smaller fish from the same school (you can switch it off on the Ship screen)', '40% chance, and sets the hook for you if you are late'] },
  cook:     { name: () => 'Cook', cat: 'CREW', costs: [350, 2500], lv: ['Smokes your catch: every sale pays 10% more', 'Every sale pays 20% more'] },
  quarter:  { name: () => 'Quartermaster', cat: 'CREW', costs: [250, 1200], lv: ['Hold 4 contracts at once; contracts pay 15% more', 'Hold 5 contracts at once; contracts pay 30% more'] },
  // dry dock upgrades (need the dry dock project)
  pots:     { name: () => 'Crab Pots', cat: 'VESSEL', req: 'drydock', costs: [800, 3000, 12000], lv: ['Hauls a crab into your hold every 4 minutes', 'Hauls a crab every 2.5 minutes', 'Hauls a crab every minute'] },
  keel:     { name: () => 'Storm Keel', cat: 'VESSEL', req: 'drydock', costs: [2000, 10000], lv: ['Hold position in rough water: storm and far-cold fish (Thunder Eel, Oarfish, Crystal Squid) will bite, and gusts push you half as hard', 'Storms cannot push you at all, and +25% hull'] },
  harpoon:  { name: () => 'Harpoon Gun', cat: 'TACKLE', req: 'drydock', costs: [3000, 14000], lv: ['Land ocean giants and legends 25% faster; they pull 12% less', 'Land them 50% faster; they pull 24% less'] },
  bell:     { name: () => 'Diving Bell', cat: 'NAVIGATION', req: 'drydock', costs: [2500, 12000], lv: ['Dive on each salvaged wreck once a day for another 60% of its loot', 'Daily dives bring up 120% of the loot'] },
  // arms, for the pirates of the far waters (game/arms.ts, game/pirates.ts)
  cannon:   { name: () => 'Broadside Guns', cat: 'ARMS', costs: [450, 2200, 9000], lv: ['A gun on each rail: R fires the side facing a pirate, if she\'s in its arc abeam. Each side reloads on its own', 'Two guns a side, harder hitting, quicker to reload', 'Three heavy guns a side with a longer reach'] },
  swivel:   { name: () => 'Bow Swivel', cat: 'ARMS', costs: [600, 3000], lv: ['A swivel gun on the bow that fires by itself at any pirate ahead of you', 'Harder hitting, faster, with a wider arc and reach'] },
  mortar:   { name: () => 'Mortar', cat: 'ARMS', costs: [2500, 9000], lv: ['T lobs a shell onto the nearest pirate 120 to 300 away, over anything between: a big splash, and it sets her alight. Slow to reload', 'Heavier shells, a wider burst, a longer reach and a quicker reload'] },
  kegs:     { name: () => 'Powder Kegs', cat: 'ARMS', costs: [700, 3200], lv: ['V rolls a powder keg off the stern: it floats and blows up any pirate that comes close. Carry 2', 'Carry 4, made up faster, with a bigger blast'] },
  ram:      { name: () => 'Iron Ram', cat: 'ARMS', costs: [1500], lv: ['An iron prow: running into a pirate does her 2.5 times the damage, and you far less'] },
};
/** Upgrades no longer sold: kept in the table so old saves still read, but out of the shop and the goals. Bilge
 *  pumps are part of Plating now (game/save.ts refunds what they cost). */
const RETIRED = new Set<string>(['bilge']);
/** Every upgrade key, in shop order. */
export const UPGRADE_KEYS = (Object.keys(UPGRADES) as UpgradeKey[]).filter(k => !RETIRED.has(k));
/** What a retired upgrade's levels cost, refunded once to saves that bought them. */
export const retiredRefund = (up: Partial<Record<UpgradeKey, number>>): number =>
  [...RETIRED].reduce((t, k) => t + UPGRADES[k as UpgradeKey].costs.slice(0, up[k as UpgradeKey] || 0).reduce((a, c) => a + c, 0), 0);
export const UP_CATS: UpgradeCategory[] = ['VESSEL', 'TACKLE', 'NAVIGATION', 'CREW', 'ARMS'];
export const BAIT_KINDS: BaitKind[] = ['shrimp', 'glow', 'chum'];
export const SUPPLIES: Record<BaitKind, Supply> = {
  shrimp: { name: 'Shrimp Bait', n: 5, cost: 25, what: 'One per cast: bites come 25% sooner and trophy chance +5%' },
  glow: { name: 'Glow Lures', n: 3, cost: 60, what: 'One per cast: bites come 25% sooner by day and twice as fast at night; trophy chance +12%' },
  chum: { name: 'Chum Bucket', n: 2, cost: 80, what: 'Press C next to a school to start a 45-second feeding frenzy: bites come 2.5 times as fast, trophy chance +10%, at least 6 fish' },
};
export const PAINTS: Paint[] = [
  { id: 'classic', name: 'Classic', cost: 0 },
  { id: 'seafoam', name: 'Seafoam', cost: 120, ramp: ['#3f7a6a', '#5fa38c', '#8ac7ae'] },
  { id: 'crimson', name: 'Crimson', cost: 140, ramp: ['#6e2420', '#a2342c', '#c8503e'] },
  { id: 'midnight', name: 'Midnight', cost: 160, ramp: ['#141c2c', '#22304a', '#34486a'] },
  { id: 'sunny', name: 'Sunflower', cost: 160, ramp: ['#a47f22', '#d9ae3e', '#f0cf6a'] },
  { id: 'gold', name: 'Gilded', cost: 5000, ramp: ['#8a6a1e', '#c49a32', '#f0cf6a'] },
  { id: 'pearl', name: 'Pearl', cost: 0, earn: 'Catch 5 different kinds of variant', ramp: ['#b8b4ac', '#dcd8cf', '#f4f1ea'] },
  { id: 'trophyred', name: 'Trophy Red', cost: 0, earn: 'Land a trophy of 10 different species', ramp: ['#5e1f1a', '#8f2c22', '#c0493a'] },
  { id: 'kingfisher', name: 'Kingfisher', cost: 0, earn: 'Reach Gold mastery (100 catches) with 10 species', ramp: ['#1d4f6e', '#2f86a8', '#e08a3c'] },
  { id: 'blacksails', name: 'Black Sails', cost: 0, earn: 'Sink 5 pirate ships', ramp: ['#16161a', '#26262c', '#3a3a42'] },
];
