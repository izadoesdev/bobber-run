// Derived stats: what the current boat and upgrades add up to, the day clock and the wind.
import { BROADSIDE, KEGS, MORTAR, SWIVEL } from './arms';
import { nA } from '../noise';
import { WX } from '../weather';
import { SPECIES, BOATS, UPGRADE_STEP } from '../econ';
import type { BoatDef, Env, Fish, ProjectId, UpgradeKey, Helper } from '../types';
import type { Fit } from '../models';
import { G } from './state';
import { frac } from '../config';
import { SHIP_NEED, VARIANTS, type VariantId } from '../species';
import { FEATURED_PRICE, featuredToday } from '../today';


// ---------- boat and gear ----------
// how much one level of each stat upgrade adds (the shop quotes these numbers)
const { prop: PROP_STEP, hull: HULL_STEP, hold: HOLD_STEP, line: LINE_STEP, ice: ICE_STEP } = UPGRADE_STEP;
// boatId always names a BOATS entry (saves only ever store ids from that list)
export const boatDef = (): BoatDef => BOATS.find(b => b.id === G.boatId)!;
/** Deck size of the boat you sail: sea giants need 1 (Trawler and up), the very largest 2 (Flagship). */
export const deckLvl = (): number => boatDef().deck ?? 0;
/** The smallest boat whose deck can land species `sp`. */
export const deckBoat = (sp: number): BoatDef => BOATS.find(b => (b.deck ?? 0) >= SPECIES[sp].deck)!;
/** Why you can't land species `sp` with your rod and boat, or null if you can. */
export function catchNeed(sp: number): string | null {
  const s = SPECIES[sp];
  if (s.rod > G.up.rod) return `needs a level ${s.rod + 1} rod`;
  if (s.deck > deckLvl()) return `needs a bigger boat: the ${deckBoat(sp).name}${s.deck < 2 ? ' or larger' : ''}`;
  const need = SHIP_NEED[s.id];
  if (need === 'sail' && boatDef().prop === 'ENGINE') return 'spooks at engines: needs sails (the Schooner)';
  if (need === 'keel' && keelLvl() < 1) return 'needs a Storm Keel to hold in rough water (the Steam Drifter has one)';
  return null;
}
/** Your rod and boat can land species `sp`. */
export const canLand = (sp: number): boolean => catchNeed(sp) === null;
/** A boat's numbers with your upgrades fitted (any boat, so the shipyard can compare). */
export function boatStats(bd: BoatDef = boatDef()): { speed: number; hold: number; hp: number; turn: number; accel: number } {
  const keel = Math.max(G.up.keel, bd.keel ?? 0);
  return {
    speed: bd.speed * (1 + PROP_STEP * G.up.prop), hold: bd.hold + HOLD_STEP * G.up.hold + chartPerks().hold,
    hp: Math.round(bd.hp * (1 + HULL_STEP * G.up.hull) * (keel >= 2 ? 1.25 : 1)), turn: bd.turn, accel: bd.accel,
  };
}
/** What charting the coast is worth: +1% sailing speed per landmark charted beyond home (up to +12%, for the
 *  physics to apply), and a hold slot per 4 lighthouses charted (up to +3). */
export function chartPerks(): { speed: number; hold: number } {
  const lights = [...G.found].filter(id => id.startsWith('light:')).length;
  return { speed: Math.min(0.12, 0.01 * Math.max(0, G.found.size - 1)), hold: Math.min(3, Math.floor(lights / 4)) };
}
export const cap = (): number => boatStats().hold;
export const hpMax = (): number => boatStats().hp;
// gear a ship carries built in counts like the upgrade
/** The level of gear you own or your boat carries (a helper counts whether or not it is switched on). */
export const gearLvl = (k: UpgradeKey): number => Math.max(G.up[k], builtIn(k));
/** A helper's level, or 0 while the player has it switched off. */
const helperLvl = (k: Helper): number => G.gearOff[k] ? 0 : gearLvl(k);
export const crewLvl = (): number => helperLvl('deckhand');
export const keelLvl = (): number => gearLvl('keel');
export const harpoonLvl = (): number => gearLvl('harpoon');
export const sonarLvl = (): number => gearLvl('sonar');
export const netLvl = (): number => helperLvl('net');
export const potsLvl = (): number => helperLvl('pots');
export const projDone = (id: ProjectId): boolean => G.projects.includes(id);
export const speedMul = (): number => boatStats().speed;
/** How far the lantern's warm pool reaches. */
export const lampR = (): number => 21 + 19 * G.up.lantern;
/** How far round the boat fish show at night: the lantern, or a motor yacht's underwater lights. */
export const lightR = (): number => lampR() + (boatDef().lights ? 45 : 0);
export const lineMax = (): number => 1 + LINE_STEP * G.up.line;
export const contractSlots = (): number => 3 + G.up.quarter;
// fish never spoil; the ice box keeps them prime and worth a little more. Today's featured fish sell double, and
// variants (big, albino...) at their own rate.
export const fishValue = (f: Fish): number => Math.round(f.value * (1 + ICE_STEP * G.up.ice)
  * (featuredToday(f.sp) ? FEATURED_PRICE : 1) * (f.variant ? VARIANTS[f.variant as VariantId]?.valueMul ?? 1 : 1));
export const logged = (): number => SPECIES.filter(s => G.log[s.id]).length;

// ---------- what an upgrade level amounts to (the outfitter's "now -> next" line) ----------
// Effects that live in fishing/sailing code are quoted from there: reel, tackle, net, pots, radio, deckhand, harpoon, bell.
const BUILT_IN: Partial<Record<UpgradeKey, 'sonar' | 'net' | 'crew' | 'keel' | 'harpoon'>> = { sonar: 'sonar', net: 'net', deckhand: 'crew', keel: 'keel', harpoon: 'harpoon' };
/** The level of gear the current boat carries for upgrade `k` without buying it. */
export const builtIn = (k: UpgradeKey): number => {
  if (k === 'cannon' || k === 'swivel' || k === 'mortar' || k === 'kegs' || k === 'ram') return boatDef().arms?.[k] ?? 0;   // a warship's guns
  const b = BUILT_IN[k]; return b ? boatDef()[b] ?? 0 : 0;
};
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const UPGRADE_STAT: Record<UpgradeKey, [string, (l: number) => string]> = {
  prop: ['Top speed', l => pct(boatDef().speed * (1 + PROP_STEP * l))],
  hull: ['Hull', l => `${Math.round(boatDef().hp * (1 + HULL_STEP * l) * (keelLvl() >= 2 ? 1.25 : 1))} points`],
  hold: ['Hold', l => `${boatDef().hold + HOLD_STEP * l + chartPerks().hold} fish`],
  bilge: ['Pump', l => ['off', '1 hull point / 4 s', '1 hull point / 1.4 s'][l]],
  anchor: ['Anchor', l => l ? 'holds you still' : 'none'],
  net: ['Drift net', l => ['none', '1 fish / 3.6 s', '1 fish / 2.9 s', '1 fish / 2.2 s'][l]],
  rod: ['Species you can catch', l => `${SPECIES.filter(s => s.rod <= l && s.deck <= deckLvl()).length} of ${SPECIES.length}`],
  reel: ['Reeling speed', l => pct(1 + 0.12 * l)],
  line: ['Line strength', l => pct(1 + LINE_STEP * l)],
  tackle: ['Wait for a bite', l => pct(1 - 0.12 * l)],
  ice: ['Fish value', l => pct(1 + ICE_STEP * l)],
  sonar: ['Sonar', l => ['off', 'schools', 'schools by species', 'species and legends'][l]],
  lantern: ['Night light', l => `${((21 + 19 * l) / 21).toFixed(1)}x reach`],
  spyglass: ['Charting range', l => `${[1, 1.5, 2][l]}x`],
  sextant: ['Sextant', l => ['off', 'points to the nearest uncharted place', 'marks every uncharted place'][l]],
  radio: ['Feeding frenzies', l => l ? 'every 4 to 7 minutes' : 'every 5 to 9 minutes'],
  deckhand: ['Bonus catch', l => pct([0, 0.25, 0.4][l]) + ' chance'],
  cook: ['Sale price', l => `+${10 * l}%`],
  quarter: ['Contracts', l => `${3 + l} at once, pay +${15 * l}%`],
  pots: ['Crab pots', l => ['none', '1 crab / 4 min', '1 crab / 2.5 min', '1 crab / min'][l]],
  keel: ['Storm push', l => pct([1, 0.5, 0][l])],
  harpoon: ['Landing giants', l => `${pct(1 + 0.25 * l)} speed`],
  bell: ['Daily wreck dive', l => ['none', '60% of the loot', '120% of the loot'][l]],
  cannon: ['Broadside', l => { const c = BROADSIDE[l]; return c ? `${c.guns} × ${c.dmg} a side, ${c.reload} s to reload` : 'none'; }],
  swivel: ['Bow swivel', l => { const c = SWIVEL[l]; return c ? `${c.dmg} damage every ${c.reload} s` : 'none'; }],
  mortar: ['Mortar', l => { const c = MORTAR[l]; return c ? `${c.dmg} damage, ${c.min} to ${c.range} away` : 'none'; }],
  kegs: ['Powder kegs', l => { const c = KEGS[l]; return c ? `${c.carry} aboard, ${c.dmg} damage` : 'none'; }],
  ram: ['Ramming', l => l ? '2.5 times the damage' : 'normal'],
};
/** The stat upgrade `k` changes and its value at level `l` (gear built into the current boat counts as a floor). */
export function upgradeStat(k: UpgradeKey, l: number): [string, string] {
  const [stat, at] = UPGRADE_STAT[k];
  return [stat, at(Math.max(l, builtIn(k)))];
}

/** What the boat should visibly carry (levels the models draw). */
export function equipment(): Fit {
  const u = G.up;
  return {
    paint: G.paint, plate: u.hull, prop: u.prop, lantern: u.lantern, sonar: sonarLvl(), rod: u.rod, ice: u.ice, tackle: u.tackle,
    net: u.net, radio: u.radio, anchor: u.anchor, hold: u.hold, pile: Math.min(3, Math.ceil(G.hold.length / 3)),
    deckhand: crewLvl(), cook: u.cook, quarter: u.quarter, bilge: Math.max(0, Math.min(2, u.hull - 1)),   // plating's pump
    reel: u.reel, pet: G.pet ? 1 : 0,
    pots: u.pots, harpoon: harpoonLvl(), bell: u.bell, cannon: u.cannon, swivel: u.swivel, mortar: u.mortar, kegs: u.kegs, ram: u.ram, jolly: 0,
  };
}

// ---------- clock ----------
/** Seconds of game clock per day. */
export const DAYLEN = 480;
export const dayFrac = (): number => frac(G.clock / DAYLEN);
/** Move the clock forward to `f` of a day (today if still ahead, else tomorrow). */
export function atClock(f: number): void {
  const base = Math.floor(G.clock / DAYLEN) * DAYLEN;
  G.clock = base + (f > (G.clock - base) / DAYLEN ? 0 : DAYLEN) + f * DAYLEN;
}
export const dayNum = (): number => Math.floor(G.clock / DAYLEN) + 1;
/** 0 by day, ramping to 1 through dusk and back down before dawn. */
export function darkness(): number {
  const c = dayFrac();
  if (c < 0.6) return 0;
  if (c < 0.68) return (c - 0.6) / 0.08;
  if (c < 0.9) return 1;
  return 1 - (c - 0.9) / 0.1;
}
export const isNight = (): boolean => darkness() > 0.5;
export function env(): Env {
  const c = dayFrac();
  return { night: isNight(), twilight: (c > 0.56 && c < 0.7) || c > 0.88 || c < 0.03, weather: WX.state };
}

// ---------- wind and sails ----------
/**
 * The spinnaker every sail carries (hoisted and doused on the special key, game/special.ts): seconds to set it, how
 * much it adds running dead before the wind, the angle off the wind past which it collapses, how much it then holds
 * her back, the wind it strains in, how long it lasts straining before it blows out, and how long the crew take to
 * bend on a new one.
 */
export const SPIN = { hoist: 1.2, pull: 0.65, flog: 2.0, back: 0.3, strain: 0.7, blowS: 8, mend: 40 };
/** How far her spinnaker is set, 0..1. */
export const RIG = { spin: 0 };
export const windAngle = (): number => 0.9 + 2.2 * nA(G.clock * 0.0015, 7.3);
/** How far heading `a` is off the wind's eye, 0 (dead downwind) .. PI (dead into it). */
export const offWind = (a: number): number => Math.abs(((a - windAngle()) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
/** Sail push at heading `a` for any rig: best across the wind, weak dead into it. */
export function windEfficiency(a: number): number {
  const rel = offWind(a);
  return rel < Math.PI / 2 ? 1 + 0.2 * Math.sin(rel) : 0.35 + 0.85 * Math.cos(rel - Math.PI / 2);
}
/** Your own sails' push at heading `a`: a schooner's gaff rig pulls harder still right abeam, and a weatherly rig
 *  (racing yacht, cutter) close-hauled, from just forward of the beam to twenty degrees off the wind's eye. A
 *  spinnaker, as far as it's set, pulls hard running before the wind, less on a reach, and close-hauled it collapses
 *  and flogs, holding her back. */
export function sailEfficiency(a = G.boat.a): number {
  const bd = boatDef(), rel = offWind(a);
  return windEfficiency(a) + (bd.reach ? 0.35 * Math.max(0, Math.cos(2 * (rel - Math.PI / 2))) : 0) + (bd.point ? 0.4 * Math.max(0, 1 - Math.abs(rel - 2.2) / 0.6) : 0)
    + RIG.spin * (rel < SPIN.flog ? SPIN.pull * Math.cos(rel * Math.PI / 2 / SPIN.flog) : -SPIN.back * Math.min(1, (rel - SPIN.flog) / 0.4));
}

// ---------- boat frame ----------
export const boatSpeed = (): number => Math.hypot(G.boat.vx, G.boat.vy);
/** Boat-local (u forward, v starboard) to world coordinates. */
export function toWorld(u: number, v: number, b: { x: number; y: number; a: number } = G.boat): [number, number] {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return [b.x + u * c - v * s, b.y + u * s + v * c];
}
