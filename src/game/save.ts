// Saving and loading, new voyages, and putting the boat at a port.
import { W, H, clamp } from '../config';
import { hAt, homePort, cellPois } from '../world';
import { SP } from '../econ';
import { netSaved } from '../net';
import type { BoatId, Contract, Fish, GameState, LogEntry, Pet, Port, ProjectId, Stats, StoryState, TreasureMap, UpgradeKey, BaitKind, BaitChoice } from '../types';
import { G, freshStats, freshUpgrades } from './state';
import { DAYLEN, hpMax } from './rules';

const KEY = 'bobber-run-save-v3', OLD = 'bobber-run-save-v2';

/** The v3 save: progress plus where the boat is. Sets are stored as arrays. */
interface SaveData {
  savedAt: number;
  coins: number; earned: number; up: Record<UpgradeKey, number>; hp: number; hold: Fish[]; log: Record<string, LogEntry>;
  boatId: BoatId; owned: BoatId[]; bait: Record<BaitKind, number>; baitSel: BaitChoice; paint: string; paints: string[];
  found: string[]; salvaged: string[]; lastPort: string | null; x: number; y: number; a: number;
  stats: Stats; story: StoryState | null; gifts: Record<string, number>; pet: Pet | null; projects: ProjectId[];
  fleet: GameState['fleet']; dives: Record<string, number>; finale: boolean; goalIdx: number; goalsDone: number[];
  maps: TreasureMap[]; musicOn: boolean; offers: Record<string, Contract[]>; active: Contract[]; pity: number; clock: number;
}
/** The v2 save, migrated on first load. */
interface OldSave {
  coins: number; earned: number; up?: { oars?: number; hull?: number; hold?: number; rod?: number };
  found: string[]; salvaged: string[]; lastPort: string | null; log?: Record<string, number>; x: number; y: number; a: number;
}

export function saveGame(): void {
  try {
    const b = G.boat;
    const data: SaveData = {
      savedAt: Date.now(), coins: G.coins, earned: G.earned, up: G.up, hp: b.hp, hold: G.hold, log: G.log, boatId: G.boatId, owned: G.owned,
      bait: G.bait, baitSel: G.baitSel, paint: G.paint, paints: G.paints, found: [...G.found], salvaged: [...G.salvaged], lastPort: G.lastPort, x: b.x, y: b.y, a: b.a,
      stats: G.stats, story: G.story, gifts: G.gifts, pet: G.pet, projects: G.projects, fleet: G.fleet, dives: G.dives, finale: G.finale,
      goalIdx: G.goalIdx, goalsDone: G.goalsDone, maps: G.maps, musicOn: G.musicOn, offers: G.offers, active: G.active, pity: G.pity, clock: G.clock,
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    netSaved();
  } catch { }   // storage full or unavailable: keep playing
}
export function hasSave(): boolean {
  try { return !!(localStorage.getItem(KEY) || localStorage.getItem(OLD)); } catch { return false; }
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
  b.vx = b.vy = b.w = 0;
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
    stats: freshStats(), goalIdx: 0, goalsDone: [], maps: [], offers: {}, active: [], pity: 0,
    clock: DAYLEN * 0.08, frenzy: null, nextFrenzy: 45, card: null, projects: [], fleet: {}, dives: {}, finale: false, gifts: {}, pet: null, dry: 0, story: null, talk: null,
  };
  Object.assign(G, fresh);
  const home = homePort();
  G.lastPort = home.id;
  G.found.add(home.id);
  G.boat.hp = hpMax();
  placeAtPort(home);
  scatterSpawn(home);
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
const int = (v: number | undefined): number => (v ?? 0) | 0;

export function loadGame(): void {
  try {
    let d = readJson<Partial<SaveData>>(KEY);
    newGame();
    if (!d) {
      const o = readJson<OldSave>(OLD);
      if (!o) return;
      d = migrateOld(o);
    }
    const loaded: Partial<GameState> = {
      coins: int(d.coins), coinsShown: int(d.coins), earned: int(d.earned), up: { ...G.up, ...d.up }, hold: (d.hold || []).filter(f => f && typeof f === 'object'),
      log: d.log || {}, boatId: d.boatId || 'row', owned: d.owned || ['row'], bait: { ...G.bait, ...d.bait }, baitSel: d.baitSel || 'shrimp',
      paint: d.paint || 'classic', paints: d.paints || ['classic'],
      found: new Set(d.found || []), salvaged: new Set(d.salvaged || []), lastPort: d.lastPort || G.lastPort, stats: { ...G.stats, ...d.stats },
      story: d.story || null, gifts: d.gifts || {}, pet: d.pet || null, projects: d.projects || [], fleet: d.fleet || {}, dives: d.dives || {},
      finale: !!d.finale, goalIdx: int(d.goalIdx), goalsDone: d.goalsDone || [], maps: d.maps || [], musicOn: d.musicOn ?? true,
      offers: d.offers || {}, active: d.active || [], pity: int(d.pity), clock: d.clock ?? G.clock,
    };
    Object.assign(G, loaded);
    G.boat.hp = clamp(d.hp ?? hpMax(), 1, hpMax());
    // older saves stored destination names in capitals
    for (const c of [...G.active, ...Object.values(G.offers).flat()]) if (c && c.to) c.toName = portById(c.to).name;
    const { x, y } = d, a = d.a || 0;
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && hAt(x, y) < -0.05) {
      Object.assign(G.boat, { x, y, a, px: x, py: y, pa: a });
      G.cam.x = x - W / 2; G.cam.y = y - H / 2;
    } else placeAtPort(portById(G.lastPort));
  } catch { newGame(); }   // a corrupt save starts a fresh voyage rather than a broken one
}
