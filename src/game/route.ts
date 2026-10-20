// Routes over water: A* on a coarse grid of the terrain, then pulled tight so it reads as a sailing line, not a
// staircase. Used for the waypoint (dots on the sea, the line on the chart) and for click-to-sail round islands.
// It samples heightAt directly, so a long route never builds the height tiles for the sea it crosses.
import { heightAt } from '../world';
import type { Point } from '../types';

const STEP = 16;                                  // grid spacing in world units
const WATER = -0.07;                              // a little deeper than the beach, so routes keep off it
const MAX_NODES = 40_000;                         // gives up beyond this (a route across most of the known sea)
const DIAG = Math.SQRT2;

/** Open water at (x, y), with a little room either side. */
const isWater = (x: number, y: number): boolean => heightAt(x, y) < WATER;
/** Whether a boat can sail straight from a to b (checked every few units). */
export function clearLine(a: Point, b: Point): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 6);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (!isWater(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

// a binary heap of node keys ordered by f
class Heap {
  k: number[] = []; f: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, f: number): void {
    const k = this.k, fs = this.f; let i = k.length;
    k.push(key); fs.push(f);
    while (i > 0) { const p = (i - 1) >> 1; if (fs[p] <= f) break; k[i] = k[p]; fs[i] = fs[p]; i = p; }
    k[i] = key; fs[i] = f;
  }
  pop(): number {
    const k = this.k, fs = this.f, top = k[0], lk = k.pop()!, lf = fs.pop()!, n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && fs[c + 1] < fs[c]) c++;
        if (fs[c] >= lf) break;
        k[i] = k[c]; fs[i] = fs[c]; i = c;
      }
      k[i] = lk; fs[i] = lf;
    }
    return top;
  }
}

const OFF = 1 << 15;
const pack = (i: number, j: number): number => (i + OFF) * 65536 + (j + OFF);

/**
 * A water route from `from` to `to`, as corner points ending at `to` (the start is left out), or null when there is
 * none within reach. A destination on land becomes the nearest water on the way to it.
 */
export function findRoute(from: Point, to: Point): Point[] | null {
  if (isWater(to.x, to.y) && clearLine(from, to)) return [to];
  const si = Math.round(from.x / STEP), sj = Math.round(from.y / STEP);
  let gi = Math.round(to.x / STEP), gj = Math.round(to.y / STEP);
  // a goal on land: walk back toward the start until there is water
  for (let t = 0; t < 400 && !isWater(gi * STEP, gj * STEP); t++) {
    const dx = si - gi, dy = sj - gj, d = Math.hypot(dx, dy);
    if (d < 1) return null;
    gi += Math.round(dx / d); gj += Math.round(dy / d);
  }
  const goal = pack(gi, gj), h = (i: number, j: number): number => {
    const dx = Math.abs(i - gi), dy = Math.abs(j - gj);
    return (dx + dy + (DIAG - 2) * Math.min(dx, dy)) * 1.05;     // octile, a touch greedy so long routes stay quick
  };
  const g = new Map<number, number>(), came = new Map<number, number>(), water = new Map<number, boolean>();
  const wet = (i: number, j: number, k: number): boolean => {
    let w = water.get(k);
    if (w === undefined) water.set(k, w = isWater(i * STEP, j * STEP));
    return w;
  };
  const open = new Heap(), start = pack(si, sj);
  g.set(start, 0); open.push(start, h(si, sj));
  let found = false, expanded = 0;
  while (open.size && expanded++ < MAX_NODES) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    const ci = Math.floor(cur / 65536) - OFF, cj = cur % 65536 - OFF, cg = g.get(cur)!;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj, nk = pack(ni, nj);
      if (!wet(ni, nj, nk)) continue;
      // no cutting a corner of land diagonally
      if (di && dj && (!wet(ci + di, cj, pack(ci + di, cj)) || !wet(ci, cj + dj, pack(ci, cj + dj)))) continue;
      const ng = cg + (di && dj ? DIAG : 1);
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, cur); open.push(nk, ng + h(ni, nj)); }
    }
  }
  if (!found) return null;
  const cells: Point[] = [];
  for (let k: number | undefined = goal; k !== undefined && k !== start; k = came.get(k)) {
    cells.push({ x: (Math.floor(k / 65536) - OFF) * STEP, y: (k % 65536 - OFF) * STEP });
  }
  cells.reverse();
  if (isWater(to.x, to.y)) cells[cells.length - 1] = to;
  // pull it tight: from each kept point, skip ahead to the furthest point still in clear sight
  const out: Point[] = [];
  let at: Point = from, i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !clearLine(at, cells[j])) j--;
    out.push(cells[j]); at = cells[j]; i = j + 1;
  }
  return out;
}
