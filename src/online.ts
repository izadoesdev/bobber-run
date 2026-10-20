// Online state shared with the renderer and the game, with no Convex imports (net.ts fills it in).
/** Another player's boat, interpolated; shaped like an NPC ship so the renderer can draw both. */
export interface Sailor {
  uid: string; id: string; name: string; paint: string;
  x: number; y: number; a: number; vx: number; vy: number;
  online: true; emote: number | null; emoteAt: number;
}
export interface Bottle { id: string; x: number; y: number; msg: number; name: string; userId: string }
export const ONLINE: { sailors: Sailor[]; bottles: Bottle[] } = { sailors: [], bottles: [] };
/** NPC ships plus other players' boats, in the shape the renderer draws. */
export const shipsAndSailors = <T,>(ships: T[] | undefined): (T | Sailor)[] => ONLINE.sailors.length ? (ships ?? []).concat(ONLINE.sailors as never[]) : (ships ?? []);
