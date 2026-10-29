// Fish schools in the water: their fish mill about a slowly wandering centre (loose flocking, never into the
// shallows), a fast engine scatters them or, done recklessly, sends them diving, and fished schools thin out
// and fill back in one fish at a time.
import { FISH_SHORE, GOLD_SCHOOLS, SWIM, TS, hAt, hasTile, heightAt, schoolsNear, type Swimmer } from '../world';
import { SPECIES, activeAt } from '../econ';
import { schoolLook } from '../species';
import { sfx } from '../audio';
import type { FightStyle, FishRole, School } from '../types';
import { W, H, frac, wrapAngle } from '../config';
import { G } from './state';
import { boatDef, env } from './rules';
import { burst, spawn, toast } from './feedback';
import { separateFish, shoalPositions, type FishBody } from './shoal';
import { advanceDive } from './diving';

/** Only an engine at a fair clip, passing almost over the fish, scares them. Sails and oars never do. */
const SCARE = { speed: 38, dist: 24 };
/** A scattered school regroups after SCATTER_S; a third scare before the first is half forgotten makes it dive for DIVE_S. */
export const SCATTER_S = 5, DIVE_S = 40;
const DIVE_HEAT = 2.5, HEAT_FADE_S = 60;
/** One fish returns to a fished school this often (the Old One takes much longer). */
const REFILL_S = 35, BOSS_REFILL_S = 1200;
const refillS = (s: { boss?: boolean }): number => s.boss ? BOSS_REFILL_S : REFILL_S;

/** A predator under a bait ball attacks it in bursts: about every ATTACK_S seconds, for ATTACK_ON seconds. */
const ATTACK_S = 11, ATTACK_ON = 2.6;
/**
 * How far through an attack on this bait ball (or by this predator) it is: 0..1, or -1 between attacks or when either
 * school isn't there to take part. Each pair keeps its own beat.
 */
export function attackK(s: School): number {
  const h = s.prey ? s : s.hunter, prey = h?.prey;
  if (!h || !prey || h.stock <= 0 || !schoolShown(h) || !schoolShown(prey) || scattered(h) || scattered(prey)) return -1;
  const per = ATTACK_S * (0.8 + frac(h.ph) * 0.4), c = G.t / per + frac(h.ph * 7), f = (c - Math.floor(c)) * per;
  return f < ATTACK_ON ? f / ATTACK_ON : -1;
}
/** Scattered within the last `within` seconds (by default: still regrouping). */
const scattered = (s: School, within = SCATTER_S): boolean => s.scatterT !== undefined && G.t - s.scatterT < within;
const dived = (s: School): boolean => (s.spooked ?? 0) > G.t;
/** Whether conditions allow this school to stay near the surface; actual depth changes gradually. */
export const schoolShown = (s: School): boolean => activeAt(s.sp, env()) && !dived(s);
/** The school will take a bait right now. */
export const schoolActive = (s: School): boolean => s.stock > 0 && schoolShown(s) && (s.submergence ?? 0) < 0.25 && !scattered(s);
type SchoolMood = 'biting' | 'scattered' | 'empty';
export const schoolMood = (s: School): SchoolMood => scattered(s) ? 'scattered' : s.stock > 0 ? 'biting' : 'empty';

const nearScratch: School[] = [];
/** Schools are drawn out well past the corners of the view, so even a fast boat only meets them off screen. */
export const schoolDrawR = (): number => Math.max(240, Math.hypot(W, H) / 2 + 90);
/**
 * Fish swim in every school around the view (whatever the screen, so the sea stays alive behind menus), a margin past
 * where they are drawn. Centred on the view, not the boat: a fast boat's camera runs ahead of it.
 */
export function swimSchools(dt: number): void {
  const n = Math.min(4, Math.ceil(dt / SWIM_STEP - 1e-6)), step = dt / Math.max(1, n);
  const schools = schoolsNear(G.cam.x + W / 2, G.cam.y + H / 2, Math.max(320, schoolDrawR() + 80), nearScratch);
  for (const s of schools) {
    const surfaced = G.fish?.s === s || (s.stock > 0 && schoolShown(s));
    s.submergence = advanceDive(s.submergence ?? (surfaced ? 0 : 1), surfaced, dt);
    if (!s.boss) for (let i = 0; i < n; i++) swim(s, step);
  }
  const bodies: FishBody[] = [];
  for (const s of schools) {
    if (s.boss || s.stock <= 0 || (s.submergence ?? 0) >= 1) continue;
    const look = schoolLook(s.sp), count = Math.max(1, Math.round((look.count + (G.frenzy?.s === s ? 2 : 0)) * Math.min(1, s.stock / Math.max(1, s.max))));
    for (const point of (s.swim ?? []).slice(0, count)) bodies.push({ point, radius: look.body * 0.28 });
  }
  separateFish(bodies, (x, y) => depthAt(x, y) <= FISH_SHORE);
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
  if (!s.respawn || s.respawn < G.t) s.respawn = G.t + refillS(s);
}
// catch up on every fish due since the boat was last near
function refill(s: School): void {
  const gap = refillS(s);
  while (s.respawn && G.t >= s.respawn && s.stock < s.max) {
    s.stock++;
    s.respawn = s.stock < s.max ? s.respawn + gap : 0;
    if (s.stock === s.max && !s.boss && !SPECIES[s.sp].legend) s.gold = Math.random() < GOLD_SCHOOLS;
  }
}
const scareable = (s: School): boolean =>
  !s.boss && schoolShown(s) && G.frenzy?.s !== s && G.fish?.s !== s && !scattered(s, SCATTER_S * 0.6);
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
    toast(`The ${name} swam deep. Go slower near fish`, 'bad');
  } else if (G.spookCd <= 0) {
    G.spookCd = 30;
    toast(`Your engine scared the ${name}. Slow down`);
  }
}

// ---------- swimming ----------
/** Cruising speed and how often a fish picks a new line, by fight style; bottom fish idle along slower still. */
const CRUISE: Record<FightStyle, number> = { steady: 3.5, darter: 5, generic: 5, jumper: 5.5, erratic: 5.5, boss: 3 };
const TURN_S: Record<FightStyle, number> = { steady: 4, darter: 2.5, generic: 3, jumper: 3, erratic: 1.2, boss: 5 };
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
/** Per role, overriding the fight style's cruise: drifters hang, bottom fish and crabs mostly sit; and how hard a school
 *  circles its centre (bait balls wheel tightly, giants patrol a wide loop). */
const ROLE_CRUISE: Partial<Record<FishRole, number>> = { bait: 6, drifter: 1.6, bottom: 2.4, crawler: 1.4, giant: 4.5 };
const SWIRL: Partial<Record<FishRole, number>> = { bait: 1.5, giant: 0.7, hunter: 0.35 };
// darters dash and pause, erratic fish surge and dawdle, the rest ease between a little slower and faster; bottom fish
// lie still with now and then a short glide, crabs scuttle and stop
function rhythm(style: FightStyle, role: FishRole, cruise: number, f: Swimmer): number {
  if (role === 'bottom') return frac(G.t * 0.07 + f.ph) < 0.12 ? cruise : cruise * 0.04;
  if (role === 'crawler') return frac(G.t * 0.3 + f.ph) < 0.35 ? cruise : 0;
  if (style === 'darter') return frac(G.t * 0.6 + f.ph) < 0.18 ? cruise * 3 : cruise * 0.35;
  if (style === 'erratic') return cruise * (0.5 + Math.abs(Math.sin(G.t * 1.3 + f.ph * 2.1)) * 1.2);
  return cruise * (0.8 + 0.3 * Math.sin(G.t * 0.4 + f.ph));
}
function spawnSwimmers(s: School): Swimmer[] {
  const look = schoolLook(s.sp), cruise = CRUISE[SPECIES[s.sp].fight];
  const positions = shoalPositions(s, look.radius, look.count + 2, look.body * 0.56, s.ph,
    (x, y) => depthAt(x, y) <= FISH_SHORE);
  return positions.map(({ x, y }, k) => {
    const a = Math.atan2(y - s.y, x - s.x);
    return { x, y, vx: -Math.sin(a) * cruise, vy: Math.cos(a) * cruise, h: a + Math.PI / 2,
      ph: s.ph + k * 0.37, turn: k * 0.4, bias: 0 };
  });
}
/** The swim runs in steps of at most SWIM_STEP seconds whatever the frame rate, so a slow frame never throws fish about. */
const SWIM_STEP = 1 / 60;
/** How fast a fish can change speed (units/s²), calm and when scared or in an attack. */
const ACCEL = 30, ACCEL_FLEE = 110;
/** heading h turned toward `to` by at most `rate` radians */
const turnToward = (h: number, to: number, rate: number): number => wrapAngle(h + Math.max(-rate, Math.min(rate, wrapAngle(to - h))));
/**
 * Loose flocking, steered: each fish is drawn to the school's wandering centre (firmly once past the school's radius),
 * keeps clear of its neighbours, matches their heading, leans into its own turns now and then, and swims at its
 * species' rhythm. The sum of those is where it would like to go; it gets there by turning its heading at a fish's pace
 * and swimming forward along it, so it bends through turns and never slides sideways or flips round. It feels ahead for
 * shallows the length of its body and turns down the slope into deeper water; no part of it is ever moved over water
 * shallower than FISH_SHORE, and past the edge of the school's water it turns firmly home (so schools never mingle).
 */
function swim(s: School, dt: number): void {
  const look = schoolLook(s.sp), role = look.role, style = look.bottom ? 'steady' : SPECIES[s.sp].fight, fish = s.swim ??= spawnSwimmers(s);
  let cx = s.x + Math.cos(G.t * 0.11 + s.ph) * SWIM.wander, cy = s.y + Math.sin(G.t * 0.083 + s.ph * 2) * SWIM.wander;
  // the boat nearby: bait and shoals edge away from it, hunters and giants come for a look at a slow one
  const b = G.boat, bx = s.x - b.x, by = s.y - b.y, bd = Math.hypot(bx, by) || 1, slow = Math.hypot(b.vx, b.vy) < 15;
  const shy = role === 'bait' || role === 'shoal' || role === 'drifter', near = look.radius + 18;
  if (shy && bd < near) { const k = Math.min(SWIM.scatter, near - bd) / bd; cx += bx * k; cy += by * k; }
  else if ((role === 'hunter' || role === 'giant') && slow && bd < 70 && bd > 12) { const k = Math.min(SWIM.scatter, (70 - bd) * 0.2) / bd; cx -= bx * k; cy -= by * k; }
  // an attack: the predators drive into the bait ball, which bursts outward and flickers, then packs again
  const atk = attackK(s), hunting = atk >= 0 && !!s.prey, burst = atk >= 0 && !!s.hunter ? Math.sin(Math.PI * atk) : 0;
  if (hunting) { cx = s.prey!.x; cy = s.prey!.y; }
  const age = s.scatterT === undefined ? 99 : G.t - s.scatterT, hold = Math.min(1, age / SCATTER_S) ** 2;   // cohesion returns as a scatter wears off
  const R = look.radius, reach = (hunting ? Math.hypot(s.prey!.x - s.x, s.prey!.y - s.y) + schoolLook(s.prey!.sp).radius : 0) + R + SWIM.wander + SWIM.scatter;
  const sep = look.space, cruise = (ROLE_CRUISE[role] ?? CRUISE[style]) * (hunting ? 2.6 : 1);
  const swirl = (SWIRL[role] ?? 0) * cruise * hold * (frac(s.ph) < 0.5 ? 1 : -1);   // each school wheels its own way
  const hook = G.fish?.s === s && G.fish.st === 'reel' ? G.fish : null;
  const sep2 = sep * sep, near2 = 9 * sep2, half = look.body * 0.5;
  const fleeing = age < 1 || burst > 0, amax = fleeing ? ACCEL_FLEE : ACCEL, top = fleeing ? 30 : cruise * 3;
  for (const f of fish) {
    // a bait ball packs tight and wheels fastest at its rim; other schools only gather in once they stray past the radius
    const dx = cx - f.x, dy = cy - f.y, d = Math.sqrt(dx * dx + dy * dy) || 1e-3, sw = swirl * Math.min(1, d / R);
    const od = Math.hypot(f.x - s.x, f.y - s.y), pull = (od > reach ? 8 : d > R ? 2.2 : role === 'bait' ? 0.9 : 0.35) * (od > reach ? 1 : hold);
    let ax = dx * pull - dy / d * sw, ay = dy * pull + dx / d * sw, nvx = 0, nvy = 0, nn = 0;
    for (const o of fish) {                                 // squared distances first: most pairs are neither close nor near
      if (o === f) continue;
      const ex = f.x - o.x, ey = f.y - o.y, e2 = ex * ex + ey * ey;
      if (e2 >= near2) continue;
      nvx += o.vx; nvy += o.vy; nn++;
      if (e2 < sep2 && e2 > 1e-6) { const e = Math.sqrt(e2), k = (sep - e) * 4 / e; ax += ex * k; ay += ey * k; }
    }
    if (nn) { ax += (nvx / nn - f.vx) * 0.6; ay += (nvy / nn - f.vy) * 0.6; }
    if (burst > 0) { ax -= dx / d * burst * 40; ay -= dy / d * burst * 40; }
    if (hook?.fx !== undefined && hook.fy !== undefined) {   // give the hooked fish room
      const ex = f.x - hook.fx, ey = f.y - hook.fy, e = Math.sqrt(ex * ex + ey * ey);
      if (e < 8 && e > 1e-3) { ax += ex / e * (8 - e) * 6; ay += ey / e * (8 - e) * 6; }
    }
    if ((f.turn -= dt) <= 0) { f.turn = TURN_S[style] * (0.6 + Math.random() * 0.8); f.bias = Math.random() * 2 - 1; }
    const hx = Math.cos(f.h), hy = Math.sin(f.h), v = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    ax -= hy * f.bias * cruise * 0.5; ay += hx * f.bias * cruise * 0.5;
    if (age > 0.4) { const dv = (rhythm(style, role, cruise, f) - v) * 2; ax += hx * dv; ay += hy * dv; }
    // shallows ahead (a body length and a bit): turn down the slope, and ease off
    const ahead = half + 3 + v * 0.5;
    if (depthAt(f.x + hx * ahead, f.y + hy * ahead) > FISH_SHORE - 0.02) {
      const gx = depthAt(f.x + 3, f.y) - depthAt(f.x - 3, f.y), gy = depthAt(f.x, f.y + 3) - depthAt(f.x, f.y - 3), g = Math.hypot(gx, gy);
      const ux = g > 1e-4 ? -gx / g : dx / d, uy = g > 1e-4 ? -gy / g : dy / d;
      ax += ux * 40 - hx * v; ay += uy * 40 - hy * v;
    }
    const a = Math.hypot(ax, ay);
    if (a > amax) { ax *= amax / a; ay *= amax / a; }
    f.vx += ax * dt; f.vy += ay * dt;
    let spd = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
    if (spd > top) { f.vx *= top / spd; f.vy *= top / spd; spd = top; }
    // the heading turns toward where it would go, quicker the faster the fish (a dart turns on the spot, a giant sweeps)
    if (spd > 0.25) {
      const rate = (role === 'giant' ? 0.8 : 1.8 + spd * 0.25) * (fleeing ? 2 : 1) * dt;
      f.h = turnToward(f.h, Math.atan2(f.vy, f.vx), rate);
    }
    const nhx = Math.cos(f.h), nhy = Math.sin(f.h), x = f.x + nhx * spd * dt, y = f.y + nhy * spd * dt;
    const k = Math.min(1, 4 * dt);                          // it swims the way it faces; where it means to go follows that
    f.vx += (nhx * spd - f.vx) * k; f.vy += (nhy * spd - f.vy) * k;
    // never into the shallows, nose or body: turn in place toward home instead (a fish somehow already there may still
    // swim out into deeper water)
    const here = depthAt(f.x, f.y), there = depthAt(x, y);
    if ((there > FISH_SHORE && there >= here) || (here <= FISH_SHORE && depthAt(x + nhx * half, y + nhy * half) > FISH_SHORE)) {
      f.h = turnToward(f.h, Math.atan2(s.y - f.y, s.x - f.x), 3 * dt);
      f.vx *= 0.5; f.vy *= 0.5;
      continue;
    }
    f.x = x; f.y = y;
  }
}
