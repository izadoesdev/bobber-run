// The superyacht's helicopter: at sea it lifts the catch off her pad and flies it to the nearest charted harbour, where
// it's sold (paid on the radio as it takes off), then flies back and lands. It can't go again until it is back aboard.
import type { Point, Port } from '../types';
import { wrapAngle } from '../config';
import { homePort } from '../world';
import { sfx } from '../audio';
import { G } from './state';
import { boatDef } from './rules';
import { lockedAt } from './regions';
import { toast } from './feedback';
import { chartedPorts, keptBack, sell } from './port';

export const HELI = { speed: 210, turn: 3, alt: 30, lift: 1, pad: [40.5, 0, 11] as const, scale: 1.25 };
export interface Flight { x: number; y: number; z: number; a: number; bank: number; to: Port; back: boolean; t: number }
/** The helicopter aloft, or null while she sits on the pad. */
export const HELI_STATE: { flight: Flight | null } = { flight: null };

/** Where the pad is, in the world. */
export function padAt(): Point & { z: number } {
  const b = G.boat, c = Math.cos(b.a), s = Math.sin(b.a), [u, v, z] = HELI.pad;
  return { x: b.x + u * c - v * s, y: b.y + u * s + v * c, z };
}
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
/** The harbour she would fly to: the nearest charted one in open waters. */
export function heliPort(): Port {
  const b = G.boat;
  let best = homePort(), bd = dist(best, b);
  for (const p of chartedPorts()) if (!lockedAt(p.x, p.y) && dist(p, b) < bd) { best = p; bd = dist(p, b); }
  return best;
}
/** Sitting on the pad with fish to fly: something the [K] key would do. */
export const heliReady = (): boolean => boatDef().special === 'heli' && !HELI_STATE.flight && G.mode === 'play' && !G.fish && G.hold.some(f => !keptBack().has(f));

export function flyCatch(): void {
  if (boatDef().special !== 'heli' || HELI_STATE.flight || G.mode !== 'play' || G.fish) { sfx('deny'); return; }
  const to = heliPort(), n = G.hold.length;
  sell(to, `by helicopter at ${to.name}`);
  if (G.hold.length === n) return;                       // nothing to fly, or a sale waiting on a second press
  const p = padAt();
  HELI_STATE.flight = { ...p, a: G.boat.a, bank: 0, to, back: false, t: 0 };
  sfx('rotor');
}

export function stepHeli(dt: number): void {
  const h = HELI_STATE.flight;
  if (!h) return;
  if (boatDef().special !== 'heli') { HELI_STATE.flight = null; return; }   // she changed boats: the helicopter stays ashore
  const pad = padAt(), goal = h.back ? pad : h.to, d = dist(h, goal);
  h.t += dt;
  if (!h.back && d < 30) h.back = true;                  // over the market: the catch is down, home again
  const landing = h.back && d < 80, face = landing ? G.boat.a : Math.atan2(goal.y - h.y, goal.x - h.x);   // she settles facing the yacht's bow
  const turn = Math.max(-HELI.turn * dt, Math.min(HELI.turn * dt, wrapAngle(face - h.a)));
  h.a += turn; h.bank += (turn / (HELI.turn * dt || 1) * 0.35 - h.bank) * Math.min(1, dt * 4);
  const rise = h.back ? 1 : Math.min(1, Math.max(0, (h.t - HELI.lift) / 2.5));   // she lifts straight up off the pad, then noses away
  const step = Math.min(d, HELI.speed * (landing ? 0.2 + 0.8 * d / 80 : rise * rise) * dt);   // a helicopter flies straight at it, nose or no
  if (d > 0) { h.x += (goal.x - h.x) / d * step; h.y += (goal.y - h.y) / d * step; }
  const keep = landing ? 1 : 1 - rise;                                                // keeping station over the moving deck
  h.x += G.boat.vx * dt * keep; h.y += G.boat.vy * dt * keep;
  h.z += ((landing ? pad.z + d * 0.25 : HELI.alt) - h.z) * Math.min(1, dt * (landing ? 3 : 1.2));
  if (h.back && d < 2) { HELI_STATE.flight = null; sfx('rotor', 0.6); toast('The helicopter is back aboard'); }
}

export const resetHeli = (): void => { HELI_STATE.flight = null; };
