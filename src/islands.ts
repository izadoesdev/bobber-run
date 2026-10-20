// Claimed islands on the client: who owns the islands around you (and on the chart), kept live from the server.
// The main island of every world cell except Alderhaven's can be bought; the price falls with distance from home.
import { G } from './game';
import { claimableNear, type Claimable } from './world';
import { NET, watchIslands, type IslandRow } from './net';
import { islandPrice } from '../convex/islandRules';

export { islandPrice };
/** Owner, name and logo by island key ("i,j"); islands nobody owns are absent. */
export const ISLANDS = new Map<string, IslandRow>();

const WATCH_R = 1400;
let lastKeys = '', extra: string[] = [];
/** The chart asks for the islands it shows, beyond the ones around the boat. */
export function watchExtra(keys: string[]): void { extra = keys.slice(0, 120); }
/** Keep the subscription on the islands around the boat (and on the chart); cheap to call every frame. */
export function tickIslands(): void {
  if (!NET.authed) return;
  const keys = [...new Set([...claimableNear(G.boat.x, G.boat.y, WATCH_R).map(c => c.key), ...extra])].sort();
  const sig = keys.join(';');
  if (sig === lastKeys) return;
  lastKeys = sig;
  watchIslands(keys, rows => { ISLANDS.clear(); for (const r of rows) ISLANDS.set(r.key, r); });
}

/** The claimable island the boat is at (within its shore plus a little water), if any. */
export function islandHere(): Claimable | null {
  const b = G.boat;
  return claimableNear(b.x, b.y, 90).find(c => Math.hypot(c.x - b.x, c.y - b.y) < c.R + 90) ?? null;
}
