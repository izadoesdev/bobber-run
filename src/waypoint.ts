// The player's waypoint: one spot marked on the chart (or from an island card), with a water route to it that goes
// round islands. The route shows as dots on the sea and a line on the minimap and chart; it is planned when the
// waypoint is set and again whenever the next corner drops out of sight. Sailing within a boat length clears it.
import { G } from './game';
import { toast } from './game/feedback';
import { setCourse } from './game/autopilot';
import { clearLine, findRoute } from './game/route';
import { sfx } from './audio';
import type { Point } from './types';

const ARRIVE = 25;
let route: Point[] = [], plannedFor: Point | null = null, retryT = -99;

export function setWaypoint(x: number, y: number): void { G.waypoint = { x, y }; plannedFor = null; retryT = -99; sfx('select'); }
export function clearWaypoint(): void { G.waypoint = null; route = []; plannedFor = null; }
/** The corners from the boat to the waypoint, ending at it; empty without a waypoint. */
export const waypointRoute = (): Point[] => G.waypoint ? route : [];
/** Let the autopilot sail the route (the waypoint chip's Sail button). */
export function sailToWaypoint(): void { if (G.waypoint) setCourse(G.waypoint.x, G.waypoint.y); }

/** Called while sailing: keeps the route fresh, and arriving clears the waypoint with a soft chime. */
export function tickWaypoint(): void {
  const w = G.waypoint, b = G.boat;
  if (!w) return;
  if (Math.hypot(w.x - b.x, w.y - b.y) < ARRIVE) { clearWaypoint(); sfx('select'); toast('You reached your waypoint', 'good'); return; }
  while (route.length > 1 && clearLine(b, route[1])) route.shift();            // corners already rounded
  const lost = !route.length || !clearLine(b, route[0]);
  if ((plannedFor !== w || lost) && G.t - retryT > 1.5) {
    retryT = G.t; plannedFor = w;
    route = findRoute(b, w) ?? [w];                                            // no way found: a straight line
  }
}
