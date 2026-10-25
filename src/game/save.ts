// Saving and loading, new voyages, and putting the boat at a port.
import { W, H, clamp } from '../config';
import { hAt, homePort, cellPois, nearestWater, WORLD } from '../world';
import { SP, retiredRefund } from '../econ';
import { toast } from './feedback';
import { netSaved, reportStats } from '../net';
import type { GameState, Point, Port } from '../types';
import { G, freshStats, freshUpgrades } from './state';
import { seedExplored } from './explore';
import { fleetWhileAway } from './port/fleet';
import { parseSave, type ParsedSave } from './saveSchema';
import { DAYLEN, cap, hpMax } from './rules';

const KEY = 'bobber-run-save-v3', OLD = 'bobber-run-save-v2';


/** The v3 save: progress plus where the boat is (sets stored as arrays). Its shape is the schema in saveSchema.ts, so
 *  writing a field the loader doesn't know is a type error here. */
type SaveData = ParsedSave;
/** The v2 save, migrated on first load. */
interface OldSave {
  coins: number; earned: number; up?: { oars?: number; hull?: number; hold?: number; rod?: number };
  found: string[]; salvaged: string[]; lastPort: string | null; log?: Record<string, number>; x: number; y: number; a: number;
}

export function saveGame(): void {
  try {
    const b = G.boat;
    const data: SaveData = {
      savedAt: Date.now(), world: WORLD, coins: G.coins, earned: G.earned, up: G.up, hp: b.hp, hold: G.hold, log: G.log, boatId: G.boatId, owned: G.owned,
      bait: G.bait, baitSel: G.baitSel, paint: G.paint, paints: G.paints, found: [...G.found], salvaged: [...G.salvaged], lastPort: G.lastPort, x: b.x, y: b.y, a: b.a,
      stats: G.stats, story: G.story, gifts: G.gifts, pet: G.pet, projects: G.projects, fleet: G.fleet, dives: G.dives,
      goalsDone: G.goalsDone, cheated: G.cheated, maps: G.maps, escaped: G.escaped, packs: G.packs, regionsSeen: G.regionsSeen, explored: G.explored, unlocked: G.unlocked, waypoint: G.waypoint, gearOff: G.gearOff, zones: G.zones, docks: G.docks, streak: G.streak, musicOn: G.musicOn, offers: G.offers, active: G.active, pity: G.pity, clock: G.clock,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    netSaved();
    reportStats(G.stats.caught, G.earned, G.cheated);   // the leaderboard's fish caught and coins earned (sent at most once a minute)
  } catch { }   // storage full or unavailable: keep playing
}
export function hasSave(): boolean {
  try { return !!(localStorage.getItem(KEY) || localStorage.getItem(OLD)); } catch { return false; }
}
/** Where the saved boat lies, so its sea can be built before Continue is pressed; null without a save. */
export function savedSpot(): Point | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<SaveData> | null;
    return d && Number.isFinite(d.x) && Number.isFinite(d.y) && (d.world ?? 1) === WORLD ? { x: d.x!, y: d.y! } : null;
  } catch { return null; }
}
/** A few facts about the save on this device, for the "erase it?" question; null when there is none or it can't be read. */
export function savedVoyage(): { day: number; caught: number; species: number } | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<SaveData> | null;
    if (!d) return null;
    return { day: Math.floor((d.clock || 0) / DAYLEN) + 1, caught: d.stats?.caught || 0, species: Object.keys(d.log || {}).length };
  } catch { return null; }
}
export function wipeSave(): void {
  try { localStorage.removeItem(KEY); localStorage.removeItem(OLD); } catch { }
}

/** Look a port up by id ("port:i,j"), falling back to Alderhaven. */
export function portById(id: string | null): Port {
  const m = /^port:(-?\d+),(-?\d+)$/.exec(id || '');
  if (!m) return homePort();
  return cellPois(+m[1], +m[2]).find((p): p is Port => p.id === id && p.type === 'port') || homePort();
}
export function placeAtPort(p: Port): void {
  const b = G.boat;
  b.x = p.dock.x; b.y = p.dock.y; b.a = p.ang;
  b.vx = b.vy = b.w = b.helm = b.thr = 0;
  b.px = b.x; b.py = b.y; b.pa = b.a;
  G.cam.x = b.x - W / 2; G.cam.y = b.y - H / 2;
  G.look.x = G.look.y = 0;
}
// New voyages start at a random spot of open water within sight of the harbour, so players arriving
// together don't all pile up on the same dock. Falls back to the dock if no clear water is found.
function scatterSpawn(port: Port): void {
  const clear = (x: number, y: number): boolean => {
    for (let a = 0; a < 6.28; a += 0.8) if (hAt(x + Math.cos(a) * 22, y + Math.sin(a) * 22) > -0.12) return false;
    return hAt(x, y) < -0.2;
  };
  for (let tries = 0; tries < 40; tries++) {
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
    const x = port.dock.x + Math.cos(a) * d, y = port.dock.y + Math.sin(a) * d;
    if (!clear(x, y)) continue;
    const b = G.boat;
    b.x = b.px = x; b.y = b.py = y;
    b.a = b.pa = Math.atan2(y - port.y, x - port.x) + (Math.random() - 0.5) * 0.8;   // facing out to sea
    G.cam.x = x - W / 2; G.cam.y = y - H / 2;
    return;
  }
}

export function newGame(): void {
  const fresh: Partial<GameState> = {
    coins: 15, coinsShown: 15, earned: 0, paint: 'classic', paints: ['classic'], up: freshUpgrades(), bait: { shrimp: 3, glow: 0, chum: 1 }, baitSel: 'shrimp',
    hold: [], log: {}, found: new Set(), salvaged: new Set(), sat: {}, fish: null, parts: [], toasts: [], floaters: [], boatId: 'row', owned: ['row'],
    stats: freshStats(), goalsDone: [], cheated: false, maps: [], escaped: [], packs: {}, regionsSeen: [], explored: '', unlocked: [], waypoint: null, gearOff: {}, zones: {}, docks: {}, streak: 0, offers: {}, active: [], pity: 0,
    clock: DAYLEN * 0.08, frenzy: null, nextFrenzy: 240, card: null, projects: [], fleet: {}, dives: {}, gifts: {}, pet: null, dry: 0, story: null, talk: null,
  };
  Object.assign(G, fresh);
  const home = homePort();
  G.lastPort = home.id;
  G.found.add(home.id);
  G.boat.hp = hpMax();
  placeAtPort(home);
  scatterSpawn(home);
}

/**
 * A save from an older world layout: progress stays (coins, boats, gear, logbook, story, projects), and everything
 * that points at a place goes: charted ports, wrecks and dives, contracts, treasure maps, the waypoint, catch spots,
 * per-port records. Fleet boats come home to Alderhaven with their earnings; the boat starts there too.
 */
function forNewWorld(d: Partial<SaveData>): Partial<SaveData> {
  const home = homePort();
  const log = Object.fromEntries(Object.entries(d.log || {}).map(([k, e]) => { const { at: _, ...rest } = e; return [k, rest]; }));
  const fleet = Object.fromEntries(Object.entries(d.fleet || {}).map(([k, f]) => [k, { ...f, port: home.id, portName: home.name }]));
  return {
    ...d, world: WORLD, found: [home.id], salvaged: [], dives: {}, offers: {}, active: [], maps: [], escaped: [], waypoint: null, lastPort: home.id,
    docks: {}, gifts: {}, explored: '', log, fleet, x: undefined, y: undefined,
  };
}

/** Read a v2 save into the v3 shape (only what v2 had). */
function migrateOld(o: OldSave): Partial<SaveData> {
  const log = Object.fromEntries(Object.entries(o.log || {}).filter(([k]) => SP[k] !== undefined).map(([k, n]) => [k, { n, best: 0 }]));
  return {
    coins: o.coins, earned: o.earned, up: { ...freshUpgrades(), prop: o.up?.oars || 0, hull: o.up?.hull || 0, hold: o.up?.hold || 0, rod: o.up?.rod || 0 },
    found: o.found, salvaged: o.salvaged, lastPort: o.lastPort, log, x: o.x, y: o.y, a: o.a,
  };
}
// JSON.parse is the boundary here: saves come from older versions and may miss any field
const readJson = <T,>(key: string): T | null => JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;

export function loadGame(): void {
  try {
    let d = readJson<Partial<SaveData>>(KEY);
    newGame();
    if (!d) {
      const o = readJson<OldSave>(OLD);
      if (!o) return;
      d = migrateOld(o);
    }
    const moved = (d.world ?? 1) < WORLD;
    if (moved) d = forNewWorld(d);                      // also covers a cloud save, which net.ts writes here first
    const s = parseSave(d);                             // every field present, of the right type (saveSchema.ts)
    const loaded: Partial<GameState> = {
      coins: s.coins, coinsShown: s.coins, earned: s.earned, up: { ...G.up, ...s.up }, hold: s.hold, log: s.log, boatId: s.boatId, owned: s.owned,
      bait: { ...G.bait, ...s.bait }, baitSel: s.baitSel, paint: s.paint, paints: s.paints, found: new Set(s.found), salvaged: new Set(s.salvaged),
      lastPort: s.lastPort || G.lastPort, stats: { ...G.stats, ...s.stats }, story: s.story, gifts: s.gifts, pet: s.pet, projects: s.projects,
      fleet: s.fleet, dives: s.dives, goalsDone: s.goalsDone, cheated: s.cheated, maps: s.maps, escaped: s.escaped, packs: s.packs, regionsSeen: s.regionsSeen, explored: s.explored, unlocked: s.unlocked, gearOff: s.gearOff, zones: s.zones,
      docks: s.docks, streak: s.streak, waypoint: s.waypoint, musicOn: s.musicOn, offers: s.offers, active: s.active, pity: s.pity, clock: s.clock ?? G.clock,
    };
    Object.assign(G, loaded);
    fleetWhileAway(s.savedAt);                                     // the fleet kept fishing while the game was closed
    if (!G.explored) seedExplored();
    if (moved) toast('The coast has changed while you were away. Your boat, coins and logbook are safe, but your chart starts fresh');
    // retired upgrades (bilge pumps went into Plating): give back what they cost, once
    const refund = retiredRefund(G.up);
    if (refund > 0) { G.coins += refund; G.coinsShown = G.coins; G.up.bilge = 0; toast(`Bilge pumps now come with Plating: refunded $${refund}`, 'good'); }
    G.boat.hp = clamp(s.hp ?? hpMax(), 1, hpMax());
    // older saves stored destination names in capitals, and could ask for more fish than the hold carries
    for (const c of [...G.active, ...Object.values(G.offers).flat()]) if (c && c.to) { c.toName = portById(c.to).name; c.n = Math.min(c.n, cap()); }
    // the coastline can change between versions: a treasure that now lies under land moves out to open water
    G.maps = G.maps.map(m => ({ ...m, ...nearestWater(m.x, m.y, -0.2) }));
    const { x, y, a } = s;
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) && hAt(x, y) < -0.05) {
      Object.assign(G.boat, { x, y, a, px: x, py: y, pa: a });
      G.cam.x = x - W / 2; G.cam.y = y - H / 2;
    } else placeAtPort(portById(G.lastPort));
  } catch { newGame(); }   // a corrupt save starts a fresh voyage rather than a broken one
}
