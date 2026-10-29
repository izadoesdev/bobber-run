import { setCaptionHook } from '../audio';
import { SET } from '../prefs';
import type { ParticleKind, ParticleSpec, Toast, ToastKind } from '../types';
import { G } from './state';

export function caption(s: string): void {
  const c = G.captions.find(q => q.s === s);
  if (c) { c.t = 2.2; return; }
  G.captions.push({ s, t: 2.2 });
  if (G.captions.length > 3) G.captions.shift();
}
setCaptionHook((s: string) => { if (SET.captions) caption(s); });

export function toast(s: string, kind: ToastKind = 'info', scope?: Toast['scope']): void {
  if (G.toasts.some(t => t.s === s && t.kind === kind && t.scope === scope)) return;
  G.toasts.push({ s, kind, t: 2.8, ...(scope ? { scope } : {}) });
  if (G.toasts.length > 3) G.toasts.shift();
}

export function spawn(o: ParticleSpec): void {
  G.parts.push(Object.assign(o, { max: o.life }));
}
/** A random value in [-k/2, k/2). */
export const jitter = (k: number): number => (Math.random() - 0.5) * k;
/** `n` particles flying out of (x, y) with random velocities up to ±speed/2. */
export function burst(kind: ParticleKind, x: number, y: number, n: number, speed: number, life: number | (() => number)): void {
  for (let i = 0; i < n; i++) spawn({ kind, x, y, vx: jitter(speed), vy: jitter(speed), life: typeof life === 'number' ? life : life() });
}
/** A ring of sparks around the boat for purchases and milestones. */
export function celebrate(): void {
  const b = G.boat;
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * 6.28;
    spawn({ kind: 'spark', x: b.x, y: b.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.9 });
  }
}

/** Change the purse; gains count towards lifetime earnings, and both float up by the counter. */
export function addCoins(n: number): void {
  G.coins += n;
  if (n > 0) G.earned += n;
  G.floaters.push({ s: (n >= 0 ? '+$' : '-$') + Math.abs(n), t: 1.4, kind: n >= 0 ? 'good' : 'bad' });
}
/** Mark a shop row as just bought, so the UI can flash it. */
export const markBought = (id: string): void => { G.bought = { id, t: G.t }; };
export const tooPoor = (cost: number): void => toast(`You need $${cost - G.coins} more`, 'bad');
