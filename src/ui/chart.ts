// Chart drawing for the minimap and the full sea chart (crisp canvas, real font labels).
import { G, sonarLvl, logged } from '../game';
import { schoolShown, schoolMood } from '../game/schools';
import { SPECIES } from '../econ';
import { poisNear, schoolsNear, LAIR } from '../world';
import { mapTile, MT } from '../maptiles';
import type { Point, Poi } from '../types';

const COL = { port: '#f0cf6a', light: '#efe9dc', wreck: '#dcb074', dim: '#8a949c', ink: '#1b2a33', red: '#c0493a', green: '#8fd48a' };

export interface ChartOptions {
  /** ms to spend building missing map tiles this frame; the rest are drawn on later frames */
  budget?: number;
  /** canvas pixels per CSS pixel: marks and labels scale with it */
  dpr?: number;
  grid?: boolean;
  labels?: boolean;
  /** sonar level: 1 shows schools, 2 colours them by species, 3 stars legends */
  sonar?: number;
  /** sextant level: 2 marks uncharted landmarks */
  sextant?: number;
  /** the guide's objective: a flag on it, or an arrow at the edge pointing to it ('round' for the minimap's circle) */
  target?: Point | null;
  round?: boolean;
}

type Ctx = CanvasRenderingContext2D;
type Project = (x: number, y: number) => [number, number];

/** Draws a chart centred on (cx, cy); `wpp` = world units per canvas pixel. */
export function drawChart(ctx: Ctx, w: number, h: number, cx: number, cy: number, wpp: number, opt: ChartOptions = {}): void {
  const t0 = performance.now(), budget = opt.budget ?? 6, u = opt.dpr || 1;
  const wx0 = cx - w / 2 * wpp, wy0 = cy - h / 2 * wpp;
  const S: Project = (x, y) => [(x - wx0) / wpp, (y - wy0) / wpp];
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#4f7389';
  ctx.fillRect(0, 0, w, h);
  drawTiles(ctx, w, h, wx0, wy0, wpp, () => performance.now() - t0 < budget);
  if (opt.grid) drawGrid(ctx, w, h, wx0, wy0, wpp, S, u);

  const pois = poisNear(cx, cy, Math.max(w, h) * wpp * 0.6);
  const son = opt.sonar ?? sonarLvl();
  const showUncharted = (opt.sextant ?? 0) >= 2;
  if (son >= 1) drawSchools(ctx, cx, cy, Math.min(260, Math.max(w, h) * wpp * 0.6), S, u, son);
  drawPois(ctx, pois, S, u, showUncharted);
  drawTreasure(ctx, S, u);
  drawLair(ctx, S, u);
  if (G.frenzy) {
    const [x, y] = S(G.frenzy.s.x, G.frenzy.s.y);
    star(ctx, x, y, 5 * u, Math.floor(G.t * 4) % 2 ? '#f0cf6a' : '#fff6d6');
  }
  if (son >= 3) for (const p of pois) {
    if (p.school && schoolShown(p.school) && SPECIES[p.school.sp].legend) {
      const [x, y] = S(p.school.x, p.school.y);
      star(ctx, x, y, 4 * u, '#f0cf6a');
    }
  }
  if (opt.labels) drawLabels(ctx, pois, S, u, showUncharted);
  if (opt.target) drawTarget(ctx, w, h, S(opt.target.x, opt.target.y), u, !!opt.round);
  drawBoat(ctx, S, u);
}

const GOLD = '#f0cf6a';
/** The objective: a gold ring and pennant on the spot, or a gold arrow on the rim (circle or box) pointing at it. */
function drawTarget(ctx: Ctx, w: number, h: number, [x, y]: [number, number], u: number, round: boolean): void {
  const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy, pad = 7 * u;
  const inside = round ? Math.hypot(dx, dy) < w / 2 - pad : x > pad && x < w - pad && y > pad && y < h - pad;
  ctx.lineJoin = 'round';
  if (!round) u *= 1.8;                     // bigger on the full chart, where it must stand out among the marks
  if (inside) {
    ctx.beginPath(); ctx.arc(x, y, 5 * u, 0, 7);
    ctx.lineWidth = 3.4 * u; ctx.strokeStyle = COL.ink; ctx.stroke();
    ctx.lineWidth = 1.8 * u; ctx.strokeStyle = GOLD; ctx.stroke();
    // a pennant on a pole above the ring, flying left so it clears the place labels on the right
    ctx.fillStyle = COL.ink;
    ctx.fillRect(x - 0.8 * u, y - 15 * u, 1.6 * u, 10 * u);
    ctx.beginPath(); ctx.moveTo(x - u, y - 15.5 * u); ctx.lineTo(x - 9 * u, y - 12.25 * u); ctx.lineTo(x - u, y - 9 * u); ctx.closePath();
    ctx.lineWidth = 1.2 * u; ctx.strokeStyle = COL.ink; ctx.stroke(); ctx.fillStyle = GOLD; ctx.fill();
    return;
  }
  const a = Math.atan2(dy, dx);
  let ex: number, ey: number;
  if (round) { const r = w / 2 - 6 * u; ex = cx + Math.cos(a) * r; ey = cy + Math.sin(a) * r; } else {
    const k = Math.min((w / 2 - pad) / Math.abs(Math.cos(a) || 1e-6), (h / 2 - pad) / Math.abs(Math.sin(a) || 1e-6));
    ex = cx + Math.cos(a) * k; ey = cy + Math.sin(a) * k;
  }
  ctx.save();
  ctx.translate(ex, ey); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(6 * u, 0); ctx.lineTo(-4.5 * u, -5 * u); ctx.lineTo(-2 * u, 0); ctx.lineTo(-4.5 * u, 5 * u); ctx.closePath();
  ctx.lineWidth = 1.4 * u; ctx.strokeStyle = COL.ink; ctx.fillStyle = GOLD; ctx.fill(); ctx.stroke();
  ctx.restore();
}

// the baked map tiles; tiles not built yet are built while `inBudget()` holds and skipped otherwise
function drawTiles(ctx: Ctx, w: number, h: number, wx0: number, wy0: number, wpp: number, inBudget: () => boolean): void {
  const tpx = MT / wpp;
  for (let ty = Math.floor(wy0 / MT); ty <= Math.floor((wy0 + h * wpp) / MT); ty++) {
    for (let tx = Math.floor(wx0 / MT); tx <= Math.floor((wx0 + w * wpp) / MT); tx++) {
      const c = mapTile(tx, ty, inBudget());
      if (c) ctx.drawImage(c, Math.floor((tx * MT - wx0) / wpp), Math.floor((ty * MT - wy0) / wpp), Math.ceil(tpx) + 1, Math.ceil(tpx) + 1);
    }
  }
}

function drawGrid(ctx: Ctx, w: number, h: number, wx0: number, wy0: number, wpp: number, S: Project, u: number): void {
  const step = 512;
  ctx.strokeStyle = 'rgba(40,30,20,0.18)';
  ctx.lineWidth = u;
  for (let gx = Math.ceil(wx0 / step) * step; gx < wx0 + w * wpp; gx += step) {
    const [x] = S(gx, 0);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  for (let gy = Math.ceil(wy0 / step) * step; gy < wy0 + h * wpp; gy += step) {
    const [, y] = S(0, gy);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawSchools(ctx: Ctx, cx: number, cy: number, rad: number, S: Project, u: number, son: number): void {
  for (const s of schoolsNear(cx, cy, rad)) {
    // scattered and fished-out schools stay on the sonar, faded, so they don't blink out of sight
    if (!schoolShown(s) || s.boss) continue;
    const [x, y] = S(s.x, s.y), colour = son >= 2 ? SPECIES[s.sp].c[1] : '#b4d0d8';
    ctx.globalAlpha = schoolMood(s) === 'biting' ? 1 : 0.45;
    // shape as well as colour: a filled dot you can catch, a hollow ring your rod can't handle yet
    const weak = SPECIES[s.sp].rod > G.up.rod;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 * u, 0, 7);
    ctx.strokeStyle = COL.ink;
    ctx.lineWidth = u * 0.8;
    if (weak) {
      ctx.lineWidth = 2.2 * u;
      ctx.stroke();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.1 * u;
      ctx.stroke();
    } else {
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// an outlined square marker
function square(ctx: Ctx, x: number, y: number, r: number, u: number, fill: string): void {
  ctx.fillStyle = COL.ink;
  ctx.fillRect(x - r - u, y - r - u, (r + u) * 2, (r + u) * 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function cross(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

function drawPois(ctx: Ctx, pois: Poi[], S: Project, u: number, showUncharted: boolean): void {
  const s3 = 3 * u;
  for (const p of pois) {
    const [x, y] = S(p.x, p.y), found = G.found.has(p.id);
    if (!found && !showUncharted) {
      square(ctx, x, y, 1.5 * u, u, COL.dim);
      continue;
    }
    if (p.type === 'port') square(ctx, x, y, s3, u, found ? COL.port : COL.dim);
    else if (p.type === 'light') {
      ctx.fillStyle = COL.ink;
      ctx.fillRect(x - 2 * u, y - 4 * u, 4 * u, 8 * u);
      ctx.fillStyle = found ? COL.light : COL.dim;
      ctx.fillRect(x - u, y - 3 * u, 2 * u, 6 * u);
      ctx.fillStyle = COL.red;
      ctx.fillRect(x - u, y - u, 2 * u, 2 * u);
    } else if (p.type === 'wreck') {
      ctx.strokeStyle = G.salvaged.has(p.id) ? '#7a5530' : COL.wreck;
      ctx.lineWidth = 1.6 * u;
      cross(ctx, x, y, s3);
    }
  }
}

function drawTreasure(ctx: Ctx, S: Project, u: number): void {
  for (const m of G.maps) {
    const [x, y] = S(m.x, m.y);
    ctx.strokeStyle = COL.red;
    ctx.lineWidth = 2.2 * u;
    cross(ctx, x, y, 4 * u);
  }
}

// the Old One's lair, a blinking eye once the logbook is well filled
function drawLair(ctx: Ctx, S: Project, u: number): void {
  if (logged() < 10 && !G.log.oldone) return;
  const [x, y] = S(LAIR.x, LAIR.y);
  ctx.fillStyle = Math.floor(G.t * 2) % 2 ? COL.red : '#efe9dc';
  ctx.beginPath();
  ctx.arc(x, y, 4.5 * u, 0, 7);
  ctx.fill();
  ctx.fillStyle = COL.ink;
  ctx.fillRect(x - 2 * u, y - u, 1.4 * u, 1.4 * u);
  ctx.fillRect(x + 0.6 * u, y - u, 1.4 * u, 1.4 * u);
}

function drawLabels(ctx: Ctx, pois: Poi[], S: Project, u: number, showUncharted: boolean): void {
  ctx.font = `600 ${Math.round(12 * u)}px Pixelify, monospace`;
  ctx.textBaseline = 'middle';
  for (const p of pois) {
    const found = G.found.has(p.id);
    if ((!found && !showUncharted) || p.type === 'wreck') continue;
    const [x, y] = S(p.x, p.y);
    const s = !found ? '?' : p.type === 'port' ? p.name : p.name.replace(' Light', '');
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = 'rgba(27,42,51,0.85)';
    ctx.strokeText(s, x + 6 * u, y);
    ctx.fillStyle = p.type === 'port' ? COL.port : COL.light;
    ctx.fillText(s, x + 6 * u, y);
  }
  // contract destinations
  for (const c of G.active) {
    const q = pois.find(p => p.id === c.to);
    if (!q) continue;
    const [x, y] = S(q.x, q.y);
    ctx.fillStyle = COL.green;
    ctx.fillText('!', x - 2 * u, y - 9 * u);
  }
}

function drawBoat(ctx: Ctx, S: Project, u: number): void {
  const b = G.boat, [bx, by] = S(b.x, b.y);
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(b.a);
  ctx.beginPath();
  ctx.moveTo(6 * u, 0);
  ctx.lineTo(-4 * u, -3.5 * u);
  ctx.lineTo(-2 * u, 0);
  ctx.lineTo(-4 * u, 3.5 * u);
  ctx.closePath();
  ctx.fillStyle = '#fff6d6';
  ctx.fill();
  ctx.lineWidth = 1.2 * u;
  ctx.strokeStyle = COL.ink;
  ctx.stroke();
  ctx.restore();
}

function star(ctx: Ctx, x: number, y: number, r: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function compassRose(ctx: Ctx, x: number, y: number, r: number, ink = 'rgba(58,42,28,0.75)'): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1, r / 30);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, 7); ctx.stroke();
  // eight points, the long ones on the cardinals; north (i = 6, pointing up) in red
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2, L = i % 2 ? r * 0.55 : r * 0.95;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.12) * r * 0.12, Math.sin(a - 0.12) * r * 0.12);
    ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
    ctx.lineTo(Math.cos(a + 0.12) * r * 0.12, Math.sin(a + 0.12) * r * 0.12);
    ctx.closePath();
    if (i === 6) {
      ctx.fillStyle = '#a0402e';
      ctx.fill();
      ctx.fillStyle = ink;
    } else ctx.fill();
  }
  ctx.font = `${Math.round(r * 0.32)}px Jersey, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r * 1.2);
  ctx.restore();
}

/** The nearest uncharted landmark, for the sextant. */
export function nearestUncharted(): { p: Poi; d: number } | null {
  const b = G.boat;
  let best: Poi | null = null, bd = 1e9;
  for (const p of poisNear(b.x, b.y, 2600)) {
    if (G.found.has(p.id)) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : null;
}
