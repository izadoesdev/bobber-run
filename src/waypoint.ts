// The player's waypoint: one spot marked on the chart (or from an island card), with a water route to it that goes
// round islands, keeps to mid-channel and leaves room for the hull (route.planRoute). The route shows as dots on the
// sea and a line on the minimap and chart; it's planned when the waypoint is set and again only when the boat has
// strayed well off it, and the part already sailed is dropped, so the line stays put. Arriving clears it.
import { G } from './game/state';
import { toast } from './game/feedback';
import { coursePath, courseTarget, roomFor, setCourse } from './game/autopilot';
import { planRoute } from './game/route';
import { sfx } from './audio';
import type { Point } from './types';

const ARRIVE = 25;
let route: Point[] = [], plannedFor: Point | null = null, retryT = -99;

export function setWaypoint(x: number, y: number): void { G.waypoint = { x, y }; route = []; plannedFor = null; retryT = -99; sfx('select'); }
export function clearWaypoint(): void { G.waypoint = null; route = []; plannedFor = null; }
/** The route from the boat to the waypoint, evenly spaced points ending at it; empty without a waypoint. */
export const waypointRoute = (): Point[] => G.waypoint ? route : [];
/** How far the waypoint is along its route, in whole metres (at least 1). */
export function waypointMetres(): number {
  const w = G.waypoint;
  if (!w) return 0;
  let d = 0, a: Point = G.boat;
  for (const p of route.length ? route : [w]) { d += Math.hypot(p.x - a.x, p.y - a.y); a = p; }
  return Math.max(1, Math.round(d / 10));
}
/** Let the autopilot sail the route (the waypoint chip's Sail button): the same route the dots show. */
export function sailToWaypoint(): void { if (G.waypoint) setCourse(G.waypoint.x, G.waypoint.y, false, route.length > 1 ? route : undefined); }
/** Whether the autopilot is sailing to the waypoint (its course ends there): then its path is the waypoint's route. */
const sailingThere = (w: Point): boolean => { const t = courseTarget(); return !!t && Math.hypot(t.x - w.x, t.y - w.y) < 40; };

/** Called each frame while sailing (game/sailing): drops the route already sailed, replans if the boat strays, and
 *  arriving clears the waypoint. */
export function tickWaypoint(): void {
  const w = G.waypoint, b = G.boat;
  if (!w) return;
  if (Math.hypot(w.x - b.x, w.y - b.y) < ARRIVE) { clearWaypoint(); sfx('select'); toast('You reached your waypoint', 'good'); return; }
  if (sailingThere(w)) { route = coursePath(); plannedFor = w; return; }   // one route: the autopilot's replans move the dots too
  // the nearest point among the next stretch: everything before it is behind the boat
  let best = -1, bd = Infinity;
  for (let i = 0; i < Math.min(route.length, 40); i++) { const d = Math.hypot(route[i].x - b.x, route[i].y - b.y); if (d < bd) { bd = d; best = i; } }
  if (best > 0) route = route.slice(best);
  const strayed = !route.length || bd > roomFor() + 40;
  if ((plannedFor !== w || strayed) && G.t - retryT > 1) {
    retryT = G.t; plannedFor = w;
    route = planRoute(b, w, roomFor())?.pts ?? [w];                      // no water route at all: a straight line
  }
}
