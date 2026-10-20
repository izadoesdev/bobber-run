// The player's waypoint: one spot marked on the chart (or from an island card). The minimap and chart draw a dashed
// line to it, the on-screen arrow points at it, and sailing within a boat length of it clears it.
import { G } from './game';
import { toast } from './game/feedback';
import { sfx } from './audio';

const ARRIVE = 25;
export function setWaypoint(x: number, y: number): void { G.waypoint = { x, y }; sfx('select'); }
export function clearWaypoint(): void { G.waypoint = null; }
/** Called while sailing: arriving clears the waypoint with a soft chime. */
export function tickWaypoint(): void {
  const w = G.waypoint;
  if (w && Math.hypot(w.x - G.boat.x, w.y - G.boat.y) < ARRIVE) { G.waypoint = null; sfx('select'); toast('You reached your waypoint', 'good'); }
}
