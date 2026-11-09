// Each boat's special, on the K key. Her rig gives one to every boat of a kind: a spinnaker on every sail, a hard
// sprint at the oars, a horn on every engine. A few boats have their own instead (BoatDef.special): the superyacht's
// helicopter flies the catch to market (heli.ts), the speedboat opens her throttles wide, and the research vessel
// sends out a long-range sonar ping.
import type { BoatDef, BoatId, School } from '../types';
import { sfx } from '../audio';
import { WX } from '../weather';
import { LIFE } from '../life';
import { SPECIES } from '../econ';
import { schoolsNear } from '../world';
import { dirTo } from '../config';
import { G } from './state';
import { RIG, SPIN, boatDef, toWorld } from './rules';
import { FUNNEL } from '../models';
import { jitter, spawn, toast } from './feedback';
import { flyCatch, heliReady } from './heli';
import { lockedAt } from './regions';
import { schoolShown } from './schools';

export type Special = 'heli' | 'boost' | 'ping' | 'spinnaker' | 'sprint' | 'horn';
export const specialOf = (bd: BoatDef = boatDef()): Special => bd.special ?? (bd.prop === 'SAIL' ? 'spinnaker' : bd.prop === 'OARS' ? 'sprint' : 'horn');

/** Bursts of speed: how long, how long until the next, and how much harder she's driven meanwhile. */
export const BURST = { boost: { time: 5, cool: 25, push: 1.8 }, sprint: { time: 2.5, cool: 8, push: 1.7 } };
/** The research vessel's ping: how far it reaches (world units), how long the chart shows what it found, the wait. */
export const PING = { r: 1500, show: 30, cool: 20 };
/** How long a horn blast keeps the next one waiting, and how often it can call dolphins over. */
const HORN = { cool: 2.5, calls: 60 };

export const SPECIAL = {
  /** the burst left, and the time until the special can be used again */
  boostT: 0, cool: 0,
  /** the spinnaker wanted up (rules.ts RIG has how far it's set), and how long it has been straining in a gale */
  spinUp: false, strainT: 0,
  /** the last ping: where and when it went out, and how long the chart keeps showing what it found */
  pingX: 0, pingY: 0, pingT: -99, revealT: 0,
  /** when a horn last called the dolphins */
  calledT: -99,
  /** when the spinnaker last blew out, and her heading then: the renderer sends it flying off downwind */
  blownT: -99, blownA: 0,
  /** the boat all this is for */
  boat: '' as BoatId | '',
};
/** How much harder the engines (or oars) push now. */
export const boostMul = (): number => {
  const sp = specialOf();
  return SPECIAL.boostT > 0 && (sp === 'boost' || sp === 'sprint') ? BURST[sp].push : 1;
};
/** Something the K key would do now. */
export function specialReady(): boolean {
  const sp = specialOf();
  if (sp === 'heli') return heliReady();
  return G.mode === 'play' && !G.fish && (SPECIAL.cool <= 0 || (sp === 'spinnaker' && SPECIAL.spinUp));   // a set spinnaker can always come down
}
/** The ping's reach while the chart shows it, or null. */
export const pingShown = (): { x: number; y: number; r: number; age: number } | null =>
  SPECIAL.revealT > 0 ? { x: SPECIAL.pingX, y: SPECIAL.pingY, r: PING.r, age: G.t - SPECIAL.pingT } : null;
/** Her spinnaker is set and collapsing with the wind too far forward. */
export const spinFlogging = (rel: number): boolean => RIG.spin > 0.5 && rel > SPIN.flog;

const WAIT: Record<Special, string> = { heli: '', boost: 'The engines are still cooling', ping: 'The sonar is still recharging', spinnaker: 'The crew are bending on a new spinnaker', sprint: 'The crew need their breath back', horn: '' };

export function useSpecial(): void {
  const sp = specialOf();
  if (sp === 'heli') { flyCatch(); return; }
  if (!specialReady()) {
    if (sp === 'horn') return;                              // blown a moment ago: let it ring
    sfx('deny');
    if (SPECIAL.cool > 0 && G.mode === 'play' && !G.fish) toast(`${WAIT[sp]}: ${Math.ceil(SPECIAL.cool)}s`);
    return;
  }
  if (sp === 'boost' || sp === 'sprint') {
    SPECIAL.boostT = BURST[sp].time; SPECIAL.cool = BURST[sp].cool;
    if (sp === 'boost') { sfx('throttle'); toast('Full throttle!'); } else { sfx('oar'); toast('Pull together!'); }
  } else if (sp === 'spinnaker') {
    SPECIAL.spinUp = !SPECIAL.spinUp;
    sfx(SPECIAL.spinUp ? 'fill' : 'move');
    if (SPECIAL.spinUp) SPECIAL.strainT = 0;
  } else if (sp === 'ping') ping();
  else horn();
}

function ping(): void {
  const b = G.boat;
  Object.assign(SPECIAL, { pingX: b.x, pingY: b.y, pingT: G.t, revealT: PING.show, cool: PING.cool });
  sfx('ping');
  spawn({ kind: 'ring', x: b.x, y: b.y, life: 1.2, r0: 4, grow: 14 });     // the transducer's thump at the hull (the renderer spreads the pulse)
  const found: [School, number][] = [];
  for (const s of schoolsNear(b.x, b.y, PING.r)) {
    const d = Math.hypot(s.x - b.x, s.y - b.y);
    if (d < PING.r && s.stock > 0 && !s.boss && schoolShown(s) && !lockedAt(s.x, s.y)) found.push([s, d]);
  }
  found.sort((p, q) => p[1] - q[1]);
  const m = (d: number): number => Math.max(1, Math.round(d / 10)), where = ([s, d]: [School, number]): string => `${SPECIES[s.sp].name}, ${m(d)} m ${dirTo(b.x, b.y, s.x, s.y)}`;
  if (!found.length) { toast(`Sonar: nothing within ${m(PING.r)} m`); return; }
  const legend = found.find(([s]) => SPECIES[s.sp].legend), best = found.reduce((a, q) => SPECIES[q[0].sp].base > SPECIES[a[0].sp].base ? q : a);
  const extra = legend ? (legend === found[0] ? '. A legend!' : `. And a legend: ${where(legend)}!`) : best[0].sp !== found[0][0].sp ? `. Richest: ${where(best)}` : '';
  toast(`Sonar: ${found.length} school${found.length > 1 ? 's' : ''} within ${m(PING.r)} m. Nearest: ${where(found[0])}${extra}`, legend ? 'good' : 'info');
}

function horn(): void {
  const bd = boatDef(), b = G.boat, big = bd.L >= 30;
  SPECIAL.cool = HORN.cool;
  sfx(big ? 'horn' : 'toot');
  const fn = FUNNEL[bd.id], [x, y] = toWorld(fn ? fn[0] : bd.L * 0.1, fn ? fn[1] : 0), z = fn ? fn[2] + 3 : 12;   // the whistle's white plume
  for (let i = 0; i < (big ? 6 : 3); i++) spawn({ kind: 'smoke', x, y, z, vx: b.vx * 0.8 + jitter(6), vy: b.vy * 0.8 + jitter(6), vz: 10 + i * 2, life: 1.2 + i * 0.15, size: big ? 3 : 2, dark: 0 });
  if (!LIFE.pods.length && G.t - SPECIAL.calledT > HORN.calls) {           // dolphins come to see what's calling
    SPECIAL.calledT = G.t;
    LIFE.nextPod = Math.min(LIFE.nextPod, 2.5);
  }
}

function blowOut(): void {
  const b = G.boat;
  Object.assign(SPECIAL, { spinUp: false, strainT: 0, cool: SPIN.mend, blownT: G.t, blownA: b.a }); RIG.spin = 0;
  sfx('rip');
  toast(`The spinnaker blew out! The crew will have a new one bent on in ${SPIN.mend}s`, 'bad');
}

export function stepSpecial(dt: number): void {
  if (SPECIAL.boat !== G.boatId) resetSpecial();                    // a new boat: nothing carries over
  const sp = specialOf();
  SPECIAL.boostT = sp === 'boost' || sp === 'sprint' ? Math.max(0, SPECIAL.boostT - dt) : 0;
  SPECIAL.cool = Math.max(0, SPECIAL.cool - dt);
  SPECIAL.revealT = sp === 'ping' ? Math.max(0, SPECIAL.revealT - dt) : 0;
  if (sp !== 'spinnaker' || G.mode !== 'play') { SPECIAL.spinUp = false; RIG.spin = 0; SPECIAL.strainT = 0; return; }
  RIG.spin = Math.max(0, Math.min(1, RIG.spin + (SPECIAL.spinUp ? dt / SPIN.hoist : -dt / 0.6)));
  if (RIG.spin > 0.9 && WX.wind > SPIN.strain) {
    if (SPECIAL.strainT === 0) toast('The spinnaker is straining in this wind. Douse it [K] before it blows out', 'bad');
    SPECIAL.strainT += dt;
    if (SPECIAL.strainT > SPIN.blowS) blowOut();
  } else SPECIAL.strainT = 0;
}

export const resetSpecial = (): void => { RIG.spin = 0; Object.assign(SPECIAL, { boat: G.boatId, boostT: 0, cool: 0, spinUp: false, strainT: 0, pingT: -99, revealT: 0, calledT: -99, blownT: -99 }); };
