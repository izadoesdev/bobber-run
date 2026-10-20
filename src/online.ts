// Online state shared with the renderer and the game, with no Convex imports (net.ts fills it in).
/** Another player's boat, interpolated; shaped like an NPC ship so the renderer can draw both. */
export interface Sailor {
  uid: string; id: string; name: string; paint: string;
  x: number; y: number; a: number; vx: number; vy: number;
  online: true; emote: number | null; emoteAt: number;
}
export const ONLINE: { sailors: Sailor[] } = { sailors: [] };

/** Fishing alongside other sailors pays: +5% per sailor within CREW_RANGE, up to +15%. */
export const CREW_RANGE = 140;
export function crewBonus(x: number, y: number): number {
  let n = 0;
  for (const s of ONLINE.sailors) if (Math.hypot(s.x - x, s.y - y) < CREW_RANGE) n++;
  return Math.min(0.15, n * 0.05);
}
