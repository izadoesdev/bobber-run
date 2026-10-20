// The single game state object `G`, and keyboard helpers over it.
import { UPGRADE_KEYS } from '../econ';
import type { GameState, Stats, UpgradeKey } from '../types';

export const freshUpgrades = (): Record<UpgradeKey, number> =>
  Object.fromEntries(UPGRADE_KEYS.map(k => [k, 0])) as Record<UpgradeKey, number>;
export const freshStats = (): Stats =>
  ({ caught: 0, sold: 0, upgrades: 0, lights: 0, contracts: 0, wrecks: 0, trophies: 0, night: 0, frenzy: 0, treasures: 0, storm: 0 });

export const G: GameState = {
  // progress (saved)
  coins: 0, earned: 0, boatId: 'row', owned: ['row'], up: freshUpgrades(), paint: 'classic', paints: ['classic'],
  bait: { shrimp: 0, glow: 0, chum: 0 }, baitSel: 'shrimp', hold: [], log: {}, found: new Set(), salvaged: new Set(),
  lastPort: null, stats: freshStats(), story: null, gifts: {}, pet: null, projects: [], fleet: {}, dives: {},
  goalsDone: [], maps: [], waypoint: null, gearOff: {}, zones: {}, docks: {}, streak: 0, musicOn: true, offers: {}, active: [], pity: 0, clock: 0,
  // the voyage
  mode: 'title', t: 0,
  boat: { x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, px: 0, py: 0, pa: 0, phaseL: 0.5, phaseR: 0.5, hp: 100 },
  coinsShown: 0, sat: {}, dry: 0, fish: null, frenzy: null, nextFrenzy: 50, throttle: 0,
  lairTold: false, sunkT: 0, sunkMsg: '',
  // timers
  crashCd: 0, spookCd: 0, petCd: 0, petT: 0, wakeAcc: 0, idleRing: 0, smokeT: 0, bilgeT: 0, saveT: 0, netT: 0, potT: 0,
  // feedback
  toasts: [], captions: [], floaters: [], parts: [], card: null, catchAnim: null, bought: null, confirm: null, myEmote: null,
  // camera
  cam: { x: 0, y: 0 }, look: { x: 0, y: 0 }, shake: 0, shakeX: 0, shakeY: 0,
  // input
  keys: {}, pressed: new Set(), pad: false,
  // surroundings
  prompt: null, nearPort: null, nearWreck: null, nearSchool: null, nearTreasure: null,
  // screens
  menu: { tab: 0, sel: 0, port: null }, map: { x: 0, y: 0, zoom: 1 }, talk: null,
  shipSel: 0, logSel: 0, titleSel: 0, pauseSel: 0, newConfirm: -1, setSel: 0, ctlSel: 0, emoteSel: 0,
  back: 'title', accountBack: 'play', journalBack: 'play', cheatBack: 'play', leadersBack: 'play', leaderTab: 0, islandKey: null, islandBack: 'play', cheatBuf: '', cheatErr: false,
  rebinding: null, netForm: null, netMsg: null, needName: false,
  // cheats
  god: false, cheated: false,
};

/** Is this key held right now? */
export const held = (k: string): boolean => !!G.keys[k];
const anyHeld = (...ks: string[]): boolean => ks.some(held);
/** Steering input: arrows or WASD. */
export const inp = {
  up: () => anyHeld('ArrowUp', 'w', 'W'),
  down: () => anyHeld('ArrowDown', 's', 'S'),
  left: () => anyHeld('ArrowLeft', 'a', 'A'),
  right: () => anyHeld('ArrowRight', 'd', 'D'),
};
/** Was any of these keys pressed this frame? */
export const hit = (...ks: string[]): boolean => ks.some(k => G.pressed.has(k));
