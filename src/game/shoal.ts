import type { Point } from '../types';

export interface FishBody { point: Point; radius: number }
const GRID = 32;
const cellKey = (x: number, y: number): string => `${x},${y}`;

/** A local spatial grid keeps body clearance cheap even in a view containing several bait balls. */
export function separateFish(bodies: FishBody[], canSwim: (x: number, y: number) => boolean): void {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < bodies.length; i++) {
    const p = bodies[i].point, key = cellKey(Math.floor(p.x / GRID), Math.floor(p.y / GRID));
    const cell = cells.get(key);
    if (cell) cell.push(i); else cells.set(key, [i]);
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i], cx = Math.floor(a.point.x / GRID), cy = Math.floor(a.point.y / GRID);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      for (const j of cells.get(cellKey(x, y)) ?? []) {
        if (j <= i) continue;
        const b = bodies[j], dx = b.point.x - a.point.x, dy = b.point.y - a.point.y;
        const distance = Math.hypot(dx, dy), clearance = a.radius + b.radius;
        if (distance >= clearance) continue;
        const ux = distance > 0.0001 ? dx / distance : 1, uy = distance > 0.0001 ? dy / distance : 0;
        const shift = (clearance - distance) * 0.5;
        const ax = a.point.x - ux * shift, ay = a.point.y - uy * shift;
        const bx = b.point.x + ux * shift, by = b.point.y + uy * shift;
        const moveA = canSwim(ax, ay), moveB = canSwim(bx, by);
        if (moveA && moveB) { a.point.x = ax; a.point.y = ay; b.point.x = bx; b.point.y = by; }
        else if (moveA && canSwim(a.point.x - ux * shift * 2, a.point.y - uy * shift * 2)) {
          a.point.x -= ux * shift * 2; a.point.y -= uy * shift * 2;
        } else if (moveB && canSwim(b.point.x + ux * shift * 2, b.point.y + uy * shift * 2)) {
          b.point.x += ux * shift * 2; b.point.y += uy * shift * 2;
        }
      }
    }
  }
}

/** A spread-out initial layout, never a fallback pile at the school's centre when the coast blocks a slot. */
export function shoalPositions(home: Point, radius: number, count: number, gap: number, phase: number,
  canSwim: (x: number, y: number) => boolean): Point[] {
  const points: Point[] = [];
  const attempts = Math.max(80, count * 12);
  for (let i = 0; i < attempts && points.length < count; i++) {
    const a = phase + i * 2.399963229728653, r = radius * 0.92 * Math.sqrt((i + 0.5) / attempts);
    const x = home.x + Math.cos(a) * r, y = home.y + Math.sin(a) * r;
    if (!canSwim(x, y) || points.some(p => Math.hypot(p.x - x, p.y - y) < gap)) continue;
    points.push({ x, y });
  }
  return points;
}
