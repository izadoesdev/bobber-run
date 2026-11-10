// Cannonballs, mortar shells and powder kegs: shot fired on an arc at where the target will be when it gets there,
// splashing into the sea, kicking up sand on land, or cracking into a hull (game/pirates.ts decides what a hit does).
// Every ball knows where it will come down, so the HUD can mark the spot and pirates can steer out of the way.
import { hAt } from '../world';
import { spawn, burst } from './feedback';
import { sfx } from '../audio';
import type { ShotKind } from './arms';
import type { Point } from '../types';

/** Who fired: your shot only hurts pirates, and theirs only you. */
export type Gunner = 'player' | 'pirate';
export interface Ball {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  from: Gunner; dmg: number; shot: ShotKind;
  /** a mortar shell bursts over this radius where it lands (balls hit only what they strike) */
  splash: number;
  /** where and when (game seconds from launch) it comes down, and seconds flown so far */
  lx: number; ly: number; flight: number; t: number;
}
/** A powder keg bobbing where it was dropped: armed after a moment, it blows when an enemy hull comes within reach. */
export interface Keg { x: number; y: number; from: Gunner; dmg: number; reach: number; t: number; ph: number }
/** Horizontal speed of a ball and the pull that brings it down, in world units (short, visible arcs). */
export const BALL_SPEED = 150, GRAVITY = 70;
/** Muzzle height above the water: shot leaves the rail at this z. */
const MUZZLE_Z = 3;
/** Seconds a keg floats before it sinks unexploded, and before it's armed. */
export const KEG_LIFE = 45, KEG_ARM = 1.2;

/**
 * Where a ball at `speed` from (sx, sy) meets a target at (tx, ty) moving at (tvx, tvy): the intercept point and the
 * flight time. When the ball can't catch the target, it leads her by the time the ball takes to cover today's range.
 */
export function leadPoint(sx: number, sy: number, tx: number, ty: number, tvx: number, tvy: number, speed = BALL_SPEED): Point & { t: number } {
  const dx = tx - sx, dy = ty - sy;
  // |d + v t| = speed t  ->  (v.v - s^2) t^2 + 2 (d.v) t + d.d = 0
  const a = tvx * tvx + tvy * tvy - speed * speed, b = 2 * (dx * tvx + dy * tvy), c = dx * dx + dy * dy;
  let t = Math.sqrt(c) / speed;
  if (Math.abs(a) > 1e-6) {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc), t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
      const best = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
      if (Number.isFinite(best)) t = best;
    }
  }
  return { x: tx + tvx * t, y: ty + tvy * t, t };
}
/** Seconds a mortar shell takes to come down `d` away: a high, slow lob. */
export const shellTime = (d: number): number => 1.5 + d / 260;

/**
 * Shot from (x, y) that comes down on (ax, ay): a ball flies flat at `speed`; a mortar shell (splash > 0) is lobbed
 * high and takes shellTime to land.
 */
export function launch(balls: Ball[], from: Gunner, x: number, y: number, ax: number, ay: number, dmg: number, shot: ShotKind = 'round', splash = 0, speed = BALL_SPEED): Ball {
  const dx = ax - x, dy = ay - y, d = Math.max(1, Math.hypot(dx, dy)), t = splash ? shellTime(d) : d / speed;
  const ball: Ball = { x, y, z: MUZZLE_Z, vx: dx / t, vy: dy / t, vz: (GRAVITY * t * t / 2 - MUZZLE_Z) / t, from, dmg, shot, splash, lx: ax, ly: ay, flight: t, t: 0 };
  balls.push(ball);
  return ball;
}

/** Where a ball comes down if nothing stops it. */
export function landingPoint(b: Ball): Point {
  const t = (b.vz + Math.sqrt(b.vz * b.vz + 2 * GRAVITY * b.z)) / GRAVITY;   // z + vz t - g t^2 / 2 = 0
  return { x: b.x + b.vx * t, y: b.y + b.vy * t };
}

/** The flash and smoke of a gun going off at (x, y), its shot heading along angle a; `big` for a mortar. */
export function muzzle(x: number, y: number, a: number, vol: number, big = false): void {
  const n = big ? 9 : 5, sp = big ? 50 : 30;
  for (let k = 0; k < n; k++) {
    const d = a + (Math.random() - 0.5) * (big ? 1.4 : 0.6), v = sp + Math.random() * sp;
    spawn({ kind: 'spark', x, y, vx: Math.cos(d) * v, vy: Math.sin(d) * v, life: 0.18 + Math.random() * 0.14 });
  }
  for (let k = 0; k < (big ? 6 : 3); k++) spawn({ kind: 'smoke', x: x + Math.cos(a) * 3, y: y + Math.sin(a) * 3, z: 3, vx: Math.cos(a) * 12 + (Math.random() - 0.5) * 8, vy: Math.sin(a) * 12 + (Math.random() - 0.5) * 8, vz: 4 + Math.random() * 5, size: (big ? 3.4 : 2.4) + Math.random() * 1.4, dark: 0.1, life: 1.6 + Math.random() * 0.9 });
  if (vol > 0.02) sfx(big ? 'mortar' : 'cannon', vol);
}
/** A blast on the water at (x, y): a powder keg or a mortar shell going off, sized by radius r. */
export function blast(x: number, y: number, r: number, vol: number): void {
  spawn({ kind: 'ring', x, y, life: 1.1, r0: 2, grow: r * 1.6 });
  spawn({ kind: 'ring', x, y, life: 0.7, r0: 1, grow: r });
  for (let k = 0; k < 14; k++) spawn({ kind: 'spout', x: x + (Math.random() - 0.5) * r * 0.6, y: y + (Math.random() - 0.5) * r * 0.6, z: 0.5, vx: (Math.random() - 0.5) * 16, vy: -(4 + Math.random() * 8), vz: 16 + Math.random() * 14, life: 0.8 + Math.random() * 0.4 });
  for (let k = 0; k < 12; k++) { const d = Math.random() * 6.28, v = 20 + Math.random() * 40; spawn({ kind: 'spark', x, y, vx: Math.cos(d) * v, vy: Math.sin(d) * v, life: 0.3 + Math.random() * 0.3 }); }
  for (let k = 0; k < 5; k++) spawn({ kind: 'smoke', x, y, z: 2, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, vz: 6 + Math.random() * 6, size: 3.5 + Math.random() * 2, dark: 0.45, life: 2 + Math.random() });
  if (vol > 0.02) sfx('explode', vol);
}

/**
 * Move every ball on by dt. `hit` is asked about each ball low enough to strike a hull and says whether it struck one
 * (it handles the damage and the splinters); a shell's burst is `burstAt`'s to resolve. Balls that come down
 * anywhere else splash or thud and are gone.
 */
export function stepBalls(balls: Ball[], dt: number, hit: (b: Ball) => boolean, burstAt: (b: Ball) => void, hear: (x: number, y: number) => number): void {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vz -= GRAVITY * dt; b.t += dt;
    if (b.shot === 'fire' && Math.random() < dt * 30) spawn({ kind: 'spark', x: b.x, y: b.y, z: b.z, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 0.25 });
    if (b.splash && Math.random() < dt * 20) spawn({ kind: 'smoke', x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 1, size: 1.2, dark: 0.2, life: 0.6 });
    if (!b.splash && b.z < 6 && hit(b)) { balls.splice(i, 1); continue; }
    if (b.z > 0) continue;
    balls.splice(i, 1);
    if (b.splash) { burstAt(b); continue; }
    const vol = hear(b.x, b.y);
    if (hAt(b.x, b.y) > 0) {                                     // into the sand or rock
      burst('debris', b.x, b.y, 5, 18, 0.7);
      if (vol > 0.05) sfx('scrape', vol * 0.6);
    } else {
      spawn({ kind: 'ring', x: b.x, y: b.y, life: 0.9, r0: 1.5, grow: 9 });
      for (let k = 0; k < (b.shot === 'grape' ? 2 : 6); k++) spawn({ kind: 'spout', x: b.x + (Math.random() - 0.5) * 3, y: b.y + (Math.random() - 0.5) * 3, z: 0.5, vx: (Math.random() - 0.5) * 8, vy: -(3 + Math.random() * 5), vz: 10 + Math.random() * 8, life: 0.6 + Math.random() * 0.3 });
      burst('dot', b.x, b.y, b.shot === 'grape' ? 2 : 7, 26, 0.6);
      if (vol > 0.05 && b.shot !== 'grape') sfx('splash', vol * 0.8);
    }
  }
}
/** Kegs sink when old, and blow when `near` says an enemy hull is within reach (their bob on the swell is only drawn). */
export function stepKegs(kegs: Keg[], dt: number, near: (k: Keg) => boolean, blow: (k: Keg) => void): void {
  for (let i = kegs.length - 1; i >= 0; i--) {
    const k = kegs[i];
    k.t += dt;
    if (k.t > KEG_LIFE) { kegs.splice(i, 1); continue; }
    if (k.t > KEG_ARM && near(k)) { kegs.splice(i, 1); blow(k); }
  }
}
