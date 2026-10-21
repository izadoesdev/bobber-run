// Click- and tap-to-sail: the boat steers and throttles itself toward a point on the sea by holding the same
// virtual steering keys a player would, so physics and the rules for fishing stay exactly as they are.
// It slows for the shore instead of ramming it, veers around islands in the way, and stops on arrival.
import { hAt } from '../world';
import { sfx } from '../audio';
import type { Point, Solid } from '../types';
import { G } from './state';
import { boatDef, boatSpeed, sailEfficiency, speedMul } from './rules';
import { toast } from './feedback';
import { wrapAngle } from '../config';
import { clearLine, findRoute } from './route';
import { shapeContact, solidsNear } from './physics';

/** Treated as land: a little deeper than where the hull grounds, so the boat keeps clear of the beach. */
const LAND = -0.045;
const STEER_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type SteerKey = typeof STEER_KEYS[number];
/** Headings tried around the straight line to the target, nearest first. */
const VEERS = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.2];

interface Course {
  /** the leg being sailed now: the next corner of the route, or the destination */
  x: number; y: number;
  /** corners still ahead after this leg, ending at the destination (empty on the last leg) */
  rest: Point[];
  /** set with a line out (before a bite): sailing off reels it in, as rowing away does */
  reelIn: boolean;
  /** which way it last veered round an obstacle (-1, 0, 1), so it doesn't dither between sides */
  side: number;
  /** closest it has come, and when it last got closer: a course that stops making progress is given up */
  best: number; bestT: number;
}
let course: Course | null = null;
const held: Record<SteerKey, boolean> = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
const arriveR = (): number => 3 + boatDef().B;

/** Where the boat is heading in the end, for the marker; null when not under way. */
export const courseTarget = (): Point | null => course && (course.rest.at(-1) ?? course);
/** The corners still to sail through, ending at the destination; empty when not under way. */
export const coursePath = (): Point[] => course ? [{ x: course.x, y: course.y }, ...course.rest] : [];

// ---------- obstacles ----------
const solids: Solid[] = [];
const nearSolids = (): void => solidsNear(160, solids);
const blocked = (x: number, y: number, pad: number): boolean => hAt(x, y) > LAND || solids.some(so => shapeContact(so, x, y, pad));

/** How far the hull can run from (x, y) along heading a before touching land or a solid, up to `len`. */
function clearRun(x: number, y: number, a: number, len: number): number {
  const bd = boatDef(), c = Math.cos(a), s = Math.sin(a), half = bd.B + 1;
  for (let d = 3; d < len; d += 3) {
    const px = x + c * d, py = y + s * d;
    if (blocked(px, py, 2) || blocked(px - s * half, py + c * half, 1) || blocked(px + s * half, py - c * half, 1)) return d;
  }
  return len;
}

// ---------- setting a course ----------
/**
 * Sail to (x, y). A point on land or a pier becomes the nearest clear water on the way to it, so the boat stops at
 * the shore. Returns false (and changes nothing) when there is no water to go to, or the boat is already there.
 */
export function setCourse(x: number, y: number, quiet = false): boolean {
  const f = G.fish;
  if (G.mode !== 'play' || (f && f.st !== 'cast' && f.st !== 'wait' && !f.tow)) return false;   // never yank a hooked fish (unless it's towing you)
  nearSolids();
  const b = G.boat, bd = boatDef(), pad = bd.B + 2;
  let dx = x - b.x, dy = y - b.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) return false;
  dx /= d; dy /= d;
  let t = d;
  while (t > 0 && blocked(b.x + dx * t, b.y + dy * t, pad)) t -= 2;    // walk back from the shore toward the boat
  if (t < d) t -= bd.L * 0.7;                                          // and keep the bow off it
  if (t < arriveR()) { if (!quiet) sfx('deny'); if (course) dropCourse(); return false; }
  const prev = course, end = { x: b.x + dx * t, y: b.y + dy * t };
  // a click plans a way round anything in between; a held finger or a followed sailor just steers straight
  const route = !quiet && !clearLine(b, end) ? findRoute(b, end) : null;
  const [leg, ...rest] = route ?? [end];
  course = { x: leg.x, y: leg.y, rest, reelIn: !!f, side: prev?.side ?? 0, best: Math.hypot(leg.x - b.x, leg.y - b.y), bestT: G.t };
  if (!quiet) sfx('move', 0.5);
  return true;
}

/** Stop steering and let go of the virtual keys (a key the player holds now is theirs, not ours). */
export function dropCourse(): void {
  course = null;
  for (const k of STEER_KEYS) if (held[k]) { held[k] = false; G.keys[k] = false; }
}
function press(k: SteerKey, on: boolean): void {
  if (held[k] === on) return;
  held[k] = on; G.keys[k] = on;
}

/**
 * Drive toward the course for one frame: pick a clear heading, steer onto it, and hold the speed at what the boat
 * could still stop from before the target or the shore ahead. Runs after the frame's actions, so a cast this frame
 * drops the course before physics could reel the new line straight back in.
 */
export function steerCourse(): void {
  const c = course;
  if (!c) return;
  if (G.mode !== 'play' || (G.fish && !c.reelIn)) { dropCourse(); return; }
  if (!G.fish) c.reelIn = false;
  const b = G.boat, bd = boatDef();
  // round a corner once it's close, or as soon as the next one is in clear sight
  while (c.rest.length && (Math.hypot(c.x - b.x, c.y - b.y) < 12 + bd.L || clearLine(b, c.rest[0]))) {
    const n = c.rest.shift()!;
    c.x = n.x; c.y = n.y; c.best = Math.hypot(n.x - b.x, n.y - b.y); c.bestT = G.t;
  }
  const dx = c.x - b.x, dy = c.y - b.y, d = Math.hypot(dx, dy), last = !c.rest.length;
  if (last && (d < 2 || (d < arriveR() && boatSpeed() < 3))) { dropCourse(); return; }   // there, and nearly stopped
  if (d < c.best - 2) { c.best = d; c.bestT = G.t; }
  else if (G.t - c.bestT > 6) { dropCourse(); toast('No clear way there'); return; }
  nearSolids();

  // a heading that clears the next stretch, veering further round an obstacle until one does (same side first)
  const look = Math.min(d, 30 + boatSpeed() * 1.5), want = Math.atan2(dy, dx);
  let heading = want, ahead = clearRun(b.x, b.y, want, look);
  if (ahead < look) {
    let bestRun = ahead;
    search: for (const v of VEERS.slice(1)) {
      for (const side of c.side < 0 ? [-1, 1] : [1, -1]) {
        const a = want + side * v, run = clearRun(b.x, b.y, a, look);
        if (run >= look) { heading = a; c.side = side; bestRun = run; break search; }
        if (run > bestRun) { heading = a; bestRun = run; }
      }
    }
    ahead = bestRun;
  } else c.side = 0;

  // speed: what drag and backing oars (or engine) can still stop from, before the target and before the shore
  const k = 0.6 * bd.accel, brake = 20 * speedMul() * bd.accel * 0.45 * (bd.prop === 'SAIL' ? sailEfficiency() : 1);
  const stopFrom = (dist: number): number => { const s = Math.max(0, dist); return k * s + Math.sqrt(brake * s); };
  const shore = clearRun(b.x, b.y, b.a, 30 + boatSpeed() * 2) - bd.L;
  const err = wrapAngle(heading - b.a), turnFirst = Math.abs(err) > 1.1;
  let vMax = Math.min(last ? stopFrom(d - 2) : Infinity, stopFrom(shore - 3));   // no braking at a corner
  if (turnFirst) vMax = Math.min(vMax, 5);
  if (ahead < 6 + bd.L) vMax = 0;                                       // boxed in: stop
  const vf = b.vx * Math.cos(b.a) + b.vy * Math.sin(b.a);

  const lead = wrapAngle(err - b.w * 0.3), dead = 0.05;                     // ease off early so it doesn't overshoot
  press('ArrowRight', lead > dead);
  press('ArrowLeft', lead < -dead);
  press('ArrowUp', !turnFirst && vf < vMax - 0.5);
  press('ArrowDown', vf > vMax + 2 && vf > 1);
}
