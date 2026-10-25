// Height tiles built off the main thread: a few workers (tileworker.ts) build the tiles the view needs next, so the
// first frame and sailing into new sea don't stall on terrain noise (a tile is about 17,000 noise samples, and the
// first view needs some 60 of them: two seconds on a phone). world.getTile still builds a tile on the spot if it's
// needed before a worker has it.
import { adoptTile, hasTile } from './world';

type Job = { tx: number; ty: number };
const busy = new Map<Worker, Job>(), pending = new Set<string>(), waiters = new Set<() => void>();
let workers: Worker[] | null = null, queue: Job[] = [];
const id = (tx: number, ty: number): string => tx + ',' + ty;

function pool(): Worker[] {
  if (workers) return workers;
  workers = [];
  const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));   // two: most of the gain, without crowding the cores the game and the browser need
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./tileworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<Job & { h: Float32Array; land: boolean }>) => { const { tx, ty, h, land } = e.data; adoptTile(tx, ty, h, land); finish(w); };
      w.onerror = () => fail();
      workers.push(w);
    }
  } catch { fail(); }
  return workers;
}
// a worker that can't run (no module workers, a load error): the main thread builds every tile, as it used to
function fail(): void {
  for (const w of workers ?? []) w.terminate();
  workers = []; busy.clear(); pending.clear(); queue = [];
  for (const f of [...waiters]) f();
}
function finish(w: Worker): void {
  const j = busy.get(w);
  if (j) pending.delete(id(j.tx, j.ty));
  busy.delete(w);
  pump();
  for (const f of [...waiters]) f();
}
function pump(): void {
  for (const w of workers ?? []) {
    if (busy.has(w)) continue;
    let j: Job | undefined;
    while ((j = queue.shift()) && (hasTile(j.tx, j.ty) || pending.has(id(j.tx, j.ty))));
    if (!j) return;
    busy.set(w, j); pending.add(id(j.tx, j.ty));
    w.postMessage(j);
  }
}

/**
 * The tiles wanted next, most wanted first: replaces what was asked before (the view has moved on). False if there
 * are no workers, and the caller should build them itself.
 */
export function wantTiles(list: readonly (readonly [number, number])[]): boolean {
  if (!pool().length) return false;
  queue = list.map(([tx, ty]) => ({ tx, ty }));
  pump();
  return true;
}
/** Ask for `list` and resolve once its first `need` tiles are built (or the workers fail, or `ms` pass). */
export function warmTiles(list: readonly (readonly [number, number])[], need: number, ms: number): Promise<void> {
  const ready = () => list.slice(0, need).every(([tx, ty]) => hasTile(tx, ty));
  if (!wantTiles(list) || ready()) return Promise.resolve();
  return new Promise(done => {
    const check = () => { if (ready() || !workers?.length) { waiters.delete(check); clearTimeout(t); done(); } };
    const t = setTimeout(() => { waiters.delete(check); done(); }, ms);
    waiters.add(check);
  });
}
