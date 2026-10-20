// Cheat console: press ` while sailing, type a code, press Enter.
import { G, toast, placeAtPort, saveGame, DAYLEN, schoolActive, cap } from './game';
import { SPECIES, BOATS, UPGRADES, UPGRADE_KEYS, PROJECTS } from './econ';
import { homePort, LAIR, schoolsNear } from './world';
import { setWeather } from './weather';
import { sfx } from './audio';
import type { ProjectId } from './types';

/** Move the clock forward to `frac` of a day (today if still ahead, else tomorrow). */
function atClock(frac: number): void {
  const base = Math.floor(G.clock / DAYLEN) * DAYLEN;
  G.clock = base + (frac > (G.clock - base) / DAYLEN ? 0 : DAYLEN) + frac * DAYLEN;
}

/** A cheat may return a message to show instead of the default, or 'finale' to jump to the ending. */
export interface Cheat { code: string; what: string; run: () => string | void }
const UNLOCK_SHIPS: ProjectId[] = ['pier', 'market', 'drydock', 'lights'];

export const CHEATS: Cheat[] = [
  { code: 'moneybags', what: '+$10,000', run: () => { G.coins += 10000; } },   // not counted as earned, so it doesn't trip goals
  { code: 'maxgear', what: 'Every upgrade at its top level', run: () => { for (const k of UPGRADE_KEYS) G.up[k] = UPGRADES[k].costs.length; } },
  { code: 'shipwright', what: 'Own every ship', run: () => {
    for (const p of UNLOCK_SHIPS) if (!G.projects.includes(p)) G.projects.push(p);
    G.owned = BOATS.map(b => b.id);
  } },
  { code: 'harbour', what: 'Finish every Alderhaven project but the last', run: () => { G.projects = PROJECTS.filter(p => p.id !== 'grand').map(p => p.id); } },
  { code: 'grandfinale', what: 'Finish Alderhaven and see the ending', run: () => { G.projects = PROJECTS.map(p => p.id); G.finale = true; return 'finale'; } },
  { code: 'fullhold', what: 'Fill the hold with fish', run: () => {
    for (let i = 0; G.hold.length < cap() && i < 99; i++) {
      const sp = Math.floor(Math.random() * (SPECIES.length - 1));   // anything but the Old One
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
