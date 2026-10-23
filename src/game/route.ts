// Routes over water for the waypoint (dots on the sea, the line on the chart) and click-to-sail round islands: A* on
// a coarse grid of the terrain, kept off the coast, pulled tight and rounded (planRoute). It samples heightAt directly,
// so a long route never builds the height tiles for the sea it crosses.
import { heightAt, poisNear } from '../world';
import { seaPropsNear } from '../seaprops';
import { lockedAt } from './open';
import type { Point } from '../types';

const WATER = -0.07;                              // a little deeper than the beach, so routes keep off it
const DIAG = Math.SQRT2;

/** Open water at (x, y), deep enough to keep off the beach. */
const isWater = (x: number, y: number): boolean => heightAt(x, y) < WATER;
/** Whether a boat can sail straight from a to b (checked every few units), with `pad` of water either side of its line. */
export function clearLine(a: Point, b: Point, pad = 0): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 6), sx = d ? -(b.y - a.y) / d * pad : 0, sy = d ? (b.x - a.x) / d * pad : 0;
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    if (!isWater(x, y) || (pad && (!isWater(x + sx, y + sy) || !isWater(x - sx, y - sy)))) return false;
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

// ---------- planRoute: the route a ship can actually sail ----------
// The same A*, but it keeps to the middle of a channel (a step costs more the nearer land is), leaves a hull's width
// clear, steps round piers, wrecks and solid sea props near the start, keeps out of regions not open yet, and plans
// long trips on a coarser grid so they don't give up. The result is pulled tight with a margin off the coast, then
// rounded (Chaikin corner cutting, kept only where the rounded line is still clear) and spaced evenly, so the line
// drawn and the line followed are the same smooth curve.

/** A planned route: `pts` evenly spaced along the smoothed path, `corners` the tight polyline it was rounded from. */
export interface Plan { pts: Point[]; corners: Point[]; end: Point; length: number }
const SOLID_REACH = 320;                          // solids are only gathered round the start, where the sea is already built (replanning picks up the rest)
const NEAR = 3;                                   // cells of clearance that still cost extra
const SPACING = 12;

/** Plan a route for a hull that needs `pad` of water either side. Null only when there's no water route at all. */
export function planRoute(from: Point, to: Point, pad: number): Plan | null {
  const solids = gatherSolids(from), seen = new Map<number, boolean>();
  // land, a closed region or a solid at (x, y), remembered on a 4-unit grid (line checks ask about the same spots a lot)
  const blocked = (x: number, y: number, p: number): boolean => {
    if (p) return hitsSolid(solids, x, y, p) || blocked(x, y, 0);
    const k = pack(Math.round(x / 4), Math.round(y / 4));
    let b = seen.get(k);
    if (b === undefined) seen.set(k, b = !isWater(x, y) || hitsSolid(solids, x, y, 0) || lockedAt(x, y));
    return b;
  };
  const clear = (a: Point, b: Point, p: number): boolean => {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 6), sx = d ? -(b.y - a.y) / d * p : 0, sy = d ? (b.x - a.x) / d * p : 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (blocked(x, y, 0) || (p && (blocked(x + sx, y + sy, 0) || blocked(x - sx, y - sy, 0) || hitsSolid(solids, x, y, p)))) return false;
    }
    return true;
  };
  const d = Math.hypot(to.x - from.x, to.y - from.y), S = d < 2400 ? 16 : d < 6000 ? 32 : 64;
  const cells = (pad ? search(from, to, S, Math.max(1, Math.ceil(pad / S)), blocked) : null) ?? search(from, to, S, 0, blocked);
  if (!cells) return null;
  const end = cells[cells.length - 1];
  // pulled tight: the furthest cell still in clear sight, with a margin off the coast where there's room for one
  const margin = Math.min(10, S * 0.6), corners: Point[] = [];
  let at: Point = from, i = 0;
  while (i < cells.length) {
    // the next cell is always reachable (the grid path is); then reach on while the line stays clear with a margin
    let j = i;
    while (j + 1 < cells.length && clear(at, cells[j + 1], pad + margin)) j++;
    corners.push(cells[j]); at = cells[j]; i = j + 1;
  }
  // rounded: three passes of corner cutting, each kept only if every new piece is still clear for the hull
  let line = [from, ...corners];
  for (let pass = 0; pass < 3 && line.length > 2; pass++) {
    const next: Point[] = [line[0]];
    for (let k = 0; k < line.length - 1; k++) {
      const a = line[k], b = line[k + 1];
      if (k > 0) next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      if (k < line.length - 2) next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(line[line.length - 1]);
    let ok = true;
    for (let k = 0; k < next.length - 1 && ok; k++) ok = clear(next[k], next[k + 1], pad);
    if (!ok) break;
    line = next;
  }
  // evenly spaced, leaving out the start
  const pts: Point[] = [];
  let length = 0, carry = SPACING;
  for (let k = 0; k < line.length - 1; k++) {
    const a = line[k], b = line[k + 1], seg = Math.hypot(b.x - a.x, b.y - a.y);
    for (; carry <= seg; carry += SPACING) pts.push({ x: a.x + (b.x - a.x) * carry / seg, y: a.y + (b.y - a.y) * carry / seg });
    carry -= seg; length += seg;
  }
  if (!pts.length || Math.hypot(pts[pts.length - 1].x - end.x, pts[pts.length - 1].y - end.y) > 1) pts.push(end);
  return { pts, corners, end, length };
}

/** A* over a grid of `S`-unit cells from `from` toward `to`, each cell needing `need` cells of clearance; the cells, ending at the goal. */
function search(from: Point, to: Point, S: number, need: number, blocked: (x: number, y: number, p: number) => boolean): Point[] | null {
  const free = new Map<number, boolean>(), room = new Map<number, number>();
  const ok1 = (i: number, j: number): boolean => { const k = pack(i, j); let w = free.get(k); if (w === undefined) free.set(k, w = !blocked(i * S, j * S, 0)); return w; };
  /** cells of clearance round (i, j): 0 if it's blocked, else the ring (1..NEAR+1) where blocked water first shows */
  const clearance = (i: number, j: number): number => {
    const k = pack(i, j); let c = room.get(k);
    if (c !== undefined) return c;
    c = ok1(i, j) ? NEAR + 1 : 0;
    for (let r = 1; r <= NEAR && c > r; r++) for (let t = -r; t <= r && c > r; t++)
      if (!ok1(i + t, j - r) || !ok1(i + t, j + r) || !ok1(i - r, j + t) || !ok1(i + r, j + t)) c = r;
    room.set(k, c);
    return c;
  };
  const si = Math.round(from.x / S), sj = Math.round(from.y / S);
  let gi = Math.round(to.x / S), gj = Math.round(to.y / S);
  for (let t = 0; t < 600 && clearance(gi, gj) <= need && !(need === 0 && ok1(gi, gj)); t++) {   // a goal on land or too tight: back toward the start
    const dx = si - gi, dy = sj - gj, dd = Math.hypot(dx, dy);
    if (dd < 1) return null;
    gi += Math.round(dx / dd); gj += Math.round(dy / dd);
  }
  const goal = pack(gi, gj), start = pack(si, sj);
  const h = (i: number, j: number): number => { const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return (dx + dy + (DIAG - 2) * Math.min(dx, dy)) * 1.02; };
  const g = new Map<number, number>(), came = new Map<number, number>(), open = new Heap();
  g.set(start, 0); open.push(start, h(si, sj));
  let found = false, expanded = 0;
  while (open.size && expanded++ < 60_000) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    const ci = Math.floor(cur / 65536) - OFF, cj = cur % 65536 - OFF, cg = g.get(cur)!;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj, nk = pack(ni, nj), c = clearance(ni, nj);
      if (c === 0 || (c <= need && nk !== goal)) continue;
      if (di && dj && (!ok1(ci + di, cj) || !ok1(ci, cj + dj))) continue;          // no cutting a corner of land
      const near = Math.max(0, 1 - (c - 1) / NEAR), ng = cg + (di && dj ? DIAG : 1) * (1 + 2.5 * near * near);   // dearer near land
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, cur); open.push(nk, ng + h(ni, nj)); }
    }
  }
  if (!found) return null;
  const out: Point[] = [];
  for (let k: number | undefined = goal; k !== undefined && k !== start; k = came.get(k)) out.push({ x: (Math.floor(k / 65536) - OFF) * S, y: (k % 65536 - OFF) * S });
  out.reverse();
  if (out.length && !blocked(to.x, to.y, 0) && Math.hypot(to.x - out[out.length - 1].x, to.y - out[out.length - 1].y) < S * 1.5) out[out.length - 1] = { x: to.x, y: to.y };
  return out.length ? out : [blocked(to.x, to.y, 0) ? { x: gi * S, y: gj * S } : { x: to.x, y: to.y }];   // already there
}

// solids near the start: piers and wrecks (their own shapes) and sea props (circles), grown by the hull's pad
// (bucketed by 64-unit cell, each under every cell its reach touches, so a check looks at one bucket)
type Obstacle = { x: number; y: number; r: number } | { ax: number; ay: number; bx: number; by: number; r: number };
type Solids = Map<number, Obstacle[]>;
const BUCKET = 64, REACH = 40;                    // a check's own pad plus the obstacle's radius stays under this
function gatherSolids(from: Point): Solids {
  const out: Solids = new Map(), add = (o: Obstacle, x0: number, y0: number, x1: number, y1: number) => {
    for (let j = Math.floor((y0 - o.r - REACH) / BUCKET); j <= Math.floor((y1 + o.r + REACH) / BUCKET); j++) for (let i = Math.floor((x0 - o.r - REACH) / BUCKET); i <= Math.floor((x1 + o.r + REACH) / BUCKET); i++) {
      const k = pack(i, j); let l = out.get(k); if (!l) out.set(k, l = []); l.push(o);
    }
  };
  for (const p of poisNear(from.x, from.y, SOLID_REACH)) {
    const so = p.solid;
    if (so?.kind === 'circ') add({ x: so.x, y: so.y, r: so.r }, so.x, so.y, so.x, so.y);
    else if (so) add({ ax: so.ax, ay: so.ay, bx: so.bx, by: so.by, r: so.r }, Math.min(so.ax, so.bx), Math.min(so.ay, so.by), Math.max(so.ax, so.bx), Math.max(so.ay, so.by));
  }
  for (const s of seaPropsNear(from.x, from.y, SOLID_REACH)) add({ x: s.x, y: s.y, r: s.r }, s.x, s.y, s.x, s.y);
  return out;
}
function hitsSolid(solids: Solids, x: number, y: number, pad: number): boolean {
  const list = solids.get(pack(Math.floor(x / BUCKET), Math.floor(y / BUCKET)));
  if (!list) return false;
  for (const o of list) {
    let cx: number, cy: number;
    if ('x' in o) { cx = o.x; cy = o.y; } else {
      const dx = o.bx - o.ax, dy = o.by - o.ay, t = Math.max(0, Math.min(1, ((x - o.ax) * dx + (y - o.ay) * dy) / (dx * dx + dy * dy || 1)));
      cx = o.ax + dx * t; cy = o.ay + dy * t;
    }
    const rr = o.r + pad + 2;
    if (Math.abs(x - cx) < rr && Math.abs(y - cy) < rr && (x - cx) ** 2 + (y - cy) ** 2 < rr * rr) return true;
  }
  return false;
}
