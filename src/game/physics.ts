// Boat physics: thrust, drag, steering, wind gusts, contacts with land and solids, crashes and sinking.
import { clamp } from '../config';
import { hBil, poisNear } from '../world';
import { WX } from '../weather';
import { sfx } from '../audio';
import { OAR } from '../models';
import type { Solid } from '../types';
import { G, inp } from './state';
import { boatDef, hpMax, keelLvl, speedMul, sailEff, windAngle, toWorld } from './rules';
import { spawn, toast, jitter, burst } from './feedback';
import { cancelFishing } from './fishing';

const frac = (x: number): number => x - Math.floor(x);

// the hull outline as 18 points on an ellipse, slightly blunter at the stern
const hullCache: Record<string, [number, number][]> = {};
function hullPoints(): [number, number][] {
  const b = boatDef();
  const cached = hullCache[b.id];
  if (cached) return cached;
  const pts: [number, number][] = [];
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * Math.PI * 2, c = Math.cos(a);
    pts.push([c * (c > 0 ? b.L : b.L * 0.93), Math.sin(a) * b.B]);
  }
  return (hullCache[b.id] = pts);
}

const RESTITUTION = 0.2, FRICTION = 0.35, DRAFT = 0.028;
/** Piers and wrecks near the boat; refreshed once per frame rather than every physics step. */
let solids: Solid[] = [];
export function refreshSolids(): void {
  solids = poisNear(G.boat.x, G.boat.y, 140).flatMap(p => p.solid ? [p.solid] : []);
}

interface Contact { pen: number; nx: number; ny: number }
/** Penetration of point (px, py) into a pier segment or wreck circle, with the push-out normal. */
function shapeContact(so: Solid, px: number, py: number): Contact | null {
  let cx: number, cy: number;
  if (so.kind === 'circ') { cx = so.x; cy = so.y; }
  else {
    const dx = so.bx - so.ax, dy = so.by - so.ay;
    const t = clamp(((px - so.ax) * dx + (py - so.ay) * dy) / (dx * dx + dy * dy), 0, 1);
    cx = so.ax + dx * t; cy = so.ay + dy * t;
  }
  const d = Math.hypot(px - cx, py - cy);
  if (d >= so.r) return null;
  const inv = d > 1e-4 ? 1 / d : 0;
  return { pen: so.r - d, nx: (px - cx) * inv, ny: (py - cy) * inv };
}
/** Deepest penetration of a hull point into land (from the height gradient) or any solid. */
function deepestContact(px: number, py: number, rx: number, ry: number): Contact {
  let best: Contact = { pen: 0, nx: 0, ny: 0 };
  const h = hBil(px, py);
  if (h > -DRAFT) {
    const gx = hBil(px + 1.5, py) - hBil(px - 1.5, py), gy = hBil(px, py + 1.5) - hBil(px, py - 1.5), gl = Math.hypot(gx, gy);
    if (gl > 1e-6) best = { nx: -gx / gl, ny: -gy / gl, pen: Math.min(2.5, (h + DRAFT) / (gl / 3) + 0.05) };
    else { const l = Math.hypot(rx, ry) || 1; best = { nx: -rx / l, ny: -ry / l, pen: 0.5 }; }   // flat ground: push back towards the centre
  }
  for (const so of solids) {
    const r = shapeContact(so, px, py);
    if (r && r.pen > best.pen) best = r;
  }
  return best;
}
/** Resolve hull contacts with impulses (restitution + friction), a few iterations deep. */
function contacts(): void {
  const b = G.boat, inertia = 200 * Math.pow(boatDef().L / 13.5, 2);
  let impact = 0, at: { x: number; y: number; nx: number; ny: number } | null = null;
  for (let it = 0; it < 3; it++) {
    const c = Math.cos(b.a), s = Math.sin(b.a);
    let any = false;
    for (const [u, v] of hullPoints()) {
      const rx = u * c - v * s, ry = u * s + v * c, px = b.x + rx, py = b.y + ry;
      const { pen, nx, ny } = deepestContact(px, py, rx, ry);
      if (pen <= 0) continue;
      any = true;
      b.x += nx * pen * 0.4; b.y += ny * pen * 0.4;
      const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx, vn = vpx * nx + vpy * ny;
      if (vn >= 0) continue;
      const rn = rx * ny - ry * nx, j = -(1 + RESTITUTION) * vn / (1 + rn * rn / inertia);
      b.vx += j * nx; b.vy += j * ny; b.w += rn * j / inertia;
      const tx = -ny, ty = nx, vt = vpx * tx + vpy * ty, rt = rx * ty - ry * tx;
      const jt = clamp(-vt / (1 + rt * rt / inertia), -FRICTION * j, FRICTION * j);
      b.vx += jt * tx; b.vy += jt * ty; b.w += rt * jt / inertia;
      if (-vn > impact) { impact = -vn; at = { x: px, y: py, nx, ny }; }
    }
    if (!any) break;
  }
  if (at) onImpact(impact, at);
}
/** Spray, scrapes, crashes and hull damage scaled by impact speed. */
function onImpact(speed: number, at: { x: number; y: number; nx: number; ny: number }): void {
  if (speed < 3 || G.crashCd > 0) return;
  G.crashCd = 0.3;
  const k = clamp((speed - 4) / 30, 0, 1);
  for (let i = 0; i < 4 + k * 18; i++) {
    const a = Math.atan2(at.ny, at.nx) + jitter(2.4), sp = 8 + Math.random() * 30 * (0.4 + k);
    spawn({ kind: 'dot', x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.5 });
  }
  if (speed < 9) { sfx('scrape', 0.4 + k); return; }
  G.shake = Math.max(G.shake, 1.5 + k * 5);
  sfx('crash', 0.6 + k * 0.7, 1.1 - k * 0.3);
  for (let i = 0; i < 3 + k * 10; i++) {
    const a = Math.random() * 6.28, sp = 6 + Math.random() * 22;
    spawn({ kind: 'debris', x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + Math.random() * 1.5 });
  }
  if (speed <= 11) return;
  const dmg = Math.round((speed - 11) * 1.7 * (1 - 0.12 * G.up.hull));
  if (dmg <= 0 || G.god) return;
  G.boat.hp -= dmg;
  toast(`-${dmg} hull`, 'bad');
  if (G.boat.hp <= 0) sink();
  else if (G.boat.hp < hpMax() * 0.3) toast('Hull critical. Repair at a port', 'bad');
}

export function physicsStep(dt: number): void {
  const b = G.boat, bd = boatDef();
  b.px = b.x; b.py = b.y; b.pa = b.a;
  const thr = inp.up() ? 1 : 0, rev = inp.down() ? 1 : 0;
  const steer = ((inp.right() ? 1 : 0) - (inp.left() ? 1 : 0)) * (G.fish ? 0.6 : 1);   // you can still turn with a line out
  if (G.fish && (thr || rev)) cancelFishing('Reeled in');
  // forward / sideways velocity in the boat frame; shallow water drags harder
  let c = Math.cos(b.a), s = Math.sin(b.a);
  let vf = b.vx * c + b.vy * s, vs = -b.vx * s + b.vy * c;
  const shallow = clamp((hBil(b.x, b.y) + 0.1) / 0.09, 0, 1), k = 0.6 * bd.accel;
  vf *= Math.exp(-(k + 2.2 * shallow) * dt);
  vs *= Math.exp(-(3.2 + 3 * shallow) * dt);
  let push = 20 * speedMul() * bd.accel;
  if (bd.prop === 'SAIL') push *= sailEff(b.a) * (1 + 0.3 * WX.wind);
  if (!G.fish) vf += (thr * push - rev * push * 0.45) * dt;
  const turnT = steer * 1.25 * bd.turn * (0.6 + 0.4 * Math.min(1, Math.abs(vf) / 22));
  b.w += (turnT - b.w) * (1 - Math.exp(-4 * dt));
  b.a += b.w * dt;
  c = Math.cos(b.a); s = Math.sin(b.a);
  b.vx = vf * c - vs * s; b.vy = vf * s + vs * c;
  // storm gusts push the boat unless it is anchored; long hulls and storm keels resist
  const anchored = G.up.anchor > 0 && (G.fish || Math.hypot(b.vx, b.vy) < 6) && !thr && !rev;
  if (WX.wind > 0.3 && !anchored) {
    const wa = windAngle();
    const gust = (WX.wind - 0.3) * 10 * (0.6 + 0.4 * Math.sin(G.t * 0.8)) * 13.5 / bd.L * Math.max(0, 1 - 0.5 * keelLvl());
    b.vx += Math.cos(wa) * gust * dt; b.vy += Math.sin(wa) * gust * dt;
  }
  b.x += b.vx * dt; b.y += b.vy * dt;
  contacts();
  G.throttle = thr || rev;
  if (bd.id === 'row' && !G.fish) rowOars(dt, thr, rev, steer);
}

// Each oar has its own stroke: forward rows both; turning right pulls the left oar while the right one rests
// (and the other way round); rowing ahead while turning works the outer oar harder.
function rowOars(dt: number, thr: number, rev: number, steer: number): void {
  const b = G.boat;
  const pace = 0.75 * (0.85 + 0.15 * speedMul()), back = rev && !thr;
  const rate = (side: number): number => {
    const outer = steer && side === -steer;
    if (back) return -0.7;
    if (thr) return steer ? (outer ? 1 : 0.45) : 1;
    return steer && outer ? 1.05 : 0;
  };
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'phaseL' : 'phaseR', prev = b[key] ?? 0.5, r = rate(side);
    if (r) b[key] = prev + dt * pace * r;
    else b[key] = Math.abs(frac(prev) - 0.5) > 0.03 ? prev + dt * pace : prev;          // drift back to rest
    if (r && Math.floor(prev) !== Math.floor(b[key])) {                                  // the blade bites the water
      const [x, y] = toWorld(back ? -OAR.sweep : OAR.sweep, side * OAR.reach);
      spawn({ kind: 'ring', x, y, life: 1.1, r0: 1, grow: 6 });
      burst('dot', x, y, 4, 14, 0.45);
      sfx('oar', 0.65, 1, side * 0.35);
    }
  }
  b.phase = b.phaseR;
}

export function sink(): void {
  G.mode = 'sunk'; G.sunkT = 0; sfx('sink');
  const fee = Math.min(G.coins, 5 + Math.min(40, Math.round(G.coins * 0.04)));   // a small tow fee; the catch is kept
  G.coins -= fee; G.fish = null;
  G.sunkMsg = `The harbour tug tows you home. Your catch is safe${fee ? `, and the tow cost $${fee}` : ''}`;
  burst('debris', G.boat.x, G.boat.y, 30, 40, () => 2 + Math.random() * 2);
}
