// The weekly tide table on the client: which species are running this week (the same for every sailor, from
// convex/rotation.ts). Running fish sell for a quarter more and have their own weekly boards.
import { runningSpecies, weekOf, weekBounds } from '../convex/rotation';

export const RUNNING_PRICE = 1.25;
let week = -1, running = new Set<string>();
/** This week's running species ids (recomputed when the week turns). */
function runningNow(): Set<string> {
  const w = weekOf(Date.now());
  if (w !== week) { week = w; running = new Set(runningSpecies(w)); }
  return running;
}
export const isRunningNow = (id: string): boolean => runningNow().has(id);
/** "3 days", "5 hours": how long until this week's tide table turns. */
export function tideEndsIn(): string {
  const ms = weekBounds(weekOf(Date.now())).end - Date.now(), h = Math.ceil(ms / 3_600_000);
  return h > 48 ? `${Math.round(h / 24)} days` : `${h} hour${h === 1 ? '' : 's'}`;
}
