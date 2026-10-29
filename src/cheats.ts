// Cheat console: press ` while sailing, type a code, press Enter.
import { G, toast, placeAtPort, saveGame, DAYLEN, schoolActive, cap } from './game';
import { SPECIES, BOATS, UPGRADES, UPGRADE_KEYS, PROJECTS } from './econ';
import { homePort, LAIR, schoolsNear, nearestWater } from './world';
import { summonSeaLife } from './life';
import { celebrate } from './game/feedback';
import { regionAt } from './biome';
import { setWeather } from './weather';
import { sfx } from './audio';
import type { ProjectId } from './types';

/** Move the clock forward to `frac` of a day (today if still ahead, else tomorrow). */
function atClock(frac: number): void {
  const base = Math.floor(G.clock / DAYLEN) * DAYLEN;
  G.clock = base + (frac > (G.clock - base) / DAYLEN ? 0 : DAYLEN) + frac * DAYLEN;
}

/** A cheat may return a message to show instead of the default, or 'finale' to jump to the ending. */
interface Cheat { code: string; what: string; run: () => string | void }
const UNLOCK_SHIPS: ProjectId[] = ['pier', 'market', 'drydock', 'lights'];

export const SEA_TOYS = [
  { code: 'whalewatch', name: 'Call a humpback', what: 'A curious whale surfaces beside you. Catchable with a level 5 rod and a giant deck.' },
  { code: 'dolphinparade', name: 'Dolphin parade', what: 'Three bow-riding dolphins join your boat. Slow down and cast for one.' },
  { code: 'jellyparty', name: 'Jellyfish lantern party', what: 'Night falls and a colourful, catchable swarm rises beside you.' },
  { code: 'kraken', name: 'Release the kraken', what: 'Summon a real giant squid from the deep. Bring serious tackle.' },
  { code: 'bootycall', name: 'X marks the spot', what: 'A treasure buoy nearby, with an improbable 42 coins inside.' },
  { code: 'sparkler', name: 'Harbour salute', what: 'A ring of golden sparks around your boat. No strobe or camera shake.' },
] as const;

export const CHEATS: Cheat[] = [
  { code: 'whalewatch', what: 'Call a friendly humpback', run: () => summonSeaLife('whale') },
  { code: 'dolphinparade', what: 'A pod of dolphins joins you', run: () => summonSeaLife('dolphins') },
  { code: 'jellyparty', what: 'A jellyfish lantern party at night', run: () => { atClock(0.75); return summonSeaLife('jellies'); } },
  { code: 'kraken', what: 'A giant squid rises beside you', run: () => summonSeaLife('squid') },
  { code: 'sparkler', what: 'A golden harbour salute', run: () => { celebrate(); return 'A salute to the captain!'; } },
  { code: 'bootycall', what: 'A nearby treasure worth 42 coins', run: () => {
    if (G.maps.length >= 3) return 'Find the treasure already on your chart first';
    const p = nearestWater(G.boat.x + Math.cos(G.boat.a) * 70, G.boat.y + Math.sin(G.boat.a) * 70, -0.12);
    G.maps.push({ id: `sandbox:${G.t}`, x: p.x, y: p.y, reward: 42 });
    return 'The answer to life, the universe, and fishing is buried at the new buoy';
  } },
  { code: 'goldrush', what: 'Turn a nearby school golden', run: () => {
    const school = schoolsNear(G.boat.x, G.boat.y, 400).find(schoolActive);
    if (!school) return 'No school nearby';
    school.gold = true;
  } },
  { code: 'openwaters', what: 'Open every region', run: () => {
    const regions = new Set(G.unlocked);
    for (let y = -12000; y <= 12000; y += 700) for (let x = -24000; x <= 24000; x += 700) regions.add(regionAt(x, y).id);
    G.unlocked = [...regions];
  } },
  { code: 'dontpanic', what: 'A small, suspiciously useful towel', run: () => { G.boat.hp = Math.max(G.boat.hp, 42); G.bait.shrimp += 42; return 'DON’T PANIC. You know where your towel is. +42 shrimp bait'; } },
  { code: 'moneybags', what: '+$1,000,000', run: () => { G.coins += 1000000; } },   // not counted as earned, so it doesn't trip goals
  { code: 'maxgear', what: 'Every upgrade at its top level', run: () => { for (const k of UPGRADE_KEYS) G.up[k] = UPGRADES[k].costs.length; } },
  { code: 'shipwright', what: 'Own every ship', run: () => {
    for (const p of UNLOCK_SHIPS) if (!G.projects.includes(p)) G.projects.push(p);
    G.owned = BOATS.map(b => b.id);
  } },
  { code: 'harbour', what: 'Finish every Alderhaven project but the last', run: () => { G.projects = PROJECTS.filter(p => p.id !== 'grand').map(p => p.id); } },
  { code: 'grandfinale', what: 'Finish Alderhaven and see the ending', run: () => { G.projects = PROJECTS.map(p => p.id); return 'finale'; } },
  { code: 'fullhold', what: 'Fill the hold with fish', run: () => {
    const pool = SPECIES.map((s, i) => s.id !== 'oldone' ? i : -1).filter(i => i >= 0);
    for (let i = 0; G.hold.length < cap() && i < 99; i++) {
      const sp = pool[Math.floor(Math.random() * pool.length)];
      G.hold.push({ sp, kg: SPECIES[sp].kg[1] * 0.6, value: SPECIES[sp].base, trophy: Math.random() < 0.2, t: G.clock });
    }
  } },
  { code: 'allfish', what: 'Log every species, with trophies', run: () => {
    for (const s of SPECIES) G.log[s.id] = { n: Math.max(1, G.log[s.id]?.n || 0), best: s.kg[1], trophy: true };
  } },
  { code: 'frenzy', what: 'Start a feeding frenzy nearby', run: () => {
    const s = schoolsNear(G.boat.x, G.boat.y, 300).find(schoolActive);
    if (!s) return 'No school nearby';
    s.stock = Math.max(s.stock, 8);
    G.frenzy = { s, until: G.t + 70 };
  } },
  { code: 'nightfall', what: 'Skip to nightfall', run: () => atClock(0.72) },
  { code: 'daybreak', what: 'Skip to morning', run: () => atClock(0.06) },
  { code: 'stormy', what: 'Bring a storm', run: () => setWeather('storm') },
  { code: 'clearsky', what: 'Clear the weather', run: () => setWeather('clear') },
  { code: 'homeward', what: 'Return to Alderhaven', run: () => placeAtPort(homePort()) },
  { code: 'leviathan', what: 'Sail to the Old One\'s lair at night', run: () => {
    const x = LAIR.x + 60, y = LAIR.y + 60;
    Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0 });
    G.cam.x = G.boat.x - 160; G.cam.y = G.boat.y - 100;
    G.up.rod = Math.max(G.up.rod, 4);
    atClock(0.75);
  } },
  { code: 'unsinkable', what: 'Toggle an unbreakable hull', run: () => {
    G.god = !G.god;
    return G.god ? 'Your hull cannot be damaged' : 'Your hull is mortal again';
  } },
  { code: 'catnip', what: 'A ship\'s cat joins you', run: () => { G.pet = G.pet || { name: 'Whiskers' }; sfx('meow'); } },
];

/** Run a typed code; returns whether it was a real cheat. */
export function runCheat(text: string): boolean {
  const c = CHEATS.find(q => q.code === text.trim().toLowerCase());
  if (!c) { sfx('deny'); return false; }
  const msg = c.run();
  if (!G.cheated) toast('Cheats are on: this save no longer counts for world records or the coastwide fund', 'bad');
  G.cheated = true;
  if (msg === 'finale') G.mode = 'finale';
  else toast(typeof msg === 'string' ? msg : `Cheat: ${c.what}`, 'good');
  sfx('levelup'); saveGame();
  return true;
}
