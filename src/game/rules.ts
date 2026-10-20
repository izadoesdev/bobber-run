// Derived stats: what the current boat and upgrades add up to, the day clock and the wind.
import { nA } from '../noise';
import { WX } from '../weather';
import { SPECIES, BOATS } from '../econ';
import type { BoatDef, Env, Fish, ProjectId } from '../types';
import { G } from './state';

const frac = (x: number): number => x - Math.floor(x);

// ---------- boat and gear ----------
// boatId always names a BOATS entry (saves only ever store ids from that list)
export const boatDef = (): BoatDef => BOATS.find(b => b.id === G.boatId)!;
export const cap = (): number => boatDef().hold + 2 * G.up.hold;
export const hpMax = (): number => Math.round(boatDef().hp * (1 + 0.25 * G.up.hull) * (keelLvl() >= 2 ? 1.25 : 1));
// gear a ship carries built in counts like the upgrade
const built = (k: 'crew' | 'keel' | 'harpoon'): number => boatDef()[k] ?? 0;
export const crewLvl = (): number => Math.max(G.up.deckhand, built('crew'));
export const keelLvl = (): number => Math.max(G.up.keel, built('keel'));
export const harpoonLvl = (): number => Math.max(G.up.harpoon, built('harpoon'));
export const sonarLvl = (): number => Math.max(G.up.sonar, boatDef().sonar);
export const netLvl = (): number => Math.max(G.up.net, boatDef().net);
export const projDone = (id: ProjectId): boolean => G.projects.includes(id);
export const speedMul = (): number => boatDef().speed * (1 + 0.12 * G.up.prop);
export const lightR = (): number => 21 + 19 * G.up.lantern;
export const lineMax = (): number => 1 + 0.12 * G.up.line;
export const contractSlots = (): number => 3 + G.up.quarter;
// fish never spoil; the ice box keeps them prime and worth a little more
export const fishValue = (f: Fish): number => Math.round(f.value * (1 + 0.05 * G.up.ice));
export const logged = (): number => SPECIES.filter(s => G.log[s.id]).length;

/** What the boat should visibly carry (levels the models draw). */
export interface Equipment {
  paint: string; plate: number; prop: number; lantern: number; sonar: number; rod: number; ice: number; tackle: number;
  net: number; radio: number; anchor: number; hold: number; pile: number; deckhand: number; cook: number; quarter: number;
  bilge: number; reel: number; pet: number; pots: number; harpoon: number; bell: number;
}
export function equipment(): Equipment {
  const u = G.up;
  return {
    paint: G.paint, plate: u.hull, prop: u.prop, lantern: u.lantern, sonar: sonarLvl(), rod: u.rod, ice: u.ice, tackle: u.tackle,
    net: u.net, radio: u.radio, anchor: u.anchor, hold: u.hold, pile: Math.min(3, Math.ceil(G.hold.length / 3)),
    deckhand: crewLvl(), cook: u.cook, quarter: u.quarter, bilge: u.bilge, reel: u.reel, pet: G.pet ? 1 : 0,
    pots: u.pots, harpoon: harpoonLvl(), bell: u.bell,
  };
}

// ---------- clock ----------
/** Seconds of game clock per day. */
export const DAYLEN = 480;
export const dayFrac = (): number => frac(G.clock / DAYLEN);
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
export const windAngle = (): number => 0.9 + 2.2 * nA(G.clock * 0.0015, 7.3);
/** Sail push for heading `a`: best across the wind, weak dead into it. */
export function sailEff(a: number): number {
  const rel = Math.abs(((a - windAngle()) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return rel < Math.PI / 2 ? 1 + 0.2 * Math.sin(rel) : 0.35 + 0.85 * Math.cos(rel - Math.PI / 2);
}
export const sailEfficiency = (): number => sailEff(G.boat.a);

// ---------- boat frame ----------
export const boatSpeed = (): number => Math.hypot(G.boat.vx, G.boat.vy);
/** Boat-local (u forward, v starboard) to world coordinates. */
export function toWorld(u: number, v: number, b: { x: number; y: number; a: number } = G.boat): [number, number] {
  const c = Math.cos(b.a), s = Math.sin(b.a);
  return [b.x + u * c - v * s, b.y + u * s + v * c];
}
