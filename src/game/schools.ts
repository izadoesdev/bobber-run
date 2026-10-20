// Fish schools in the water: their fish mill about a slowly wandering centre (loose flocking, never into the
// shallows), a fast engine scatters them or, done recklessly, sends them diving, and fished schools thin out
// and fill back in one fish at a time.
import { FISH_SHORE, GOLD_SCHOOLS, SWIM, TS, hAt, hasTile, heightAt, schoolsNear, type Swimmer } from '../world';
import { SPECIES, activeAt } from '../econ';
import { schoolLook } from '../species';
import { sfx } from '../audio';
import type { FightStyle, School } from '../types';
import { W, H } from '../config';
import { G } from './state';
import { boatDef, env } from './rules';
import { burst, spawn, toast } from './feedback';

/** Only an engine at a fair clip, passing almost over the fish, scares them. Sails and oars never do. */
const SCARE = { speed: 38, dist: 24 };
/** A scattered school regroups after SCATTER_S; a third scare before the first is half forgotten makes it dive for DIVE_S. */
export const SCATTER_S = 5, DIVE_S = 40;
const DIVE_HEAT = 2.5, HEAT_FADE_S = 60;
/** One fish returns to a fished school this often (the Old One takes much longer). */
const REFILL_S = 35, BOSS_REFILL_S = 1200;

export const scattered = (s: School): boolean => s.scatterT !== undefined && G.t - s.scatterT < SCATTER_S;
const dived = (s: School): boolean => (s.spooked ?? 0) > G.t;
/** The school is in the water to be seen: its species is about, and it hasn't dived. Depleted schools still show a straggler. */
export const schoolShown = (s: School): boolean => activeAt(s.sp, env()) && !dived(s);
/** The school will take a bait right now. */
export const schoolActive = (s: School): boolean => s.stock > 0 && schoolShown(s) && !scattered(s);
export type SchoolMood = 'biting' | 'scattered' | 'empty';
export const schoolMood = (s: School): SchoolMood => scattered(s) ? 'scattered' : s.stock > 0 ? 'biting' : 'empty';

const nearScratch: School[] = [];
/** Schools are drawn out to just past the corners of the view, so new ones always come in from off screen. */
export const schoolDrawR = (): number => Math.max(240, Math.hypot(W, H) / 2 + 30);
/** Fish swim in every school near the boat (whatever the screen, so the sea stays alive behind menus), a margin past where they are drawn. */
export function swimSchools(dt: number): void {
  for (const s of schoolsNear(G.boat.x, G.boat.y, Math.max(320, schoolDrawR() + 80), nearScratch)) if (!s.boss) swim(s, dt);
}
/** While sailing: fished schools refill, and a fast engine passing over one scatters it. */
export function updateSchools(speed: number, dt: number): void {
  const b = G.boat, bd = boatDef(), loud = bd.prop === 'ENGINE' && speed > SCARE.speed;
  for (const s of schoolsNear(b.x, b.y, 260, nearScratch)) {
    refill(s);
    if (s.heat) s.heat = Math.max(0, s.heat - dt / HEAT_FADE_S);
    if (loud && Math.hypot(s.x - b.x, s.y - b.y) < SCARE.dist + bd.B && scareable(s)) scare(s);
  }
}
/** A catch takes a fish from the school; they come back one at a time. */
export function takeFish(s: { stock: number; respawn?: number; boss?: boolean }): void {
  s.stock--;
  if (!s.respawn || s.respawn < G.t) s.respawn = G.t + (s.boss ? BOSS_REFILL_S : REFILL_S);
}
// catch up on every fish due since the boat was last near
function refill(s: School): void {
  const gap = s.boss ? BOSS_REFILL_S : REFILL_S;
  while (s.respawn && G.t >= s.respawn && s.stock < s.max) {
    s.stock++;
    s.respawn = s.stock < s.max ? s.respawn + gap : 0;
    if (s.stock === s.max && !s.boss && !SPECIES[s.sp].legend) s.gold = Math.random() < GOLD_SCHOOLS;
  }
}
const scareable = (s: School): boolean =>
  !s.boss && schoolShown(s) && G.frenzy?.s !== s && G.fish?.s !== s && !(s.scatterT !== undefined && G.t - s.scatterT < SCATTER_S * 0.6);
/** Fish dart away from the boat and regroup; a few reckless passes in a row and the school dives for a while. */
function scare(s: School): void {
  const b = G.boat, name = SPECIES[s.sp].name;
  s.scatterT = G.t;
  s.heat = (s.heat ?? 0) + 1;
  for (const f of s.swim ?? []) {
    const a = Math.atan2(f.y - b.y, f.x - b.x) + (Math.random() - 0.5) * 0.9, v = 18 + Math.random() * 8;
    f.vx = Math.cos(a) * v; f.vy = Math.sin(a) * v;
  }
  spawn({ kind: 'ring', x: s.x, y: s.y, life: 1.2, r0: 2, grow: 14 });
  burst('dot', s.x, s.y, 10, 34, 0.5);
  sfx('splash', 0.35);
  if (s.heat >= DIVE_HEAT) {
    s.spooked = G.t + DIVE_S; s.heat = 0;
    toast(`The ${name} swam deep and won't bite for a while. Go slower near fish`, 'bad');
  } else if (G.spookCd <= 0) {
    G.spookCd = 30;
    toast(`Your engine scared off the ${name}. Slow down and they will come back`);
  }
}

// ---------- swimming ----------
/** Cruising speed and how often a fish picks a new line, by fight style; bottom fish idle along slower still. */
const CRUISE: Record<FightStyle, number> = { steady: 3.5, darter: 5, generic: 5, jumper: 5.5, erratic: 5.5, boss: 3 };
const TURN_S: Record<FightStyle, number> = { steady: 4, darter: 2.5, generic: 3, jumper: 3, erratic: 1.2, boss: 5 };
const frac = (x: number): number => x - Math.floor(x);
/**
 * hAt without its side effect: where the height tile is not built yet, the same value (the tile's float32 height
 * at that integer cell) is computed directly and remembered. Schools far out at the edge of the swim radius would
 * otherwise force whole tiles to be built mid-frame; the renderer's prefetch builds them on its own budget.
 */
const untiled = new Map<number, number>();
function depthAt(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (hasTile(Math.floor(ix / TS), Math.floor(iy / TS))) return hAt(ix, iy);
  const k = (ix + 1e6) * 2e6 + (iy + 1e6);
  let h = untiled.get(k);
  if (h === undefined) {
    if (untiled.size >= 50000) untiled.clear();
    h = Math.fround(heightAt(ix, iy));
    untiled.set(k, h);
  }
  return h;
}
// darters dash and pause, erratic fish surge and dawdle, the rest ease between a little slower and faster
function rhythm(style: FightStyle, cruise: number, f: Swimmer): number {
  if (style === 'darter') return frac(G.t * 0.6 + f.ph) < 0.18 ? cruise * 3 : cruise * 0.35;
  if (style === 'erratic') return cruise * (0.5 + Math.abs(Math.sin(G.t * 1.3 + f.ph * 2.1)) * 1.2);
  return cruise * (0.8 + 0.3 * Math.sin(G.t * 0.4 + f.ph));
}
function spawnSwimmers(s: School): Swimmer[] {
  const look = schoolLook(s.sp), cruise = CRUISE[SPECIES[s.sp].fight], L: Swimmer[] = [];
  for (let k = 0; k < look.count + 2; k++) {
    const a = s.ph + k * 2.4, r = look.radius * (0.3 + 0.5 * frac(k * 0.618));
    let x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    if (depthAt(x, y) > FISH_SHORE) { x = s.x; y = s.y; }      // the home itself is always open water
    L.push({ x, y, vx: -Math.sin(a) * cruise, vy: Math.cos(a) * cruise, ph: s.ph + k * 0.37, turn: k * 0.4, bias: 0 });
  }
  return L;
}
/**
 * Loose flocking: each fish is drawn to the school's wandering centre (firmly once past the school's radius), keeps
 * clear of its neighbours, matches their heading, leans into its own turns now and then, and swims at its species'
 * rhythm. Two hard rules keep it honest: no fish strays past the school's reach (so schools never mingle), and no
 * fish ever moves into water shallower than FISH_SHORE.
 */
function swim(s: School, dt: number): void {
  const look = schoolLook(s.sp), style = look.bottom ? 'steady' : SPECIES[s.sp].fight, fish = s.swim ??= spawnSwimmers(s);
  const cx = s.x + Math.cos(G.t * 0.11 + s.ph) * SWIM.wander, cy = s.y + Math.sin(G.t * 0.083 + s.ph * 2) * SWIM.wander;
  const age = s.scatterT === undefined ? 99 : G.t - s.scatterT, hold = Math.min(1, age / SCATTER_S) ** 2;   // cohesion returns as a scatter wears off
  const R = look.radius, reach = R + SWIM.wander + SWIM.scatter, sep = look.space, cruise = CRUISE[style] * (look.bottom ? 0.6 : 1);
  const hook = G.fish?.s === s && G.fish.st === 'reel' ? G.fish : null;
  const sep2 = sep * sep, near2 = 9 * sep2;
  for (const f of fish) {
    const dx = cx - f.x, dy = cy - f.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-3, pull = (d > R ? 2.2 : 0.35) * hold;
    let ax = dx * pull, ay = dy * pull, nvx = 0, nvy = 0, nn = 0;
    for (const o of fish) {                                 // squared distances first: most pairs are neither close nor near
      if (o === f) continue;
      const ex = f.x - o.x, ey = f.y - o.y, e2 = ex * ex + ey * ey;
      if (e2 >= near2) continue;
      nvx += o.vx; nvy += o.vy; nn++;
      if (e2 < sep2 && e2 > 1e-6) { const e = Math.sqrt(e2), k = (sep - e) * 8 / e; ax += ex * k; ay += ey * k; }
    }
    if (nn) { ax += (nvx / nn - f.vx) * 0.9; ay += (nvy / nn - f.vy) * 0.9; }
    if (hook?.fx !== undefined && hook.fy !== undefined) {   // give the hooked fish room
      const ex = f.x - hook.fx, ey = f.y - hook.fy, e = Math.sqrt(ex * ex + ey * ey);
      if (e < 8 && e > 1e-3) { ax += ex / e * (8 - e) * 6; ay += ey / e * (8 - e) * 6; }
    }
    if ((f.turn -= dt) <= 0) { f.turn = TURN_S[style] * (0.6 + Math.random() * 0.8); f.bias = Math.random() * 2 - 1; }
    const v = Math.sqrt(f.vx * f.vx + f.vy * f.vy) || 1e-3, hx = f.vx / v, hy = f.vy / v;
    ax -= hy * f.bias * cruise * 0.8; ay += hx * f.bias * cruise * 0.8;
    if (age > 0.4) { const dv = (rhythm(style, cruise, f) - v) * 2; ax += hx * dv; ay += hy * dv; }
    if (depthAt(f.x + hx * 5, f.y + hy * 5) > FISH_SHORE - 0.02) { ax += dx / d * 30; ay += dy / d * 30; }   // shallows ahead: turn for home
    f.vx += ax * dt; f.vy += ay * dt;
    const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy), top = age < 1 ? 30 : cruise * 3;
    if (speed > top) { f.vx *= top / speed; f.vy *= top / speed; }
    let x = f.x + f.vx * dt, y = f.y + f.vy * dt;
    const ox = x - s.x, oy = y - s.y, od = Math.sqrt(ox * ox + oy * oy);
    if (od > reach) {                                       // the edge of the school's water: slide along it
      x = s.x + ox / od * reach; y = s.y + oy / od * reach;
      const out = (f.vx * ox + f.vy * oy) / od;
      if (out > 0) { f.vx -= ox / od * out; f.vy -= oy / od * out; }
    }
    if (depthAt(x, y) > FISH_SHORE) { f.vx = dx / d * v * 0.5; f.vy = dy / d * v * 0.5; continue; }   // never into the shallows
    f.x = x; f.y = y;
  }
}
