// Ambient sea life, simulated here and drawn by gl/renderer.ts: whales that dive, spout, breach and tail-slap,
// dolphins racing fast boats, giants passing under the boat, jellyfish swarms and glowing plankton in wakes.
import { G, spawn, toWorld, darkness, windAngle } from './game';
import { hAt, heightAt, hasTile, TS } from './world';
import { W, H, clamp, wrapAngle } from './config';
import { WX } from './weather';
import { BOATS } from './econ';
import { hash, mulberry } from './noise';
import { OAR } from './models';
import { sfx } from './audio';
import { biomeAt, type BiomeId } from './biome';

// ---------------------------------------------------------------- shapes
type WhalePhase = 'swim' | 'surface' | 'breach' | 'dive' | 'slap';
/** a whale circling a still boat out of curiosity: approach ('go'), then one lap ('circle') */
interface Curiosity { st: 'go' | 'circle'; acc: number; last: number; dir: number }
export interface Whale {
  x: number; y: number;
  /** heading */
  a: number;
  /** body height: 0 = back just breaking the surface, negative underwater, up to ~14 at the top of a breach */
  z: number;
  pitch: number; roll: number;
  /** 0..1 how far the fluke is raised out of the water */
  tail: number;
  mouth: number;
  phase: WhalePhase;
  /** time in the current phase */
  t: number;
  /** scale: ~1 for an adult humpback (~26 units long), ~0.55 for a calf */
  size: number;
  // ---- simulation state
  dur: number; sp: number;
  /** target heading */
  ta: number;
  steerT: number;
  /** a calf's mother (calves follow her), null for adults */
  mom: Whale | null;
  spoutT: number; breaches: number; slaps: number; rollDir: number;
  /** depth when the breach launches */
  z0: number;
  cur: Curiosity | null; curDone: boolean; seed: number;
  /** steering round shallows this beat */
  avoid: boolean;
  /** breach apex height, and splash progress (0 none, 1 on the way up, 2 crashed down) */
  peak: number; splashed: number;
}
type GiantKind = 'shadow' | 'ray' | 'squid' | 'eel';
/** something huge passing under the boat */
export interface Giant {
  x: number; y: number; a: number;
  /** depth below the surface (negative) */
  z: number;
  len: number;
  kind: GiantKind;
  /** 0..1 bioluminescence */
  glow: number;
  /** animation phase */
  ph: number;
  // ---- simulation state
  a0: number; t: number; dur: number; v: number;
  /** cruising depth */
  zt: number;
  seed: number;
}
interface Jelly {
  x: number; y: number; z: number;
  ph: number;
  /** tint, 0..1 per channel */
  col: [number, number, number];
  glow: number;
  size: number;
  // ---- simulation state: drift about a home point, plus a push from the hull
  hx: number; hy: number; A: number; w1: number; w2: number; s1: number;
  rate: number; bright: number;
  /** one of the few that also show by day */
  day: boolean;
  px: number; py: number;
}
interface Swarm { cx: number; cy: number; m: Jelly[] }
/** a dolphin in a bow-riding pod; each has its own position, velocity and heading */
interface Dolphin {
  /** which side of the bow it rides, how far out and how far ahead */
  side: number; off: number; lead: number;
  ph: number;
  x: number; y: number; vx: number; vy: number; a: number;
  /** weave phase */
  wv: number;
}
interface Pod { t: number; m: Dolphin[] }
interface Life {
  whales: Whale[]; pods: Pod[]; giants: Giant[]; jellies: Jelly[];
  /** countdowns to the next spawn attempt */
  nextWhale: number; nextPod: number; nextGiant: number;
  t: number;
  /** jelly swarms by cell key */
  swarms: Map<string, Swarm>;
  /** cooldown between whale calls */
  callCd: number;
}

export const LIFE: Life = {
  whales: [], pods: [], giants: [], jellies: [],
  nextWhale: 20, nextPod: 12, nextGiant: 50, t: 0,
  swarms: new Map(), callCd: 0,
};

const TAU = Math.PI * 2, rnd = () => Math.random() - 0.5;
const ease = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));
// height without forcing a 128x128 tile build far from the camera (whales roam off-screen)
const depth = (x: number, y: number) => hasTile(Math.floor(x / TS), Math.floor(y / TS)) ? hAt(x, y) : heightAt(x, y);
const viewR = () => 0.6 * Math.hypot(W, H) + 20;
// distance-based [volume, pan] for ambient sounds; null when too far to hear
function hear(x: number, y: number, range = 280): [number, number] | null {
  const b = G.boat, d = Math.hypot(x - b.x, y - b.y), v = 1 - d / range;
  return v > 0.05 ? [v, Math.max(-1, Math.min(1, (x - b.x) / 160))] : null;
}
let dark = 0;                                                 // darkness() cached per frame
const glowK = () => clamp((dark - 0.25) / 0.5, 0, 1);              // plankton/jelly glow strength
function glow(x: number, y: number, sp = 4, life = 1.2, size = 1.2): void {
  spawn({ kind: 'glow', x, y, z: 0, vx: rnd() * sp, vy: rnd() * sp, life: life * (0.7 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6) });
}

// ---------------------------------------------------------------- whales
function newWhale(x: number, y: number, a: number, size: number, mom: Whale | null = null): Whale {
  return {
    x, y, a, z: -7, pitch: 0, roll: 0, tail: 0, mouth: 0, phase: 'swim', t: 0, size,
    dur: 2 + Math.random() * 5, sp: 5, ta: a, steerT: 0, mom, spoutT: 0.6, breaches: 0, slaps: 0, rollDir: 1, z0: -7,
    cur: null, curDone: false, seed: Math.random() * 100, avoid: false, peak: 0, splashed: 0,
  };
}
// a mother (and sometimes her calf) somewhere in deep water around the boat; false if no spot was found
function spawnWhales(): boolean {
  const b = G.boat;
  for (let k = 0; k < 20; k++) {
    // just beyond the edge of the view, so nobody sees a whale appear out of nothing
    const a = Math.random() * TAU, d = viewR() + 20 + Math.random() * 100, x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d;
    if (depth(x, y) > -0.38 || depth(x + 30, y) > -0.36 || depth(x - 30, y) > -0.36 || depth(x, y + 30) > -0.36 || depth(x, y - 30) > -0.36) continue;
    const h = Math.random() * TAU, mom = newWhale(x, y, h, 0.9 + Math.random() * 0.2);
    LIFE.whales.push(mom);
    if (Math.random() < 0.35) LIFE.whales.push(newWhale(x - Math.cos(h) * 8 + Math.sin(h) * 9, y - Math.sin(h) * 8 - Math.cos(h) * 9, h, 0.55, mom));
    return true;
  }
  return false;
}
function spout(w: Whale, k = 1): void {
  const s = w.size, c = Math.cos(w.a), sn = Math.sin(w.a), bx = w.x + c * 7 * s, by = w.y + sn * 7 * s;
  const wa = windAngle(), wx = Math.cos(wa) * WX.wind * 6, wy = Math.sin(wa) * WX.wind * 6;   // the blow drifts downwind
  for (let i = 0, n = Math.round((10 + 8 * s) * k); i < n; i++) {
    spawn({
      kind: 'spout', x: bx + rnd() * 1.5 * s, y: by + rnd() * 1.5 * s, z: w.z + 2 * s,
      vx: rnd() * 5 + wx, vy: wy - (5 + Math.random() * 7) * s, vz: (12 + Math.random() * 9) * Math.sqrt(s), life: 0.8 + Math.random() * 0.6,
    });
  }
  const hv = hear(bx, by, 200);
  if (hv) sfx('splash', 0.18 * hv[0] * s, hv[1]);
}
function call(w: Whale, under: boolean): void {
  if (LIFE.callCd > 0) return;
  const hv = hear(w.x, w.y, 300);
  if (!hv) return;
  LIFE.callCd = 7 + Math.random() * 8;
  sfx('whale', (under ? 0.35 : 0.6) * hv[0], hv[1]);
}
function splash(x: number, y: number, s: number, big: boolean): void {
  for (let i = 0; i < (big ? 3 : 2); i++) spawn({ kind: 'ring', x: x + rnd() * 4, y: y + rnd() * 4, life: 1.2 + i * 0.45, r0: (2 + i * 2) * s, grow: (big ? 14 : 7) * s * (1 + i * 0.3) });
  for (let i = 0, n = big ? 34 : 12; i < n; i++) {
    const a = Math.random() * TAU, v = (big ? 14 + Math.random() * 30 : 8 + Math.random() * 16) * s;
    spawn({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.6, foam: Math.random() < 0.4 });
  }
  for (let i = 0, n = big ? 22 : 7; i < n; i++) {
    spawn({ kind: 'spout', x: x + rnd() * 6 * s, y: y + rnd() * 6 * s, z: 0.5, vx: rnd() * 10, vy: -(4 + Math.random() * 8), vz: (big ? 14 + Math.random() * 16 : 8 + Math.random() * 8) * s, life: 0.6 + Math.random() * 0.5 });
  }
  if (big && glowK() > 0) for (let i = 0; i < 24 * glowK(); i++) glow(x + rnd() * 26 * s, y + rnd() * 26 * s, 10, 1.6, 1.6);
}
function setPhase(w: Whale, ph: WhalePhase, dur: number): void { w.phase = ph; w.t = 0; w.dur = dur; }
// pick a heading toward `want` that keeps the whale's nose over deep water
function steerWhale(w: Whale, want: number, dt: number): void {
  if ((w.steerT -= dt) > 0) return;
  w.steerT = 0.25;
  const L = 22 + 22 * w.size;
  const ok = (a: number) => depth(w.x + Math.cos(a) * L, w.y + Math.sin(a) * L) < -0.36 && depth(w.x + Math.cos(a) * L * 0.5, w.y + Math.sin(a) * L * 0.5) < -0.33;
  w.avoid = false;
  if (ok(want)) { w.ta = want; return; }
  w.avoid = true;
  for (const o of [0.5, 1, 1.5, 2, 2.6]) for (const sg of [w.rollDir, -w.rollDir]) if (ok(want + o * sg)) { w.ta = want + o * sg; return; }
  w.ta = w.a + Math.PI;                                       // boxed in: turn round
}
function updateWhale(w: Whale, dt: number): void {
  const b = G.boat, s = w.size, dx = b.x - w.x, dy = b.y - w.y, db = Math.hypot(dx, dy), still = Math.hypot(b.vx, b.vy) < 3;
  w.t += dt; w.spoutT -= dt;
  // curiosity: a still boat nearby may draw a whale in for one slow circle
  if (!w.cur && !w.curDone && still && db < 150 && (w.phase === 'swim' || w.phase === 'surface') && depth(b.x, b.y) < -0.3 && Math.random() < dt * 0.06) {
    w.cur = { st: 'go', acc: 0, last: 0, dir: Math.random() < 0.5 ? -1 : 1 };
    if (w.phase === 'swim') setPhase(w, 'surface', 14);
  }
  if (w.cur && (Math.hypot(b.vx, b.vy) > 10 || db > 260)) { w.cur = null; w.curDone = true; }
  let want = w.ta + Math.sin(LIFE.t * 0.05 + w.seed) * 0.002, turn = 0.16;
  if (w.cur) {
    const ang = Math.atan2(w.y - b.y, w.x - b.x);
    if (w.cur.st === 'go') {
      want = Math.atan2(dy, dx);
      if (db < 40) { w.cur.st = 'circle'; w.cur.last = ang; }
    } else {
      want = ang + w.cur.dir * (Math.PI / 2 + Math.max(-0.6, Math.min(0.6, (db - 34) * 0.04)));
      w.cur.acc += Math.abs(wrapAngle(ang - w.cur.last)); w.cur.last = ang;
      if (w.cur.acc > TAU) { w.cur = null; w.curDone = true; w.ta = ang; }
    }
    turn = 0.45;
  } else if (Math.random() < dt * 0.04) want = w.a + rnd() * 1.4;  // wander
  steerWhale(w, want, dt);
  if (w.avoid || w.cur) turn = 0.5;
  w.a += Math.max(-turn * dt, Math.min(turn * dt, wrapAngle(w.ta - w.a)));
  let sp = 5, zt = w.z, pitch = 0, tail = 0, roll = Math.sin(LIFE.t * 0.4 + w.seed) * 0.06, mouth = 0;
  switch (w.phase) {
    case 'swim':                                             // long deep dive, nearly invisible
      zt = -6.5; sp = 6;
      w.z = ease(w.z, zt, 0.6, dt);
      if (Math.random() < dt * 0.02) call(w, true);
      if (w.t > w.dur) setPhase(w, 'surface', 8 + Math.random() * 7);
      break;
    case 'surface': {                                        // a run along the surface, blowing every few seconds
      zt = -0.2 + Math.sin(w.t * 1.1 + w.seed) * 0.22; sp = w.cur ? 4.5 : 4;
      const pz = w.z;
      w.z = ease(w.z, zt, 0.9, dt);
      pitch = Math.max(-0.3, Math.min(0.3, (w.z - pz) / dt * 0.06));
      if (w.z > -1.2 && w.spoutT <= 0 && !w.mom) {
        spout(w); w.spoutT = 3 + Math.random() * 2.5;
        if (Math.random() < 0.4) call(w, false);
        for (const c of LIFE.whales) if (c.mom === w) c.spoutT = 0.7;   // calves blow just after her
      }
      if (w.cur && w.t > w.dur - 1) w.t = w.dur - 1;          // stay up while curious
      if (w.t > w.dur) {
        const r = Math.random(), clear = db > 70;
        if (clear && w.breaches < 2 && r < 0.32) {
          setPhase(w, 'breach', 2 + 2.6); w.z0 = w.z; w.rollDir = Math.random() < 0.5 ? -1 : 1;
          w.peak = (11 + Math.random() * 3) * (s < 0.7 ? 0.5 : 1); w.splashed = 0;
        } else if (db > 30 && r < 0.52) { setPhase(w, 'slap', 0); w.slaps = 2 + Math.floor(Math.random() * 3); }
        else setPhase(w, 'dive', 6);
      }
      break;
    }
    case 'breach': {                                         // wind up deep, then launch out and crash down on its side
      if (w.t < 2) {
        zt = -7; sp = 6 + w.t * 4;
        w.z = ease(w.z, zt, 1.4, dt); pitch = -0.25 * (w.t / 2); w.z0 = w.z;
        break;
      }
      const u = Math.min(1, (w.t - 2) / 2.6), sn = Math.sin(Math.PI * u), pz = w.z;
      w.z = u < 0.5 ? w.z0 + (w.peak - w.z0) * sn : -6 + (w.peak + 6) * sn;
      sp = 10; pitch = 1.25 * Math.cos(Math.PI * u); roll = w.rollDir * 1.5 * (u * u * (3 - 2 * u)); mouth = 0.35 * sn;
      const hx = w.x + Math.cos(w.a) * 4 * s, hy = w.y + Math.sin(w.a) * 4 * s;
      if (!w.splashed && pz < 0 && w.z >= 0) {               // bursting out
        w.splashed = 1; splash(hx, hy, s * 0.6, false);
        const hv = hear(hx, hy);
        if (hv) sfx('splash', 0.5 * hv[0], hv[1]);
      }
      if (w.splashed === 1 && u > 0.5 && w.z <= 1.5) {        // and crashing back down
        w.splashed = 2; splash(hx, hy, s, true);
        const hv = hear(hx, hy, 320);
        if (hv) {
          sfx('bigsplash', hv[0] * s, hv[1]);
          if (db < 90) G.shake = Math.max(G.shake, 2.5 * (1 - db / 90));
        }
      }
      if (u >= 1) { w.breaches++; setPhase(w, 'surface', 4 + Math.random() * 3); w.spoutT = 2; }
      break;
    }
    case 'slap': {                                           // head down, fluke up, smack the water a few times
      zt = -0.9; sp = 1.5; pitch = -0.35; w.z = ease(w.z, zt, 1.2, dt);
      const cyc = 1.7, k = (w.t % cyc) / cyc, prev = ((w.t - dt) % cyc) / cyc;
      tail = k < 0.72 ? Math.sin(k / 0.72 * Math.PI / 2) : Math.max(0, 1 - (k - 0.72) / 0.12);
      if (prev < 0.82 && k >= 0.82 && w.t > dt) {
        const tx = w.x - Math.cos(w.a) * 13 * s, ty = w.y - Math.sin(w.a) * 13 * s;
        splash(tx, ty, s * 0.7, false);
        const hv = hear(tx, ty);
        if (hv) sfx('bigsplash', 0.45 * hv[0] * s, hv[1]);
        if (--w.slaps <= 0) setPhase(w, 'dive', 6);
      }
      break;
    }
    case 'dive': {                                           // arch the back, raise the flukes, slide under
      const u = Math.min(1, w.t / w.dur);
      zt = -0.2 - 6.3 * u * u; w.z = ease(w.z, zt, 2, dt); sp = 4.5;
      pitch = -0.45 * Math.sin(Math.PI * Math.min(1, u * 1.3));
      tail = w.t > 1.5 && w.t < 4.2 ? Math.sin(Math.PI * (w.t - 1.5) / 2.7) : 0;
      if (tail > 0.9 && Math.random() < dt * 10) {
        const tx = w.x - Math.cos(w.a) * 13 * s, ty = w.y - Math.sin(w.a) * 13 * s;
        spawn({ kind: 'dot', x: tx + rnd() * 6, y: ty, vx: rnd() * 4, vy: rnd() * 4, life: 0.5, foam: true });
      }
      if (w.t > w.dur) { setPhase(w, 'swim', 16 + Math.random() * 18); w.breaches = 0; }
      break;
    }
  }
  w.sp = ease(w.sp, sp, 1.5, dt);
  // during the leap itself pitch and roll follow the script exactly; otherwise they ease
  const leaping = w.phase === 'breach' && w.t >= 2;
  w.pitch = leaping ? pitch : ease(w.pitch, pitch, 3, dt);
  w.roll = leaping ? roll : ease(w.roll, roll, 1.5, dt);
  w.tail = ease(w.tail, tail, 8, dt); w.mouth = ease(w.mouth, mouth, 4, dt);
  w.x += Math.cos(w.a) * w.sp * dt; w.y += Math.sin(w.a) * w.sp * dt;
  wakeLife(w, s, dt);
}
// calves shadow their mother: a slot beside her flank, her depth and her moods, a beat behind
function updateCalf(c: Whale, m: Whale, dt: number): void {
  const ca = Math.cos(m.a), sa = Math.sin(m.a);
  const tx = m.x - ca * 6 + sa * 10, ty = m.y - sa * 6 - ca * 10, dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
  c.t += dt; c.spoutT -= dt;
  c.ta = d > 1 ? Math.atan2(dy, dx) : m.a;
  c.a += Math.max(-1.2 * dt, Math.min(1.2 * dt, wrapAngle((d > 3 ? c.ta : m.a) - c.a)));
  c.sp = ease(c.sp, Math.min(14, m.sp + d * 0.5), 2, dt);
  c.x += Math.cos(c.a) * c.sp * dt; c.y += Math.sin(c.a) * c.sp * dt;
  const breach = m.phase === 'breach';                       // calves stay up and watch
  c.phase = breach ? 'surface' : m.phase;
  c.z = ease(c.z, breach ? -0.3 + Math.sin(c.t * 2) * 0.3 : m.z * 0.85, 1.5, dt);
  c.pitch = ease(c.pitch, breach ? 0 : m.pitch, 2, dt); c.roll = ease(c.roll, Math.sin(c.t * 0.7) * 0.1, 2, dt);
  c.tail = ease(c.tail, m.phase === 'slap' ? m.tail * 0.5 : m.tail, 4, dt); c.mouth = 0;
  if (c.spoutT <= 0 && c.spoutT > -dt * 1.5 && c.z > -1.5) spout(c, 0.7);
  wakeLife(c, c.size, dt);
}
// ripples where the back breaks the surface, and plankton glow along the body at night
function wakeLife(w: Whale, s: number, dt: number): void {
  if (w.z < -2.5) return;
  if (w.z > -1.6 && Math.random() < dt * 1.6) spawn({ kind: 'ring', x: w.x + Math.cos(w.a) * rnd() * 16 * s, y: w.y + Math.sin(w.a) * rnd() * 16 * s, life: 0.9, r0: 2, grow: 4 * s });
  const gk = glowK();
  if (gk <= 0) return;
  for (let n = dt * 14 * gk * s; n > 0; n--) if (Math.random() < n) {
    const u = rnd() * 22 * s, v = rnd() * 8 * s;
    glow(w.x + Math.cos(w.a) * u - Math.sin(w.a) * v, w.y + Math.sin(w.a) * u + Math.cos(w.a) * v, 5, 1.5);
  }
}
function whales(dt: number): void {
  const b = G.boat;
  if ((LIFE.nextWhale -= dt) <= 0) {
    const groups = LIFE.whales.filter(w => !w.mom).length;
    LIFE.nextWhale = groups >= 2 ? 15 : spawnWhales() ? 40 + Math.random() * 60 : 6;
  }
  for (const w of LIFE.whales) {
    if (w.mom) updateCalf(w, w.mom, dt);
    else updateWhale(w, dt);
  }
  const L = LIFE.whales;
  let j = 0;
  for (let i = 0; i < L.length; i++) {
    const w = L[i];
    const gone = Math.hypot(w.x - b.x, w.y - b.y) > viewR() + 160 ||   // only once well out of view
      (w.mom && !L.includes(w.mom)) || !Number.isFinite(w.x + w.y + w.z);
    if (!gone) L[j++] = w;
  }
  L.length = j;
  // a calf whose mother just left goes with her (second pass catches mothers removed after their calves)
  for (let i = L.length - 1; i >= 0; i--) { const mom = L[i].mom; if (mom && !L.includes(mom)) L.splice(i, 1); }
}

// ---------------------------------------------------------------- giants
const GIANT: Record<GiantKind, { len: [number, number]; z: number; v: [number, number] }> = {
  shadow: { len: [26, 40], z: -6, v: [13, 17] },
  ray: { len: [14, 22], z: -3.5, v: [9, 13] },
  squid: { len: [16, 26], z: -4.5, v: [10, 13] },
  eel: { len: [22, 34], z: -4, v: [14, 18] },
};
// a giant crossing under where the boat is about to be, along a line of deep water; false if none fits
// which giants pass where: rays glide over coral and mangrove channels, eels and squid haunt the kelp and the ember
// isles, and big shadows keep to the cold north
function giantKind(night: boolean, r: number): GiantKind {
  switch (biomeAt(G.boat.x, G.boat.y)) {
    case 'reef': return night ? (r < 0.5 ? 'ray' : r < 0.8 ? 'eel' : 'shadow') : (r < 0.75 ? 'ray' : 'shadow');
    case 'kelp': return night ? (r < 0.45 ? 'eel' : r < 0.8 ? 'squid' : 'shadow') : (r < 0.45 ? 'eel' : r < 0.85 ? 'shadow' : 'ray');
    case 'volcanic': return night ? (r < 0.55 ? 'squid' : r < 0.9 ? 'eel' : 'shadow') : (r < 0.5 ? 'eel' : 'shadow');
    case 'mangrove': return night ? (r < 0.5 ? 'ray' : r < 0.8 ? 'eel' : 'shadow') : (r < 0.7 ? 'ray' : 'shadow');   // stingrays in the channels
    case 'cold': return night ? (r < 0.5 ? 'squid' : 'shadow') : (r < 0.8 ? 'shadow' : 'squid');
    default: return night ? (r < 0.4 ? 'squid' : r < 0.65 ? 'eel' : r < 0.82 ? 'ray' : 'shadow') : (r < 0.55 ? 'shadow' : 'ray');
  }
}
function spawnGiant(): boolean {
  const b = G.boat, kind = giantKind(dark > 0.5, Math.random());
  const D = GIANT[kind], v = D.v[0] + Math.random() * (D.v[1] - D.v[0]), dur = 16 + Math.random() * 6;
  const floor = kind === 'ray' ? -0.18 : -0.32;                       // rays cross the shallows too
  const px = b.x + b.vx * 4, py = b.y + b.vy * 4;
  for (let k = 0; k < 6; k++) {
    // along the boat's line (either way) or across it
    const a = Math.random() < 0.5 ? b.a + rnd() * 1.2 + (Math.random() < 0.5 ? 0 : Math.PI) : b.a + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2 + rnd() * 0.8;
    const half = v * dur / 2, sx = px - Math.cos(a) * half, sy = py - Math.sin(a) * half;
    let ok = true;
    for (let q = 0; q <= 8 && ok; q++) { const f = q / 8 * half * 2; ok = depth(sx + Math.cos(a) * f, sy + Math.sin(a) * f) < floor; }
    if (!ok) continue;
    LIFE.giants.push({
      x: sx, y: sy, a, a0: a, z: -14, len: D.len[0] + Math.random() * (D.len[1] - D.len[0]), kind, glow: 0, ph: Math.random() * TAU,
      t: 0, dur, v, zt: D.z, seed: Math.random() * 10,
    });
    return true;
  }
  return false;
}
function giants(dt: number): void {
  const b = G.boat, sp = Math.hypot(b.vx, b.vy);
  if (!LIFE.giants.length && sp > 4 && depth(b.x, b.y) < -0.38 && (LIFE.nextGiant -= dt) <= 0) LIFE.nextGiant = spawnGiant() ? 70 + Math.random() * 70 : 8;
  const gk = glowK();
  for (const g of LIFE.giants) {
    g.t += dt;
    let v = g.v;
    if (g.kind === 'ray') { g.ph += dt * 1.7; g.a = g.a0 + Math.sin(g.t * 0.35 + g.seed) * 0.25; }
    else if (g.kind === 'squid') { g.ph += dt * 1.9; const p = Math.max(0, Math.sin(g.ph)); v *= 0.35 + 1.3 * p * p; }   // jets in pulses
    else if (g.kind === 'eel') { g.ph += dt * 2.6; g.a = g.a0 + Math.sin(g.ph * 0.5) * 0.3; }
    else { g.ph += dt * 1.1; g.a = g.a0 + Math.sin(g.t * 0.2 + g.seed) * 0.12; }
    g.x += Math.cos(g.a) * v * dt; g.y += Math.sin(g.a) * v * dt;
    // shallows ahead: sink away early
    if (g.t < g.dur * 0.8 && depth(g.x + Math.cos(g.a) * g.len, g.y + Math.sin(g.a) * g.len) > -0.3) g.t = g.dur * 0.8;
    // rise from the deep, cruise, sink again
    const u = g.t / g.dur, fade = Math.min(clamp(u / 0.2, 0, 1), clamp((1 - u) / 0.2, 0, 1));
    const f = fade * fade * (3 - 2 * fade);
    g.z = -14 + (g.zt + 14) * f;
    g.glow = f * (g.kind === 'squid' ? 0.25 + 0.75 * gk : g.kind === 'eel' ? 0.65 * gk : g.kind === 'ray' ? 0.15 * gk : 0);
    if (gk > 0 && f > 0.5 && Math.random() < dt * 8 * gk) glow(g.x + rnd() * g.len * 0.8, g.y + rnd() * g.len * 0.5, 3, 1.4);
  }
  if (LIFE.giants.length) LIFE.giants = LIFE.giants.filter(g => g.t < g.dur && Number.isFinite(g.x + g.y));
}

// ---------------------------------------------------------------- jellyfish swarms
// swarms live at fixed places (one possible per JC-sized cell, decided by a hash) in deep water
const JC = 420;
type RGB3 = [number, number, number];
// three colours per region, and how likely a cell is to hold a swarm there
const JELLY: Record<BiomeId, { p: number; col: [RGB3, RGB3, RGB3] }> = {
  home: { p: 0.42, col: [[0.3, 0.95, 0.85], [1, 0.45, 0.75], [0.66, 0.45, 1]] },
  open: { p: 0.42, col: [[0.3, 0.95, 0.85], [1, 0.45, 0.75], [0.66, 0.45, 1]] },
  warm: { p: 0.5, col: [[0.3, 0.95, 0.85], [1, 0.45, 0.75], [1, 0.8, 0.35]] },
  reef: { p: 0.6, col: [[1, 0.4, 0.8], [0.75, 0.4, 1], [1, 0.6, 0.5]] },        // bright pinks and violets
  kelp: { p: 0.45, col: [[1, 0.72, 0.35], [0.95, 0.85, 0.55], [0.85, 0.55, 0.3]] }, // amber moon jellies
  volcanic: { p: 0.3, col: [[1, 0.3, 0.2], [0.85, 0.15, 0.25], [1, 0.55, 0.2]] },  // deep reds
  mangrove: { p: 0.35, col: [[0.6, 1, 0.55], [0.8, 0.95, 0.5], [0.45, 0.85, 0.7]] },  // pale greens
  cold: { p: 0.4, col: [[0.65, 0.85, 1], [0.85, 0.95, 1], [0.5, 0.7, 1]] },        // pale ice blues
};
function makeSwarm(i: number, j: number): Swarm {
  const r = mulberry(hash(i, j, 4242)), roll = r();
  const cx = (i + 0.2 + 0.6 * r()) * JC, cy = (j + 0.2 + 0.6 * r()) * JC, m: Jelly[] = [], kind = JELLY[biomeAt(cx, cy)];
  if (roll >= kind.p || depth(cx, cy) > -0.32) return { cx, cy, m };
  // two colours per swarm, mostly the first
  const n = 10 + Math.floor(r() * 21), R = 28 + r() * 40, c0 = Math.floor(r() * 3), c1 = (c0 + 1 + Math.floor(r() * 2)) % 3;
  for (let q = 0; q < n; q++) {
    const a = r() * TAU, d = Math.sqrt(r()) * R, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    if (depth(x, y) > -0.22) continue;
    m.push({
      x, y, z: -3, ph: r() * TAU, col: kind.col[r() < 0.75 ? c0 : c1], glow: 0, size: 0.6 + r() * 0.7,
      hx: x, hy: y, A: 4 + r() * 8, w1: 0.04 + r() * 0.05, w2: 0.03 + r() * 0.05, s1: r() * TAU, rate: 1.3 + r() * 0.9, bright: 0.7 + r() * 0.3, day: r() < 0.25, px: 0, py: 0,
    });
  }
  return { cx, cy, m };
}
function jellies(dt: number): void {
  // swarms are loaded and drawn out to beyond the edge of the view, so they never pop in
  const b = G.boat, ci = Math.floor(b.x / JC), cj = Math.floor(b.y / JC), S = LIFE.swarms, reach = viewR() + 120, n = Math.ceil(reach / JC);
  for (let j = cj - n; j <= cj + n; j++) for (let i = ci - n; i <= ci + n; i++) {
    const k = i + ',' + j;
    if (!S.has(k)) { const cx = (i + 0.5) * JC, cy = (j + 0.5) * JC; if (Math.hypot(cx - b.x, cy - b.y) < reach + JC * 0.7) S.set(k, makeSwarm(i, j)); }
  }
  // LIFE.jellies is rebuilt each frame with the visible ones
  const gk = glowK(), out = LIFE.jellies;
  out.length = 0;
  for (const [k, sw] of S) {
    const d = Math.hypot(sw.cx - b.x, sw.cy - b.y);
    if (d > reach + JC * 1.5) { S.delete(k); continue; }        // regenerates identically when we come back
    if (d > reach + 70 || !sw.m.length) continue;
    for (const m of sw.m) {
      m.ph += dt * m.rate;
      const T = LIFE.t;
      m.px *= Math.exp(-0.4 * dt); m.py *= Math.exp(-0.4 * dt);
      m.x = m.hx + Math.sin(T * m.w1 + m.s1) * m.A + m.px; m.y = m.hy + Math.cos(T * m.w2 + m.s1) * m.A + m.py;
      const dx = m.x - b.x, dy = m.y - b.y, dd = dx * dx + dy * dy;
      if (dd < 100) {                                         // the hull nudges them aside
        const l = Math.sqrt(dd) || 1;
        m.px += dx / l * 14 * dt; m.py += dy / l * 14 * dt;
        if (gk > 0 && Math.random() < dt * 6) glow(m.x, m.y, 6, 1.2);
      }
      if (!m.day && gk <= 0.02) continue;                     // by day only a few drift up near the light
      const pulse = Math.sin(m.ph);
      m.z = -3.6 + 2.8 * gk + 0.35 * pulse - (m.day ? 0 : 0.6 * (1 - gk));
      m.glow = (m.day ? 0.06 + 0.94 * gk : gk) * m.bright * (0.78 + 0.22 * pulse);
      out.push(m);
    }
  }
}

// ---------------------------------------------------------------- plankton in the player's wake
let oarL = 0, oarR = 0;                                         // last oar phases, to catch each new stroke
function oarGlow(sgn: number, gk: number): void {
  const [x, y] = toWorld(OAR.sweep, sgn * OAR.reach);
  for (let i = 0; i < 10 * gk; i++) glow(x + rnd() * 3, y + rnd() * 3, 9, 1.4, 1.3);
}
function plankton(dt: number): void {
  const gk = glowK(), b = G.boat;
  const pl = b.phaseL, pr = b.phaseR;
  if (gk > 0 && G.boatId === 'row') {
    if (Math.floor(oarL) !== Math.floor(pl)) oarGlow(-1, gk);
    if (Math.floor(oarR) !== Math.floor(pr)) oarGlow(1, gk);
  }
  oarL = pl; oarR = pr;
  const sp = Math.hypot(b.vx, b.vy);
  if (gk <= 0 || sp < 3) return;
  const c = Math.cos(b.a), s = Math.sin(b.a), L = (BOATS.find(q => q.id === G.boatId) || BOATS[0]).L, B = 5;
  for (let n = Math.min(45, sp * 1.1) * gk * dt; n > 0; n--) if (Math.random() < n) {
    const u = -L * (0.3 + Math.random() * 0.5), v = rnd() * 2 * B;
    const x = b.x + c * u - s * v, y = b.y + s * u + c * v;
    if (depth(x, y) < -0.05) spawn({ kind: 'glow', x, y, z: 0, vx: -s * v * 0.6 + rnd() * 3, vy: c * v * 0.6 + rnd() * 3, life: 1 + Math.random(), size: 0.8 + Math.random() * 0.9 });
  }
}

// ---------------------------------------------------------------- dolphins
// a pod arrives from one side of a fast boat
/** Distance from the boat to just past the screen edge, going sideways from its heading. */
const offscreenSide = (c: number, s: number) => Math.abs(s) * W / 2 + Math.abs(c) * H / 2 + 24;
function spawnPod(): void {
  const b = G.boat, c = Math.cos(b.a), s = Math.sin(b.a), from = Math.random() < 0.5 ? -1 : 1, edge = offscreenSide(c, s);
  LIFE.pods.push({
    t: 0, m: [0, 1, 2].map(k => {
      const side = k % 2 ? 1 : -1, x = b.x - c * 30 - s * from * (edge + k * 8), y = b.y - s * 30 + c * from * (edge + k * 8);
      return { side, off: 10 + k * 6, lead: 6 + k * 7, ph: k * 0.37 + Math.random() * 0.2, x, y, vx: b.vx, vy: b.vy, a: b.a, wv: Math.random() * 6 };
    }),
  });
}
// each dolphin steers toward a loose slot beside the bow; it has its own speed and heading,
// so the pod lags behind turns, overtakes, weaves, and peels away at the end
const POD_STAY = 14;   // seconds alongside before they peel away
function dolphins(dt: number): void {
  const b = G.boat, c = Math.cos(b.a), s = Math.sin(b.a), gk = glowK();
  for (const p of LIFE.pods) for (const m of p.m) {
    const leave = p.t > POD_STAY ? (p.t - POD_STAY) * 18 : 0, weave = Math.sin(p.t * 0.9 + m.wv) * 5;
    const lead = m.lead + Math.sin(p.t * 0.7 + m.ph) * 5, off = m.side * (m.off + weave + leave);
    const tx = b.x + c * lead - s * off + b.vx * 0.35, ty = b.y + s * lead + c * off + b.vy * 0.35;
    let ax = (tx - m.x) * 2.2 + (b.vx - m.vx) * 1.4, ay = (ty - m.y) * 2.2 + (b.vy - m.vy) * 1.4;
    const al = Math.hypot(ax, ay), amax = 70;
    if (al > amax) { ax *= amax / al; ay *= amax / al; }
    m.vx += ax * dt; m.vy += ay * dt;
    const v = Math.hypot(m.vx, m.vy), vmax = Math.max(30, Math.hypot(b.vx, b.vy) * 1.45);
    if (v > vmax) { m.vx *= vmax / v; m.vy *= vmax / v; }
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (v > 2) { m.a += wrapAngle(Math.atan2(m.vy, m.vx) - m.a) * Math.min(1, dt * 5); }
    if (gk > 0 && Math.random() < dt * 10 * gk) glow(m.x, m.y, 6, 1.1);   // dolphins streak through the glow
  }
  // a pod stays a while, then peels away and is removed only once every dolphin is off-screen
  const edge = offscreenSide(c, s) + 20;
  LIFE.pods = LIFE.pods.filter(p => (p.t += dt) < POD_STAY || (p.t < 40 && p.m.some(m => Math.hypot(m.x - b.x, m.y - b.y) < edge)));
}

// ---------------------------------------------------------------- main entry
export function updateLife(dt: number): void {
  if (G.mode !== 'play') return;
  LIFE.t += dt; LIFE.callCd -= dt; dark = darkness();
  const b = G.boat, sp = Math.hypot(b.vx, b.vy);
  // raindrop rings on the water in view
  for (let n = WX.rain * 16 * dt; n > 0; n--) if (Math.random() < n) {
    const x = G.cam.x + Math.random() * W, y = G.cam.y + Math.random() * H;
    if (hAt(x, y) < -0.03) spawn({ kind: 'ring', x, y, life: 0.5, r0: 0, grow: 2 });
  }
  whales(dt);
  giants(dt);
  jellies(dt);
  plankton(dt);
  if ((LIFE.nextPod -= dt) <= 0 && sp > 20 && hAt(b.x, b.y) < -0.3) {
    LIFE.nextPod = 45 + Math.random() * 60;
    spawnPod();
  }
  dolphins(dt);
}
