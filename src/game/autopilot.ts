// Click- and tap-to-sail: the boat steers and throttles itself toward a point on the sea by holding the same
// virtual steering keys a player would, so physics and the rules for fishing stay exactly as they are.
// A click plans a smooth water route (route.ts) and the boat follows it by pure pursuit: it steers at a point a
// little way along the path, further for a fast or long ship, and slows for the bends ahead and for the shore.
// If the path ahead is blocked or the boat has drifted off it, it plans again from where it is.
import { hAt } from '../world';
import { sfx } from '../audio';
import type { Point, Solid } from '../types';
import { G } from './state';
import { boatDef, boatSpeed, sailEfficiency, speedMul } from './rules';
import { toast } from './feedback';
import { wrapAngle } from '../config';
import { planRoute } from './route';
import { shapeContact, solidsNear } from './physics';
import { lockedAt } from './regions';

/** Treated as land: a little deeper than where the hull grounds, so the boat keeps clear of the beach. */
const LAND = -0.045;
const STEER_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
type SteerKey = typeof STEER_KEYS[number];
/** Headings tried around the pursuit heading when the way ahead is blocked, nearest first (an emergency only). */
const VEERS = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.2];
/** At most one new plan this often (seconds). */
const REPLAN_S = 1;

interface Course {
  /** the path to follow, ending at the destination, and how far along it the boat has got (an index into pts) */
  pts: Point[]; i: number;
  /** a held finger or a followed sailor: steer straight at the point, never plan */
  quiet: boolean;
  /** set with a line out (before a bite): sailing off reels it in, as rowing away does */
  reelIn: boolean;
  /** which way it last veered round something in the way (-1, 0, 1), so it doesn't dither between sides */
  side: number;
  /** the least path left so far, the smallest heading error while coming round, and when either last shrank: a course
   *  that stops making progress is given up */
  best: number; bestErr: number; bestT: number;
  replanT: number;
}
let course: Course | null = null;
const held: Record<SteerKey, boolean> = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
const arriveR = (): number => 3 + boatDef().B;
/** Water to keep either side of the boat's line on a planned route: its half beam, a margin, and room for a long
 *  stern to swing on the corners. */
export const roomFor = (): number => { const bd = boatDef(); return bd.B + 3 + 0.15 * bd.L; };

const end = (c: Course): Point => c.pts[c.pts.length - 1];
/** Where the boat is heading in the end, for the marker; null when not under way. */
export const courseTarget = (): Point | null => course && end(course);
/** The path still to sail, ending at the destination; empty when not under way. */
export const coursePath = (): Point[] => course ? course.pts.slice(course.i) : [];

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
 * Sail to (x, y). A click plans a water route round anything in the way (a point on land, behind a solid or in
 * closed water ends at the nearest open water round it), or follows one given (`via`); a held finger or a followed
 * sailor (`quiet`) steers straight. Returns false (and changes nothing) when there is nowhere to go, or the boat is
 * already there.
 */
export function setCourse(x: number, y: number, quiet = false, via?: Point[]): boolean {
  const f = G.fish;
  if (G.mode !== 'play' || (f && f.st !== 'cast' && f.st !== 'wait' && !f.tow)) return false;   // never yank a hooked fish (unless it's towing you)
  const b = G.boat, prev = course;
  // `via`: a route already planned to (x, y) (the waypoint's), so the boat sails the dots it shows
  const pts = quiet ? straightTo(x, y) : via?.length ? via : planRoute(b, { x, y }, roomFor())?.pts ?? [];
  const last = pts[pts.length - 1];
  if (!last || Math.hypot(last.x - b.x, last.y - b.y) < arriveR()) {
    if (!quiet) sfx('deny');
    if (course) dropCourse();
    return false;
  }
  course = { pts, i: 0, quiet, reelIn: !!f, side: prev?.side ?? 0, best: Infinity, bestErr: Infinity, bestT: G.t, replanT: G.t };
  if (!quiet) sfx('move', 0.5);
  return true;
}
/** The straight way to (x, y), stopping short of the shore or a solid with the bow off it. */
function straightTo(x: number, y: number): Point[] {
  nearSolids();
  const b = G.boat, bd = boatDef(), pad = bd.B + 2;
  const d = Math.hypot(x - b.x, y - b.y);
  if (d < 2) return [];
  const dx = (x - b.x) / d, dy = (y - b.y) / d;
  let t = d;
  while (t > 0 && blocked(b.x + dx * t, b.y + dy * t, pad)) t -= 2;    // walk back from the shore toward the boat
  if (t < d) t -= bd.L * 0.7;                                          // and keep the bow off it
  return t > 0 ? [{ x: b.x + dx * t, y: b.y + dy * t }] : [];
}
/** Plan again from where the boat is now (at most once every REPLAN_S); false if there's no way any more. */
function replan(c: Course): boolean {
  if (c.quiet || G.t - c.replanT < REPLAN_S) return true;
  c.replanT = G.t;
  const plan = planRoute(G.boat, end(c), roomFor());
  if (!plan?.pts.length) return false;
  // a much longer way round (often the other side of an island) only if the boat is well off its path; a nearby
  // snag on the way it's sailing is better veered round than turned back from
  if (plan.length > pathLeft(c) * 1.4 + 60 && track(c) < roomFor() + 30) return true;
  c.pts = plan.pts; c.i = 0;
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

// ---------- following the path ----------
/** Move c.i on to the path point nearest the boat (looking a little way ahead, never back); how far off the path it is. */
function track(c: Course): number {
  const b = G.boat;
  let best = Math.hypot(c.pts[c.i].x - b.x, c.pts[c.i].y - b.y);
  for (let j = c.i + 1; j < Math.min(c.pts.length, c.i + 25); j++) {
    const d = Math.hypot(c.pts[j].x - b.x, c.pts[j].y - b.y);
    if (d <= best) { best = d; c.i = j; }
  }
  return best;
}
/** The path still to sail from point i, as a distance. */
function pathLeft(c: Course): number {
  const b = G.boat;
  let d = Math.hypot(c.pts[c.i].x - b.x, c.pts[c.i].y - b.y);
  for (let j = c.i + 1; j < c.pts.length; j++) d += Math.hypot(c.pts[j].x - c.pts[j - 1].x, c.pts[j].y - c.pts[j - 1].y);
  return d;
}
/** The pursuit point: the first point on the path at least `look` from the boat (or the destination). */
function pursuit(c: Course, look: number): Point {
  const b = G.boat;
  for (let j = c.i; j < c.pts.length; j++) if (Math.hypot(c.pts[j].x - b.x, c.pts[j].y - b.y) >= look) return c.pts[j];
  return end(c);
}
/** The tightest curvature (radians of turn per unit of path) over the next `span` of the path from point i. */
function curveAhead(c: Course, span: number): number {
  let k = 0, run = 0;
  for (let j = c.i + 1; j + 1 < c.pts.length && run < span; j++) {
    const a = c.pts[j - 1], p = c.pts[j], n = c.pts[j + 1], seg = Math.hypot(n.x - p.x, n.y - p.y) || 1;
    k = Math.max(k, Math.abs(wrapAngle(Math.atan2(n.y - p.y, n.x - p.x) - Math.atan2(p.y - a.y, p.x - a.x))) / seg);
    run += Math.hypot(p.x - a.x, p.y - a.y);
  }
  return k;
}

/**
 * Drive toward the course for one frame: steer at the pursuit point, and hold the speed at what the bends ahead
 * allow and at what the boat could still stop from before the destination or the shore. Runs after the frame's
 * actions, so a cast this frame drops the course before physics could reel the new line straight back in.
 */
export function steerCourse(): void {
  const c = course;
  if (!c) return;
  if (G.mode !== 'play' || (G.fish && !c.reelIn) || lockedAt(G.boat.x, G.boat.y)) { dropCourse(); return; }   // rough water ends a course
  if (!G.fish) c.reelIn = false;
  const b = G.boat, bd = boatDef(), speed = boatSpeed(), goal = end(c);
  const dEnd = Math.hypot(goal.x - b.x, goal.y - b.y);
  if (dEnd < 2 || (dEnd < arriveR() && speed < 3)) { dropCourse(); return; }   // there, and nearly stopped
  nearSolids();

  // on the path? (drifting well off it, or a blocked way ahead, asks for a new plan)
  if (track(c) > roomFor() + 30 && !replan(c)) { dropCourse(); toast('No clear way there'); return; }
  const left = pathLeft(c);
  if (left < c.best - 2) { c.best = left; c.bestT = G.t; }
  else if (G.t - c.bestT > 6 + 0.2 * bd.L) {                        // a long hull takes longer to come round
    dropCourse();
    if (dEnd > bd.L + 30) toast('No clear way there');                // stuck just short of a spot by the shore: as close as it gets
    return;
  }

  // pure pursuit: steer at a point along the path, further ahead the faster and longer the ship; round a headland the
  // straight line to that point cuts the corner the path goes round, so look nearer until the line is clear
  let look = 12 + 1.2 * bd.L + 0.8 * speed, aim = pursuit(c, look);
  let want = Math.atan2(aim.y - b.y, aim.x - b.x), reach = Math.min(Math.hypot(aim.x - b.x, aim.y - b.y), look);
  while (look > 10 + 0.6 * bd.L && clearRun(b.x, b.y, want, reach) < reach) {
    look *= 0.7; aim = pursuit(c, look);
    want = Math.atan2(aim.y - b.y, aim.x - b.x); reach = Math.min(Math.hypot(aim.x - b.x, aim.y - b.y), look);
  }
  let heading = want, ahead = clearRun(b.x, b.y, want, reach);
  if (ahead < reach) {                                                 // something in the way even close up: plan again, and veer meanwhile
    replan(c);
    let bestRun = ahead;
    search: for (const v of VEERS) {
      for (const side of c.side < 0 ? [-1, 1] : [1, -1]) {
        const a = want + side * v, run = clearRun(b.x, b.y, a, reach);
        if (run >= reach) { heading = a; c.side = side; bestRun = run; break search; }
        if (run > bestRun) { heading = a; bestRun = run; }
      }
    }
    ahead = bestRun;
  } else c.side = 0;

  // speed: slow enough to hold the tightest bend over the next couple of seconds (the hull's turn rate over the
  // path's curvature, with a margin), and to still stop before the destination and the shore
  const k = 0.6 * bd.accel, brake = 20 * speedMul() * bd.accel * 0.45 * (bd.prop === 'SAIL' ? sailEfficiency() : 1);
  const stopFrom = (dist: number): number => { const s = Math.max(0, dist); return k * s + Math.sqrt(brake * s); };
  const bendV = Math.max(6, 0.7 * 1.25 * bd.turn / Math.max(1e-3, curveAhead(c, bd.L + 2.5 * Math.max(10, speed))));
  const shore = clearRun(b.x, b.y, b.a, bd.L + 30 + speed * 2) - bd.L;   // clear water ahead of the bow
  const err = wrapAngle(heading - b.a), turnFirst = Math.abs(err) > 1.1;
  if (Math.abs(err) < c.bestErr - 0.15) { c.bestErr = Math.abs(err); c.bestT = G.t; }   // coming round toward the path counts as progress
  if (!turnFirst) c.bestErr = Infinity;
  let vMax = Math.min(bendV, stopFrom(left - 2), stopFrom(shore - 3));
  if (ahead < reach && ahead < 6 + bd.L) vMax = 0;                    // boxed in: stop
  // coming round a long way: oars spin the boat where it is, but a rudder needs water flowing past it, so a ship creeps
  // ahead while it turns, or backs off astern if there's no room in front of its bow
  const rowing = bd.prop === 'OARS', astern = turnFirst && !rowing && shore < bd.L * 0.5 + 8;
  if (turnFirst) vMax = rowing || astern ? 0 : Math.min(Math.max(vMax, 4), 7);
  const vf = b.vx * Math.cos(b.a) + b.vy * Math.sin(b.a);

  const lead = wrapAngle(err - b.w * 0.4 * Math.sqrt(bd.L / 13.5)), dead = 0.05;   // ease off early (more for a heavy helm) so it doesn't overshoot
  press('ArrowRight', lead > dead);
  press('ArrowLeft', lead < -dead);
  press('ArrowUp', !astern && vf < vMax - 0.5);
  press('ArrowDown', astern ? vf > -5 : vf > vMax + 2 && vf > 1);
}
