// Buried treasure: maps whose X lies on a beach, not the sea floor. Bring the boat in close and a hand rows ashore
// with a shovel; wait while they dig and the chest comes aboard. Maps come from sunk pirate ships and raided coves
// (pirates.ts), and now and then from a bottle (fishing.ts). Sea-floor chests are hauled up in sailing.ts.
import { G } from './state';
import { boatDef } from './rules';
import { addCoins, burst, celebrate, toast } from './feedback';
import { saveGame } from './save';
import { lockedAt } from './open';
import { claimableNear, heightAt, poisNear } from '../world';
import { sfx } from '../audio';
import { track, bucket } from '../analytics';
import type { Point, TreasureMap } from '../types';

/** Seconds of digging before the chest comes up. */
export const DIG_S = 3;

/**
 * A beach on an island between `min` and `max` from (x, y) where a chest can lie: dry sand a little up from the
 * waterline (not cliff, not marsh), with water deep enough for a boat a short row out, away from any harbour. Never on Alderhaven.
 */
export function beachSpot(x: number, y: number, min: number, max: number, rnd = Math.random): Point | null {
  const isles = claimableNear(x, y, max).filter(c => c.key !== '0,0' && Math.hypot(c.x - x, c.y - y) >= min);
  for (let tries = 0; tries < 30 && isles.length; tries++) {
    const c = isles[Math.floor(rnd() * isles.length)], a = rnd() * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
    let shore = 0;                                         // walk out from the middle to the waterline
    for (let d = c.R * 0.3; d < c.R * 2.6 && !shore; d += 3) if (heightAt(c.x + cs * d, c.y + sn * d) < -0.02) shore = d;
    if (!shore) continue;
    const bx = c.x + cs * (shore - 9), by = c.y + sn * (shore - 9), h = heightAt(bx, by);
    if (h < 0.02 || h > 0.3 || heightAt(c.x + cs * (shore + 22), c.y + sn * (shore + 22)) > -0.08 || lockedAt(bx, by)) continue;
    if (poisNear(bx, by, 160).some(p => p.type === 'port' && Math.hypot(p.end.x - bx, p.end.y - by) < 160)) continue;   // not by a pier, where E would dock
    return { x: Math.round(bx), y: Math.round(by) };
  }
  return null;
}

/** A map to a chest buried on some beach between `min` and `max` from `from`; null if no beach fits. */
export function buriedMap(reward: number, from: Point, min = 500, max = 2200): TreasureMap | null {
  const at = beachSpot(from.x, from.y, min, max);
  return at && { id: 'b' + Math.random().toString(36).slice(2, 8), x: at.x, y: at.y, reward: Math.round(reward), buried: true };
}

/** How close the boat must come to a map's X: right over a sunken chest, or just off the beach for a buried one. */
export const treasureReach = (m: TreasureMap, boatLength: number): number => m.buried ? 40 + boatLength * 0.5 : 16 + boatLength * 0.6;

export function startDig(m: TreasureMap): void {
  if (G.dig) return;
  G.dig = { m, t: 0 };
  sfx('select');
  toast('A hand rows ashore with a shovel. Wait close by while they dig', 'good', 'sailing');
}

/** The dig goes on while the boat waits nearby; sailing off, or anything else taking over, calls the hand back. */
export function updateDig(dt: number, speed: number): void {
  const d = G.dig;
  if (!d) return;
  const b = G.boat, near = Math.hypot(d.m.x - b.x, d.m.y - b.y) < treasureReach(d.m, boatDef().L) + 12;
  if (!near || speed > 16 || G.mode !== 'play' || !G.maps.includes(d.m)) {
    G.dig = null;
    toast('Your hand rowed back aboard before the chest came up', 'bad', 'sailing');
    return;
  }
  const before = d.t;
  d.t += dt;
  if (Math.floor(d.t / 0.5) !== Math.floor(before / 0.5)) { burst('debris', d.m.x, d.m.y, 4, 14, 0.6); sfx('scrape', 0.25); }
  if (d.t >= DIG_S) finishDig(d.m);
}

function finishDig(m: TreasureMap): void {
  G.dig = null;
  G.maps = G.maps.filter(q => q !== m);
  G.stats.dug++;
  addCoins(m.reward);
  let extra = '';
  const roll = Math.random();
  if (roll < 0.3) { G.bait.glow += 3; extra = ', and 3 glow lures'; }
  else if (roll < 0.45 && G.maps.length < 3) {
    const next = buriedMap(m.reward * 1.2, m, 600, 2400);   // an older map, pointing further on
    if (next) { G.maps.push(next); extra = ', and an older map pointing further on'; }
  }
  toast(`Your hand dug up a chest: $${m.reward}${extra}`, 'good');
  burst('spark', m.x, m.y, 18, 40, 0.9);
  celebrate(); sfx('coin'); setTimeout(() => sfx('coin', 0.8), 110);
  track('treasure_dug', { reward_bucket: bucket(m.reward) });
  saveGame();
}
