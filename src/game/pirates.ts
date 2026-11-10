// Pirates of the far waters. Each cove (world.ts placeCove) keeps a few ships at anchor; they weigh anchor and patrol
// the bay when you sail near, give chase when they spot you, and fight by their captains' ways:
//   raiders (sloops) make hit-and-run passes at your quarters, swivels blazing, and if you let one lie alongside she
//     throws grappling hooks and boards you for your catch (fire into her, or sail hard to cut free);
//   gunners (brigantines) work round to your bow or stern to rake you, chain shot to slow you first;
//   brawlers (some brigantines) square up and charge to ram (a straight run you can turn out of), grapeshot alongside;
//   warships (galleons) stand off at long range, broadsides and mortar, fire shot to set you ablaze, and now and then
//     a double-shotted broadside, run out slowly, that can break you if you stay in its arc;
//   bombers (bomb ketches) keep their distance and lob mortar shells, ranging long and short and walking them in onto
//     you (change course and they lose the range), dropping kegs if you get close;
//   chasers (oared galleys) row wherever they like whatever the wind, lie bow-on and fire one long bow gun (get on
//     her beam, where she has nothing);
//   fire ships (burning hulks) are sailed straight at you and blow up alongside: sink one early, or let her drift
//     into the other pirates.
// Your lookout calls what each ship is doing as she does it (PIRATES.call), so a fight can be read from the deck.
// An encounter unfolds as it did in the age of sail: a sail sighted, flying no colours, that shadows you while you
// wonder; then, at gun range, the black flag and the hail to heave to. Stop and you pay a tribute from your hold and
// she lets you go (pirates wanted the prize, not a fight); run (upwind, where a square rig can't follow), or refuse and
// get a shot across your bow, then the red flag: no quarter. A few merciless captains skip the parley. In a fight every
// captain keeps out of your loaded broadside arcs and presses in while you reload, dodges shot it sees coming, spreads
// out to flank you, and runs its guns out before it fires (a long moment to turn away). Guns are slow and heavy
// (arms.ts): a fight is manoeuvring round a few big volleys. Badly holed, a ship runs home (dropping kegs behind it) or
// strikes her colours for you to board; sink the flagship and the rest lose heart. Sailing ships can't point into the
// wind: they tack. Harbours are safe and storms keep them at anchor. The shot flies in gunnery.ts.
import { G } from './state';
import { boatDef, gearLvl, hpMax, isNight, dayNum, windEfficiency, DAYLEN } from './rules';
import { addCoins, burst, celebrate, spawn, toast } from './feedback';
import { saveGame } from './save';
import { sink } from './physics';
import { clearLine, planRoute } from './route';
import { GRAVITY, blast, launch, leadPoint, muzzle, shellTime, stepBalls, stepKegs, type Ball, type Gunner, type Keg } from './gunnery';
import {
  AIR, AWE, BARRAGE, BOARDERS, BROADSIDE, CHASER, KEGS, MISSILE, MORTAR, RAKE, RAM, SHOTS, SWIVEL, TORPEDO, TURRET, ahead, freshWounds, inRail, mend, raking, reloadFactor, speedFactor, wound,
  type BoughtShot, type ShotKind, type Wounds,
} from './arms';
import { buriedMap } from './treasure';
import { PIRATE_FROM, heightAt, nearestWater, poisNear } from '../world';
import { HOME_ISLAND } from '../../convex/islandRules';
import { PAINTS } from '../econ';
import { SHIP_DIMS, SCHEME_COUNT, RED_FLAG, type PirateHull } from '../pirateships';
import { SET } from '../prefs';
import { sfx } from '../audio';
import { track, bucket } from '../analytics';
import { clamp, dirTo, wrapAngle } from '../config';
import { WX } from '../weather';
import { fnv1a } from '../noise';
import type { Cove, Point, Poi, TreasureMap } from '../types';

export type PirateKind = 'sloop' | 'brig' | 'galleon' | 'ketch' | 'galley' | 'fireship';
export type Role = 'raider' | 'gunner' | 'brawler' | 'warship' | 'bomber' | 'chaser' | 'fireship';
interface KindDef {
  /** its hull (pirateships.ts) and what it's called */
  hull: PirateHull; name: string;
  hp: number; speed: number; turn: number;
  /** guns a rail (0: none), damage a ball, seconds to reload a rail, reach and arc either side of the beam */
  guns: number; dmg: number; reload: number; range: number; arc: number;
  /** a bow swivel, a mortar, kegs to drop, and the special shot its gunners load when it pays */
  swivel: boolean; mortar: boolean; kegs: boolean; shots: readonly ShotKind[];
  /** fore-and-aft rigs sail closer to the wind than square riggers; oars don't care where the wind is */
  rig: 'fore' | 'square' | 'oars';
  /** how far it spots you, its gunners' skill 0..1, coins aboard and the chance of a treasure map */
  sight: number; skill: number; loot: number; mapChance: number;
  /** the fighting ways its captains may have */
  roles: readonly Role[];
}
export const KINDS: Record<PirateKind, KindDef> = {
  sloop: { hull: 'sloop', name: 'sloop', hp: 70, speed: 54, turn: 1.0, guns: 1, dmg: 18, reload: 11, range: 150, arc: 0.6, swivel: true, mortar: false, kegs: true, shots: ['grape'], rig: 'fore', sight: 330, skill: 0.55, loot: 90, mapChance: 0.25, roles: ['raider'] },
  brig: { hull: 'brig', name: 'brigantine', hp: 170, speed: 58, turn: 0.6, guns: 2, dmg: 22, reload: 12, range: 175, arc: 0.55, swivel: false, mortar: false, kegs: false, shots: ['chain', 'grape'], rig: 'square', sight: 380, skill: 0.65, loot: 220, mapChance: 0.4, roles: ['gunner', 'brawler'] },
  galleon: { hull: 'galleon', name: 'galleon', hp: 320, speed: 44, turn: 0.4, guns: 3, dmg: 26, reload: 14, range: 195, arc: 0.55, swivel: true, mortar: true, kegs: false, shots: ['fire'], rig: 'square', sight: 420, skill: 0.72, loot: 480, mapChance: 0.7, roles: ['warship'] },
  ketch: { hull: 'ketch', name: 'bomb ketch', hp: 95, speed: 48, turn: 0.76, guns: 0, dmg: 0, reload: 0, range: 0, arc: 0, swivel: true, mortar: true, kegs: true, shots: [], rig: 'fore', sight: 400, skill: 0.7, loot: 160, mapChance: 0.35, roles: ['bomber'] },
  galley: { hull: 'galley', name: 'galley', hp: 110, speed: 46, turn: 0.75, guns: 0, dmg: 0, reload: 0, range: 0, arc: 0, swivel: false, mortar: false, kegs: false, shots: [], rig: 'oars', sight: 380, skill: 0.75, loot: 150, mapChance: 0.3, roles: ['chaser'] },
  fireship: { hull: 'sloop', name: 'fire ship', hp: 45, speed: 50, turn: 0.85, guns: 0, dmg: 0, reload: 0, range: 0, arc: 0, swivel: false, mortar: false, kegs: false, shots: [], rig: 'fore', sight: 360, skill: 0.5, loot: 0, mapChance: 0, roles: ['fireship'] },
};
/** A galley's long bow gun: she has to point at you to fire it. */
const P_BOWGUN = { dmg: 55, reload: 14, range: 280, arc: 0.22 };
/** A fire ship's blast: how far it reaches and how hard it hits at the middle; how long she burns before she blows anyway. */
export const FIRESHIP = { reach: 55, dmg: 130, burn: 35 };
/** The guns pirates carry beyond their broadsides. */
const P_SWIVEL = { dmg: 12, reload: 6, range: 120, arc: 1.1 }, P_MORTAR = { dmg: 60, splash: 16, reload: 20, min: 110, range: 300 }, P_KEG = { dmg: 70, reach: 16, every: 12 };
const SHIP_NAMES = ['Black Gull', 'Salt Wraith', 'Rusty Cutlass', 'Widow\'s Grin', 'Sea Jackal', 'Crimson Tide', 'Gallows Bird', 'Drowned Crow',
  'Night Heron', 'Grim Tern', 'Bilge Rat', 'Iron Mary', 'Sly Mackerel', 'Hungry Shark', 'Bone Reaper', 'Mad Petrel',
  'Cursed Pelican', 'Red Lantern', 'Wicked Wren', 'Salty Dog', 'Kraken\'s Kiss', 'Silent Moray', 'Devil\'s Due', 'Rum Runner'];

/**
 * What a ship is doing: riding at anchor, sailing round its bay, shadowing you under no colours, hailing you under the
 * black flag to heave to, coming alongside for her tribute, sailing home with it; after you under the red flag (no
 * quarter), fighting, running home, colours struck (waiting to be boarded), boarded and let go, going down.
 */
export type Mood = 'anchored' | 'patrol' | 'shadow' | 'hail' | 'tribute' | 'sated' | 'chase' | 'engage' | 'flee' | 'surrender' | 'struck' | 'sinking';
export interface Pirate {
  id: string; kind: PirateKind; role: Role; cove: Cove; name: string;
  /** 0 near the edge of the pirate waters .. 1 far out: further out they're tougher and richer */
  tier: number;
  x: number; y: number; a: number; vx: number; vy: number; w: number;
  hp: number; max: number; wounds: Wounds;
  mood: Mood;
  /** seconds in the current mood, until the next look round, and of anger left after being shot at */
  t: number; think: number; aggro: number;
  /** where it's heading (patrol), the heading it wants, and which way it circles in a fight (+1 keeps you to starboard) */
  goal: Point | null; want: number; side: 1 | -1;
  /** seconds until each rail (port, starboard) is loaded, and of running its guns out before they fire (-1: not) */
  reload: [number, number]; aim: [number, number];
  swivelT: number; mortarT: number; kegT: number;
  /** a gunner's chosen station round you (bearing off your bow, distance), when it chose it, and sails eased to hold it */
  station: { rel: number; d: number } | null; stationAt: number; easy: boolean;
  /** sailing alongside you at your speed (a raider closing to hook on) */
  match: boolean;
  /** a raider's run: in at you, or out to come round again, and seconds left of it */
  run: 'in' | 'out'; runT: number;
  /** a turn away from shot it saw coming, until game time `until` */
  dodge: { until: number; h: number } | null;
  /** whether this captain strikes his colours when beaten, rather than running; whether he skips the parley altogether */
  yields: boolean; merciless: boolean;
  /** the parley: seconds left before she fires, whether she's put a shot across your bow, seconds you've lain hove to */
  parley: number; warned: boolean; hove: number;
  /** a raider alongside: seconds closing to throw the hooks, seconds grappled (her boarders' progress), damage taken while grappled */
  hooks: number; grapple: number; repel: number;
  /** a brawler's charge: squaring up ('aim') then running straight at you on heading h ('go') until game time `until`; seconds till the next */
  charge: { phase: 'aim' | 'go'; until: number; h: number } | null; chargeCd: number;
  /** a galleon's double-shotted broadside: seconds until the next, and whether the guns run out now are double-shotted */
  heavyT: number; heavy: boolean;
  /** a mortar ranging on you: shells fired since you last changed course, and your heading and speed then */
  bracket: { n: number; a: number; s: number };
  /** a galley's bow gun: seconds to reload, and of laying it on you before it fires (-1: not); a fire ship: seconds alight (-1: not yet) */
  bowT: number; bowAim: number; lit: number;
  /** a route round the land to where it's going, and when it was planned */
  path: Point[]; pathAt: number;
  /** seconds pressed against the shore, and of turning hard away after that */
  stuck: number; unstick: number;
  /** roll for the renderer, seconds since it started to sink, her colours and her crew's own black flag, and foam owed to her wake */
  heel: number; sinkT: number; scheme: number; flag: number; wake: number;
}
interface Loot { x: number; y: number; coins: number; map: TreasureMap | null; ph: number; t: number }
/** A torpedo running under the water: where it is, its heading, and how far it has run. */
interface Torpedo { x: number; y: number; a: number; run: number }
/** A guided missile in flight: where it is, its heading, the pirate it's homing on, and how far it has flown. */
interface Missile { x: number; y: number; a: number; target: Pirate; run: number }
/** A plane of a carrier's air wing aloft: where, how high, heading and bank, the pirate it's after, bombs left, whether
 *  it's running in to bomb (or out, to turn and come again), and whether it's flying home. */
interface Plane { x: number; y: number; z: number; a: number; bank: number; target: Pirate | null; bombs: number; inbound: boolean; home: boolean }
/** A gun in a volley, waiting its turn: where it fires from, at what (pirates aim as they fire), how wide it misses. */
interface Shot { at: number; from: Gunner; ship: Pirate | null; x: number; y: number; ax: number; ay: number; dmg: number; miss: number; shot: ShotKind }
/** Your guns: seconds until each rail and the swivel, mortar, bow chaser and turrets are loaded, the turrets' bearing
 *  off your bow, kegs aboard (and the rack level they were filled for), the shot you're loading, your wounds; and a
 *  coast guard cutter's boarders on a pirate's deck (seconds at it, and seconds you've been sailing hard enough to tear
 *  the grapples out). */
export interface Battery {
  rails: [number, number]; swivel: number; mortar: number; chaser: number; turret: number; turretA: number;
  /** a destroyer's torpedo tubes, a missile cruiser's cells or a carrier's planes: how many (a new boat comes with hers
   *  loaded), ready now (planes on deck, armed), and seconds into reloading the next */
  tubes: number; loaded: number; tubeT: number;
  kegs: number; kegT: number; rack: number; shot: ShotKind; wounds: Wounds;
  taking: { p: Pirate; t: number; slip: number } | null;
}
const freshBattery = (): Battery => ({ rails: [0, 0], swivel: 0, mortar: 0, chaser: 0, turret: 0, turretA: 0, tubes: 0, loaded: 0, tubeT: 0, kegs: 0, kegT: 0, rack: 0, shot: 'round', wounds: freshWounds(), taking: null });

/** Everything afloat in the pirate fight, for the renderer and the HUD. */
export const PIRATES = {
  ships: [] as Pirate[], balls: [] as Ball[], kegs: [] as Keg[], loot: [] as Loot[], torps: [] as Torpedo[], missiles: [] as Missile[], planes: [] as Plane[],
  /** shots waiting for their turn in a rippling volley */
  salvo: [] as Shot[],
  me: freshBattery(),
  /** what your lookout last called out, how urgent (higher wins), and when (game time) */
  call: null as { s: string; pri: number; t: number } | null,
};
/** Seconds a lookout's call stays up. */
export const CALL_S = 2.8;
/** The lookout calls out what a ship is doing. A more urgent call cuts in; a less urgent one waits until the last is said. */
function call(s: string, pri: number): void {
  const c = PIRATES.call;
  if (c && G.t - c.t < CALL_S && pri < c.pri) return;
  if (c && c.s === s && G.t - c.t < CALL_S) return;
  PIRATES.call = { s, pri, t: G.t };
}
/** Where a ship lies from your boat, the way a lookout says it: off the port bow, on the starboard beam, dead astern. */
export function whereIs(p: Point): string {
  const rel = wrapAngle(bearing(G.boat, p) - G.boat.a), side = rel > 0 ? 'starboard' : 'port', r = Math.abs(rel);
  return r < 0.35 ? 'dead ahead' : r > Math.PI - 0.35 ? 'dead astern' : r < Math.PI / 2 - 0.45 ? `off the ${side} bow` : r < Math.PI / 2 + 0.45 ? `on the ${side} beam` : `off the ${side} quarter`;
}
/** "The brigantine", as the lookout names a ship. */
const The = (p: Pirate): string => `The ${KINDS[p.kind].name}`;
/** How each captain fights, and how to beat her: told once a voyage, the first time you fight one. */
const WAYS: Record<Role, string> = {
  raider: 'Sloops are quick and lightly armed. She\'ll dart at your quarter and, if you let her lie alongside, grapple and board you. Keep moving, and give her grapeshot',
  gunner: 'Her gunners fire chain at your rigging to slow you, then work round your bow or stern to rake you. Keep her abeam',
  brawler: 'Her captain likes to ram. When she squares up and charges, turn across her bow and give her your broadside as she passes',
  warship: 'A galleon is slow, but her broadsides are heavy, and now and then double-shotted. Stay out of her arcs and work round to her stern',
  bomber: 'A bomb ketch lobs shells from afar and walks them onto you. Change course after each splash, or close in where her mortar can\'t reach',
  chaser: 'A galley rows wherever she likes, wind or no wind, and carries one long gun in her bow. Get onto her beam, where she has nothing',
  fireship: 'A fire ship is a burning hulk sailed straight at you to blow up alongside. Sink her before she\'s lit, keep clear, or let her drift into her friends',
};
const told = new Set<Role>();
function tellWays(p: Pirate): void {
  if (told.has(p.role)) return;
  told.add(p.role);
  toast(`${cap(p.name)}, a ${KINDS[p.kind].name}. ${WAYS[p.role]}`, 'info');
}
/** cove ship slot -> game clock when it was sunk or taken; a slot's ship comes back a day later */
const sunkAt = new Map<string, number>();
/** coves whose crews have already shouted that they've seen you, this voyage */
const shouted = new Set<string>();
/** cove -> game clock when you last paid its ships a tribute: they leave you be for half a day */
const paidAt = new Map<string, number>();

const RESPAWN = DAYLEN;               // a game day
const RAID_DAYS = 2;                  // a raided cove lies quiet this many days
const SAFE_R = 330;                   // pirates keep this far from any harbour
const LEASH = 1500;                   // and don't chase further than this from their cove
const NEAR = 1100;                    // coves this close to you have their ships out
const HUNTERS = 2;                    // at most this many ships come after you at once (unless you shoot at more)
const AIM_S = 1.3;                    // seconds a pirate's guns are run out before they fire: time to turn away
const HEAVY = 1.8;                    // a double-shotted broadside's damage, times the usual
const PARLEY = 16;                    // seconds a hailing ship gives you to heave to
const HEAVE = 2;                      // seconds lying still that count as heaving to
const HAIL_R = 230;                   // how close she comes to hail you (a speaking trumpet carries about a cable)
const TAU = Math.PI * 2;

/** A ship's half-length and half-beam (like a BoatDef's L and B: the hull runs from -L to +L). */
export const lengthOf = (p: Pirate): number => SHIP_DIMS[KINDS[p.kind].hull].L;
const beamOf = (p: Pirate): number => SHIP_DIMS[KINDS[p.kind].hull].B;
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const bearing = (from: Point, to: Point): number => Math.atan2(to.y - from.y, to.x - from.x);
const alive = (p: Pirate): boolean => p.mood !== 'sinking';
/** Close enough alongside your boat to board, or be boarded from. */
const alongside = (p: Pirate): boolean => dist(p, G.boat) < beamOf(p) + boatDef().B + 30;
/** A ship still fighting (not sinking, struck or let go): one your guns go for, and one that shoots back. */
export const hostile = (p: Pirate): boolean => p.mood !== 'sinking' && p.mood !== 'surrender' && p.mood !== 'struck';
/** How far out a cove lies in the pirate waters, 0..1. */
export const tierOf = (c: Point): number => clamp((dist(c, HOME_ISLAND) - PIRATE_FROM) / 5000, 0, 1);
/** The ships a cove keeps: one, then two and three further out, bigger the further, a bomb ketch or a galley among
 *  some, and a fire ship kept ready in a few of the far ones. */
export function fleetOf(c: Cove): PirateKind[] {
  const t = tierOf(c), h = fnv1a(c.id), out: PirateKind[] = [t > 0.45 ? 'brig' : 'sloop'];
  if (t > 0.2) out.push(t > 0.35 && h % 3 === 0 ? 'ketch' : t > 0.28 && h % 4 === 1 ? 'galley' : 'sloop');
  if (t > 0.55) out.push('galleon');
  if (t > 0.4 && h % 5 === 2) out.push('fireship');
  return out;
}
/** Whether the captain of a cove's ship `id` gives no quarter, skipping the parley (one in five, never a galleon's). */
const merciless = (id: string, kind: PirateKind): boolean => kind === 'fireship' || (kind !== 'galleon' && (fnv1a(id) >> 7) % 5 === 0);
/** What the sailors in port say of a cove: the ships it keeps, and whether they give quarter (for the inn's rumours). */
export function coveWord(c: Cove): { fleet: string; merciless: boolean; quiet: boolean } {
  const kinds = fleetOf(c), n = new Map<PirateKind, number>();
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1);
  const parts = [...n].map(([k, m]) => m > 1 ? `${m === 2 ? 'two' : 'three'} ${KINDS[k].name}s` : `a ${KINDS[k].name}`);
  return {
    fleet: parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0],
    merciless: kinds.some((k, slot) => merciless(`${c.id}#${slot}`, k)), quiet: quiet(c),
  };
}
const quiet = (c: Cove): boolean => G.raids[c.id] !== undefined && dayNum() - G.raids[c.id] < RAID_DAYS;
const hearAt = (x: number, y: number): number => clamp(1 - Math.hypot(x - G.boat.x, y - G.boat.y) / 520, 0, 1);
const randn = (): number => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
/** Pirates hunt only while you're out sailing, pirates are switched on, and you're clear of every harbour (worked out
 *  once a frame, in updatePirates). */
let huntNow = false;
function hunting(): boolean {
  if (!SET.pirates || G.mode !== 'play' || G.god) return false;
  return !poisNear(G.boat.x, G.boat.y, SAFE_R, poiScratch).some(p => p.type === 'port' && dist(p, G.boat) < SAFE_R);
}
const poiScratch: Poi[] = [];

// ---------------------------------------------------------------- your guns
/** Torn rigging slows your boat (physics.ts). */
export const rigFactor = (): number => speedFactor(PIRATES.me.wounds);
/** How long your gun crews take to reload, times the usual: slower with men down, faster aboard a drilled warship. */
export const crewReload = (): number => reloadFactor(PIRATES.me.wounds) * (boatDef().gunnery ?? 1);
/** Prize money: a warship sailing under a letter of marque earns more for every pirate taken, sunk or raided. */
const prize = (coins: number): number => Math.round(coins * (1 + (boatDef().marque ?? 0)));
/** The broadside guns' reach with the shot you're loading. */
const railRange = (): number => (BROADSIDE[gearLvl('cannon')]?.range ?? 0) * SHOTS[PIRATES.me.shot].reach;
/** The nearest fighting pirate in reach of rail `side`, with open water between, or null. */
function railTarget(side: 1 | -1): Pirate | null {
  const B = BROADSIDE[gearLvl('cannon')];
  if (!B) return null;
  let best: Pirate | null = null, bd = railRange();
  for (const p of PIRATES.ships) {
    const d = dist(p, G.boat);
    if (hostile(p) && d < bd && inRail(G.boat.a, bearing(G.boat, p), side, B.arc) && clearLine(G.boat, p)) { best = p; bd = d; }
  }
  return best;
}
/** The pirate your broadside would fire at now (either rail, loaded or not), or null. */
export function cannonTarget(): Pirate | null { return railTarget(1) ?? railTarget(-1); }
/** Which rails (port, starboard) have a pirate in their arc right now: for the HUD's arcs. */
export const railsBearing = (): [boolean, boolean] => [!!railTarget(-1), !!railTarget(1)];
/** A cutter's bow chaser's mark: the nearest fighting pirate within its narrow arc dead ahead and in its reach, or null. */
export function chaserTarget(): Pirate | null {
  if (boatDef().signature !== 'chaser') return null;
  const b = G.boat;
  let best: Pirate | null = null, bd: number = CHASER.range;
  for (const p of PIRATES.ships) {
    const d = dist(p, b);
    if (hostile(p) && d < bd && ahead(b.a, bearing(b, p), CHASER.arc) && clearLine(b, p)) { best = p; bd = d; }
  }
  return best;
}
/** A dreadnought's turrets' mark: the nearest fighting pirate in its reach with open water between, on any bearing. */
export function turretTarget(): Pirate | null {
  if (boatDef().signature !== 'turret') return null;
  let best: Pirate | null = null, bd: number = TURRET.range;
  for (const p of PIRATES.ships) { const d = dist(p, G.boat); if (hostile(p) && d < bd && clearLine(G.boat, p)) { best = p; bd = d; } }
  return best;
}
/** How far the turrets have still to train onto their mark (radians, signed), or null with nothing to lay on. */
export function turretOff(): number | null {
  const t = turretTarget();
  return t && wrapAngle(bearing(G.boat, t) - G.boat.a - PIRATES.me.turretA);
}
/**
 * R: fire every loaded rail with a pirate in its arc, aimed where it will be, a cutter's bow chaser if she's dead
 * ahead, a dreadnought's turrets once they're laid on her; with no pirate about, a salute from both rails.
 */
export function fireBroadside(): void {
  const B = BROADSIDE[gearLvl('cannon')], me = PIRATES.me, bd = boatDef();
  if (!B && bd.signature !== 'turret') { toast('No cannons aboard. Fit them at a harbour outfitter (Arms)', 'bad', 'sailing'); return; }
  if (G.mode !== 'play') return;
  let fired = fireChaser() || fireTurret();
  if (!B) return;
  const b = G.boat, targets: [Pirate | null, Pirate | null] = [railTarget(-1), railTarget(1)], guns = B.guns;
  const salute = !targets[0] && !targets[1] && !PIRATES.ships.some(p => hostile(p) && dist(p, b) < 450);
  for (const s of [-1, 1] as const) {
    const rail = s < 0 ? 0 : 1, target = targets[rail];
    if (me.rails[rail] > 0 || (!target && !salute)) continue;
    const shot = loadShot(), def = SHOTS[shot], reach = B.range * def.reach;
    const aim = target ? leadPoint(b.x, b.y, target.x, target.y, target.vx, target.vy) : { x: b.x - Math.sin(b.a) * s * reach, y: b.y + Math.cos(b.a) * s * reach };
    const miss = dist(b, aim) * 0.035 + 2;
    for (let g = 0; g < guns; g++) {
      const u = (g - (guns - 1) / 2) * bd.L * 1.2 / (guns + 1), x = b.x + Math.cos(b.a) * u - Math.sin(b.a) * s * bd.B, y = b.y + Math.sin(b.a) * u + Math.cos(b.a) * s * bd.B;
      for (let k = 0; k < def.pellets; k++) {
        const spread = def.pellets > 1 ? 9 : 0;
        PIRATES.salvo.push({ at: G.t + g * 0.09 + k * 0.01, from: 'player', ship: null, x, y, ax: aim.x + randn() * (miss + spread), ay: aim.y + randn() * (miss + spread), dmg: B.dmg * def.dmg, miss: 0, shot });
      }
    }
    me.rails[rail] = B.reload * crewReload();
    fired = true;
    if (target) provoke(target);
  }
  if (fired) G.shake = Math.max(G.shake, 1.2);
}
/** A dreadnought's salvo thunders: every pirate near already beaten below AWE.hull loses heart. */
function overawe(): void {
  for (const p of PIRATES.ships) {
    if (!hostile(p) || p.role === 'fireship' || p.hp >= p.max * AWE.hull || dist(p, G.boat) > AWE.reach) continue;
    beaten(p, 0);
    call(p.mood === 'surrender' ? `${cap(p.name)} strikes! She won't stand against a dreadnought` : `${cap(p.name)} breaks and runs from our guns!`, 4);
  }
}
/** The turrets fire every gun at her mark, one great salvo, if they're loaded and laid on her; whether they fired. */
function fireTurret(): boolean {
  const t = turretTarget(), off = turretOff(), me = PIRATES.me, b = G.boat, L = boatDef().L;
  if (!t || off === null || me.turret > 0 || Math.abs(off) > TURRET.lay) return false;
  const a = b.a + me.turretA, aim = leadPoint(b.x, b.y, t.x, t.y, t.vx, t.vy), miss = dist(b, aim) * 0.03 + 2;
  for (const [k, at] of TURRET.at.entries()) {
    const x0 = b.x + Math.cos(b.a) * L * at, y0 = b.y + Math.sin(b.a) * L * at;
    for (const side of [-1, 1]) {
      const x = x0 - Math.sin(a) * side * 1.5 + Math.cos(a) * 6, y = y0 + Math.cos(a) * side * 1.5 + Math.sin(a) * 6;
      PIRATES.salvo.push({ at: G.t + k * 0.12 + (side + 1) * 0.03, from: 'player', ship: null, x, y, ax: aim.x + randn() * miss, ay: aim.y + randn() * miss, dmg: TURRET.dmg, miss: 0, shot: 'round' });
    }
  }
  me.turret = TURRET.reload * crewReload();
  G.shake = Math.max(G.shake, 3);
  call('Salvo!', 2);
  provoke(t);
  overawe();
  return true;
}
/** The bow chaser fires at her mark if it's loaded and she's dead ahead; whether it fired. */
function fireChaser(): boolean {
  const target = chaserTarget(), b = G.boat, me = PIRATES.me;
  if (!target || me.chaser > 0) return false;
  const L = boatDef().L, x = b.x + Math.cos(b.a) * L, y = b.y + Math.sin(b.a) * L, aim = leadPoint(x, y, target.x, target.y, target.vx, target.vy), miss = dist(b, aim) * 0.025 + 2;
  launch(PIRATES.balls, 'player', x, y, aim.x + randn() * miss, aim.y + randn() * miss, CHASER.dmg);
  muzzle(x, y, bearing({ x, y }, aim), 1);
  me.chaser = CHASER.reload * crewReload();
  provoke(target);
  return true;
}
/** The shot to load for a volley: the chosen kind while it lasts (one box is a volley), else round shot. */
function loadShot(): ShotKind {
  const me = PIRATES.me;
  if (me.shot === 'round') return 'round';
  const k = me.shot as BoughtShot;
  if ((G.ammo[k] ?? 0) <= 0) { me.shot = 'round'; toast(`Out of ${SHOTS[k].name.toLowerCase()}: loading round shot`, 'bad', 'sailing'); return 'round'; }
  G.ammo[k]--;
  return k;
}
/** Z: load the next kind of shot you carry. */
export function cycleShot(): void {
  const me = PIRATES.me, kinds = (['round', 'chain', 'grape', 'fire'] as const).filter(k => k === 'round' || (G.ammo[k] ?? 0) > 0);
  me.shot = kinds[(kinds.indexOf(me.shot as typeof kinds[number]) + 1) % kinds.length];
  sfx('move');
  toast(me.shot === 'round' ? 'Loading round shot' : `Loading ${SHOTS[me.shot].name.toLowerCase()} (${G.ammo[me.shot as BoughtShot]} volleys)`, 'info', 'sailing');
}
/** The nearest fighting pirate between the mortar's least and greatest range, or null. */
export function mortarTarget(): Pirate | null {
  const M = MORTAR[gearLvl('mortar')], b = G.boat;
  if (!M) return null;
  let best: Pirate | null = null, bd: number = M.range;
  for (const p of PIRATES.ships) { const d = dist(p, b); if (hostile(p) && d > M.min && d < bd) { best = p; bd = d; } }
  return best;
}
/** T: lob a mortar shell onto the nearest pirate in reach, where it will be when the shell lands. */
export function fireMortar(): void {
  const M = MORTAR[gearLvl('mortar')], me = PIRATES.me, b = G.boat;
  if (!M) { toast('No mortar aboard. Fit one at a harbour outfitter (Arms)', 'bad', 'sailing'); return; }
  if (G.mode !== 'play') return;
  if (me.mortar > 0) { toast('The mortar crew is still loading', 'info', 'sailing'); return; }
  const target = mortarTarget();
  if (!target) { toast(`Nothing in mortar range (${M.min / 10} to ${M.range / 10} m off)`, 'info', 'sailing'); return; }
  let aim: Point = target;
  for (let k = 0; k < 2; k++) { const t = shellTime(dist(b, aim)); aim = { x: target.x + target.vx * t, y: target.y + target.vy * t }; }
  // a rocket gunboat's barrage walks its rockets along her course, ahead of her and astern, so turning won't save her
  const n = boatDef().signature === 'barrage' ? BARRAGE.shells : 1, sp = Math.hypot(target.vx, target.vy);
  const ux = sp > 2 ? target.vx / sp : Math.cos(target.a), uy = sp > 2 ? target.vy / sp : Math.sin(target.a);
  for (let k = 0; k < n; k++) {
    const o = (k - (n - 1) / 2) * BARRAGE.step;
    launch(PIRATES.balls, 'player', b.x, b.y, aim.x + ux * o + randn() * 6, aim.y + uy * o + randn() * 6, M.dmg * (n > 1 ? BARRAGE.dmg : 1), 'round', M.splash);
  }
  muzzle(b.x, b.y, bearing(b, aim), 1, true);
  me.mortar = M.reload * crewReload();
  G.shake = Math.max(G.shake, 2.5);
  provoke(target);
}
/** Where a torpedo fired now would run: angled (at most TORPEDO.gyro off the bow) to meet the nearest fighting pirate
 *  roughly ahead, or straight ahead with none; and that pirate. */
export function torpedoCourse(): { a: number; target: Pirate | null } {
  const b = G.boat, L = boatDef().L, x = b.x + Math.cos(b.a) * L, y = b.y + Math.sin(b.a) * L;
  let target: Pirate | null = null, bd: number = TORPEDO.range;
  for (const p of PIRATES.ships) {
    const d = dist(p, b);
    if (hostile(p) && d < bd && Math.abs(wrapAngle(bearing(b, p) - b.a)) < TORPEDO.gyro + 0.25 && clearLine(b, p)) { target = p; bd = d; }
  }
  if (!target) return { a: b.a, target };
  const aim = leadPoint(x, y, target.x, target.y, target.vx, target.vy, TORPEDO.speed);
  return { a: b.a + clamp(wrapAngle(bearing({ x, y }, aim) - b.a), -TORPEDO.gyro, TORPEDO.gyro), target };
}
/** A missile's mark: the nearest fighting pirate in its reach, on any bearing (it flies over land), or null. */
export function missileTarget(): Pirate | null {
  let best: Pirate | null = null, bd: number = MISSILE.range;
  for (const p of PIRATES.ships) { const d = dist(p, G.boat); if (hostile(p) && d < bd) { best = p; bd = d; } }
  return best;
}
/** A plane's mark: the fighting pirate nearest `from` within the air wing's reach of your carrier, or null. */
export function airTarget(from: Point = G.boat): Pirate | null {
  let best: Pirate | null = null, bd = Infinity;
  for (const p of PIRATES.ships) { const d = dist(p, from); if (hostile(p) && dist(p, G.boat) < AIR.range && d < bd) { best = p; bd = d; } }
  return best;
}
/** Your launcher, if your ship has one: a destroyer's torpedo tubes, a missile cruiser's cells or a carrier's planes. */
export const launcher = (): { kind: 'torpedo' | 'missile' | 'air'; n: number; reload: number } | null => {
  const sig = boatDef().signature;
  return sig === 'torpedo' ? { kind: sig, n: TORPEDO.tubes, reload: TORPEDO.reload } : sig === 'missile' ? { kind: sig, n: MISSILE.cells, reload: MISSILE.reload }
    : sig === 'air' ? { kind: sig, n: AIR.planes, reload: AIR.rearm } : null;
};
/** What a launcher would fire at now: the pirate a torpedo would meet, a missile's or a plane's mark. */
export const launcherTarget = (kind: 'torpedo' | 'missile' | 'air'): Pirate | null => kind === 'torpedo' ? torpedoCourse().target : kind === 'missile' ? missileTarget() : airTarget();
/** Y: a destroyer fires a torpedo from her bow tubes (on torpedoCourse); a missile cruiser launches a missile at the
 *  nearest pirate; a carrier launches a plane after the nearest pirate within its reach. */
export function fireLauncher(): void {
  const me = PIRATES.me, b = G.boat, l = launcher();
  if (!l) { toast('No torpedoes, missiles or planes aboard. A destroyer, a missile cruiser or a carrier carries them', 'bad', 'sailing'); return; }
  if (G.mode !== 'play') return;
  if (me.loaded <= 0) { toast(l.kind === 'torpedo' ? 'The torpedo tubes are reloading' : l.kind === 'missile' ? 'The missile cells are reloading' : 'Every plane is aloft or rearming', 'info', 'sailing'); return; }
  if (l.kind === 'air') {
    const target = airTarget();
    if (!target) { toast(`No pirate within the planes' reach (${AIR.range / 10} m)`, 'info', 'sailing'); return; }
    const L = boatDef().L;
    PIRATES.planes.push({ x: b.x + Math.cos(b.a) * L * 0.6, y: b.y + Math.sin(b.a) * L * 0.6, z: 9, a: b.a, bank: 0, target, bombs: AIR.bombs, inbound: true, home: false });
    me.loaded--;
    sfx('boom', 0.4);
    for (let k = 0; k < 6; k++) spawn({ kind: 'smoke', x: b.x + Math.cos(b.a) * L * (0.6 - k * 0.12), y: b.y + Math.sin(b.a) * L * (0.6 - k * 0.12), z: 9, vx: 0, vy: 0, vz: 2, size: 1.6, dark: 0.05, life: 1.2 });   // the catapult's steam
    call(`Plane launched! Going after the ${KINDS[target.kind].name}`, 2);
    provoke(target);
    return;
  }
  if (l.kind === 'missile') {
    const target = missileTarget();
    if (!target) { toast(`No pirate within missile range (${MISSILE.range / 10} m)`, 'info', 'sailing'); return; }
    PIRATES.missiles.push({ x: b.x, y: b.y, a: bearing(b, target), target, run: 0 });
    me.loaded--;
    burst('debris', b.x, b.y, 6, 20, () => 0.5);
    sfx('boom', 0.5);
    call('Missile away!', 2);
    provoke(target);
    return;
  }
  const { a, target } = torpedoCourse(), L = boatDef().L;
  PIRATES.torps.push({ x: b.x + Math.cos(b.a) * L, y: b.y + Math.sin(b.a) * L, a, run: 0 });
  me.loaded--;
  sfx('slap', 0.7);
  call(target ? 'Torpedo away! Running true for her' : 'Torpedo away!', 2);
  if (target) provoke(target);
}
/** Missiles fly on, trailing smoke, turning onto their mark (or the nearest pirate, if she's gone) until they strike or run out. */
function stepMissiles(dt: number): void {
  for (let i = PIRATES.missiles.length - 1; i >= 0; i--) {
    const m = PIRATES.missiles[i], step = MISSILE.speed * dt;
    if (!hostile(m.target)) m.target = missileTarget() ?? m.target;
    const want = wrapAngle(bearing(m, m.target) - m.a), turn = MISSILE.turn * dt;
    m.a += clamp(want, -turn, turn);
    m.x += Math.cos(m.a) * step; m.y += Math.sin(m.a) * step; m.run += step;
    spawn({ kind: 'spark', x: m.x, y: m.y, z: 7, vx: 0, vy: 0, life: 0.12 });
    if (Math.random() < dt * 40) spawn({ kind: 'smoke', x: m.x, y: m.y, z: 7, vx: 0, vy: 0, vz: 1, size: 1.1, dark: 0.15, life: 0.9 });
    const hit = PIRATES.ships.find(p => alive(p) && p.mood !== 'struck' && inHull(m.x, m.y, 2, p.x, p.y, p.a, lengthOf(p), beamOf(p)));
    if (hit) {
      PIRATES.missiles.splice(i, 1);
      blast(m.x, m.y, 14, hearAt(m.x, m.y));
      G.shake = Math.max(G.shake, 3);
      hurtPirate(hit, MISSILE.dmg, m.x, m.y);
      call('Missile hit!', 3);
    } else if (m.run > MISSILE.range * 1.3) PIRATES.missiles.splice(i, 1);
  }
}
/**
 * Planes fly to their mark and bomb her: a run in, bombs away when they'd fall on where she'll be, a run out far enough
 * to turn and come again, and when the bombs are gone (or no pirate's left in reach) home to land on the carrier,
 * where each one rearms. A carrier gone, or one you've left, takes her planes with her.
 */
function stepPlanes(dt: number): void {
  const b = G.boat, carrier = boatDef().signature === 'air' && G.mode === 'play';
  for (let i = PIRATES.planes.length - 1; i >= 0; i--) {
    const pl = PIRATES.planes[i];
    if (!carrier) { PIRATES.planes.splice(i, 1); continue; }
    if (!pl.home && (!pl.target || !hostile(pl.target) || dist(pl.target, b) > AIR.range * 1.2)) pl.target = airTarget(pl);
    if (!pl.target || pl.bombs <= 0) pl.home = true;
    const fall = Math.sqrt(2 * pl.z / GRAVITY), vx = Math.cos(pl.a) * AIR.speed, vy = Math.sin(pl.a) * AIR.speed;
    let goal: Point;
    if (pl.home) goal = { x: b.x - Math.cos(b.a) * boatDef().L, y: b.y - Math.sin(b.a) * boatDef().L };   // in over her stern
    else {
      const t = pl.target!, there = { x: t.x + t.vx * fall, y: t.y + t.vy * fall }, d = dist(pl, there), lead = AIR.speed * fall;
      if (pl.inbound) {
        const drop = { x: pl.x + vx * fall, y: pl.y + vy * fall };
        if (dist(drop, there) < beamOf(t) + 6) {                              // bombs away: they carry on at her speed as they fall
          PIRATES.balls.push({ x: pl.x, y: pl.y, z: pl.z, vx, vy, vz: 0, from: 'player', dmg: AIR.dmg, shot: 'round', splash: AIR.splash, lx: drop.x, ly: drop.y, flight: fall, t: 0 });
          pl.bombs--; pl.inbound = false;
          call(pl.bombs > 0 ? 'Bombs away! Coming round again' : 'Bombs away! Heading home', 2);
        } else if (d < lead * 0.6) pl.inbound = false;                            // overshot her: run out and come again
      } else if (d > lead * 2.2) pl.inbound = true;
      goal = pl.inbound ? there : { x: pl.x + vx, y: pl.y + vy };
    }
    const turn = clamp(wrapAngle(bearing(pl, goal) - pl.a), -AIR.turn * dt, AIR.turn * dt);
    pl.a += turn; pl.bank += (turn / (AIR.turn * dt || 1) * 0.6 - pl.bank) * Math.min(1, dt * 4);
    const near = dist(pl, b), L = boatDef().L, landing = pl.home && near < L * 3;
    pl.z += ((landing ? 6 + near * 0.15 : AIR.alt) - pl.z) * Math.min(1, dt * 1.2);
    pl.x += Math.cos(pl.a) * AIR.speed * dt; pl.y += Math.sin(pl.a) * AIR.speed * dt;
    if (Math.random() < dt * 10) spawn({ kind: 'smoke', x: pl.x - Math.cos(pl.a) * 4, y: pl.y - Math.sin(pl.a) * 4, z: pl.z, vx: 0, vy: 0, vz: 0, size: 0.8, dark: 0, life: 0.6 });
    if (pl.home && near < L * 1.1) { PIRATES.planes.splice(i, 1); call('Plane back aboard, rearming', 1); }
  }
}
/** Torpedoes run on, trailing a line of bubbles, until they strike a pirate's hull (a great blow), run aground or run out. */
function stepTorps(dt: number): void {
  for (let i = PIRATES.torps.length - 1; i >= 0; i--) {
    const t = PIRATES.torps[i], step = TORPEDO.speed * dt;
    t.x += Math.cos(t.a) * step; t.y += Math.sin(t.a) * step; t.run += step;
    if (Math.random() < dt * 30) spawn({ kind: 'dot', x: t.x, y: t.y, vx: 0, vy: 0, life: 2.4, foam: true });
    const hit = PIRATES.ships.find(p => alive(p) && p.mood !== 'struck' && inHull(t.x, t.y, 0, p.x, p.y, p.a, lengthOf(p), beamOf(p)));
    if (hit) {
      PIRATES.torps.splice(i, 1);
      blast(t.x, t.y, 20, hearAt(t.x, t.y));
      G.shake = Math.max(G.shake, 4);
      hurtPirate(hit, TORPEDO.dmg, t.x, t.y);
      call('Torpedo hit! Right under her waterline', 4);
    } else if (t.run > TORPEDO.range || heightAt(t.x, t.y) > -0.05) PIRATES.torps.splice(i, 1);
  }
}
/** V: roll a powder keg off the stern. */
export function dropKeg(): void {
  const K = KEGS[gearLvl('kegs')], me = PIRATES.me, b = G.boat;
  if (!K) { toast('No powder kegs aboard. Fit a rack at a harbour outfitter (Arms)', 'bad', 'sailing'); return; }
  if (G.mode !== 'play') return;
  if (me.kegs <= 0) { toast('No kegs left. The gunner is making up another', 'info', 'sailing'); return; }
  me.kegs--;
  const L = boatDef().L;
  PIRATES.kegs.push({ x: b.x - Math.cos(b.a) * (L + 4), y: b.y - Math.sin(b.a) * (L + 4), from: 'player', dmg: K.dmg, reach: K.reach, t: 0, ph: Math.random() * TAU });
  sfx('slap', 0.5);
}
/** The bow swivel looks after itself: it fires at any pirate in its arc ahead, in reach, with water between. */
function swivelAuto(): void {
  const S = SWIVEL[gearLvl('swivel')], me = PIRATES.me, b = G.boat;
  if (!S || me.swivel > 0 || G.mode !== 'play' || G.fish) return;
  const target = PIRATES.ships.find(p => hostile(p) && dist(p, b) < S.range && ahead(b.a, bearing(b, p), S.arc) && clearLine(b, p));
  if (!target) return;
  const L = boatDef().L, x = b.x + Math.cos(b.a) * L * 0.8, y = b.y + Math.sin(b.a) * L * 0.8, aim = leadPoint(x, y, target.x, target.y, target.vx, target.vy), miss = dist(b, aim) * 0.05 + 2;
  launch(PIRATES.balls, 'player', x, y, aim.x + randn() * miss, aim.y + randn() * miss, S.dmg);
  muzzle(x, y, bearing({ x, y }, aim), 0.5);
  me.swivel = S.reload * crewReload();
}
/** Firing on a ship makes it angry: whatever it was doing, it's no quarter now. */
function provoke(p: Pirate): void {
  p.aggro = 30;
  if (parleying(p) || p.mood === 'anchored' || p.mood === 'patrol' || p.mood === 'sated') noQuarter(p);
}

// ---------------------------------------------------------------- fleets
function makePirate(c: Cove, kind: PirateKind, slot: number): Pirate {
  const k = KINDS[kind], t = tierOf(c), max = Math.round(k.hp * (1 + t)), at = mooring(c, slot), id = `${c.id}#${slot}`, h = fnv1a(id);
  return {
    id, kind, role: k.roles[h % k.roles.length], cove: c, tier: t, name: shipName(id),
    x: at.x, y: at.y, a: c.ang, vx: 0, vy: 0, w: 0, hp: max, max, wounds: freshWounds(),
    mood: 'anchored', t: 0, think: Math.random() * 0.3, aggro: 0, goal: null, want: c.ang, side: slot % 2 ? -1 : 1,
    reload: [1 + Math.random(), 1 + Math.random()], aim: [-1, -1], swivelT: 1, mortarT: 2 + Math.random() * 2, kegT: 0,
    station: null, stationAt: -99, easy: false, match: false, run: 'in', runT: 0, dodge: null, yields: kind !== 'galleon' && kind !== 'fireship' && (h >> 4) % 5 < 2, merciless: merciless(id, kind),
    parley: 0, warned: false, hove: 0, hooks: 0, grapple: 0, repel: 0, charge: null, chargeCd: 0, heavyT: 8, heavy: false, bracket: { n: 0, a: 0, s: 0 }, bowT: 2, bowAim: -1, lit: -1,
    path: [], pathAt: -99, stuck: 0, unstick: 0, heel: 0, sinkT: 0, scheme: h % SCHEME_COUNT, flag: (h >> 3) % RED_FLAG, wake: 0,
  };
}
/** Ships out for the coves near you; ships far behind that aren't after you go back to their coves. */
function manageFleets(): void {
  const b = G.boat;
  PIRATES.ships = PIRATES.ships.filter(p => !alive(p) || (p.mood === 'struck' ? dist(p, b) < 700 : dist(p, b) < NEAR + 1000 || stalking(p)));
  if (!SET.pirates) { PIRATES.ships = PIRATES.ships.filter(p => !alive(p)); return; }
  for (const c of poisNear(b.x, b.y, NEAR, poiScratch)) {
    if (c.type !== 'cove' || quiet(c)) continue;
    fleetOf(c).forEach((kind, slot) => {
      const id = `${c.id}#${slot}`, sunk = sunkAt.get(id);
      if (PIRATES.ships.some(p => p.id === id) || (sunk !== undefined && G.clock - sunk < RESPAWN)) return;
      PIRATES.ships.push(makePirate(c, kind, slot));
    });
  }
}
/** A pirate ship put out right by (x, y), already after you under the red flag unless `mood` says otherwise (the cheat
 *  console and the tests); `role` overrides its captain's way. */
export function spawnPirate(kind: PirateKind, x0: number, y0: number, role?: Role, mood: Mood = 'chase'): Pirate {
  const { x, y } = nearestWater(x0, y0, -0.15);                     // never aground
  const cove = poisNear(x, y, 1400).filter((p): p is Cove => p.type === 'cove').sort((a, b) => dist(a, { x, y }) - dist(b, { x, y }))[0]
    ?? { id: 'cove:none', type: 'cove', name: 'the open sea', x, y, ang: 0, anchor: { x, y } };
  const p = makePirate(cove, kind, 0);
  const id = `${cove.id}#x${Math.random().toString(36).slice(2, 6)}`;
  Object.assign(p, { id, name: shipName(id), x, y, a: bearing({ x, y }, G.boat) }, role ? { role } : {});
  PIRATES.ships.push(p);
  setMood(p, mood);
  return p;
}
export function resetPirates(): void {
  PIRATES.ships = []; PIRATES.balls = []; PIRATES.kegs = []; PIRATES.loot = []; PIRATES.torps = []; PIRATES.missiles = []; PIRATES.planes = []; PIRATES.salvo = []; PIRATES.call = null;
  Object.assign(PIRATES.me, freshBattery());
  sunkAt.clear(); shouted.clear(); paidAt.clear();
}

// ---------------------------------------------------------------- moods
function setMood(p: Pirate, m: Mood): void { if (p.mood !== m) { p.mood = m; p.t = 0; p.path = []; p.station = null; p.aim = [-1, -1]; p.heavy = false; p.charge = null; p.hooks = 0; if (p.grapple) cutLoose(p); } }
/** Shadowing, hailing or waiting on her tribute: the parley before any fight. */
const parleying = (p: Pirate): boolean => p.mood === 'shadow' || p.mood === 'hail' || p.mood === 'tribute';
/** After you, one way or another. */
const stalking = (p: Pirate): boolean => parleying(p) || p.mood === 'chase' || p.mood === 'engage';
const hunters = (): number => PIRATES.ships.filter(stalking).length;
/** A ship has seen you: she comes out after you under no colours, to shadow you (a merciless captain gives chase under
 *  the red flag straight away), and her cove-mates nearby follow; the first time, a lookout sights her sails. */
function spotted(p: Pirate): void {
  if (hunters() >= HUNTERS) return;
  const paid = paidAt.get(p.cove.id);
  if (paid !== undefined && G.clock - paid < DAYLEN / 2) return;   // you paid: they let you pass
  if (p.merciless || PIRATES.ships.some(o => o.cove.id === p.cove.id && (o.mood === 'chase' || o.mood === 'engage'))) { noQuarter(p); return; }   // or joins a fight already on
  setMood(p, 'shadow');
  for (const o of PIRATES.ships) if (o !== p && o.cove.id === p.cove.id && alive(o) && dist(o, p) < 900 && (o.mood === 'patrol' || o.mood === 'anchored') && hunters() < HUNTERS) setMood(o, 'shadow');
  if (shouted.has(p.cove.id)) return;
  shouted.add(p.cove.id);
  sfx('alarm', 0.5);
  toast(`A sail to the ${dirTo(G.boat.x, G.boat.y, p.x, p.y)}, flying no colours. She's shadowing you`, 'info');
}
/** At gun range she runs up the black flag and hails you to heave to: stop and pay tribute, or else. */
function hail(p: Pirate): void {
  p.parley = PARLEY;
  p.hove = 0;
  runOut(p, wrapAngle(bearing(p, G.boat) - p.a) > 0 ? 1 : -1);
  sfx('alarm');
  toast(`${cap(p.name)} runs up the black flag and hails you: "Heave to!" Stop to pay her tribute, or fight`, 'bad');
}
/** No quarter: the red flag goes up on her and every ship of her cove after you, and they come to fight. */
function noQuarter(p: Pirate): void {
  const loud = !PIRATES.ships.some(o => o.cove.id === p.cove.id && (o.mood === 'chase' || o.mood === 'engage'));
  for (const o of PIRATES.ships) if (o.cove.id === p.cove.id && alive(o) && (o === p || stalking(o)) && o.mood !== 'chase' && o.mood !== 'engage') setMood(o, 'chase');
  shouted.add(p.cove.id);
  if (!loud) return;
  tellWays(p);
  sfx('alarm');
  if (p.role === 'fireship') { toast(`A fire ship is bearing down on you from ${dirTo(G.boat.x, G.boat.y, p.x, p.y)}! Sink her or keep clear`, 'bad'); return; }
  toast(gearLvl('cannon') ? `${cap(p.name)} runs up the red flag: no quarter! Bring her abeam and press R` : `${cap(p.name)} runs up the red flag: no quarter! Run for a harbour, they won't follow you in`, 'bad');
}
/** A shot across your bow: a harmless splash ahead of you, and the last warning. */
function warningShot(p: Pirate): void {
  const b = G.boat, side = wrapAngle(bearing(p, b) - p.a) > 0 ? 1 : -1, port = portsOf(p, side)[0] ?? p, L = boatDef().L;
  const ax = b.x + Math.cos(b.a) * (L + 45) + b.vx * 1.2, ay = b.y + Math.sin(b.a) * (L + 45) + b.vy * 1.2;
  launch(PIRATES.balls, 'pirate', port.x, port.y, ax, ay, 0);
  muzzle(port.x, port.y, Math.atan2(ay - port.y, ax - port.x), hearAt(port.x, port.y));
  p.warned = true;
  p.parley = PARLEY * 0.5;
  toast(`${cap(p.name)} fires a shot across your bow. Last warning: heave to!`, 'bad');
}
/** Her crew rows across for the tribute: the best third of your catch, or coins if the hold's empty; then she lets you go. */
function takeTribute(p: Pirate): void {
  const n = Math.ceil(G.hold.length / 3), taken = [...G.hold].sort((a, b) => b.value - a.value).slice(0, n);
  const coins = taken.length ? 0 : Math.min(G.coins, Math.round(60 + 140 * p.tier));
  G.hold = G.hold.filter(f => !taken.includes(f));
  if (coins > 0) addCoins(-coins);
  paidAt.set(p.cove.id, G.clock);
  for (const o of PIRATES.ships) if (o.cove.id === p.cove.id && parleying(o)) setMood(o, 'sated');
  sfx('coin', 0.6);
  toast(taken.length ? `${cap(p.name)}'s crew takes ${taken.length} of your best fish as tribute, and lets you go`
    : coins > 0 ? `${cap(p.name)}'s crew takes $${coins} as tribute, and lets you go` : `${cap(p.name)}'s crew finds nothing worth taking, and lets you go with a laugh`, 'info');
  track('pirate_tribute', { kind: p.kind, fish: taken.length, coins_bucket: bucket(coins) });
  saveGame();
}
/** A ship's name, from its id; never one another ship about is already using. */
function shipName(id: string): string {
  const k = fnv1a(id);
  for (let i = 0; i < SHIP_NAMES.length; i++) {
    const name = 'the ' + SHIP_NAMES[(k + i) % SHIP_NAMES.length];
    if (!PIRATES.ships.some(p => p.name === name && alive(p))) return name;
  }
  return 'the ' + SHIP_NAMES[k % SHIP_NAMES.length];
}
function giveUp(p: Pirate): void { setMood(p, 'patrol'); p.aggro = 0; p.goal = null; }
/** Your boat went down: every pirate drifts back to its cove. */
function standDown(): void { for (const p of PIRATES.ships) if (hostile(p)) giveUp(p); PIRATES.balls = []; PIRATES.salvo = []; }
/** Beaten: a captain who yields strikes his colours when you have him (rigging torn, or you right on him); the rest run. */
function beaten(p: Pirate, d: number): void {
  if (p.yields && (p.wounds.sails > 0.35 || d < 150)) {
    setMood(p, 'surrender');
    toast(`${cap(p.name)} strikes her colours! Come alongside and press E to board her`, 'good');
    sfx('select');
  } else {
    setMood(p, 'flee');
    if (d < 600) toast(`${cap(p.name)} breaks off, limping home to ${p.cove.name}`, 'good', 'sailing');
  }
}

/** A look round, a few times a second: what to do next, and which way to steer for it. */
function think(p: Pirate): void {
  const k = KINDS[p.kind], b = G.boat, d = dist(p, b), hunt = huntNow;
  const storm = WX.state === 'storm', sight = k.sight * (isNight() ? 0.7 : 1) * (WX.state === 'rain' ? 0.85 : 1);
  const sees = hunt && (d < sight || (p.aggro > 0 && d < sight * 2));
  const fromHome = dist(p, p.cove.anchor), reach = engageRange(p), lost = !hunt || d > sight * 2.2 || fromHome > LEASH;
  switch (p.mood) {
    case 'anchored':                                                 // in a storm they ride it out at anchor
      if (sees && !storm) spotted(p);
      else if (d < NEAR * 0.75 && !storm) setMood(p, 'patrol');
      break;
    case 'patrol':
      if (storm) giveUp(p);
      else if (sees) spotted(p);
      break;
    case 'shadow':                                                   // after a while watching you, she closes to hail
      if (lost || storm) giveUp(p);
      else if (p.t > 8 + fnv1a(p.id) % 7 && d < sight) { setMood(p, 'hail'); p.parley = 0; p.warned = false; }
      break;
    case 'hail':
      if (lost || storm) giveUp(p);
      else if (p.parley === 0) { if (d < HAIL_R && clearLine(p, G.boat)) hail(p); }
      else {
        p.hove = d < HAIL_R + 40 && Math.hypot(b.vx, b.vy) < 5 ? p.hove + 0.25 : 0;
        if (p.hove >= HEAVE) setMood(p, 'tribute');
        else if ((p.parley -= 0.25) <= 0) { if (p.warned) noQuarter(p); else warningShot(p); }
      }
      break;
    case 'tribute':                                                  // she comes alongside; sail off and it's war
      if (!hunt) giveUp(p);
      else if (d > 300) noQuarter(p);
      else if (d < beamOf(p) + boatDef().B + 26 || p.t > 20) takeTribute(p);
      break;
    case 'sated':
      if (dist(p, berth(p)) < 14) setMood(p, 'anchored');
      break;
    case 'chase':
      if (lost && (p.aggro <= 0 || !hunt || fromHome > LEASH)) giveUp(p);
      else if (d < reach) { setMood(p, 'engage'); tellWays(p); }
      break;
    case 'engage':
      if (!hunt || fromHome > LEASH + 300) giveUp(p);
      else if (d > reach * 1.35) setMood(p, 'chase');
      break;
    case 'flee':
      if (p.hp >= p.max * 0.8) setMood(p, 'patrol');
      break;
  }
  if ((p.mood === 'chase' || p.mood === 'engage') && p.hp < p.max * (p.role === 'bomber' ? 0.4 : 0.28)) beaten(p, d);
  if (p.mood === 'surrender' || p.mood === 'sinking' || p.unstick > 0) return;
  const plan = tactic(p, d);
  p.easy = !!plan.easy; p.match = !!plan.match;
  let want = plan.face ?? (plan.to ? bearing(p, plan.to) : p.a);
  seeIncoming(p);
  if (p.dodge && p.dodge.until > G.t) want = p.dodge.h;
  p.want = steer(p, want);
}
/** How close a ship comes before it stops chasing and starts fighting: its guns' reach, or its mortar's for a bomber. */
const engageRange = (p: Pirate): number => p.role === 'bomber' ? P_MORTAR.range : p.role === 'chaser' ? P_BOWGUN.range + 20 : p.role === 'fireship' ? 700 : KINDS[p.kind].range * 0.95;

/** Whether one of your loaded broadside rails has this ship in its arc and reach: somewhere to get out of. */
function underYourGuns(p: Pirate, loadedIn = 0.4): boolean {
  const B = BROADSIDE[gearLvl('cannon')];
  if (!B || dist(p, G.boat) > B.range + 20) return false;
  const bear = bearing(G.boat, p);
  return ([-1, 1] as const).some(s => PIRATES.me.rails[s < 0 ? 0 : 1] < loadedIn && inRail(G.boat.a, bear, s, B.arc + 0.1));
}
/** Both your rails reloading (or no guns at all): a window to close in. */
const yourGunsDown = (): boolean => !BROADSIDE[gearLvl('cannon')] || PIRATES.me.rails.every(r => r > 0.8);

/**
 * The fighting plan by the captain's way, as a point to sail for (round the land if need be) or a heading to hold.
 * Out of a fight it's the bay, the anchorage, or home.
 */
function tactic(p: Pirate, d: number): Plan {
  const b = G.boat, k = KINDS[p.kind];
  switch (p.mood) {
    case 'anchored': case 'flee': case 'struck': case 'sated': {
      const at = berth(p);
      if (dist(p, at) < 14) return { face: p.cove.ang };
      return { to: route(p, at) };
    }
    case 'patrol': {
      if (d > NEAR) { const at = berth(p); if (dist(p, at) < 14) { setMood(p, 'anchored'); return { face: p.cove.ang }; } return { to: route(p, at) }; }
      if (!p.goal || dist(p, p.goal) < 40 || p.t > 28) p.goal = patrolPoint(p);
      return { to: route(p, p.goal) };
    }
    case 'chase':
      return { to: route(p, leadPoint(p.x, p.y, b.x, b.y, b.vx, b.vy, k.speed)) };   // cut you off, not follow your wake
    case 'shadow':                                                   // hanging off your quarter, out of gun range
      return d < 230 ? { face: bearing(p, b) + p.side * 1.2, easy: true } : { to: route(p, aboutYou(Math.PI + p.side * 0.7, 280)) };
    case 'hail':                                                     // closes to hail, then lies abeam, guns trained on you
      if (p.parley === 0) return { to: route(p, leadPoint(p.x, p.y, b.x, b.y, b.vx, b.vy, k.speed)) };
      return d > 170 ? { to: route(p, aboutYou(p.side * Math.PI / 2, 140)) } : { face: broadsideOn(p), easy: d < 150 };
    case 'tribute':
      return { to: route(p, aboutYou(p.side * Math.PI / 2, beamOf(p) + boatDef().B + 10, 0)) };
  }
  switch (p.role) {
    case 'raider': return raid(p, d);
    case 'chaser': return bowOn(p, d);
    case 'fireship': return burnIn(p, d);
    case 'brawler': return brawl(p, d);
    case 'bomber': return bombard(p, d);
    default: return duel(p, d);
  }
}
/** Where to sail (`to`, round the land if need be) or which way to point (`face`), and whether to ease sail to hold there. */
interface Plan { to?: Point | null; face?: number; easy?: boolean; match?: boolean }
/** A point `dd` from your boat at bearing `rel` off your bow, led by where you're going. */
function aboutYou(rel: number, dd: number, lead = 1.2): Point {
  const b = G.boat, a = b.a + rel;
  return { x: b.x + Math.cos(a) * dd + b.vx * lead, y: b.y + Math.sin(a) * dd + b.vy * lead };
}
/** The heading that puts you abeam on whichever rail needs the smaller turn. */
function broadsideOn(p: Pirate): number {
  const bear = bearing(p, G.boat), rel = wrapAngle(bear - p.a);
  if (Math.abs(wrapAngle(rel - p.side * Math.PI / 2)) > 2.2) p.side = rel > 0 ? 1 : -1;
  return bear - p.side * Math.PI / 2;
}
/**
 * Gunners and warships: pick a station round you, best off your bow or stern where they rake you and your broadside
 * can't answer, closer in while your guns are down, away from where the other pirates are, never in the shallows;
 * sail there, then come broadside on. Warships stand off further and move less.
 */
function duel(p: Pirate, _d: number): Plan {
  const k = KINDS[p.kind], war = p.role === 'warship';
  if (!p.station || G.t - p.stationAt > (war ? 4 : 2.5) || underYourGuns(p)) {
    const reach = k.range * (war ? 0.85 : yourGunsDown() ? 0.55 : 0.72), B = BROADSIDE[gearLvl('cannon')];
    let best = -Infinity;
    for (const rel of [0, 0.45, -0.45, Math.PI, Math.PI - 0.45, Math.PI + 0.45, Math.PI / 2, -Math.PI / 2]) {
      const at = aboutYou(rel, reach);
      let score = Math.abs(Math.cos(rel)) > 0.8 ? 1.2 : 0;                                  // a raking position
      if (B && ([-1, 1] as const).some(s => PIRATES.me.rails[s < 0 ? 0 : 1] < 1 && inRail(0, rel, s, B.arc + 0.15))) score -= 1.6;
      score -= dist(p, at) / (war ? 500 : 250);
      if (dist(p, at) > 60) score -= (1 - windFactor(p.kind, bearing(p, at))) * 1.2;      // a station dead upwind is a long beat away
      for (const o of PIRATES.ships) if (o !== p && o.station && dist(aboutYou(o.station.rel, o.station.d), at) < 90) score -= 1;
      if (heightAt(at.x, at.y) > -0.1) score -= 5;
      if (score > best) { best = score; p.station = { rel, d: reach }; }
    }
    p.stationAt = G.t;
  }
  const at = aboutYou(p.station!.rel, p.station!.d);
  return dist(p, at) > (war ? 60 : 40) ? { to: route(p, at) } : { face: broadsideOn(p), easy: true };
}
/**
 * Raiders: a run in at your quarter, swivel and grape firing, then out wide to come round again; out early if your guns
 * bear. Let one lie alongside you, going your speed, and she throws her grappling hooks to board (see grappled).
 */
function raid(p: Pirate, d: number): Plan {
  const b = G.boat, beside = beamOf(p) + boatDef().B;
  if (p.grapple > 0) return { face: b.a };
  const slow = Math.hypot(p.vx - b.vx, p.vy - b.vy) < 16 && Math.hypot(b.vx, b.vy) < 28;
  p.hooks = d < beside + 16 && slow ? p.hooks + 0.25 : Math.max(0, p.hooks - 0.25);
  if (p.hooks >= 1) { grappleOn(p); return { face: b.a }; }
  if (p.run === 'in' && d < beside + 40) {                          // alongside on the side she's on, your speed, to hook on
    p.side = wrapAngle(bearing(b, p) - b.a) > 0 ? 1 : -1;
    return { to: aboutYou(p.side * Math.PI / 2, beside + 4, 0.3), match: true };
  }
  p.runT -= 0.25;
  if (p.run === 'in' && (underYourGuns(p) || p.runT < -10)) { p.run = 'out'; p.runT = 3.5; }
  else if (p.run === 'out' && p.runT <= 0 && !underYourGuns(p, 1)) { p.run = 'in'; p.runT = 0; }
  if (p.run === 'in') return d < 110 ? { face: bearing(p, G.boat) } : { to: route(p, aboutYou(Math.PI + p.side * 0.7, 55)) };
  const away = bearing(G.boat, p) + p.side * 0.5;
  return { to: route(p, { x: G.boat.x + Math.cos(away) * 280, y: G.boat.y + Math.sin(away) * 280 }) };
}
/**
 * Brawlers: close in, then square up (pointing at you, sails eased: the lookout sees it coming) and charge to ram,
 * straight on the heading she set, so you can turn out of her way; alongside, swing broadside on for grapeshot.
 */
function brawl(p: Pirate, d: number): Plan {
  const b = G.boat, lead = leadPoint(p.x, p.y, b.x, b.y, b.vx, b.vy, KINDS[p.kind].speed * 1.3), L = lengthOf(p);
  p.chargeCd -= 0.25;
  const c = p.charge;
  if (c?.phase === 'go') {
    const ahead = Math.cos(bearing(p, b) - c.h) > 0;                 // still before her bow
    if (G.t < c.until && (ahead || d < L * 1.5)) return { face: c.h };
    p.charge = null; p.chargeCd = 7;
  } else if (c?.phase === 'aim') {
    if (G.t >= c.until) p.charge = { phase: 'go', until: G.t + 4, h: bearing(p, lead) };
    return { face: bearing(p, lead), easy: true };
  } else if (p.chargeCd <= 0 && d > L * 2.5 && d < L * 9 && Math.abs(wrapAngle(bearing(p, b) - p.a)) < 0.9 && clearLine(p, b)) {
    p.charge = { phase: 'aim', until: G.t + 1.6, h: 0 };
    call(`${The(p)} is squaring up to ram us, ${whereIs(p)}! Turn across her bow`, 4);
    return { face: bearing(p, lead), easy: true };
  }
  if (d < L * 1.6 && p.reload.some(r => r <= 0)) return { face: broadsideOn(p) };
  return d < L * 4 ? { face: bearing(p, lead) } : { to: route(p, lead) };
}
/** A raider's hooks bite: she's lashed alongside, and her boarders come over the rail. */
function grappleOn(p: Pirate): void {
  p.grapple = 0.001; p.hooks = 0; p.repel = 0;
  sfx('clank'); G.shake = Math.max(G.shake, 1.5);
  call(`Grappling hooks! ${The(p)} means to board us. Fire into her, or sail hard to cut free`, 5);
}
/** The grapples part (cut, torn loose, or she gave up): she sheers off to come round again. */
function cutLoose(p: Pirate): void { p.grapple = 0; p.hooks = 0; p.run = 'out'; p.runT = 5; }
/** Seconds her boarders need to carry your hold, and the way you need to tear the grapples loose. */
export const BOARD_S = 8, BREAK_SPEED = 24;
/**
 * Lashed alongside: she moves with you (dragging at your boat), her crew boards, and if they're left long enough they
 * carry off a share of your catch (or coins) and cut down some of your crew, then sheer off home. Hurting her enough
 * repels them (hurtPirate); so does sailing hard enough, for long enough, to tear the hooks out.
 */
function grappled(p: Pirate, dt: number): void {
  const b = G.boat;
  lash(p, dt);
  p.grapple += dt;
  if (Math.hypot(b.vx, b.vy) > BREAK_SPEED) p.hooks += dt; else p.hooks = Math.max(0, p.hooks - dt);
  if (p.hooks > 1.2) { cutLoose(p); call('The grapples tear loose! We\'re free of her', 3); sfx('slap'); return; }
  if (p.grapple > BOARD_S * 0.45 && p.grapple - dt <= BOARD_S * 0.45) call('Boarders on deck! Drive them off!', 5);
  if (p.grapple < BOARD_S) return;
  const n = Math.ceil(G.hold.length / 4), taken = [...G.hold].sort((x, y) => y.value - x.value).slice(0, n);
  const coins = taken.length ? 0 : Math.min(G.coins, Math.round(40 + 100 * p.tier));
  G.hold = G.hold.filter(f => !taken.includes(f));
  if (coins > 0) addCoins(-coins);
  PIRATES.me.wounds.crew = Math.min(1, PIRATES.me.wounds.crew + 0.3);
  paidAt.set(p.cove.id, G.clock);                                    // her cove has had its plunder from you
  cutLoose(p);
  setMood(p, 'sated');
  toast(`${cap(p.name)}'s boarders made off with ${taken.length ? `${taken.length} of your best fish` : coins ? `$${coins}` : 'nothing but bruises'}, and cut down some of your crew`, 'bad');
  track('pirate_boarded_you', { kind: p.kind, fish: taken.length, coins_bucket: bucket(coins) });
  saveGame();
}
/** Lashed to your boat, a fender's width off on the side she lies: she moves with you, and you tow her. */
function lash(p: Pirate, dt: number): void {
  const b = G.boat, side = wrapAngle(bearing(b, p) - b.a) > 0 ? 1 : -1, off = (beamOf(p) + boatDef().B) * 1.3 + 4;
  const tx = b.x - Math.sin(b.a) * side * off, ty = b.y + Math.cos(b.a) * side * off, k = 1 - Math.exp(-6 * dt);
  p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.a += wrapAngle(b.a - p.a) * k; p.vx = b.vx; p.vy = b.vy; p.w = 0;
  const drag = Math.exp(-0.5 * dt);
  b.vx *= drag; b.vy *= drag;
}
/** A coast guard cutter's mark for her boarders: a fighting pirate (no fire ship) beaten below BOARDERS.most of her hull,
 *  alongside you and going your speed; null if none. */
function boardable(): Pirate | null {
  if (boatDef().signature !== 'boarders' || PIRATES.me.taking) return null;
  const b = G.boat;
  return PIRATES.ships.find(p => hostile(p) && p.role !== 'fireship' && p.grapple === 0 && p.hp < p.max * BOARDERS.most
    && alongside(p) && Math.hypot(p.vx - b.vx, p.vy - b.vy) < 16) ?? null;
}
/** Seconds your boarders need to carry her deck: quicker the more beaten she is, slower with your own men down. */
export const takeTime = (p: Pirate): number => (BOARDERS.s + BOARDERS.hp * p.hp / p.max) * reloadFactor(PIRATES.me.wounds);
/** Your boarders go over the rail: the grapples bite, and she's lashed alongside with her guns silent. */
function sendBoarders(p: Pirate): void {
  PIRATES.me.taking = { p, t: 0, slip: 0 };
  provoke(p);
  sfx('clank'); G.shake = Math.max(G.shake, 1.5);
  call('Away boarders! Hold her alongside', 4);
}
/**
 * Your boarders on her deck, her crew fighting back (some of yours fall). Carry it and she strikes to you, her cargo
 * yours; sail hard long enough and the grapples tear out; if she sinks or strikes first, it's over.
 */
function taking(dt: number): void {
  const me = PIRATES.me, tk = me.taking!, p = tk.p, b = G.boat;
  if (!alive(p) || !PIRATES.ships.includes(p) || G.mode !== 'play') { me.taking = null; return; }
  if (p.mood === 'surrender') { me.taking = null; takeCargo(p); return; }
  lash(p, dt);
  me.wounds.crew = Math.min(0.9, me.wounds.crew + dt * 0.015 * p.hp / p.max);
  if (Math.hypot(b.vx, b.vy) > BREAK_SPEED) tk.slip += dt; else tk.slip = Math.max(0, tk.slip - dt);
  if (tk.slip > 1.2) { me.taking = null; call('The grapples tore loose! Our boarders scrambled back', 3); sfx('slap'); return; }
  const need = takeTime(p), was = tk.t;
  tk.t += dt;
  if (was < need * 0.5 && tk.t >= need * 0.5) call('Fighting across her deck. They\'re giving way!', 3);
  if (tk.t < need) return;
  me.taking = null;
  call(`She's struck! ${cap(p.name)} is ours`, 5);
  takeCargo(p);
}
/** Galleys: row in to a long gunshot, then lie bow-on with oars resting while the bow gun is laid; back off if you close. */
function bowOn(p: Pirate, d: number): Plan {
  const b = G.boat;
  if (d > 250) return { to: route(p, leadPoint(p.x, p.y, b.x, b.y, b.vx, b.vy, KINDS[p.kind].speed)) };
  if (d < 140) { const away = bearing(b, p) + p.side * 0.6; return { to: route(p, { x: b.x + Math.cos(away) * 260, y: b.y + Math.sin(away) * 260 }) }; }
  return { face: bearing(p, b), easy: true };
}
/** Fire ships: straight for where you'll be, and lit once she's close enough that you can't easily get clear. */
function burnIn(p: Pirate, d: number): Plan {
  const b = G.boat, lead = leadPoint(p.x, p.y, b.x, b.y, b.vx, b.vy, KINDS[p.kind].speed * 1.25);
  if (p.lit < 0 && d < 240 && clearLine(p, b)) {
    p.lit = 0;
    sfx('boom', hearAt(p.x, p.y) * 0.6);
    call(`A fire ship ${whereIs(p)}! She's alight and coming straight for us. Sink her or keep clear!`, 5);
  }
  return d < 90 ? { face: bearing(p, lead) } : { to: route(p, lead) };
}
/** A fire ship goes up: everything within her reach is hit, hardest close in, and set ablaze, her own side too. */
function fireBlast(p: Pirate): void {
  const R = FIRESHIP.reach, dmg = FIRESHIP.dmg * (1 + 0.5 * p.tier);
  setMood(p, 'sinking');
  defeated(p);
  blast(p.x, p.y, R * 0.6, hearAt(p.x, p.y)); burst('debris', p.x, p.y, 30, 50, () => 1.5 + Math.random() * 2);
  sfx('explode', hearAt(p.x, p.y)); G.shake = Math.max(G.shake, 7 * hearAt(p.x, p.y));
  const d = dist(p, G.boat), reach = R + boatDef().L * 0.6;
  if (d < reach && G.mode === 'play') { PIRATES.me.wounds.burn = Math.max(PIRATES.me.wounds.burn, 10); hurtPlayer(dmg * (1 - 0.6 * d / reach), p.x, p.y, 'Boom!'); }
  else if (hearAt(p.x, p.y) > 0) call('The fire ship blew up!', 3);
  for (const o of [...PIRATES.ships]) {
    const od = dist(p, o), oreach = R + lengthOf(o) * 0.6;
    if (o === p || !alive(o) || od > oreach) continue;
    o.wounds.burn = Math.max(o.wounds.burn, 10);
    hurtPirate(o, dmg * (1 - 0.6 * od / oreach), o.x, o.y, 'Boom!');
  }
}
/** A lit fire ship each frame: burning, and blowing up alongside you or when she's burnt through. */
function burning(p: Pirate, dt: number): boolean {
  if (p.lit < 0) return false;
  p.lit += dt; p.hp -= 0.8 * dt;
  flames(p.x, p.y, lengthOf(p), dt); flames(p.x, p.y, lengthOf(p), dt);
  if (dist(p, G.boat) < lengthOf(p) * 0.6 + boatDef().L * 0.6 + 4 || p.lit > FIRESHIP.burn || p.hp <= 0) { fireBlast(p); return true; }
  return false;
}
/** Bombers: hold off at a mortar's reach, run if you close, circle slowly between. */
function bombard(p: Pirate, d: number): Plan {
  const b = G.boat, out = bearing(b, p);
  if (d < 190) return { to: route(p, { x: p.x + Math.cos(out) * 200, y: p.y + Math.sin(out) * 200 }) };
  const ring = out + (d > 290 ? 0 : p.side * 0.45), r = d > 290 ? 250 : 255;
  return { to: route(p, { x: b.x + Math.cos(ring) * r, y: b.y + Math.sin(ring) * r }) };
}
/** Sail at `target` directly when the water's open, else along a route planned round the land (replanned as it moves). */
function route(p: Pirate, target: Point): Point {
  if (dist(p, target) < 60 || clearLine(p, target, beamOf(p))) { p.path = []; return target; }
  if (!p.path.length || G.t - p.pathAt > 3 || dist(p.path[p.path.length - 1], target) > 90) {
    p.pathAt = G.t;
    p.path = planRoute(p, target, beamOf(p) + 4)?.pts.slice(1) ?? [];
  }
  while (p.path.length > 1 && (dist(p, p.path[0]) < 30 || clearLine(p, p.path[1], beamOf(p)))) p.path.shift();
  return p.path[0] ?? target;
}
/**
 * Shot it can see coming: a ball or shell of yours that will come down where the ship will be. A skilled crew turns
 * away from it (an untried one may not notice in time).
 */
function seeIncoming(p: Pirate): void {
  if (p.dodge && p.dodge.until > G.t) return;
  const reach = lengthOf(p) * 0.8 + 4;
  for (const ball of PIRATES.balls) {
    if (ball.from !== 'player') continue;
    const left = ball.flight - ball.t, qx = p.x + p.vx * left, qy = p.y + p.vy * left;
    if (left < 0.25 || Math.hypot(qx - ball.lx, qy - ball.ly) > reach + ball.splash) continue;
    if (Math.random() > KINDS[p.kind].skill * 0.6) continue;
    const side = Math.sign((ball.lx - p.x) * Math.sin(p.a) - (ball.ly - p.y) * Math.cos(p.a)) || 1;   // turn away from where it falls
    p.dodge = { until: G.t + 0.9, h: p.a + side * 1.1 };
    return;
  }
  for (const t of PIRATES.torps) {                                   // a torpedo's track: she turns to comb it, end-on
    const near = [0.6, 1.2, 1.8, 2.4].some(k => Math.hypot(t.x + Math.cos(t.a) * TORPEDO.speed * k - (p.x + p.vx * k), t.y + Math.sin(t.a) * TORPEDO.speed * k - (p.y + p.vy * k)) < reach);
    if (!near || Math.random() > KINDS[p.kind].skill * 0.5) continue;
    const h = Math.cos(t.a - p.a) > 0 ? t.a : t.a + Math.PI;
    p.dodge = { until: G.t + 1.6, h };
    return;
  }
}
/** Each ship's own spot in its cove's anchorage: moored in a line heading out of the bay, in water deep enough. */
const berth = (p: Pirate): Point => mooring(p.cove, Number(p.id.split('#')[1]) || 0);
function mooring(c: Cove, slot: number): Point {
  const at = { x: c.anchor.x + Math.cos(c.ang) * slot * 34, y: c.anchor.y + Math.sin(c.ang) * slot * 34 };
  return heightAt(at.x, at.y) < -0.15 ? at : c.anchor;
}
/** Somewhere in open water round the cove's bay to sail to next. */
function patrolPoint(p: Pirate): Point {
  const c = p.cove;
  for (let k = 0; k < 12; k++) {
    const a = c.ang + (Math.random() - 0.5) * 2.4, r = 120 + Math.random() * 360, x = c.anchor.x + Math.cos(a) * r, y = c.anchor.y + Math.sin(a) * r;
    if (heightAt(x, y) < -0.15) return { x, y };
  }
  return berth(p);
}

/**
 * Context steering: score sixteen headings round the compass (and the one it wants) by how well each points where
 * it's going, how much it turns, how soon it runs into shallows, other pirates in the way, harbours it won't go near,
 * and your powder kegs and shells about to land; steer for the best. Cheap enough for every ship a few times a second.
 */
function steer(p: Pirate, desired: number): number {
  const L = lengthOf(p), probes = [L * 0.8, L * 1.6, L * 2.6, L * 4], cost = [3, 1.8, 1, 0.5];
  const ports = poisNear(p.x, p.y, 600).filter(q => q.type === 'port');
  const kegs = PIRATES.kegs.filter(k => k.from === 'player' && dist(k, p) < L * 5);
  const shells = PIRATES.balls.filter(b => b.from === 'player' && b.splash && Math.hypot(b.lx - p.x, b.ly - p.y) < L * 5);
  let best = desired, bestScore = -Infinity;
  for (let i = -1; i < 16; i++) {
    const h = i < 0 ? desired : i / 16 * TAU, c = Math.cos(h), s = Math.sin(h);
    // the way she'd make toward where she wants to go on this heading (so dead upwind she tacks, close-hauled on one
    // board and then the other, rather than lying in irons), a little less for a hard turn
    let score = windFactor(p.kind, h) * Math.cos(wrapAngle(h - desired)) - 0.25 * Math.abs(wrapAngle(h - p.a)) / Math.PI;
    for (let q = 0; q < probes.length; q++) {
      const x = p.x + c * probes[q], y = p.y + s * probes[q];
      if (heightAt(x, y) > -0.09) { score -= cost[q]; break; }
      if (ports.some(port => dist(port, { x, y }) < SAFE_R - 40)) { score -= 1.5; break; }
      if (kegs.some(k => Math.hypot(k.x - x, k.y - y) < k.reach + 8) || shells.some(b => Math.hypot(b.lx - x, b.ly - y) < b.splash + 6)) { score -= 1.2 * cost[q] / 3; break; }
    }
    for (const o of PIRATES.ships) {
      if (o === p || !alive(o)) continue;
      const dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
      if (d < 2.5 * L && (dx * c + dy * s) / d > 0.6) score -= 0.8 * (1 - d / (2.5 * L));
    }
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best;
}

// ---------------------------------------------------------------- sailing
const SPEED: Record<Mood, number> = { anchored: 0.35, patrol: 0.5, shadow: 0.7, hail: 0.95, tribute: 0.6, sated: 0.5, chase: 1, engage: 0.75, flee: 1, surrender: 0, struck: 0.5, sinking: 0 };
/**
 * How much way a ship makes on heading `a` for the wind: a square rigger can't sail closer than about sixty degrees off
 * the wind and makes little way near it; a fore-and-aft rig points higher, to about forty-five. Neither sails into the
 * wind: they tack (steer weighs this), which is how a nimble boat escapes upwind.
 */
export function windFactor(kind: PirateKind, a: number): number {
  if (KINDS[kind].rig === 'oars') return 1;
  const eff = windEfficiency(a);
  return KINDS[kind].rig === 'square' ? clamp((eff - 0.75) / 0.4, 0.08, 1) : clamp((eff - 0.45) / 0.5, 0.15, 1);
}
function sail(p: Pirate, dt: number): void {
  const k = KINDS[p.kind], L = lengthOf(p);
  const c0 = Math.cos(p.a), s0 = Math.sin(p.a);
  let fwd = p.vx * c0 + p.vy * s0, side = -p.vx * s0 + p.vy * c0;
  const holding = (p.mood === 'anchored' || p.mood === 'flee') && dist(p, berth(p)) < 14;
  const ramming = p.charge?.phase === 'go' ? 1.35 : p.lit >= 0 ? 1.25 : p.role === 'brawler' && p.mood === 'engage' ? 1.05 : 1;
  const top = holding ? 0 : SPEED[p.mood] * ramming * (p.easy ? 0.15 : 1) * k.speed * speedFactor(p.wounds) * windFactor(p.kind, p.a) * (1 + 0.15 * WX.wind);
  const want = p.match ? Math.min(top, Math.hypot(G.boat.vx, G.boat.vy) + 5) : top;
  fwd += (want - fwd) * (1 - Math.exp(-(want > fwd ? 0.6 : 1.2) * dt));
  side *= Math.exp(-3 * dt);
  // a rudder needs way on her; but lying in irons (head to wind, stopped) she backs a sail and the wind pays her bow off
  const irons = windFactor(p.kind, p.a) < 0.3 && fwd < 8;
  const steerage = irons ? 0.9 : 0.3 + 0.7 * clamp(fwd / 20, 0, 1), turn = clamp(wrapAngle(p.want - p.a) * 2, -1, 1) * k.turn * steerage;
  p.w += (turn - p.w) * (1 - Math.exp(-3 * dt));
  p.a += p.w * dt;
  const c = Math.cos(p.a), s = Math.sin(p.a);
  p.vx = fwd * c - side * s; p.vy = fwd * s + side * c;
  const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
  // never sail up the beach: hold short, and if pressed against it for long, come about hard
  if (heightAt(nx + c * L * 0.45, ny + s * L * 0.45) > -0.06) {
    p.vx *= 0.3; p.vy *= 0.3; p.stuck += dt;
  } else { p.x = nx; p.y = ny; p.stuck = Math.max(0, p.stuck - dt * 0.5); }
  if (p.stuck > 1.2 && p.unstick <= 0) { p.unstick = 2.5; p.want = p.a + Math.PI * (Math.random() < 0.5 ? 0.75 : -0.75); p.stuck = 0; }
  p.unstick -= dt;
  p.heel += (clamp(-p.w * fwd * 0.004, -0.12, 0.12) - p.heel) * (1 - Math.exp(-3 * dt));
  wake(p, fwd, dt);
  if (p.mood === 'flee' && holding) p.hp = Math.min(p.max, p.hp + p.max * 0.04 * dt);   // patching up at anchor
}

/** Her wake, where you can see it: bow waves peeling off both sides, churned water astern, spray when she's driving hard. */
function wake(p: Pirate, fwd: number, dt: number): void {
  if (fwd < 8 || dist(p, G.boat) > 520) return;
  const L = lengthOf(p), B = beamOf(p), c = Math.cos(p.a), s = Math.sin(p.a);
  p.wake += fwd * dt * 0.5;
  while (p.wake >= 1) {
    p.wake -= 1;
    for (const side of [-1, 1]) spawn({ kind: 'dot', x: p.x + c * L * 0.75 - s * side * B * 0.8, y: p.y + s * L * 0.75 + c * side * B * 0.8, vx: -s * side * 7 - c * 3, vy: c * side * 7 - s * 3, life: 1.6 + Math.random() * 0.6 });
    spawn({ kind: 'dot', x: p.x - c * (L + 1) + (Math.random() - 0.5) * B, y: p.y - s * (L + 1) + (Math.random() - 0.5) * B, vx: 0, vy: 0, life: 1.8, foam: true });
  }
  if (fwd > 40 && Math.random() < dt * 6) spawn({ kind: 'spout', x: p.x + c * L, y: p.y + s * L, z: 0.5, vx: c * 10 + (Math.random() - 0.5) * 8, vy: s * 10 - 4, vz: 8 + Math.random() * 6, life: 0.6 });
}

// ---------------------------------------------------------------- pirate gunnery
/**
 * A ship's guns: a rail whose arc swings onto you is run out (a puff and a clank: you have a moment to turn away),
 * then fires if you're still there; the swivel and the mortar fire when they bear; a bomber or a ship on the run
 * drops kegs in your path.
 */
function pirateGuns(p: Pirate, dt: number): void {
  const k = KINDS[p.kind], b = G.boat, d = dist(p, b), rf = reloadFactor(p.wounds);
  for (let r = 0; r < 2; r++) { p.reload[r] -= dt; if (p.aim[r] > 0) p.aim[r] = Math.max(0, p.aim[r] - dt); }   // -1: guns in; counts down to 0: fire
  p.swivelT -= dt; p.mortarT -= dt; p.kegT -= dt;
  p.heavyT -= dt; p.bowT -= dt;
  if (!huntNow || p.grapple > 0 || PIRATES.me.taking?.p === p || !(p.mood === 'engage' || p.mood === 'chase' || p.mood === 'flee')) { p.aim = [-1, -1]; return; }
  const bear = bearing(p, b), open = d < 400 && clearLine(p, b);
  if (k.guns && p.mood !== 'flee') for (const s of [-1, 1] as const) {
    const rail = s < 0 ? 0 : 1, shot = pickShot(p, d), reach = k.range * SHOTS[shot].reach;
    if (p.aim[rail] < 0) {
      if (p.reload[rail] <= 0 && d < reach * (p.heavyT <= 0 && p.role === 'warship' ? 0.85 : 1) && inRail(p.a, bear, s, k.arc) && open) {
        p.heavy = p.role === 'warship' && p.heavyT <= 0 && !p.aim.some(a => a >= 0);
        p.aim[rail] = AIM_S * (p.heavy ? 2.2 : 1);
        runOut(p, s);
      }
    } else if (p.aim[rail] === 0) {
      p.aim[rail] = -1;
      if (d < reach * 1.1 && inRail(p.a, bear, s, k.arc + 0.25) && open) volley(p, s, shot, d, rf);
      else { p.reload[rail] = 0.6; if (p.heavy) { p.heavy = false; call(`Her double-shotted broadside never bore. Well steered!`, 2); } }   // you slipped out of the arc
    }
  }
  if (p.role === 'chaser') bowGun(p, d, bear, open, rf, dt);
  if (k.swivel && p.swivelT <= 0 && d < P_SWIVEL.range && ahead(p.a, bear, P_SWIVEL.arc) && open) {
    const L = lengthOf(p), x = p.x + Math.cos(p.a) * L * 0.8, y = p.y + Math.sin(p.a) * L * 0.8, miss = (1 - k.skill) * d * 0.2 + 3, lp = leadPoint(x, y, b.x, b.y, b.vx, b.vy);
    launch(PIRATES.balls, 'pirate', x, y, lp.x + randn() * miss, lp.y + randn() * miss, P_SWIVEL.dmg * (1 + 0.5 * p.tier));
    muzzle(x, y, bearing({ x, y }, lp), hearAt(x, y) * 0.6);
    p.swivelT = P_SWIVEL.reload * rf;
  }
  if (k.mortar && p.mortarT <= 0 && d > P_MORTAR.min && d < P_MORTAR.range && p.mood !== 'flee') {
    let aim: Point = b;                                              // where you'll be when the shell comes down
    for (let n = 0; n < 2; n++) { const t = shellTime(dist(p, aim)); aim = { x: b.x + b.vx * t, y: b.y + b.vy * t }; }
    const err = rangeError(p), line = bearing(p, aim), miss = (1 - k.skill) * 10 + 3;
    launch(PIRATES.balls, 'pirate', p.x, p.y, aim.x + Math.cos(line) * err + randn() * miss, aim.y + Math.sin(line) * err + randn() * miss, P_MORTAR.dmg * (1 + 0.5 * p.tier), 'round', P_MORTAR.splash);
    muzzle(p.x, p.y, line, hearAt(p.x, p.y), true);
    p.mortarT = P_MORTAR.reload * rf * (0.85 + Math.random() * 0.3);
  }
  const behind = Math.abs(wrapAngle(bear - p.a - Math.PI)) < 0.8;   // you're astern of her
  if (k.kegs && p.kegT <= 0 && behind && d < 170 && (p.mood === 'flee' || p.role === 'bomber' || (p.role === 'raider' && p.run === 'out'))) {
    const L = lengthOf(p);
    PIRATES.kegs.push({ x: p.x - Math.cos(p.a) * (L + 4), y: p.y - Math.sin(p.a) * (L + 4), from: 'pirate', dmg: P_KEG.dmg * (1 + 0.5 * p.tier), reach: P_KEG.reach, t: 0, ph: Math.random() * TAU });
    p.kegT = P_KEG.every;
  }
}
/**
 * How far a mortar's next shell falls long (or short, negative) of you: gunners range on a target, the first shell well
 * over, the next short, then on, walking them in. A change of course or speed since her last shell throws her off,
 * and she starts again.
 */
function rangeError(p: Pirate): number {
  const b = G.boat, br = p.bracket, speed = Math.hypot(b.vx, b.vy);
  if (br.n > 0 && (Math.abs(wrapAngle(b.a - br.a)) > 0.45 || Math.abs(speed - br.s) > 14)) {
    br.n = 0;
    if (hearAt(p.x, p.y) > 0) call('Her mortar\'s lost the range. Keep changing course!', 2);
  }
  const err = RANGING[Math.min(br.n, RANGING.length - 1)] * (br.n % 2 ? -1 : 1);
  if (hearAt(p.x, p.y) > 0) call(br.n === 0 ? `${The(p)} is ranging on us with her mortar, ${whereIs(p)}` : br.n === 1 ? 'Her shells are walking in. Change course!' : 'The next shell will be on us. Turn now!', br.n === 0 ? 2 : 3);
  br.n++; br.a = b.a; br.s = speed;
  return err;
}
/** How far long or short each shell of a mortar's ranging falls: well over, short, then on. */
export const RANGING = [75, 38, 8];
/** A galley's bow gun: laid on you while you're off her bow (the lookout sees it), fired if you still are. */
function bowGun(p: Pirate, d: number, bear: number, open: boolean, rf: number, dt: number): void {
  if (p.bowAim < 0) {
    if (p.bowT > 0 || d > P_BOWGUN.range || !ahead(p.a, bear, P_BOWGUN.arc) || !open) return;
    p.bowAim = AIM_S * 1.2;
    const vol = hearAt(p.x, p.y);
    if (vol > 0) { sfx('clank', vol); call(`${The(p)} is laying her bow gun on us, ${whereIs(p)}! Get off her bow!`, 3); }
    return;
  }
  if ((p.bowAim -= dt) > 0) return;
  p.bowAim = -1;
  if (d > P_BOWGUN.range * 1.05 || !ahead(p.a, bear, P_BOWGUN.arc + 0.08) || !open) { p.bowT = 0.8; return; }
  const b = G.boat, L = lengthOf(p), x = p.x + Math.cos(p.a) * L, y = p.y + Math.sin(p.a) * L, lp = leadPoint(x, y, b.x, b.y, b.vx, b.vy), miss = (1 - KINDS[p.kind].skill) * d * 0.12 + 3;
  launch(PIRATES.balls, 'pirate', x, y, lp.x + randn() * miss, lp.y + randn() * miss, P_BOWGUN.dmg * (1 + 0.6 * p.tier));
  muzzle(x, y, bearing({ x, y }, lp), hearAt(x, y), true);
  p.bowT = P_BOWGUN.reload * rf;
}
/** Where her gunports on rail `side` are, in the world: the muzzles a broadside comes out of. */
function portsOf(p: Pirate, side: 1 | -1): Point[] {
  const c = Math.cos(p.a), s = Math.sin(p.a), B = beamOf(p) + 1;
  return SHIP_DIMS[KINDS[p.kind].hull].ports.map(u => ({ x: p.x + c * u - s * side * B, y: p.y + s * u + c * side * B }));
}
/** What a ship's gunners load: grape up close, chain to slow you while your rigging's whole, fire now and then. */
function pickShot(p: Pirate, d: number): ShotKind {
  const s = KINDS[p.kind].shots;
  if (s.includes('grape') && d < KINDS[p.kind].range * 0.5) return 'grape';
  if (s.includes('chain') && PIRATES.me.wounds.sails < 0.4 && p.role === 'gunner') return 'chain';
  if (s.includes('fire') && fnv1a(p.id + Math.floor(G.t / 6)) % 3 === 0) return 'fire';
  return 'round';
}
/** Guns run out on rail `side`: a puff from the gunports and the clank of carriages, the moment before a broadside. */
function runOut(p: Pirate, side: 1 | -1): void {
  for (const port of portsOf(p, side)) spawn({ kind: 'smoke', x: port.x, y: port.y, z: 3, vx: -Math.sin(p.a) * side * 4, vy: Math.cos(p.a) * side * 4, vz: 2, size: p.heavy ? 2.4 : 1.4, dark: 0.05, life: p.heavy ? 1.2 : 0.6 });
  const vol = hearAt(p.x, p.y);
  if (vol > 0.05) { sfx('clank', vol); if (p.heavy) setTimeout(() => sfx('clank', vol), 260); }
  if (p.mood === 'hail' || vol <= 0) return;
  const b = G.boat, at = whereIs(p);
  if (p.heavy) call(`${The(p)} is double-shotting her guns, ${at}! Get out of her arc!`, 4);
  else if (raking(b.a, b.x - p.x, b.y - p.y)) call(`${The(p)} is across your ${Math.cos(bearing(b, p) - b.a) > 0 ? 'bow' : 'stern'} to rake you. Turn!`, 3);
  else call(`${The(p)} is running out her guns, ${at}!`, 2);
}
function volley(p: Pirate, side: 1 | -1, shot: ShotKind, d: number, rf: number): void {
  const k = KINDS[p.kind], def = SHOTS[shot];
  const heavy = p.heavy;
  if (heavy) { p.heavy = false; p.heavyT = 32; }
  p.reload[side < 0 ? 0 : 1] = k.reload * rf * (0.85 + Math.random() * 0.3) * (heavy ? 1.3 : 1);
  const dmg = k.dmg * (1 + 0.6 * p.tier) * def.dmg * (heavy ? HEAVY : 1), fast = Math.hypot(G.boat.vx, G.boat.vy) > 40 ? 1.2 : 1;
  const miss = ((1 - k.skill) * d * 0.18 + 3) * (isNight() ? 1.3 : 1) * fast + (def.pellets > 1 ? 9 : 0);
  portsOf(p, side).forEach((port, g) => {
    for (let n = 0; n < def.pellets; n++) PIRATES.salvo.push({ at: G.t + g * 0.14 + n * 0.01 + Math.random() * 0.04, from: 'pirate', ship: p, x: port.x, y: port.y, ax: 0, ay: 0, dmg, miss, shot });
  });
}
/** Fire the shots of a volley whose turn has come (pirates aim as they go off, at where you'll be). */
function fireSalvo(): void {
  const b = G.boat;
  for (let i = PIRATES.salvo.length - 1; i >= 0; i--) {
    const sh = PIRATES.salvo[i];
    if (sh.at > G.t) continue;
    PIRATES.salvo.splice(i, 1);
    if (sh.from === 'pirate') {
      if (!sh.ship || !hostile(sh.ship)) continue;
      const lp = leadPoint(sh.x, sh.y, b.x, b.y, b.vx, b.vy), ax = lp.x + randn() * sh.miss, ay = lp.y + randn() * sh.miss;
      launch(PIRATES.balls, 'pirate', sh.x, sh.y, ax, ay, sh.dmg, sh.shot);
      muzzle(sh.x, sh.y, Math.atan2(ay - sh.y, ax - sh.x), hearAt(sh.x, sh.y) * (sh.shot === 'grape' ? 0.5 : 1));
    } else {
      launch(PIRATES.balls, 'player', sh.x, sh.y, sh.ax, sh.ay, sh.dmg, sh.shot);
      if (sh.shot !== 'grape' || Math.random() < 0.3) muzzle(sh.x, sh.y, Math.atan2(sh.ay - sh.y, sh.ax - sh.x), 1);
    }
  }
}

// ---------------------------------------------------------------- hits, sinking, loot
/** Whether point (x, y) at height z is inside the hull of a ship at (sx, sy) heading a, of half-length L and half-beam B (tapering to the ends). */
function inHull(x: number, y: number, z: number, sx: number, sy: number, a: number, L: number, B: number, pad = 1): boolean {
  const dx = x - sx, dy = y - sy, c = Math.cos(a), s = Math.sin(a), u = dx * c + dy * s, v = -dx * s + dy * c;
  return Math.abs(u) < L + pad && Math.abs(v) < B * (1 - 0.6 * (u / L) ** 2) + pad && z < 6 + L * 0.08;
}
function strike(ball: Ball): boolean {
  if (ball.from === 'pirate') {
    const bd = boatDef();
    if (G.mode !== 'play' || ball.dmg <= 0 || !inHull(ball.x, ball.y, ball.z, G.boat.x, G.boat.y, G.boat.a, bd.L, bd.B)) return false;
    const rake = raking(G.boat.a, ball.vx, ball.vy);
    wound(PIRATES.me.wounds, ball.shot === 'fire' && boatDef().armour ? 'round' : ball.shot);   // iron won't burn
    hurtPlayer(ball.dmg * (rake ? RAKE : 1), ball.x, ball.y, rake ? 'Raked!' : woundWord(ball.shot));
    return true;
  }
  for (const p of PIRATES.ships) if (alive(p) && p.mood !== 'struck' && inHull(ball.x, ball.y, ball.z, p.x, p.y, p.a, lengthOf(p), beamOf(p))) {
    const rake = raking(p.a, ball.vx, ball.vy);
    wound(p.wounds, ball.shot);
    hurtPirate(p, ball.dmg * (rake ? RAKE : 1), ball.x, ball.y, rake ? 'Raked!' : woundWord(ball.shot));
    return true;
  }
  return false;
}
const woundWord = (s: ShotKind): string | null => s === 'chain' ? 'Rigging torn' : s === 'fire' ? 'Ablaze!' : null;
/** A mortar shell bursts: everything of the other side inside its splash is hit, hardest at the middle, and set alight. */
function shellBurst(ball: Ball): void {
  blast(ball.x, ball.y, ball.splash, hearAt(ball.x, ball.y));
  G.shake = Math.max(G.shake, 4 * hearAt(ball.x, ball.y));
  const harm = (d: number, L: number): number => d > ball.splash + L * 0.6 ? 0 : ball.dmg * (1 - 0.5 * clamp(d / (ball.splash + L * 0.6), 0, 1));
  if (ball.from === 'pirate') {
    const h = harm(dist(ball, G.boat), boatDef().L);
    if (h > 0 && G.mode === 'play') { PIRATES.me.wounds.burn = Math.max(PIRATES.me.wounds.burn, 3); hurtPlayer(h, G.boat.x, G.boat.y, 'Shelled!'); }
    return;
  }
  for (const p of [...PIRATES.ships]) {
    const h = alive(p) && p.mood !== 'struck' ? harm(dist(ball, p), lengthOf(p)) : 0;
    if (h > 0) { p.wounds.burn = Math.max(p.wounds.burn, 3); hurtPirate(p, h, p.x, p.y, 'Shelled!'); }
  }
}
/** A keg blows: the other side's hulls within twice its reach are hit, hardest close in, and set alight. */
function kegBlast(k: Keg): void {
  blast(k.x, k.y, k.reach, hearAt(k.x, k.y));
  G.shake = Math.max(G.shake, 5 * hearAt(k.x, k.y));
  const harm = (d: number, L: number): number => d > k.reach * 2 + L * 0.6 ? 0 : k.dmg * (1 - 0.6 * clamp(d / (k.reach * 2 + L * 0.6), 0, 1));
  if (k.from === 'pirate') {
    const h = harm(dist(k, G.boat), boatDef().L);
    if (h > 0 && G.mode === 'play') { PIRATES.me.wounds.burn = Math.max(PIRATES.me.wounds.burn, 4); hurtPlayer(h, G.boat.x, G.boat.y, 'Boom!'); }
    return;
  }
  for (const p of [...PIRATES.ships]) {
    const h = alive(p) && p.mood !== 'struck' ? harm(dist(k, p), lengthOf(p)) : 0;
    if (h > 0) { p.wounds.burn = Math.max(p.wounds.burn, 4); hurtPirate(p, h, p.x, p.y, 'Boom!'); }
  }
}
/** Whether an enemy hull is close enough to set keg k off. */
function kegTripped(k: Keg): boolean {
  if (k.from === 'pirate') return G.mode === 'play' && dist(k, G.boat) < k.reach + boatDef().B;
  return PIRATES.ships.some(p => hostile(p) && dist(k, p) < k.reach + beamOf(p));
}
let lowWarned = false;
function hurtPlayer(dmg: number, x: number, y: number, word: string | null = null): void {
  if (G.god || G.mode !== 'play') return;
  const taken = Math.max(1, Math.round(dmg * (1 - 0.12 * G.up.hull) * (1 - (boatDef().armour ?? 0))));   // plating and armour turn some of it
  G.boat.hp = Math.max(0, G.boat.hp - taken);
  G.shake = Math.max(G.shake, 3);
  burst('debris', x, y, 8, 30, () => 0.8 + Math.random());
  sfx('boom');
  if (word === 'Raked!' || word === 'Shelled!' || word === 'Boom!') call(word === 'Raked!' ? 'We\'re raked stem to stern!' : word === 'Shelled!' ? 'A shell bursts aboard!' : 'A powder keg goes off under us!', 3);
  else if (G.boat.hp < hpMax() * 0.3) call('We\'re holed below the waterline!', 3);
  if (G.boat.hp <= 0) { sunkByPirates(); return; }
  if (!lowWarned && G.boat.hp < hpMax() * 0.3) { lowWarned = true; toast('Your hull is holed badly. Run for a harbour!', 'bad'); }
}
function hurtPirate(p: Pirate, dmg: number, x: number, y: number, word: string | null = null): void {
  const taken = Math.max(1, Math.round(dmg));
  p.hp -= taken;
  burst('debris', x, y, 7, 28, () => 0.8 + Math.random());
  sfx('boom', hearAt(x, y));
  if (word === 'Raked!') call('You raked her! Stem to stern!', 2);
  if (p.grapple > 0 && (p.repel += taken) >= p.max * 0.12) { cutLoose(p); call('Boarders repelled! She\'s cut her grapples', 4); }
  provoke(p);
  if (p.hp <= 0) sinkPirate(p);
}
/** Your boat goes down under pirate fire: they take the best half of your catch, and a tug tows you home. */
function sunkByPirates(): void {
  const worst = PIRATES.ships.find(p => p.mood === 'engage' || p.mood === 'chase');
  const n = Math.ceil(G.hold.length / 2), taken = [...G.hold].sort((a, b) => b.value - a.value).slice(0, n);
  G.hold = G.hold.filter(f => !taken.includes(f));
  track('sunk_by_pirates', { kind: worst?.kind ?? 'unknown', boat: G.boatId, plundered: taken.length });
  standDown();
  lowWarned = false;
  PIRATES.me.wounds = freshWounds();
  sink(taken.length ? `The pirates took ${taken.length} of your fish, the best of the catch` : 'The pirates found nothing worth taking in your hold');
}
/** A pirate beaten for good (sunk, or boarded and let go): counted, its slot stays empty a day, and the paint at 5. */
function defeated(p: Pirate): void {
  sunkAt.set(p.id, G.clock);
  G.stats.pirates++;
  if (G.stats.pirates >= 5 && !G.paints.includes('blacksails')) {
    G.paints.push('blacksails');
    toast(`You earned the ${PAINTS.find(q => q.id === 'blacksails')!.name} paint: sink 5 pirate ships`, 'good');
  }
}
function sinkPirate(p: Pirate): void {
  if (p.role === 'fireship' && p.lit >= 0) { fireBlast(p); return; }   // shot through while alight: she goes up where she is
  const k = KINDS[p.kind], flagship = p.kind === 'galleon';
  setMood(p, 'sinking');
  defeated(p);
  const coins = prize(k.loot * (1 + 1.5 * p.tier) * (0.85 + Math.random() * 0.3));
  const map = Math.random() < k.mapChance ? buriedMap(coins * 1.6, p) : null;
  if (coins > 0 || map) PIRATES.loot.push({ x: p.x, y: p.y, coins, map, ph: Math.random() * TAU, t: 0 });
  burst('debris', p.x, p.y, 26, 44, () => 1.5 + Math.random() * 1.5);
  blast(p.x, p.y, lengthOf(p) * 0.4, hearAt(p.x, p.y) * 0.8);
  sfx('sink', hearAt(p.x, p.y));
  G.shake = Math.max(G.shake, 5);
  track('pirate_sunk', { kind: p.kind, tier: Math.round(p.tier * 10) / 10, map: !!map });
  if (flagship) for (const o of PIRATES.ships) {                     // the flagship's gone: the rest lose heart
    if (o.cove.id !== p.cove.id || !hostile(o)) continue;
    if (o.hp < o.max * 0.6) beaten(o, dist(o, G.boat));
  }
  saveGame();
}
/** The ship alongside to board: one that struck, or (aboard a coast guard cutter) a beaten one still fighting; null if none. */
export function prizeAlongside(): Pirate | null {
  return PIRATES.ships.find(p => p.mood === 'surrender' && alongside(p)) ?? boardable();
}
/** E alongside: take a struck ship's cargo, or send a coast guard cutter's boarders over to fight for a beaten one's deck. */
export function boardPrize(p: Pirate): void {
  if (p.mood === 'surrender') takeCargo(p); else sendBoarders(p);
}
/** Her cargo is yours (more than you'd fish out of the sea if she sank), and she's let go. */
function takeCargo(p: Pirate): void {
  const k = KINDS[p.kind], coins = prize(k.loot * 1.5 * (1 + 1.5 * p.tier) * (0.85 + Math.random() * 0.3));
  const map = G.maps.length < 4 && Math.random() < Math.min(0.9, k.mapChance * 1.4) ? buriedMap(coins * 1.4, p) : null;
  setMood(p, 'struck');
  defeated(p);
  addCoins(coins);
  if (map) G.maps.push(map);
  toast(`You boarded ${p.name} and took her cargo: $${coins}${map ? ' and a map to buried treasure' : ''}. She limps home, flying white`, 'good');
  celebrate(); sfx('coin'); setTimeout(() => sfx('coin', 0.8), 110);
  track('pirate_sunk', { kind: p.kind, tier: Math.round(p.tier * 10) / 10, map: !!map });
  saveGame();
}
function collectLoot(dt: number): void {
  const b = G.boat, reach = 16 + boatDef().L * 0.4;
  for (let i = PIRATES.loot.length - 1; i >= 0; i--) {
    const l = PIRATES.loot[i];
    l.t += dt;
    if (l.t > 240) { PIRATES.loot.splice(i, 1); continue; }   // drifted off and sank
    if (G.mode !== 'play' || dist(l, b) > reach) continue;
    PIRATES.loot.splice(i, 1);
    addCoins(l.coins);
    const map = l.map && G.maps.length < 4 ? l.map : null;
    if (map) G.maps.push(map);
    toast(`You hauled in the pirates' loot: $${l.coins}${map ? ', and a map to buried treasure' : ''}`, 'good');
    sfx('coin'); setTimeout(() => sfx('coin', 0.8), 110);
    saveGame();
  }
}

// ---------------------------------------------------------------- coves
/** Whether a cove's stash lies open: every ship of its fleet beaten this voyage (none come back for a day), not yet raided. */
export function stashOpen(c: Cove): boolean {
  if (quiet(c)) return false;
  return fleetOf(c).every((_, slot) => { const t = sunkAt.get(`${c.id}#${slot}`); return t !== undefined && G.clock - t < RESPAWN; })
    && !PIRATES.ships.some(p => hostile(p) && p.cove.id === c.id);
}
/** The cove whose open stash the boat is close enough to raid, or null. */
export function coveToRaid(): Cove | null {
  const b = G.boat, reach = 60 + boatDef().L;
  for (const p of poisNear(b.x, b.y, 200, poiScratch)) if (p.type === 'cove' && dist(p.anchor, b) < reach && stashOpen(p)) return p;
  return null;
}
export function raidCove(c: Cove): void {
  const t = tierOf(c), coins = prize(160 + 340 * t + Math.random() * 80);
  const map = G.maps.length < 4 ? buriedMap(coins * 1.5, c, 700, 2600) : null;
  G.raids[c.id] = dayNum();
  G.stats.coves++;
  addCoins(coins);
  if (map) G.maps.push(map);
  toast(`You raided ${c.name}: $${coins}${map ? ' and a map to buried treasure' : ''}. Its pirates will stay away a while`, 'good');
  celebrate(); sfx('coin'); setTimeout(() => sfx('coin', 0.8), 110);
  track('cove_raided', { reward_bucket: bucket(coins) });
  saveGame();
}

// ---------------------------------------------------------------- the frame
let fleetT = 0, ramCd = 0, fireT = 0, onFire = false, rakeT = 0, turretLaid = false;
export function updatePirates(dt: number): void {
  if (G.mode !== 'play' && G.mode !== 'sunk') return;
  if ((fleetT -= dt) <= 0) { fleetT = 0.5; manageFleets(); }
  huntNow = hunting();
  tickBattery(dt);
  if (PIRATES.me.taking) taking(dt);
  ramCd -= dt;
  if (G.boat.hp > hpMax() * 0.5) lowWarned = false;
  for (let i = PIRATES.ships.length - 1; i >= 0; i--) {
    const p = PIRATES.ships[i];
    p.t += dt; p.aggro -= dt;
    if (!alive(p)) {
      p.sinkT += dt;
      if (p.sinkT > 4) PIRATES.ships.splice(i, 1);
      continue;
    }
    const fire = mend(p.wounds, dt, p.mood === 'anchored' || p.mood === 'surrender');
    if (fire > 0) { p.hp -= fire; flames(p.x, p.y, lengthOf(p), dt); if (p.hp <= 0) { sinkPirate(p); continue; } }
    if ((p.think -= dt) <= 0) { p.think = 0.25; think(p); }
    if (burning(p, dt)) continue;
    if (p.grapple > 0) grappled(p, dt); else if (PIRATES.me.taking?.p !== p) sail(p, dt);
    pirateGuns(p, dt);
    bump(p);
  }
  fireSalvo();
  stepBalls(PIRATES.balls, dt, strike, shellBurst, hearAt);
  stepKegs(PIRATES.kegs, dt, kegTripped, kegBlast);
  stepTorps(dt);
  stepMissiles(dt);
  stepPlanes(dt);
  collectLoot(dt);
}
/** Your guns load, kegs are made up, and your own fire burns (out twice as fast if you heave to). */
function tickBattery(dt: number): void {
  const me = PIRATES.me, K = KEGS[gearLvl('kegs')];
  const fight = !!threat();
  for (const r of [0, 1]) {
    const was = me.rails[r];
    me.rails[r] = Math.max(0, was - dt);
    if (was > 0 && me.rails[r] === 0 && fight) { call(`${r ? 'Starboard' : 'Port'} guns ready!`, 1); sfx('clank', 0.35); }
  }
  me.swivel = Math.max(0, me.swivel - dt); me.mortar = Math.max(0, me.mortar - dt);
  if (me.chaser > 0 && (me.chaser -= dt) <= 0 && fight && boatDef().signature === 'chaser') call('Bow chaser ready! Put her bow on them', 1);
  const l = launcher(), tubes = l?.n ?? 0, aloft = PIRATES.planes.length;
  if (me.tubes !== tubes) { me.tubes = tubes; me.loaded = tubes; me.tubeT = 0; }                  // a new boat comes with her tubes loaded
  if (l && me.loaded + aloft < tubes && (me.tubeT += dt) >= l.reload * crewReload()) {           // a plane aloft isn't rearming
    me.tubeT = 0; me.loaded++;
    if (fight) call(l.kind === 'torpedo' ? 'Torpedo tube loaded!' : l.kind === 'missile' ? 'Missile cell loaded!' : 'Plane armed and on the catapult!', 1);
  }
  if (boatDef().signature === 'turret') {                           // the turrets train onto her mark, or back fore-and-aft
    me.turret = Math.max(0, me.turret - dt);
    const off = turretOff() ?? wrapAngle(-me.turretA), step = TURRET.traverse * dt, laid = Math.abs(off) <= TURRET.lay;
    me.turretA = wrapAngle(me.turretA + clamp(off, -step, step));
    if (laid && !turretLaid && me.turret <= 0 && turretTarget() && fight) call('Turrets bear! Fire! [R]', 2);
    turretLaid = laid;
  }
  if (me.rack !== gearLvl('kegs')) { me.rack = gearLvl('kegs'); me.kegs = K?.carry ?? 0; }      // a new rack (or boat) comes filled
  if (K && me.kegs < K.carry && (me.kegT += dt) >= K.every) { me.kegT = 0; me.kegs++; }
  if (G.mode !== 'play') return;
  swivelAuto();
  if (me.wounds.burn > 0 !== onFire) { onFire = !onFire; if (onFire) call('Fire aboard! Heave to and the crew can douse it', 4); }
  if (fight && (rakeT -= dt) <= 0) {                                 // a loaded rail bearing along a pirate's length
    rakeT = 0.5;
    const t = [railTarget(-1), railTarget(1)].find((q, r) => q && me.rails[r] <= 0 && raking(q.a, q.x - G.boat.x, q.y - G.boat.y));
    if (t) call(`You're across her ${Math.cos(bearing(t, G.boat) - t.a) > 0 ? 'bow' : 'stern'}. Rake her! [R]`, 2);
  }
  const still = Math.hypot(G.boat.vx, G.boat.vy) < 5, fire = mend(me.wounds, dt, still);
  if (fire > 0) {
    flames(G.boat.x, G.boat.y, boatDef().L, dt);
    if ((fireT += fire) >= 3) { hurtPlayer(fireT, G.boat.x, G.boat.y); fireT = 0; }
  } else fireT = 0;
}
/** Flames and black smoke off a burning hull. */
function flames(x: number, y: number, L: number, dt: number): void {
  if (Math.random() < dt * 14) spawn({ kind: 'spark', x: x + (Math.random() - 0.5) * L * 0.6, y: y + (Math.random() - 0.5) * L * 0.3, z: 4, vx: (Math.random() - 0.5) * 6, vy: -(4 + Math.random() * 6), life: 0.4 + Math.random() * 0.3 });
  if (Math.random() < dt * 6) spawn({ kind: 'smoke', x: x + (Math.random() - 0.5) * L * 0.5, y, z: 5, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, vz: 7 + Math.random() * 4, size: 2.4 + Math.random() * 1.6, dark: 0.75, life: 1.8 + Math.random() });
}
/** Hulls are solid: you and a pirate push apart, and coming together fast stoves in both (an iron ram stoves in theirs). */
function bump(p: Pirate): void {
  const b = G.boat, bd = boatDef(), reach = 0.4 * (bd.L + lengthOf(p)), dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
  if (d >= reach || d < 1e-3 || G.mode !== 'play' || p.grapple > 0) return;
  const nx = dx / d, ny = dy / d, push = (reach - d) / 2;
  b.x += nx * push; b.y += ny * push; p.x -= nx * push; p.y -= ny * push;
  const closing = -((b.vx - p.vx) * nx + (b.vy - p.vy) * ny);
  if (closing <= 0) return;
  b.vx += nx * closing * 0.6; b.vy += ny * closing * 0.6; p.vx -= nx * closing * 0.4; p.vy -= ny * closing * 0.4;
  if (closing > 18 && ramCd <= 0) {
    ramCd = 0.6;
    const ram = RAM[Math.min(1, gearLvl('ram'))], mine = -(b.vx * nx + b.vy * ny) > p.vx * nx + p.vy * ny;   // who ran into whom
    const at = { x: b.x - nx * reach / 2, y: b.y - ny * reach / 2 };
    hurtPirate(p, closing * 0.6 * (mine ? ram.out : 1), at.x, at.y, mine && ram.out > 1 ? 'Rammed!' : null);
    hurtPlayer(closing * 0.35 * (mine ? ram.back : p.role === 'brawler' ? 1.6 : 1), at.x, at.y);
  } else sfx('slap', 0.6);
}
/** The flag at her masthead now: none while she shadows you, her black flag when she hails (and after), red for no quarter. */
export const flagOf = (p: Pirate): number => p.mood === 'shadow' || (p.mood === 'hail' && p.parley === 0) || p.role === 'fireship' ? -1
  : p.mood === 'chase' || p.mood === 'engage' || p.mood === 'flee' ? RED_FLAG : p.flag;
/** The raider lashed alongside you with her boarders on your deck, or null. */
export const boarder = (): Pirate | null => PIRATES.ships.find(p => p.grapple > 0) ?? null;
/** The ship hailing you to heave to (black flag up, waiting on your answer), for the prompt line; null when none is. */
export const hailer = (): Pirate | null => PIRATES.ships.find(p => p.mood === 'hail' && p.parley > 0) ?? null;
/** The pirate most dangerous to you right now (nearest of those fighting you), for the HUD; null when none is. */
export function threat(): Pirate | null {
  let best: Pirate | null = null, bd = Infinity;
  for (const p of PIRATES.ships) {
    if (p.mood !== 'chase' && p.mood !== 'engage') continue;
    const d = dist(p, G.boat);
    if (d < bd) { best = p; bd = d; }
  }
  return best;
}
