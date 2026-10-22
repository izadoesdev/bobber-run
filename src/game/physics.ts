// Boat physics: thrust, drag, steering, wind gusts, contacts with land and solids, crashes and sinking.
import { clamp, frac, smooth01 } from '../config';
import { hBil, poisNear } from '../world';
import { WX } from '../weather';
import { sfx } from '../audio';
import { track, bucket } from '../analytics';
import { OAR } from '../models';
import { BOATS } from '../econ';
import { ONLINE } from '../online';
import type { Poi, Solid, Sway } from '../types';
import { seaPropsNear, type SeaProp } from '../seaprops';
import { G, inp } from './state';
import { boatDef, chartPerks, hpMax, keelLvl, speedMul, sailEfficiency, windAngle, toWorld } from './rules';
import { spawn, toast, jitter, burst } from './feedback';
import { cancelFishing, hitstop, towStretch } from './fishing';

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
const nearPois: Poi[] = [], nearProps: SeaProp[] = [];
/** A sea prop's solid footprint as a circle, made once per prop (props are fixed in place). */
const propSolids = new WeakMap<SeaProp, Solid>();
const propSolid = (p: SeaProp): Solid => {
  let so = propSolids.get(p);
  if (!so) propSolids.set(p, so = { kind: 'circ', x: p.x, y: p.y, r: p.r });
  return so;
};
/** The piers, wrecks and solid sea props (icebergs, floes, sea stacks, whale bones, basalt) within `rad` of the boat, into `out`. */
export function solidsNear(rad: number, out: Solid[]): void {
  out.length = 0;
  for (const p of poisNear(G.boat.x, G.boat.y, rad, nearPois)) if (p.solid) out.push(p.solid);
  for (const p of seaPropsNear(G.boat.x, G.boat.y, rad, nearProps)) out.push(propSolid(p));
}
/** Everything solid near the boat; refreshed once per frame rather than every physics step. */
const solids: Solid[] = [];
export const refreshSolids = (): void => solidsNear(140, solids);

interface Contact { pen: number; nx: number; ny: number }
/** Penetration of point (px, py) into a pier segment or wreck circle grown by `pad`, with the push-out normal. */
export function shapeContact(so: Solid, px: number, py: number, pad = 0): Contact | null {
  let cx: number, cy: number;
  if (so.kind === 'circ') { cx = so.x; cy = so.y; }
  else {
    const dx = so.bx - so.ax, dy = so.by - so.ay;
    const t = clamp(((px - so.ax) * dx + (py - so.ay) * dy) / (dx * dx + dy * dy), 0, 1);
    cx = so.ax + dx * t; cy = so.ay + dy * t;
  }
  const d = Math.hypot(px - cx, py - cy);
  if (!(d < so.r + pad)) return null;                       // NaN (a zero-length pier) is no contact
  const inv = d > 1e-4 ? 1 / d : 0;
  return { pen: so.r - d, nx: (px - cx) * inv, ny: (py - cy) * inv };
}
/** Penetration of a hull point into land, pushed out along the height gradient. */
function landContact(px: number, py: number, rx: number, ry: number): Contact | null {
  const h = hBil(px, py);
  if (h <= -DRAFT) return null;
  const gx = hBil(px + 1.5, py) - hBil(px - 1.5, py), gy = hBil(px, py + 1.5) - hBil(px, py - 1.5), gl = Math.hypot(gx, gy);
  if (gl > 1e-6) return { nx: -gx / gl, ny: -gy / gl, pen: Math.min(2.5, (h + DRAFT) / (gl / 3) + 0.05) };
  const l = Math.hypot(rx, ry) || 1;
  return { nx: -rx / l, ny: -ry / l, pen: 0.5 };                                    // flat ground: push back towards the centre
}
/**
 * The point of hull edge (ax, ay)-(bx, by) closest to a pier's core segment (or a wreck's centre), and its contact.
 * Piers are tested against edges, not hull points: on a long hull the points are wider apart than a pier end.
 */
interface Hit { px: number; py: number; c: Contact }
/** The hull outline in world space, rewritten each contact iteration. */
const hullWorld: [number, number][] = Array.from({ length: 18 }, () => [0, 0]);
function edgeContact(so: Solid, ax: number, ay: number, bx: number, by: number): Hit | null {
  const [cx, cy, dx, dy] = so.kind === 'circ' ? [so.x, so.y, 0, 0] : [so.ax, so.ay, so.bx - so.ax, so.by - so.ay];
  const ex = bx - ax, ey = by - ay, wx = ax - cx, wy = ay - cy;
  const ee = ex * ex + ey * ey, dd = dx * dx + dy * dy, ed = ex * dx + ey * dy, ew = ex * wx + ey * wy, dw = dx * wx + dy * wy;
  // closest points of two segments (Ericson): s along the edge, t along the core
  let s = clamp(dd > 1e-9 ? (ed * dw - ew * dd) / Math.max(1e-9, ee * dd - ed * ed) : -ew / ee, 0, 1);
  let t = dd > 1e-9 ? (ed * s + dw) / dd : 0;
  if (t < 0 || t > 1) { t = clamp(t, 0, 1); s = clamp((ed * t - ew) / ee, 0, 1); }
  const px = ax + ex * s, py = ay + ey * s, qx = cx + dx * t, qy = cy + dy * t, d = Math.hypot(px - qx, py - qy);
  if (!(d < so.r)) return null;
  const [nx, ny] = d > 1e-4 ? [(px - qx) / d, (py - qy) / d] : [-ey / Math.sqrt(ee), ex / Math.sqrt(ee)];   // core on the edge: push the hull inward
  return { px, py, c: { pen: so.r - d, nx, ny } };
}
/** Resolve hull contacts with impulses (restitution + friction), a few iterations deep. */
function contacts(): void {
  const b = G.boat, inertia = 200 * Math.pow(boatDef().L / 13.5, 2);
  let impact = 0, at: { x: number; y: number; nx: number; ny: number } | null = null;
  const hull = hullPoints(), n = hull.length;
  for (let it = 0; it < 3; it++) {
    const c = Math.cos(b.a), s = Math.sin(b.a), hits: Hit[] = [];
    hull.forEach(([u, v], i) => {
      const px = b.x + u * c - v * s, py = b.y + u * s + v * c, land = landContact(px, py, px - b.x, py - b.y);
      hullWorld[i][0] = px; hullWorld[i][1] = py;
      if (land) hits.push({ px, py, c: land });
    });
    for (const so of solids) {                       // each pier or wreck touches the hull at its deepest edge
      let deepest: Hit | null = null;
      for (let i = 0; i < n; i++) {
        const e = edgeContact(so, ...hullWorld[i], ...hullWorld[(i + 1) % n]);
        if (e && e.c.pen > (deepest?.c.pen ?? 0)) deepest = e;
      }
      if (deepest) hits.push(deepest);
    }
    for (const { px, py, c: { pen, nx, ny } } of hits) {
      const rx = px - b.x, ry = py - b.y;
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
    if (!hits.length) break;
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
  sfx('crash', 0.6 + k * 0.7);
  for (let i = 0; i < 3 + k * 10; i++) {
    const a = Math.random() * 6.28, sp = 6 + Math.random() * 22;
    spawn({ kind: 'debris', x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + Math.random() * 1.5 });
  }
  if (speed <= 11) return;
  const dmg = Math.round((speed - 11) * 1.7 * (1 - 0.12 * G.up.hull));
  if (dmg <= 0 || G.god) return;
  const taken = Math.min(dmg, Math.max(0, G.boat.hp));   // the hull bottoms out at zero
  G.boat.hp -= taken;
  toast(`Crash! -${taken} hull`, 'bad');
  if (G.boat.hp <= 0) sink();
  else if (G.boat.hp < hpMax() * 0.3) toast('Your hull is badly damaged. Repair it at a port before your boat sinks', 'bad');
}

// Other sailors' boats are solid: running into one bounces you off it with a wet slap. Each client only moves its own
// boat, so both sides bounce. Hulls are treated as circles a little shorter than the boat; nobody takes damage.
let slapAt = 0;
function bumpSailors(): void {
  const b = G.boat, mine = boatDef();
  for (const o of ONLINE.sailors) {
    const theirs = BOATS.find(bd => bd.id === o.id) ?? mine;
    const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy), reach = 0.4 * (mine.L + theirs.L);
    if (d >= reach || d < 1e-3) continue;
    const nx = dx / d, ny = dy / d, vn = (b.vx - o.vx) * nx + (b.vy - o.vy) * ny;
    b.x += nx * (reach - d) * 0.5; b.y += ny * (reach - d) * 0.5;      // the other boat moves its half on its own screen
    if (vn >= 0) continue;
    const j = -1.4 * vn / 2;                                          // equal boats, a bouncy bump; we take half the impulse
    b.vx += j * nx; b.vy += j * ny; b.w += (Math.random() - 0.5) * Math.min(1.2, -vn * 0.05);
    if (-vn > 3 && G.t - slapAt > 0.35) {
      slapAt = G.t;
      sfx('slap', Math.min(1, 0.35 + -vn / 40));
      G.shake = Math.max(G.shake, Math.min(2.5, -vn / 12));
      spawn({ kind: 'dot', x: b.x - nx * reach * 0.5, y: b.y - ny * reach * 0.5, vx: jitter(20), vy: jitter(20), life: 0.4 });
    }
  }
}
export function physicsStep(dt: number): void {
  const b = G.boat, bd = boatDef();
  b.px = b.x; b.py = b.y; b.pa = b.a;
  if (hitstop()) return;                                          // the world holds still for a hook or a big landing
  const thr = inp.up() ? 1 : 0, rev = inp.down() ? 1 : 0;
  const steer = ((inp.right() ? 1 : 0) - (inp.left() ? 1 : 0)) * (G.fish ? 0.6 : 1);   // you can still turn with a line out
  const towing = G.fish?.st === 'reel' && !!G.fish.tow;            // a towing fight is sailed: the throttle chases or brakes
  if (G.fish && !towing && (thr || rev)) cancelFishing('You started sailing, so you reeled in your line');
  // the helm and throttle ease towards the controls, and bigger hulls answer them more slowly
  const heft = Math.sqrt(bd.L / 13.5), rowing = bd.prop === 'OARS';
  b.helm = ease(b.helm, steer, (steer ? 6 : 8) / heft, dt);
  b.thr = ease(b.thr, G.fish && !towing ? 0 : thr - rev, (rowing ? 5 : bd.prop === 'SAIL' ? 1.6 : 2.5) / heft, dt);   // sails take a moment to fill
  // forward / sideways velocity in the boat frame; shallow water and hard turns drag harder
  let c = Math.cos(b.a), s = Math.sin(b.a);
  let vf = b.vx * c + b.vy * s, vs = -b.vx * s + b.vy * c;
  const vf0 = vf, shallow = clamp((hBil(b.x, b.y) + 0.1) / 0.09, 0, 1), k = 0.6 * bd.accel;
  vf *= Math.exp(-(k + 2.2 * shallow + 0.12 * Math.abs(b.w)) * dt);
  vs *= Math.exp(-(3.2 + 3 * shallow) * dt);
  let push = 20 * speedMul() * bd.accel * (1 + chartPerks().speed);   // a well-charted coast is a faster one
  if (bd.prop === 'SAIL') push *= sailEfficiency() * (1 + 0.3 * WX.wind);
  vf += b.thr * push * (b.thr < 0 ? 0.45 : 1) * dt;
  // a rudder needs water flowing past it, so ships barely turn from a standstill; oars can spin a rowboat in place
  const still = rowing ? 0.7 : 0.4, steerage = still + (1 - still) * smooth01(Math.abs(vf) / 22);
  b.w = ease(b.w, b.helm * 1.25 * bd.turn * steerage, 5 / heft, dt);
  b.a += b.w * dt;
  swayHull(dt, heft, vf, (vf - vf0) / dt);
  c = Math.cos(b.a); s = Math.sin(b.a);
  b.vx = vf * c - vs * s; b.vy = vf * s + vs * c;
  // storm gusts push the boat unless it is anchored; long hulls and storm keels resist
  const anchored = G.up.anchor > 0 && (G.fish || Math.hypot(b.vx, b.vy) < 6) && !thr && !rev;
  if (WX.wind > 0.3 && !anchored) {
    const wa = windAngle();
    const gust = (WX.wind - 0.3) * 10 * (0.6 + 0.4 * Math.sin(G.t * 0.8)) * 13.5 / bd.L * Math.max(0, 1 - 0.5 * keelLvl());
    b.vx += Math.cos(wa) * gust * dt; b.vy += Math.sin(wa) * gust * dt;
  }
  towBoat(dt, heft);
  b.x += b.vx * dt; b.y += b.vy * dt;
  contacts();
  bumpSailors();
  G.throttle = thr || rev;
  if (bd.id === 'row' && !G.fish) rowOars(dt, thr, rev, steer);
}

/** A sea giant on the line drags the boat after it while the line is stretched (see runWithLine in fishing). */
function towBoat(dt: number, heft: number): void {
  const f = G.fish;
  if (f?.st !== 'reel' || !f.tow) return;
  const b = G.boat, stretch = towStretch(f, f.tow);
  if (stretch <= 0) return;
  const dx = (f.fx ?? f.tx) - b.x, dy = (f.fy ?? f.ty) - b.y, d = Math.hypot(dx, dy), pull = Math.min(stretch, 12) * 2.6 / (heft * heft);
  b.vx += dx / d * pull * dt; b.vy += dy / d * pull * dt;
}
/** `v` eased towards `target` at `rate` per second (exponential, so it never overshoots). */
const ease = (v: number, target: number, rate: number, dt: number): number => v + (target - v) * (1 - Math.exp(-rate * dt));
/** A lightly damped spring: the angle swings towards `target` at `hz` and rocks back a little before it settles. */
function swing(s: Sway, target: number, hz: number, dt: number): void {
  const w = 2 * Math.PI * hz;
  s.v += (w * w * (target - s.x) - 2 * 0.35 * w * s.v) * dt;
  s.x += s.v * dt;
}
/**
 * The hull heels out of a turn and away from the wind under sail, squats with the bow up under power and noses down
 * when it slows; big ships move less and more slowly. Purely for show: physics ignores it.
 */
function swayHull(dt: number, heft: number, vf: number, accel: number): void {
  const b = G.boat, bd = boatDef();
  const sails = bd.prop === 'SAIL' ? Math.sin(windAngle() - b.a) * WX.wind * Math.max(0, b.thr) * 0.12 : 0;
  const heel = clamp(b.w * vf * 0.004, -0.1, 0.1) - sails;
  const trim = clamp(accel * 0.0025, -0.05, 0.06) + (bd.prop === 'ENGINE' ? Math.min(1, Math.abs(vf) / 60) * 0.035 : 0);
  swing(b.heel, heel / Math.sqrt(heft), 0.55 / heft, dt);
  swing(b.trim, trim / heft, 0.7 / heft, dt);
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
      sfx('oar', 0.65, side * 0.35);
    }
  }
}

export function sink(): void {
  G.mode = 'sunk'; G.sunkT = 0; sfx('sink');
  const fee = Math.min(G.coins, 5 + Math.min(40, Math.round(G.coins * 0.04)));   // a small tow fee; the catch is kept
  G.coins -= fee; G.fish = null;
  track('boat_sunk', { boat: G.boatId, tow_cost_bucket: bucket(fee), storm: WX.state === 'storm' });
  G.sunkMsg = `A tug towed you back to the last port you visited. You kept your fish${fee ? `, and the tow cost $${fee}` : ''}`;
  burst('debris', G.boat.x, G.boat.y, 30, 40, () => 2 + Math.random() * 2);
}
