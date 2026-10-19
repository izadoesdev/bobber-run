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
    LIFE.pods.push({ t: 0, m: [0, 1, 2].map(k => ({ side: k % 2 ? 1 : -1, off: 12 + k * 6, ph: k * 0.37, lead: 8 + k * 6 })) });
  }
  LIFE.pods = LIFE.pods.filter(p => (p.t += dt) < 11);
}
