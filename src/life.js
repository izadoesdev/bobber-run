// Ambient sea life: whales that surface and spout, dolphin pods that race fast boats.
import { G, spawn } from './game.js';
import { hAt } from './world.js';
import { W, H } from './config.js';
import { WX } from './weather.js';

export const LIFE = { whales: [], pods: [], nextWhale: 35, nextPod: 12 };
export function updateLife(dt) {
  if (G.mode !== 'play') return;
  const b = G.boat, sp = Math.hypot(b.vx, b.vy);
  for (let n = WX.rain * 40 * dt; n > 0; n--) if (Math.random() < n) { const x = G.cam.x + Math.random() * W, y = G.cam.y + Math.random() * H; if (hAt(x, y) < -0.03) spawn({ kind: 'ring', x, y, life: 0.5, r0: 0, grow: 2 }); }
  if ((LIFE.nextWhale -= dt) <= 0) {
    LIFE.nextWhale = 55 + Math.random() * 80;
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * 6.28, d = 70 + Math.random() * 90, x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
      if (hAt(x, y) < -0.38 && hAt(x + 24, y) < -0.36 && hAt(x - 24, y) < -0.36) { LIFE.whales.push({ x, y, dir: Math.random() < 0.5 ? -1 : 1, t: 0, sp: 0 }); break; }
    }
  }
  for (const w of LIFE.whales) {
    w.t += dt; w.x += w.dir * 4 * dt;
    if ((w.t > 2 && w.sp < 1) || (w.t > 5.5 && w.sp < 2)) { w.sp++; for (let i = 0; i < 16; i++) spawn({ kind: 'spout', x: w.x + w.dir * 6 + (Math.random() - 0.5) * 2, y: w.y - 2, vx: (Math.random() - 0.5) * 7, vy: -(16 + Math.random() * 12), life: 0.8 + Math.random() * 0.5 }); }
    if (w.t > 1.2 && w.t < 8 && Math.random() < dt * 3) spawn({ kind: 'ring', x: w.x + (Math.random() - 0.5) * 14, y: w.y + 2, life: 0.9, r0: 2, grow: 4 });
  }
  LIFE.whales = LIFE.whales.filter(w => w.t < 10);
  if ((LIFE.nextPod -= dt) <= 0 && sp > 20 && hAt(b.x, b.y) < -0.3) {
    LIFE.nextPod = 45 + Math.random() * 60;
    // dolphins arrive from one side, each with its own position and velocity
    const c = Math.cos(b.a), s = Math.sin(b.a), from = Math.random() < 0.5 ? -1 : 1;
    LIFE.pods.push({ t: 0, m: [0, 1, 2].map(k => {
      const side = k % 2 ? 1 : -1, x = b.x - c * 30 - s * from * (40 + k * 8), y = b.y - s * 30 + c * from * (40 + k * 8);
      return { side, off: 10 + k * 6, lead: 6 + k * 7, ph: k * 0.37 + Math.random() * 0.2, x, y, vx: b.vx, vy: b.vy, a: b.a, wv: Math.random() * 6 };
    }) });
  }
  // each dolphin steers toward a loose slot beside the bow; it has its own speed and heading,
  // so the pod lags behind turns, overtakes, weaves, and peels away at the end
  const c = Math.cos(b.a), s = Math.sin(b.a);
  for (const p of LIFE.pods) for (const m of p.m) {
    const leave = p.t > 8.5 ? (p.t - 8.5) * 18 : 0, weave = Math.sin(p.t * 0.9 + m.wv) * 5;
    const lead = m.lead + Math.sin(p.t * 0.7 + m.ph) * 5, off = m.side * (m.off + weave + leave);
    const tx = b.x + c * lead - s * off + b.vx * 0.35, ty = b.y + s * lead + c * off + b.vy * 0.35;
    let ax = (tx - m.x) * 2.2 + (b.vx - m.vx) * 1.4, ay = (ty - m.y) * 2.2 + (b.vy - m.vy) * 1.4;
    const al = Math.hypot(ax, ay), amax = 70; if (al > amax) { ax *= amax / al; ay *= amax / al; }
    m.vx += ax * dt; m.vy += ay * dt;
    const v = Math.hypot(m.vx, m.vy), vmax = Math.max(30, Math.hypot(b.vx, b.vy) * 1.45); if (v > vmax) { m.vx *= vmax / v; m.vy *= vmax / v; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (v > 2) { let d = Math.atan2(m.vy, m.vx) - m.a; d = Math.atan2(Math.sin(d), Math.cos(d)); m.a += d * Math.min(1, dt * 5); }
  }
  LIFE.pods = LIFE.pods.filter(p => (p.t += dt) < 11);
}
