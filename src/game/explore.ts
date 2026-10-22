// Fog of war: the sea you've seen. The world is cut into 32-unit cells, kept as bits in 1024-unit chunks, and a cell
// is seen once the boat has been within sight of it (further with a better spyglass), or a lighthouse or port near it
// was charted. The chart draws what's unseen as blank parchment, and hides the marks there. It saves as a short
// string: each chunk that has anything seen, as "cx,cy:base64" (a typical voyage is a few kilobytes).
import { G } from './state';
import { poisNear, homePort } from '../world';
import { tickRegions } from './regions';

export const CELL = 32;
const CN = 32;                               // cells per chunk side (a chunk is 1024 units)
const chunks = new Map<string, Uint8Array>();
/** Chunks changed since the chart last looked (it re-uploads them), and a counter that moves on every change. */
export const fogDirty = new Set<string>();
export const fog = { version: 0 };

const ck = (cx: number, cy: number): string => cx + ',' + cy;
/** The bits of chunk (cx, cy), if anything in it has been seen. */
export const fogChunk = (cx: number, cy: number): Uint8Array | undefined => chunks.get(ck(cx, cy));

/** Has the cell at world point (x, y) been seen? */
export function seen(x: number, y: number): boolean {
  const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), cx = Math.floor(gx / CN), cy = Math.floor(gy / CN);
  const c = chunks.get(ck(cx, cy));
  if (!c) return false;
  const i = (gy - cy * CN) * CN + (gx - cx * CN);
  return (c[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Marks every cell within r of (x, y) as seen. */
export function reveal(x: number, y: number, r: number): void {
  const g0x = Math.floor((x - r) / CELL), g1x = Math.floor((x + r) / CELL), g0y = Math.floor((y - r) / CELL), g1y = Math.floor((y + r) / CELL);
  let changed = false;
  for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
    if (Math.hypot((gx + 0.5) * CELL - x, (gy + 0.5) * CELL - y) > r) continue;
    const cx = Math.floor(gx / CN), cy = Math.floor(gy / CN), k = ck(cx, cy);
    let c = chunks.get(k);
    if (!c) chunks.set(k, c = new Uint8Array(CN * CN / 8));
    const i = (gy - cy * CN) * CN + (gx - cx * CN), bit = 1 << (i & 7);
    if (c[i >> 3] & bit) continue;
    c[i >> 3] |= bit; fogDirty.add(k); changed = true;
  }
  if (changed) fog.version++;
}

/** How far the boat sees, by spyglass. */
export const sightRange = (): number => 260 * [1, 1.25, 1.5][G.up.spyglass ?? 0];
// charted landmarks light up the chart round them: a lighthouse most of all
const LANDMARK_R: Record<string, number> = { light: 520, port: 380, wreck: 160 };

let acc = 0, foundSeen = 0, wroteAt = -Infinity, wroteVersion = -1;
// the G.explored string the chunks were last read from or written to: a load or a new game swaps it, and we follow
let synced = '\0';
function sync(): void {
  if (G.explored === synced) return;
  exploredFromSave(G.explored, homePort());
  synced = G.explored;
}
/** For a save with nothing seen yet (a new game, or one from before the fog): seed it, and keep it in the save. */
export function seedExplored(): void {
  exploredFromSave('', homePort());
  G.explored = synced = exploredToSave(); wroteVersion = fog.version;
}
/** While sailing: reveal round the boat a few times a second and round any place charted since; keep the save's copy fresh. */
export function tickExplore(dt: number): void {
  sync();
  if ((acc += dt) < 0.25) return;
  acc = 0;
  tickRegions();
  reveal(G.boat.x, G.boat.y, sightRange());
  if (G.found.size !== foundSeen) { foundSeen = G.found.size; revealFound(); }
  if (fog.version !== wroteVersion && G.t - wroteAt > 2) { G.explored = synced = exploredToSave(); wroteVersion = fog.version; wroteAt = G.t; }
}
function revealFound(): void {
  for (const p of poisNear(G.boat.x, G.boat.y, 900)) if (G.found.has(p.id)) revealPlace(p);
}
/** The sea round a charted place: a lighthouse lights up the most. */
export const revealPlace = (p: { x: number; y: number; type: string }): void => reveal(p.x, p.y, LANDMARK_R[p.type] ?? 200);

const toB64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b));
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
// a save keeps at most this many chunks (about 100k characters, under the save's 120k for this field): the nearest
// the boat, so a captain far out keeps the sea round them
const MAX_CHUNKS = 560;
/** The seen sea as a save string. */
export function exploredToSave(): string {
  let all = [...chunks];
  if (all.length > MAX_CHUNKS) {
    const bx = G.boat.x / 1024, by = G.boat.y / 1024, d = ([k]: [string, Uint8Array]) => { const [x, y] = k.split(',').map(Number); return (x - bx) ** 2 + (y - by) ** 2; };
    all = all.sort((a, b) => d(a) - d(b)).slice(0, MAX_CHUNKS);
  }
  return all.map(([k, c]) => k + ':' + toB64(c)).join(';');
}
/**
 * Loads the seen sea from a save string, with home and the boat's surroundings seen. (A save from before the fog
 * gets the sea round its charted places back as the chart comes to them: see revealPlace.)
 */
export function exploredFromSave(s: string | undefined, home: { x: number; y: number }): void {
  chunks.clear(); fogDirty.clear(); fog.version++;
  for (const part of (s ?? '').split(';')) {
    const m = /^(-?\d+),(-?\d+):([A-Za-z0-9+/=]+)$/.exec(part);
    if (!m) continue;
    try { const c = fromB64(m[3]); if (c.length === CN * CN / 8) { chunks.set(ck(+m[1], +m[2]), c); fogDirty.add(ck(+m[1], +m[2])); } } catch { /* a damaged chunk stays unseen */ }
  }
  reveal(home.x, home.y, 700);
  reveal(G.boat.x, G.boat.y, sightRange());
  foundSeen = G.found.size;
}
/** Every chunk key with something seen, for the chart's fog texture after a load. */
export const fogChunks = (): IterableIterator<string> => chunks.keys();
