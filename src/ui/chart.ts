// Chart drawing for the minimap and the full sea chart (crisp canvas, real font labels).
import { G, sonarLvl, logged, canLand } from '../game';
import { schoolShown, schoolMood } from '../game/schools';
import { SPECIES, PAINTS } from '../econ';
import { poisNear, schoolsNear, claimableNear, heightAt, homesteadSite, LAIR } from '../world';
import { livesAt } from '../species';
import { drawTerrain } from './chartgl';
import { seen as isSeen, revealPlace } from '../game/explore';
import { ONLINE } from '../online';
import { ISLANDS, watchExtra, islandPrice, islandColour } from '../islands';
import type { Point, Poi } from '../types';
import { waypointMetres, waypointRoute } from '../waypoint';
import { clamp, dirTo, money } from '../config';
import { SET } from '../settings';

const COL = { you: '#ff9a6b', port: '#f0cf6a', light: '#efe9dc', wreck: '#dcb074', dim: '#8a949c', ink: '#1b2a33', red: '#c0493a', green: '#8fd48a' };

export interface ChartOptions {
  /** ms to spend building missing map tiles this frame; the rest are drawn on later frames */
  budget?: number;
  /** canvas pixels per CSS pixel: marks and labels scale with it */
  dpr?: number;
  grid?: boolean;
  labels?: boolean;
  /** sextant level: 2 marks uncharted landmarks */
  sextant?: number;
  /** the guide's objective: a flag on it, or an arrow at the edge pointing to it ('round' for the minimap's circle) */
  target?: Point | null;
  round?: boolean;
  /** a species to show: where it lives (shaded, once its zone is known) and where you've caught it (pins) */
  zone?: number | null;
  /** the player's waypoint: its water route from the boat as a dashed line, and a marker (or a rim arrow on the minimap) */
  waypoint?: Point | null;
  /** mark unclaimed islands too (the full chart) */
  islands?: boolean;
}

type Ctx = CanvasRenderingContext2D;
type Project = (x: number, y: number) => [number, number];
/** Notes that a kind of mark was drawn at canvas point (x, y), for the legend. */
type Seen = (k: Legend, x: number, y: number) => void;
export type Legend = 'you' | 'port' | 'light' | 'wreck' | 'treasure' | 'escaped' | 'owned' | 'frenzy' | 'uncharted' | 'target' | 'waypoint' | 'sailor' | 'island' | 'school';
/** The kinds of mark the last full chart showed, so its legend only explains what's on it. */
export const drawn = new Set<Legend>();
const font = (ctx: Ctx, px: number, u: number): void => { ctx.font = `600 ${Math.round(px * u)}px Pixelify, monospace`; };
/** Chart lettering: dark-outlined so it reads on land and sea. */
function inked(ctx: Ctx, s: string, x: number, y: number, u: number, fill: string): void {
  ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(27,42,51,0.85)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = fill; ctx.fillText(s, x, y);
}
/** A name on a small parchment plate, its left end at (x, y): how a chart names its ports. */
function plate(ctx: Ctx, s: string, x: number, y: number, u: number): void {
  font(ctx, 12, u);
  const w = ctx.measureText(s).width + 9 * u, h = 15 * u;
  ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 3 * u);
  ctx.fillStyle = 'rgba(27,42,51,0.35)'; ctx.fill();                     // a soft drop under it
  ctx.beginPath(); ctx.roundRect(x, y - h / 2 - u, w, h, 3 * u);
  rimmed(ctx, '#f4ead2', 1.2 * u);
  ctx.fillStyle = COL.ink; ctx.textBaseline = 'middle'; ctx.fillText(s, x + 4.5 * u, y - 0.5 * u);
}
/** A closed path through `pts` ([x0, y0, x1, y1, ...]), scaled by `u`. */
function poly(ctx: Ctx, u: number, ...pts: number[]): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pts[i] * u, pts[i + 1] * u);
  ctx.closePath();
}
/** Fill, then a dark rim. */
function rimmed(ctx: Ctx, fill: string, lw: number): void { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = COL.ink; ctx.stroke(); }

/** Draws a chart centred on (cx, cy); `wpp` = world units per canvas pixel. */
export function drawChart(ctx: Ctx, w: number, h: number, cx: number, cy: number, wpp: number, opt: ChartOptions = {}): void {
  const budget = opt.budget ?? 6, u = opt.dpr || 1;
  const wx0 = cx - w / 2 * wpp, wy0 = cy - h / 2 * wpp;
  const S: Project = (x, y) => [(x - wx0) / wpp, (y - wy0) / wpp];
  if (opt.labels) drawn.clear();
  const seen: Seen = opt.labels ? (k, x, y) => { if (x > 0 && y > 0 && x < w && y < h) drawn.add(k); } : () => {};
  ctx.imageSmoothingEnabled = false;
  if (!drawTerrain(ctx, w, h, wx0, wy0, wpp, u, budget, !!opt.grid)) { ctx.fillStyle = '#4f7389'; ctx.fillRect(0, 0, w, h); }
  if (opt.zone != null) {
    // its own slice, not the map's leftovers, and in proportion to real time: a slow machine drawing few frames
    // builds more per frame, so the waters fill in about as fast everywhere
    const tz = performance.now(), slice = clamp((tz - zoneDrawnAt) * 0.4, 6, 40);
    zoneDrawnAt = tz;
    drawZone(ctx, w, h, wx0, wy0, wpp, opt.zone, S, u, () => performance.now() - tz < slice);
  }
  if (opt.grid) drawGrid(ctx, w, h, wx0, wy0, wpp, S, u);

  const son = sonarLvl();                  // 1 shows schools, 2 colours them by species, 3 stars legends
  const showUncharted = (opt.sextant ?? 0) >= 2;
  // what's in sea you haven't seen stays off the chart, except what a sextant marks
  const pois = poisNear(cx, cy, Math.max(w, h) * wpp * 0.6).filter(p => showUncharted || G.found.has(p.id) || isSeen(p.x, p.y));
  for (const p of pois) if (G.found.has(p.id) && !isSeen(p.x, p.y)) revealPlace(p);   // charted before the fog came in
  if (son >= 1) drawSchools(ctx, cx, cy, Math.min(260, Math.max(w, h) * wpp * 0.6), S, u, son, seen);
  drawPois(ctx, pois, S, u, showUncharted, seen);
  drawTreasure(ctx, S, u, seen);
  drawLair(ctx, S, u);
  if (G.frenzy && isSeen(G.frenzy.s.x, G.frenzy.s.y)) { const [x, y] = S(G.frenzy.s.x, G.frenzy.s.y); star(ctx, x, y, 5 * u, Math.floor(G.t * 4) % 2 ? COL.port : '#fff6d6'); seen('frenzy', x, y); }
  if (son >= 3) for (const p of pois) if (p.school && schoolShown(p.school) && SPECIES[p.school.sp].legend) star(ctx, ...S(p.school.x, p.school.y), 4 * u, COL.port);
  if (opt.labels) drawLabels(ctx, pois, S, u);
  if (opt.target) { const at = S(opt.target.x, opt.target.y); drawTarget(ctx, w, h, at, u, !!opt.round); if (opt.labels) drawn.add('target'); }
  drawIslandNames(ctx, cx, cy, Math.max(w, h) * wpp * 0.6, S, u, !!opt.labels, !!opt.islands, seen);
  if (opt.waypoint) { drawWaypoint(ctx, w, h, S, S(opt.waypoint.x, opt.waypoint.y), u, !!opt.round, opt.labels ? opt.waypoint : null); if (opt.labels) drawn.add('waypoint'); }
  drawSailors(ctx, w, h, S, u, !!opt.labels, seen);
  drawBoat(ctx, S, u);
  if (opt.labels) drawn.add('you');
}

/** The objective: a gold ring and pennant on the spot, or a gold arrow on the rim (circle or box) pointing at it. */
function drawTarget(ctx: Ctx, w: number, h: number, [x, y]: [number, number], u: number, round: boolean): void {
  const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy, pad = 7 * u;
  const inside = round ? Math.hypot(dx, dy) < w / 2 - pad : x > pad && x < w - pad && y > pad && y < h - pad;
  ctx.lineJoin = 'round';
  if (!round) u *= 1.8;                     // bigger on the full chart, where it must stand out among the marks
  if (inside) {
    ctx.beginPath(); ctx.arc(x, y, 5 * u, 0, 7);
    ctx.lineWidth = 3.4 * u; ctx.strokeStyle = COL.ink; ctx.stroke();
    ctx.lineWidth = 1.8 * u; ctx.strokeStyle = COL.port; ctx.stroke();
    // a pennant on a pole above the ring, flying left so it clears the place labels on the right
    ctx.fillStyle = COL.ink;
    ctx.fillRect(x - 0.8 * u, y - 15 * u, 1.6 * u, 10 * u);
    ctx.beginPath(); ctx.moveTo(x - u, y - 15.5 * u); ctx.lineTo(x - 9 * u, y - 12.25 * u); ctx.lineTo(x - u, y - 9 * u); ctx.closePath();
    ctx.lineWidth = 1.2 * u; ctx.strokeStyle = COL.ink; ctx.stroke(); ctx.fillStyle = COL.port; ctx.fill();
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
  poly(ctx, u, 6, 0, -4.5, -5, -2, 0, -4.5, 5); rimmed(ctx, COL.port, 1.4 * u);
  ctx.restore();
}

// ---------- fish zones ----------
// Where a species lives, worked out from the same rules that place its schools, on a world-aligned grid of 16-unit
// cells. Each 512-unit chunk is drawn once into a canvas, hatched in gold the way an old chart engraves a fishing
// ground, outlined only where the waters end in open sea (the coast already draws itself), then kept. Chunks are big so a far view needs only a few dozen,
// and the cache holds far more than any view shows, so nothing on screen is thrown away and rebuilt. Landmark fish
// ring their landmarks instead.
const ZC = 16, ZCH = 512, ZK = ZCH / ZC, ZPX = 4, ZS = ZK * ZPX;   // cell size, chunk size, cells per chunk side, canvas px per cell, canvas size
const ZONE_CAP = 600, zoneTiles = new Map<string, HTMLCanvasElement | null>();
let zoneDrawnAt = 0;
/** How many chunks have been built since the page loaded (window.BR.ZONES, for the tests: a settled chart builds none). */
export const zoneStats = { built: 0 };
const HATCH = [250, 218, 112, 165], TINT = [240, 207, 106, 60], EDGE = [255, 236, 168, 240];
/** Whether the chart may shade species `sp`'s zone: its chart was bought, or you've caught it 5 times. */
export const zoneKnown = (sp: number): boolean => !!G.zones[SPECIES[sp].id] || (G.log[SPECIES[sp].id]?.n ?? 0) >= 5;
/** A cell's water: 0 land or shallows, 1 sea the species doesn't live in, 2 its waters. */
const waterOf = (sp: number, cx: number, cy: number): number => {
  const x = (cx + 0.5) * ZC, y = (cy + 0.5) * ZC, h = heightAt(x, y);
  return h > -0.07 ? 0 : livesAt(sp, x, y, h) ? 2 : 1;
};
function zoneTile(sp: number, tx: number, ty: number, build: boolean): HTMLCanvasElement | null | undefined {
  const k = `${sp}:${tx},${ty}`, have = zoneTiles.get(k);
  if (have !== undefined) return have;
  if (!build) return undefined;
  // the chunk's cells plus a ring of its neighbours', so the outline knows where the waters end across the edge
  const N = ZK + 2, cell = new Uint8Array(N * N), c0 = tx * ZK - 1, r0 = ty * ZK - 1;
  let any = false;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = waterOf(sp, c0 + i, r0 + j); cell[j * N + i] = k; if (k === 2 && i && j && i <= ZK && j <= ZK) any = true; }
  let c: HTMLCanvasElement | null = null;
  if (any) {
    c = document.createElement('canvas'); c.width = c.height = ZS;
    const g = c.getContext('2d')!, img = g.createImageData(ZS, ZS), d = img.data;
    const put = (x: number, y: number, col: number[]) => { const o = (y * ZS + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = col[3]; };
    for (let j = 1; j <= ZK; j++) for (let i = 1; i <= ZK; i++) {
      if (cell[j * N + i] !== 2) continue;
      const x0 = (i - 1) * ZPX, y0 = (j - 1) * ZPX, open = (k: number) => cell[k] === 1;   // an edge only against open sea
      const l = open(j * N + i - 1), r = open(j * N + i + 1), t = open((j - 1) * N + i), b = open((j + 1) * N + i);
      for (let y = 0; y < ZPX; y++) for (let x = 0; x < ZPX; x++) {
        const edge = (l && x === 0) || (r && x === ZPX - 1) || (t && y === 0) || (b && y === ZPX - 1);
        put(x0 + x, y0 + y, edge ? EDGE : (x0 + x + y0 + y) % 4 === 0 ? HATCH : TINT);   // 4 divides a chunk, so diagonals run on across chunks; dense enough for a narrow band
      }
    }
    g.putImageData(img, 0, 0);
  }
  zoneTiles.set(k, c); zoneStats.built++;
  if (zoneTiles.size > ZONE_CAP) zoneTiles.delete(zoneTiles.keys().next().value!);   // oldest first; a far view needs about 70
  return c;
}
function drawZone(ctx: Ctx, w: number, h: number, wx0: number, wy0: number, wpp: number, sp: number, S: Project, u: number, inBudget: () => boolean): void {
  const s = SPECIES[sp];
  if (zoneKnown(sp)) {
    if (s.special) {                                       // wreck and lighthouse fish: a ring round each landmark that holds them
      for (const p of poisNear(wx0 + w * wpp / 2, wy0 + h * wpp / 2, Math.max(w, h) * wpp * 0.6)) {
        if (p.school?.sp !== sp) continue;
        const [x, y] = S(p.school.x, p.school.y);
        ctx.fillStyle = 'rgba(240,207,106,0.35)'; ctx.beginPath(); ctx.arc(x, y, 9 * u, 0, 7); ctx.fill();
      }
    } else {
      // crisp pixels, each chunk from one whole pixel to the next so the wash never doubles up along a seam
      ctx.save(); ctx.imageSmoothingEnabled = false;
      const px = (wx: number, o: number) => Math.round((wx - o) / wpp);
      for (let ty = Math.floor(wy0 / ZCH); ty <= Math.floor((wy0 + h * wpp) / ZCH); ty++) {
        for (let tx = Math.floor(wx0 / ZCH); tx <= Math.floor((wx0 + w * wpp) / ZCH); tx++) {
          const c = zoneTile(sp, tx, ty, inBudget());
          if (!c) continue;
          const x0 = px(tx * ZCH, wx0), y0 = px(ty * ZCH, wy0);
          ctx.drawImage(c, x0, y0, px((tx + 1) * ZCH, wx0) - x0, px((ty + 1) * ZCH, wy0) - y0);
        }
      }
      ctx.restore();
    }
  }
  // the spots where you've caught it: small gold pins with a dark rim
  for (const [px, py] of G.log[s.id]?.at ?? []) {
    const [x, y] = S(px, py);
    ctx.beginPath(); ctx.arc(x, y - 6 * u, 3.4 * u, 0, 7); ctx.moveTo(x, y); ctx.lineTo(x - 2 * u, y - 4 * u); ctx.lineTo(x + 2 * u, y - 4 * u); ctx.closePath();
    rimmed(ctx, COL.port, 1.2 * u);
  }
}

function drawGrid(ctx: Ctx, w: number, h: number, wx0: number, wy0: number, wpp: number, S: Project, u: number): void {
  const step = 512;
  ctx.strokeStyle = 'rgba(240,248,250,0.13)';
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

function drawSchools(ctx: Ctx, cx: number, cy: number, rad: number, S: Project, u: number, son: number, seen: Seen): void {
  for (const s of schoolsNear(cx, cy, rad)) {
    if (!isSeen(s.x, s.y)) continue;
    // scattered and fished-out schools stay on the sonar, faded, so they don't blink out of sight
    if (!schoolShown(s) || s.boss) continue;
    const [x, y] = S(s.x, s.y), colour = son >= 2 ? SPECIES[s.sp].c[1] : '#b4d0d8';
    seen('school', x, y);
    ctx.globalAlpha = schoolMood(s) === 'biting' ? 1 : 0.45;
    ctx.beginPath(); ctx.arc(x, y, 2.2 * u, 0, 7);
    // shape as well as colour: a filled dot you can catch, a hollow ring your rod can't handle yet
    if (canLand(s.sp)) rimmed(ctx, colour, 0.8 * u);
    else { ctx.lineWidth = 2.2 * u; ctx.strokeStyle = COL.ink; ctx.stroke(); ctx.lineWidth = 1.1 * u; ctx.strokeStyle = colour; ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
}

function cross(ctx: Ctx, x: number, y: number, r: number, lw: number, col: string): void {
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
}

function drawPois(ctx: Ctx, pois: Poi[], S: Project, u: number, showUncharted: boolean, seen: Seen): void {
  for (const p of pois) {
    const [x, y] = S(p.x, p.y), found = G.found.has(p.id);
    seen(found ? p.type : 'uncharted', x, y);
    if (!found && !showUncharted) {                                    // something's there: a faint ring until you've seen it
      ctx.beginPath(); ctx.arc(x, y, 2.4 * u, 0, 7); ctx.lineWidth = 1.2 * u; ctx.strokeStyle = 'rgba(240,248,250,0.55)'; ctx.stroke();
      continue;
    }
    if (p.type === 'port') portMark(ctx, x, y, u, found);
    else if (p.type === 'light') lightMark(ctx, x, y, u, found);
    else if (p.type === 'wreck') { const r = 3.4 * u; cross(ctx, x, y, r, 3.4 * u, COL.ink); cross(ctx, x, y, r, 1.8 * u, G.salvaged.has(p.id) ? '#9a7550' : COL.wreck); }
  }
}
/** A port: a gold disc with an anchor on it (grey until charted). */
function portMark(ctx: Ctx, x: number, y: number, u: number, found: boolean): void {
  ctx.beginPath(); ctx.arc(x, y, 5.6 * u, 0, 7); rimmed(ctx, found ? COL.port : COL.dim, 1.5 * u);
  ctx.strokeStyle = COL.ink; ctx.lineWidth = 1.1 * u; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - 2.7 * u, 0.9 * u, 0, 7);
  ctx.moveTo(x, y - 1.8 * u); ctx.lineTo(x, y + 2.9 * u);
  ctx.moveTo(x - 1.7 * u, y - 0.7 * u); ctx.lineTo(x + 1.7 * u, y - 0.7 * u);
  ctx.moveTo(x - 2.8 * u, y + 0.8 * u); ctx.quadraticCurveTo(x - 2.4 * u, y + 2.9 * u, x, y + 2.9 * u); ctx.quadraticCurveTo(x + 2.4 * u, y + 2.9 * u, x + 2.8 * u, y + 0.8 * u);
  ctx.stroke(); ctx.lineCap = 'butt';
}
/** A lighthouse: a white tower with a red band, and once charted a warm glow round its lamp. */
function lightMark(ctx: Ctx, x: number, y: number, u: number, found: boolean): void {
  if (found) {
    const g = ctx.createRadialGradient(x, y - 4 * u, 0, x, y - 4 * u, 11 * u);
    g.addColorStop(0, 'rgba(255,232,150,0.6)'); g.addColorStop(1, 'rgba(255,232,150,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 11 * u, y - 15 * u, 22 * u, 22 * u);
  }
  poly(ctx, u, -2.8, 4.5, 2.8, 4.5, 1.7, -4, -1.7, -4); rimmed(ctx, found ? COL.light : COL.dim, 1.3 * u);
  ctx.fillStyle = COL.red; ctx.fillRect(x - 2.3 * u, y - 0.2 * u, 4.6 * u, 1.8 * u);
  ctx.fillStyle = COL.ink; ctx.fillRect(x - 2.2 * u, y - 6.4 * u, 4.4 * u, 2.6 * u);
  ctx.fillStyle = found ? '#ffe08a' : COL.dim; ctx.fillRect(x - 1.3 * u, y - 5.7 * u, 2.6 * u, 1.4 * u);
}

function drawTreasure(ctx: Ctx, S: Project, u: number, seen: Seen): void {
  for (const m of G.maps) { const [x, y] = S(m.x, m.y); cross(ctx, x, y, 4 * u, 2.2 * u, COL.red); seen('treasure', x, y); }
  for (const e of G.escaped) {                                       // the fish that got away: a red ring where it lives
    const [x, y] = S(e.x, e.y);
    ctx.lineWidth = 2.6 * u; ctx.strokeStyle = COL.ink; ctx.beginPath(); ctx.arc(x, y, 4 * u, 0, 7); ctx.stroke();
    ctx.lineWidth = 1.4 * u; ctx.strokeStyle = COL.red; ctx.stroke();
    seen('escaped', x, y);
  }
}

// the Old One's lair, a blinking eye once the logbook is well filled
function drawLair(ctx: Ctx, S: Project, u: number): void {
  if ((logged() < 10 && !G.log.oldone) || !isSeen(LAIR.x, LAIR.y)) return;
  const [x, y] = S(LAIR.x, LAIR.y);
  ctx.fillStyle = Math.floor(G.t * 2) % 2 ? COL.red : '#efe9dc';
  ctx.beginPath(); ctx.arc(x, y, 4.5 * u, 0, 7); ctx.fill();
  ctx.fillStyle = COL.ink;
  ctx.fillRect(x - 2 * u, y - u, 1.4 * u, 1.4 * u);
  ctx.fillRect(x + 0.6 * u, y - u, 1.4 * u, 1.4 * u);
}

function drawLabels(ctx: Ctx, pois: Poi[], S: Project, u: number): void {
  font(ctx, 12, u);
  ctx.textBaseline = 'middle';
  // ports first, then lighthouses; a name goes right of its mark, else left, else not at all (hovering still says it)
  const taken: number[][] = [];
  const fits = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (taken.some(r => x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1])) return false;
    taken.push([x0, y0, x1, y1]); return true;
  };
  const named = pois.filter(p => G.found.has(p.id) && p.type !== 'wreck').sort((a, b) => +(a.type !== 'port') - +(b.type !== 'port'));
  for (const p of named) {
    const [x, y] = S(p.x, p.y), port = p.type === 'port', s = port ? p.name : p.name.replace(' Light', '');
    font(ctx, port ? 12 : 11, u);
    const w = ctx.measureText(s).width + (port ? 9 : 4) * u, h = (port ? 16 : 13) * u, gap = (port ? 8 : 6) * u;
    const right = fits(x + gap, y - h / 2, x + gap + w, y + h / 2), left = !right && fits(x - gap - w, y - h / 2, x - gap, y + h / 2);
    if (!right && !left) continue;
    const lx = right ? x + gap : x - gap - w;
    if (port) plate(ctx, s, lx, y, u); else inked(ctx, s, lx, y - 2 * u, u, COL.light);
  }
  font(ctx, 12, u);
  // contract destinations
  for (const c of G.active) {
    const q = pois.find(p => p.id === c.to);
    if (!q) continue;
    const [x, y] = S(q.x, q.y);
    ctx.fillStyle = COL.green;
    ctx.fillText('!', x - 2 * u, y - 9 * u);
  }
}

// claimed islands read as landmarks: a gold dashed ring round the island, a tall pennant flying the owner's flag (or
// the island's own colour until the flag is approved), and on the full chart its name and owner; yours in gold
const flagImgs = new Map<string, HTMLImageElement>();
function flagImg(url: string): HTMLImageElement | null {
  let im = flagImgs.get(url);
  if (!im) { if (flagImgs.size > 200) flagImgs.clear(); im = new Image(); im.src = url; flagImgs.set(url, im); }
  return im.complete && im.naturalWidth ? im : null;
}
function drawIslandNames(ctx: Ctx, cx: number, cy: number, rad: number, S: Project, u: number, labels: boolean, unclaimed: boolean, seen: Seen): void {
  const near = claimableNear(cx, cy, rad);
  if (labels) watchExtra(near.map(c => c.key));            // the full chart asks for every island it shows
  ctx.textAlign = 'center';
  for (const c of near) {
    const row = ISLANDS.get(c.key), [x, y] = S(c.x, c.y);
    if (!row?.mine && !isSeen(c.x, c.y)) continue;      // only your own island shows through unseen sea
    if (!row) {                                          // for sale: a faint dashed ring on the full chart
      if (unclaimed) { seen('island', x, y); ctx.setLineDash([3 * u, 3 * u]); ctx.lineWidth = 1.2 * u; ctx.strokeStyle = 'rgba(58,42,28,0.45)'; ctx.beginPath(); ctx.arc(x, y, 5 * u, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      continue;
    }
    seen('owned', x, y);
    const r = Math.max(8 * u, S(c.x + c.R * 0.85, c.y)[0] - x), gold = row.mine ? COL.port : '#e8c86a';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = 'rgba(240,207,106,0.12)'; ctx.fill();   // a warm wash over the claimed ground
    ctx.setLineDash([6 * u, 3 * u]);
    ctx.lineWidth = 4 * u; ctx.strokeStyle = 'rgba(27,42,51,0.6)'; ctx.stroke();
    ctx.lineWidth = 2.2 * u; ctx.strokeStyle = gold; ctx.stroke();
    ctx.setLineDash([]);
    // the pennant, where the island's flagpole stands in the world (homesteadSite): an ink pole with a gold cap, the flag off its top
    const site = homesteadSite(c), [px, py] = site ? S(site.x, site.y) : [x, y];
    const pole = (labels ? 46 : 18) * u, fs = (labels ? 40 : 14) * u, top = py - pole;
    ctx.fillStyle = COL.ink; ctx.fillRect(px - 1.2 * u, top, 2.4 * u, pole);
    ctx.beginPath(); ctx.arc(px, top, 2.2 * u, 0, 7); rimmed(ctx, gold, u);
    const f = row.logoUrl ? flagImg(row.logoUrl) : null, fx = px + 1.5 * u, fy = top + 1 * u;
    if (f) {
      ctx.fillStyle = row.mine ? gold : COL.ink; ctx.fillRect(fx - 1.2 * u, fy - 1.2 * u, fs + 2.4 * u, fs + 2.4 * u);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(f, fx, fy, fs, fs);
    } else {
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + fs, fy + fs * 0.35); ctx.lineTo(fx, fy + fs * 0.7); ctx.closePath();
      rimmed(ctx, islandColour(c.key), 1.2 * u);
    }
    if (!labels) continue;
    font(ctx, 15, u); inked(ctx, row.name, px, py + 10 * u, u, row.mine ? COL.port : '#fff6dc');
    font(ctx, 11, u); inked(ctx, row.mine ? 'your island' : `by ${row.owner}`, px, py + 24 * u, u, '#d8d0bf');
  }
  ctx.textAlign = 'start';
}
/** The waypoint: its water route from the boat as a dashed line to a white diamond, or on the minimap an arrow on the rim
 *  when it's outside (the line is clipped to the dial). */
const WP = '#e6efec';
function drawWaypoint(ctx: Ctx, w: number, h: number, S: Project, [x, y]: [number, number], u: number, round: boolean, label: Point | null): void {
  const [bx, by] = S(G.boat.x, G.boat.y), r = w / 2 - 6 * u;
  const inside = round ? Math.hypot(x - w / 2, y - h / 2) < r : x > 0 && x < w && y > 0 && y < h;
  let ex = x, ey = y;
  if (!inside && round) { const a = Math.atan2(y - h / 2, x - w / 2); ex = w / 2 + Math.cos(a) * r; ey = h / 2 + Math.sin(a) * r; }
  const route = waypointRoute();
  ctx.save();
  if (round) { ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.clip(); }
  ctx.setLineDash([4 * u, 3 * u]); ctx.lineWidth = 3 * u; ctx.strokeStyle = 'rgba(27,42,51,0.6)';
  ctx.beginPath(); ctx.moveTo(bx, by);
  if (route.length) for (const p of route) ctx.lineTo(...S(p.x, p.y)); else ctx.lineTo(x, y);
  ctx.stroke();
  ctx.lineWidth = 1.5 * u; ctx.strokeStyle = WP; ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.setLineDash([]);
  ctx.translate(ex, ey);
  if (inside) poly(ctx, u, 0, -5, 5, 0, 0, 5, -5, 0);
  else { ctx.rotate(Math.atan2(ey - h / 2, ex - w / 2)); poly(ctx, u, 5, 0, -4, -4, -4, 4); }
  rimmed(ctx, WP, 1.2 * u);
  ctx.restore();
  if (label && inside) {                                   // the full chart says how far and which way
    const s = `${waypointMetres()} m ${dirTo(G.boat.x, G.boat.y, label.x, label.y)}`;
    font(ctx, 12, u); ctx.textAlign = 'center';
    inked(ctx, s, x, y - 9 * u, u, WP); ctx.textAlign = 'start';
  }
}

/** Every other sailor we know about: the nearby ones we draw on the water, plus the far ones the relay reports for the chart. */
type Mark = { uid: string; name: string; x: number; y: number; paint?: string };
function sailorMarks(): Mark[] {
  const near = new Set(ONLINE.sailors.map(s => s.uid));
  return [...ONLINE.sailors, ...ONLINE.far.filter(f => !near.has(f.uid))];   // far includes the nearby ones too
}
const paintColour = (id?: string): string => PAINTS.find(p => p.id === id)?.ramp?.[2] ?? '#e6efec';
/** Other players: a dot in their paint (outlined so it reads on land and sea), with their name on the full chart. */
function drawSailors(ctx: Ctx, w: number, h: number, S: Project, u: number, labels: boolean, seen: Seen): void {
  font(ctx, 11, u);
  ctx.textAlign = 'center';
  for (const s of sailorMarks()) {
    const [x, y] = S(s.x, s.y);
    if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
    seen('sailor', x, y);
    ctx.beginPath(); ctx.arc(x, y, 3.2 * u, 0, 7); rimmed(ctx, paintColour(s.paint), 1.4 * u);
    if (labels) inked(ctx, s.name, x, y - 6 * u, u, '#f6eedc');
  }
  ctx.textAlign = 'start';
}

/** You: a bright arrow with a ripple spreading from it, so it's found at a glance among the marks. */
function drawBoat(ctx: Ctx, S: Project, u: number): void {
  const b = G.boat, [bx, by] = S(b.x, b.y), k = SET.calm ? 0.4 : (G.t * 0.7) % 1;
  ctx.save();
  ctx.translate(bx, by);
  ctx.beginPath(); ctx.arc(0, 0, (8 + 9 * k) * u, 0, 7); ctx.lineWidth = 1.6 * u; ctx.strokeStyle = `rgba(255,246,214,${0.85 * (1 - k)})`; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 8 * u, 0, 7); ctx.fillStyle = 'rgba(27,42,51,0.35)'; ctx.fill();
  ctx.rotate(b.a);
  poly(ctx, u, 9, 0, -6, -5.5, -3, 0, -6, 5.5);
  ctx.lineJoin = 'round'; ctx.lineWidth = 4.5 * u; ctx.strokeStyle = 'rgba(255,246,214,0.9)'; ctx.stroke();   // a pale halo, so it reads on land and sea
  rimmed(ctx, COL.you, 1.6 * u);
  ctx.restore();
}

function star(ctx: Ctx, x: number, y: number, r: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}

export function compassRose(ctx: Ctx, x: number, y: number, r: number): void {
  const ink = 'rgba(58,42,28,0.75)';
  ctx.save();
  ctx.translate(x, y);
  Object.assign(ctx, { strokeStyle: ink, fillStyle: ink, lineWidth: Math.max(1, r / 30) });
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
    ctx.fillStyle = i === 6 ? '#a0402e' : ink; ctx.fill();
  }
  Object.assign(ctx, { font: `${Math.round(r * 0.32)}px Jersey, monospace`, textAlign: 'center', textBaseline: 'middle' });
  ctx.fillText('N', 0, -r * 1.2);
  ctx.restore();
}

// ---------- what's under the pointer ----------
/** What the chart shows at a spot and what clicking it does: open an island's card, clear the waypoint, set one (snapped to a mark), or nothing. */
export interface Spot { title: string; sub?: string; act?: string; island?: string; snap?: Point; clear?: boolean; none?: boolean }
const away = (p: Point): string => `${Math.max(1, Math.round(Math.hypot(p.x - G.boat.x, p.y - G.boat.y) / 10))} m ${dirTo(G.boat.x, G.boat.y, p.x, p.y)}`;
const SAIL = 'Click to sail here';
/** The claimable island whose land is at (x, y), if any. */
const islandAt = (x: number, y: number) => claimableNear(x, y, 10).find(c => Math.hypot(c.x - x, c.y - y) < c.R * 0.8);
/** What is at world point (x, y) on the chart, picking marks within `r` world units. */
export function chartAt(x: number, y: number, r: number, target: { at: Point; text: string } | null): Spot {
  const near = (p: Point): boolean => Math.hypot(p.x - x, p.y - y) < r;
  if (near(G.boat)) return { title: 'You', sub: 'Your boat', none: true };
  if (G.waypoint && near(G.waypoint)) return { title: 'Your waypoint', sub: `${waypointMetres()} m away`, act: 'Click to clear it', clear: true };
  if (target && near(target.at)) return { title: 'Next step', sub: target.text, act: SAIL, snap: target.at };
  const sailor = sailorMarks().find(near);
  if (sailor) return { title: sailor.name, sub: 'Another sailor', act: 'Click to set a waypoint here' };
  const fogged = !isSeen(x, y);
  const map = G.maps.find(near);
  if (map) return { title: 'Treasure', sub: `Marked on a treasure map · ${away(map)}`, act: SAIL, snap: map };
  const esc = G.escaped.find(near);
  if (esc) return { title: `The ${SPECIES[esc.sp].name} that got away`, sub: `Broke your line on day ${esc.day} · ${away(esc)}`, act: SAIL, snap: esc };
  if (fogged) return { title: 'Unexplored waters', sub: `${away({ x, y })}. Sail there to fill in the chart`, act: 'Click to set a waypoint' };
  const poi = poisNear(x, y, r * 3).filter(near).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
  if (poi) {
    const snap = poi.type === 'port' ? poi.dock : poi, where = away(poi);
    if (!G.found.has(poi.id)) return { title: 'Uncharted place', sub: `${where}. Sail close to put it on your chart`, act: SAIL, snap };
    if (poi.type === 'port') return { title: poi.name, sub: `Port · ${where}`, act: SAIL, snap };
    if (poi.type === 'light') return { title: poi.name, sub: `Lighthouse · ${where}`, act: SAIL, snap };
    return { title: G.salvaged.has(poi.id) ? 'Salvaged wreck' : 'Wreck', sub: where, act: SAIL, snap };
  }
  if ((logged() >= 10 || G.log.oldone) && near(LAIR)) return { title: "The Old One's lair", sub: away(LAIR), act: SAIL, snap: LAIR };
  const isle = islandAt(x, y);
  if (isle) {
    const row = ISLANDS.get(isle.key);
    return row ? { title: row.name, sub: row.mine ? 'Your island' : `Owned by ${row.owner}`, act: 'Click to view it', island: isle.key }
      : { title: isle.i === 0 && isle.j === 0 ? 'Alderhaven' : 'Unclaimed island', sub: `For sale · ${money(islandPrice(isle.i, isle.j))}`, act: 'Click to view or buy it', island: isle.key };
  }
  return { title: heightAt(x, y) > -0.05 ? 'Land' : 'Open sea', sub: away({ x, y }), act: 'Click to set a waypoint' };
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
