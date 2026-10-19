// Game state and rules: boats, physics/contacts, fishing, frenzies, ports (market, outfitter, shipyard,
// ferry), contracts, goals, day/night, saving.
import { W, H, clamp } from './config.js';
import { nA } from './noise.js';
import { hBil, hAt, heightAt, poisNear, schoolsNear, cratesNear, homePort, cellPois, BOSS } from './world.js';
import { WX, updateWeather, biteMul, trophyBonus } from './weather.js';
import { SPECIES, SP, BOATS, UPGRADES, UP_CATS, PAINTS, SUPPLIES, activeAt, fmtKg, pickSpecies } from './econ.js';
import { sfx, soundscape, music, setCaptionHook } from './audio.js';
import { SET } from './prefs.js';
import { bladeAt, OAR } from './models.js';

export const G = {
  mode: 'title', t: 0, clock: 0,
  boat: { x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, px: 0, py: 0, pa: 0, phase: 0.5, hp: 100 },
  boatId: 'row', owned: ['row'], coins: 0, coinsShown: 0, earned: 0,
  up: Object.fromEntries(Object.keys(UPGRADES).map(k => [k, 0])), paint: 'classic', paints: ['classic'], shipSel: 0, logPage: 0, bait: { shrimp: 0, glow: 0 }, baitSel: 'shrimp',
  hold: [], log: {}, found: new Set(), salvaged: new Set(), lastPort: null, sat: {}, pity: 0,
  stats: { caught: 0, sold: 0, upgrades: 0, lights: 0, contracts: 0, wrecks: 0, trophies: 0, night: 0, frenzy: 0, treasures: 0 },
  goalIdx: 0, goalsDone: [], offers: {}, active: [], maps: [], musicOn: true, nearTreasure: null,
  fish: null, catchAnim: null, card: null, toasts: [], captions: [], floaters: [], parts: [], frenzy: null, nextFrenzy: 50,
  cam: { x: 0, y: 0 }, look: { x: 0, y: 0 }, shake: 0, shakeX: 0, shakeY: 0,
  prompt: null, menu: { tab: 0, sel: 0, port: null }, map: { x: 0, y: 0, zoom: 1 },
  sunkT: 0, sunkMsg: '', keys: {}, pressed: new Set(),
  crashCd: 0, wakeAcc: 0, idleRing: 0, saveT: 0, spookCd: 0, netT: 0, nearPort: null, nearWreck: null, nearSchool: null,
};
const frac = x => x - Math.floor(x);
const K = k => !!G.keys[k];
export const inp = {
  up: () => K('ArrowUp') || K('w') || K('W'), down: () => K('ArrowDown') || K('s') || K('S'),
  left: () => K('ArrowLeft') || K('a') || K('A'), right: () => K('ArrowRight') || K('d') || K('D'),
};
export const hit = (...ks) => ks.some(k => G.pressed.has(k));

// ---------- derived stats ----------
export const boatDef = () => BOATS.find(b => b.id === G.boatId);
export const cap = () => boatDef().hold + 2 * G.up.hold;
export const hpMax = () => Math.round(boatDef().hp * (1 + 0.25 * G.up.hull));
export const speedMul = () => boatDef().speed * (1 + 0.12 * G.up.prop);
export const sonarLvl = () => Math.max(G.up.sonar, boatDef().sonar);
export const lightR = () => 18 + 17 * G.up.lantern;
export const netLvl = () => Math.max(G.up.net, boatDef().net);
export const lineMax = () => 1 + 0.12 * G.up.line;
export const contractSlots = () => 3 + G.up.quarter;
const ICE_GRACE = [150, 360, 900, Infinity];
export function freshness(f) { const age = G.clock - (f.t ?? G.clock), g = ICE_GRACE[G.up.ice]; return age < g ? 1 : Math.max(0.7, 1 - (age - g) / 600 * 0.3); }
export const fishValue = f => Math.round(f.value * freshness(f));
export const env = () => { const c = dayFrac(); return { night: isNight(), twilight: (c > 0.56 && c < 0.7) || c > 0.88 || c < 0.03, weather: WX.state }; };
// what the boat should visibly carry
export function equipment() {
  const u = G.up; return { paint: G.paint, plate: u.hull, prop: u.prop, lantern: u.lantern, sonar: sonarLvl(), rod: u.rod, ice: u.ice, tackle: u.tackle, net: u.net, radio: u.radio, anchor: u.anchor, hold: u.hold, pile: Math.min(3, Math.ceil(G.hold.length / 3)), deckhand: u.deckhand, cook: u.cook, quarter: u.quarter, bilge: u.bilge, reel: u.reel };
}
export const logged = () => SPECIES.filter(s => G.log[s.id]).length;

// ---------- clock, wind ----------
export const DAYLEN = 480;
export const dayFrac = () => frac(G.clock / DAYLEN);
export const dayNum = () => Math.floor(G.clock / DAYLEN) + 1;
export function darkness() { const c = dayFrac(); return c < 0.6 ? 0 : c < 0.68 ? (c - 0.6) / 0.08 : c < 0.9 ? 1 : 1 - (c - 0.9) / 0.1; }
export const isNight = () => darkness() > 0.5;
export const windAngle = () => 0.9 + 2.2 * nA(G.clock * 0.0015, 7.3);
function sailEff(a) {
  let rel = Math.abs(((a - windAngle()) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return rel < Math.PI / 2 ? 1 + 0.2 * Math.sin(rel) : 0.35 + 0.85 * Math.cos(rel - Math.PI / 2);
}
export const sailEfficiency = () => sailEff(G.boat.a);

export function caption(s) { const c = G.captions.find(q => q.s === s); if (c) c.t = 2.2; else { G.captions.push({ s, t: 2.2 }); if (G.captions.length > 3) G.captions.shift(); } }
setCaptionHook(s => { if (SET.captions) caption(s); });
export function toast(s, kind = 'info') { G.toasts.push({ s, kind, t: 2.8 }); if (G.toasts.length > 4) G.toasts.shift(); }
export function spawn(o) { o.max = o.life; G.parts.push(o); }
function addCoins(n, why) { G.coins += n; if (n > 0) G.earned += n; G.floaters.push({ s: (n >= 0 ? '+$' : '-$') + Math.abs(n), t: 1.4, kind: n >= 0 ? 'good' : 'bad' }); }
export const boatSpeed = () => Math.hypot(G.boat.vx, G.boat.vy);
export function toWorld(u, v, b = G.boat) { const c = Math.cos(b.a), s = Math.sin(b.a); return [b.x + u * c - v * s, b.y + u * s + v * c]; }

// ---------- goals ----------
const GOALS = [
  ['Catch a fish', 10, () => G.stats.caught >= 1],
  ['Sell fish at a port', 10, () => G.stats.sold >= 1],
  ['Buy an upgrade', 20, () => G.stats.upgrades >= 1],
  ['Chart a lighthouse', 20, () => G.stats.lights >= 1],
  ['Deliver a port contract', 40, () => G.stats.contracts >= 1],
  ['Log 5 species', 50, () => logged() >= 5, () => [logged(), 5]],
  ['Catch a trophy fish', 60, () => G.stats.trophies >= 1],
  ['Buy the Sail Skiff', 60, () => G.owned.includes('skiff')],
  ['Catch a fish at night', 60, () => G.stats.night >= 1],
  ['Salvage a wreck', 50, () => G.stats.wrecks >= 1],
  ['Find a sunken treasure', 100, () => G.stats.treasures >= 1],
  ['Fish through a storm', 120, () => G.stats.storm >= 1],
  ['Fish a feeding frenzy', 80, () => G.stats.frenzy >= 1],
  ['Buy the Motor Launch', 150, () => G.owned.includes('launch')],
  ['Land a Bluefin Tuna', 200, () => !!G.log.tuna],
  ['Log 10 species', 250, () => logged() >= 10, () => [logged(), 10]],
  ['Buy the Trawler', 400, () => G.owned.includes('trawler')],
  ['Catch the Ghost Carp', 600, () => !!G.log.ghost],
  ['Catch the Old One', 2500, () => !!G.log.oldone],
  ['Complete the logbook', 1500, () => logged() >= SPECIES.length, () => [logged(), SPECIES.length]],
  ['Chart 8 lighthouses', 200, () => G.stats.lights >= 8, () => [G.stats.lights, 8]],
  ['Catch 10 trophies', 300, () => G.stats.trophies >= 10, () => [G.stats.trophies, 10]],
  ['Earn $10,000 in total', 500, () => G.earned >= 10000, () => [G.earned, 10000]],
  ['Max out every upgrade', 800, () => Object.keys(UPGRADES).every(k => G.up[k] >= UPGRADES[k].costs.length)],
  ['A trophy of every species', 3000, () => trophied() >= SPECIES.length, () => [trophied(), SPECIES.length]],
];
const trophied = () => SPECIES.filter(s => G.log[s.id]?.trophy).length;
// goals can be completed in any order; the HUD shows the first one still open
export function currentGoal() {
  const i = GOALS.findIndex((_, k) => !G.goalsDone.includes(k)), g = GOALS[i];
  if (!g) return { text: 'Break your own records', prog: null };
  return { text: g[0], prog: g[3] ? g[3]() : null, reward: g[1] };
}
function checkGoals() {
  GOALS.forEach(([text, reward, done], k) => {
    if (G.goalsDone.includes(k) || !done()) return;
    G.goalsDone.push(k); G.goalIdx = G.goalsDone.length;
    addCoins(reward); toast(`Goal complete: ${text}  +$${reward}`, 'good'); sfx('fanfare');
  });
}

// ---------- save / load ----------
const KEY = 'bobber-run-save-v3', OLD = 'bobber-run-save-v2';
export function saveGame() {
  try {
    const b = G.boat;
    localStorage.setItem(KEY, JSON.stringify({ coins: G.coins, earned: G.earned, up: G.up, hp: b.hp, hold: G.hold, log: G.log, boatId: G.boatId, owned: G.owned,
      bait: G.bait, baitSel: G.baitSel, paint: G.paint, paints: G.paints, found: [...G.found], salvaged: [...G.salvaged], lastPort: G.lastPort, x: b.x, y: b.y, a: b.a,
      stats: G.stats, goalIdx: G.goalIdx, goalsDone: G.goalsDone, maps: G.maps, musicOn: G.musicOn, offers: G.offers, active: G.active, pity: G.pity, clock: G.clock }));
  } catch (_) { }
}
export const hasSave = () => { try { return !!(localStorage.getItem(KEY) || localStorage.getItem(OLD)); } catch (_) { return false; } };
function portById(id) {
  const m = /^port:(-?\d+),(-?\d+)$/.exec(id || ''); if (!m) return homePort();
  return cellPois(+m[1], +m[2]).find(p => p.id === id) || homePort();
}
export function placeAtPort(p) {
  const b = G.boat; b.x = p.dock.x; b.y = p.dock.y; b.a = p.ang; b.vx = b.vy = b.w = 0; b.px = b.x; b.py = b.y; b.pa = b.a;
  G.cam.x = b.x - W / 2; G.cam.y = b.y - H / 2; G.look.x = G.look.y = 0;
}
export function newGame() {
  Object.assign(G, { coins: 15, coinsShown: 15, earned: 0, paint: 'classic', paints: ['classic'], up: Object.fromEntries(Object.keys(UPGRADES).map(k => [k, 0])), bait: { shrimp: 3, glow: 0, chum: 1 }, baitSel: 'shrimp',
    hold: [], log: {}, found: new Set(), salvaged: new Set(), sat: {}, fish: null, parts: [], toasts: [], floaters: [], boatId: 'row', owned: ['row'],
    stats: { caught: 0, sold: 0, upgrades: 0, lights: 0, contracts: 0, wrecks: 0, trophies: 0, night: 0, frenzy: 0, treasures: 0, storm: 0 }, goalIdx: 0, goalsDone: [], maps: [], offers: {}, active: [], pity: 0,
    clock: DAYLEN * 0.08, frenzy: null, nextFrenzy: 45, card: null });
  const home = homePort(); G.lastPort = home.id; G.found.add(home.id); G.boat.hp = hpMax();
  placeAtPort(home);
}
export function loadGame() {
  try {
    let d = JSON.parse(localStorage.getItem(KEY));
    newGame();
    if (!d) {                                          // migrate the previous version's save
      const o = JSON.parse(localStorage.getItem(OLD)); if (!o) return;
      d = { coins: o.coins, earned: o.earned, up: { prop: o.up?.oars || 0, hull: o.up?.hull || 0, hold: o.up?.hold || 0, rod: o.up?.rod || 0 }, found: o.found, salvaged: o.salvaged, lastPort: o.lastPort,
        log: Object.fromEntries(Object.entries(o.log || {}).filter(([k]) => SP[k] !== undefined).map(([k, n]) => [k, { n, best: 0 }])), x: o.x, y: o.y, a: o.a };
    }
    Object.assign(G, { coins: d.coins | 0, coinsShown: d.coins | 0, earned: d.earned | 0, up: { ...G.up, ...d.up }, hold: (d.hold || []).filter(f => f && typeof f === 'object'),
      log: d.log || {}, boatId: d.boatId || 'row', owned: d.owned || ['row'], bait: { ...G.bait, ...d.bait }, baitSel: d.baitSel || 'shrimp', paint: d.paint || 'classic', paints: d.paints || ['classic'],
      found: new Set(d.found || []), salvaged: new Set(d.salvaged || []), lastPort: d.lastPort || G.lastPort, stats: { ...G.stats, ...d.stats },
      goalIdx: d.goalIdx | 0, goalsDone: d.goalsDone || [], maps: d.maps || [], musicOn: d.musicOn ?? true, offers: d.offers || {}, active: d.active || [], pity: d.pity | 0, clock: d.clock ?? G.clock });
    G.boat.hp = clamp(d.hp ?? hpMax(), 1, hpMax());
    for (const c of [...G.active, ...Object.values(G.offers).flat()]) if (c && c.to) c.toName = portById(c.to).name;   // older saves stored names in capitals
    if (Number.isFinite(d.x) && hAt(d.x, d.y) < -0.05) { Object.assign(G.boat, { x: d.x, y: d.y, a: d.a || 0, px: d.x, py: d.y, pa: d.a || 0 }); G.cam.x = d.x - W / 2; G.cam.y = d.y - H / 2; }
    else placeAtPort(portById(G.lastPort));
  } catch (_) { newGame(); }
}
export function wipeSave() { try { localStorage.removeItem(KEY); localStorage.removeItem(OLD); } catch (_) { } }

// ---------- physics ----------
const hullCache = {};
function hullPoints() {
  const b = boatDef(); if (hullCache[b.id]) return hullCache[b.id];
  const pts = []; for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2, c = Math.cos(a); pts.push([c * (c > 0 ? b.L : b.L * 0.93), Math.sin(a) * b.B]); }
  return (hullCache[b.id] = pts);
}
const RESTITUTION = 0.2, FRICTION = 0.35, DRAFT = 0.028;
let solids = [];
export function refreshSolids() { solids = poisNear(G.boat.x, G.boat.y, 140).filter(p => p.solid).map(p => p.solid); }
function shapeContact(so, px, py) {
  let cx, cy;
  if (so.kind === 'circ') { cx = so.x; cy = so.y; }
  else { const dx = so.bx - so.ax, dy = so.by - so.ay, t = clamp(((px - so.ax) * dx + (py - so.ay) * dy) / (dx * dx + dy * dy), 0, 1); cx = so.ax + dx * t; cy = so.ay + dy * t; }
  const d = Math.hypot(px - cx, py - cy); if (d >= so.r) return null;
  const inv = d > 1e-4 ? 1 / d : 0; return { pen: so.r - d, nx: (px - cx) * inv, ny: (py - cy) * inv };
}
function contacts() {
  const b = G.boat, I = 200 * Math.pow(boatDef().L / 13.5, 2); let impact = 0, at = null;
  for (let it = 0; it < 3; it++) {
    const c = Math.cos(b.a), s = Math.sin(b.a); let any = false;
    for (const [u, v] of hullPoints()) {
      const rx = u * c - v * s, ry = u * s + v * c, px = b.x + rx, py = b.y + ry;
      let pen = 0, nx = 0, ny = 0;
      const h = hBil(px, py);
      if (h > -DRAFT) {
        const gx = hBil(px + 1.5, py) - hBil(px - 1.5, py), gy = hBil(px, py + 1.5) - hBil(px, py - 1.5), gl = Math.hypot(gx, gy);
        if (gl > 1e-6) { nx = -gx / gl; ny = -gy / gl; pen = Math.min(2.5, (h + DRAFT) / (gl / 3) + 0.05); }
        else { const l = Math.hypot(rx, ry) || 1; nx = -rx / l; ny = -ry / l; pen = 0.5; }
      }
      for (const so of solids) { const r = shapeContact(so, px, py); if (r && r.pen > pen) { pen = r.pen; nx = r.nx; ny = r.ny; } }
      if (pen <= 0) continue;
      any = true;
      b.x += nx * pen * 0.4; b.y += ny * pen * 0.4;
      const vpx = b.vx - b.w * ry, vpy = b.vy + b.w * rx, vn = vpx * nx + vpy * ny;
      if (vn < 0) {
        const rn = rx * ny - ry * nx, j = -(1 + RESTITUTION) * vn / (1 + rn * rn / I);
        b.vx += j * nx; b.vy += j * ny; b.w += rn * j / I;
        const tx = -ny, ty = nx, vt = vpx * tx + vpy * ty, rt = rx * ty - ry * tx;
        const jt = clamp(-vt / (1 + rt * rt / I), -FRICTION * j, FRICTION * j);
        b.vx += jt * tx; b.vy += jt * ty; b.w += rt * jt / I;
        if (-vn > impact) { impact = -vn; at = { x: px, y: py, nx, ny }; }
      }
    }
    if (!any) break;
  }
  if (at) onImpact(impact, at);
}
function onImpact(I, at) {
  if (I < 3 || G.crashCd > 0) return;
  G.crashCd = 0.3;
  const k = clamp((I - 4) / 30, 0, 1);
  for (let i = 0; i < 4 + k * 18; i++) { const a = Math.atan2(at.ny, at.nx) + (Math.random() - 0.5) * 2.4, sp = 8 + Math.random() * 30 * (0.4 + k); spawn({ kind: 'dot', x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.5 }); }
  if (I < 9) { sfx('scrape', 0.4 + k); return; }
  G.shake = Math.max(G.shake, 1.5 + k * 5);
  sfx('crash', 0.6 + k * 0.7, 1.1 - k * 0.3);
  for (let i = 0; i < 3 + k * 10; i++) { const a = Math.random() * 6.28, sp = 6 + Math.random() * 22; spawn({ kind: 'debris', x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + Math.random() * 1.5 }); }
  if (I > 11) {
    const dmg = Math.round((I - 11) * 1.7 * (1 - 0.12 * G.up.hull));
    if (dmg > 0) { G.boat.hp -= dmg; toast(`-${dmg} hull`, 'bad'); if (G.boat.hp <= 0) sink(); else if (G.boat.hp < hpMax() * 0.3) toast('Hull critical. Repair at a port', 'bad'); }
  }
}
export function physicsStep(dt) {
  const b = G.boat, bd = boatDef(); b.px = b.x; b.py = b.y; b.pa = b.a;
  const thr = inp.up() ? 1 : 0, rev = inp.down() ? 1 : 0, steer = G.fish ? 0 : (inp.right() ? 1 : 0) - (inp.left() ? 1 : 0);
  if (G.fish && (thr || rev)) cancelFishing('Reeled in');
  let c = Math.cos(b.a), s = Math.sin(b.a);
  let vf = b.vx * c + b.vy * s, vs = -b.vx * s + b.vy * c;
  const shallow = clamp((hBil(b.x, b.y) + 0.1) / 0.09, 0, 1), k = 0.6 * bd.accel;
  vf *= Math.exp(-(k + 2.2 * shallow) * dt); vs *= Math.exp(-(3.2 + 3 * shallow) * dt);
  let push = 20 * speedMul() * bd.accel;
  if (bd.prop === 'SAIL') push *= sailEff(b.a) * (1 + 0.3 * WX.wind);
  if (!G.fish) vf += (thr * push - rev * push * 0.45) * dt;
  const turnT = steer * 1.25 * bd.turn * (0.45 + 0.55 * Math.min(1, Math.abs(vf) / 22));
  b.w += (turnT - b.w) * (1 - Math.exp(-4 * dt));
  b.a += b.w * dt;
  c = Math.cos(b.a); s = Math.sin(b.a);
  b.vx = vf * c - vs * s; b.vy = vf * s + vs * c;
  const anchored = G.up.anchor > 0 && (G.fish || Math.hypot(b.vx, b.vy) < 6) && !thr && !rev;
  if (WX.wind > 0.3 && !anchored) { const wa = windAngle(), gust = (WX.wind - 0.3) * 10 * (0.6 + 0.4 * Math.sin(G.t * 0.8)) * 13.5 / bd.L; b.vx += Math.cos(wa) * gust * dt; b.vy += Math.sin(wa) * gust * dt; }
  b.x += b.vx * dt; b.y += b.vy * dt;
  contacts();
  G.throttle = thr || rev;
  if (bd.id !== 'row') return;
  const rowing = (thr || rev || steer) && !G.fish, prev = b.phase;
  if (rowing) b.phase += dt * (rev && !thr ? -0.7 : 0.75) * (0.85 + 0.15 * speedMul());
  else if (Math.abs(frac(b.phase) - 0.5) > 0.03) b.phase += dt * 0.75;
  if (rowing && Math.floor(prev) !== Math.floor(b.phase)) {
    for (const sgn of [-1, 1]) {
      const [x, y] = toWorld(rev && !thr ? -OAR.sweep : OAR.sweep, sgn * OAR.reach);
      spawn({ kind: 'ring', x, y, life: 1.1, r0: 1, grow: 6 });
      for (let i = 0; i < 4; i++) spawn({ kind: 'dot', x, y, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, life: 0.45 });
    }
    sfx('oar', 0.7, 1, -0.35); setTimeout(() => sfx('oar', 0.6, 1, 0.35), 40);
  }
}

function sink() {
  G.mode = 'sunk'; G.sunkT = 0; sfx('sink');
  const fee = Math.min(G.coins, 10 + Math.round(G.coins * 0.1)), lost = G.hold.length;
  G.coins -= fee; G.hold = []; G.fish = null;
  G.sunkMsg = `You lost ${lost} fish and paid $${fee} for the tow`;
  for (let i = 0; i < 30; i++) spawn({ kind: 'debris', x: G.boat.x, y: G.boat.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 2 + Math.random() * 2 });
}

// ---------- fishing ----------
export const schoolActive = s => s.stock > 0 && activeAt(s.sp, env()) && !(s.spooked > G.t);
function nearestSchool() {
  const b = G.boat; let best = null, bd = 50 + boatDef().L * 0.5;
  for (const s of schoolsNear(b.x, b.y, 90)) { if (!schoolActive(s)) continue; const d = Math.hypot(s.x - b.x, s.y - b.y); if (d < bd) { bd = d; best = s; } }
  return best;
}
export function cancelFishing(msg) { if (G.fish && msg) toast(msg); G.fish = null; }
function tryCast() {
  const b = G.boat, s = G.nearSchool, sp = SPECIES[s.sp];
  if (G.hold.length >= cap()) { toast('Hold full. Sell at a port', 'bad'); sfx('deny'); return; }
  if (sp.rod > G.up.rod) { toast(`${sp.name} needs a level ${sp.rod + 1} rod`, 'bad'); sfx('deny'); return; }
  const bait = G.baitSel !== 'none' && G.bait[G.baitSel] > 0 ? G.baitSel : null;
  if (bait) G.bait[bait]--;
  const frenzy = G.frenzy && G.frenzy.s === s;
  G.fish = { st: 'cast', s, t: 0, tx: s.x + (Math.random() - 0.5) * 8, ty: s.y + (Math.random() - 0.5) * 8, tension: 0, prog: 0, ph: Math.random() * 6, wait: 0, reelT: 0, bait, frenzy, perfect: false };
  sfx('cast');
}
export const TUNE = { k: 1.5, surge: 0.55 };
const FIGHT = {
  steady: ph => 0.45 + 0.25 * Math.sin(ph * 0.6),
  darter: ph => Math.pow(Math.max(0, Math.sin(ph * 1.9)), 5) * 2.6 + 0.1,
  generic: ph => Math.max(0, Math.sin(ph) * 1.3 + Math.sin(ph * 2.7 + 1) * 0.6 - 0.2),
  jumper: ph => Math.max(0, Math.sin(ph) * 1.1 + Math.sin(ph * 2.7 + 1) * 0.5 - 0.2),
  erratic: ph => Math.max(0, nA(ph * 0.8, 3.1) * 1.85 + 0.15),
  boss: ph => Math.max(0, nA(ph * 0.7, 9.7) * 1.5 + 0.1),
};
function updateFishing(dt) {
  const f = G.fish; if (!f) return;
  f.t += dt; const sp = SPECIES[f.s.sp], rod = G.up.rod, b = G.boat;
  if (Math.hypot(f.tx - b.x, f.ty - b.y) > 80) { cancelFishing('Line too long. You sailed away'); return; }
  const strike = hit(' ');
  if (f.st === 'cast') {
    if (f.t >= 0.55) {
      f.st = 'wait'; f.t = 0;
      f.wait = (1.4 + Math.random() * 2.6) * (1 - 0.1 * rod) * (f.frenzy ? 0.4 : 1) * (f.bait === 'glow' && isNight() ? 0.5 : f.bait ? 0.75 : 1) * biteMul() * (1 - 0.12 * G.up.tackle);
      spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.9, r0: 1, grow: 5 }); sfx('plop', 0.5);
    }
  } else if (f.st === 'wait') {
    if (strike) { toast('Too early. Wait for the bobber to dip'); f.wait += 1.2; sfx('deny', 0.5); }
    if (Math.random() < dt * 0.8) spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.8, r0: 2, grow: 3 });
    if (f.t >= f.wait) { f.st = 'bite'; f.t = 0; sfx('bite'); for (let i = 0; i < 6; i++) spawn({ kind: 'dot', x: f.tx, y: f.ty, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0.4 }); }
  } else if (f.st === 'bite') {
    const relaxed = SET.strike === 'relaxed' ? 1.6 : 1;
    const perfectWin = ((G.boatId === 'row' ? 0.32 : 0.2) + 0.03 * rod + 0.05 * Math.max(0, G.up.tackle - 1)) * relaxed;
    const auto = (G.up.deckhand >= 2 && f.t > 0.42) || (SET.strike === 'auto' && f.t > 0.3);
    if (auto && SET.strike !== 'auto') toast('Your deckhand sets the hook');
    if (strike || auto) {
      f.st = 'reel'; f.perfect = f.t < perfectWin; f.t = 0;
      f.tension = f.perfect ? 0.1 : 0.25; f.prog = f.perfect ? 0.25 : 0.08; f.reeling = true;
      sfx(f.perfect ? 'perfect' : 'plop'); if (f.perfect) toast('Perfect strike!', 'good');
    } else if (f.t > (0.75 + 0.12 * rod) * relaxed) { toast('It got away. Wait for another bite'); f.st = 'wait'; f.t = 0; f.wait = 1.5 + Math.random() * 2.5; }
  } else if (f.st === 'reel') {
    const S = FIGHT[sp.fight], stage = f.stage || 0;
    f.ph += dt * (1.5 + sp.diff() * 2.5);
    const assist = SET.reelAssist ? 0.7 : 1;
    const surge = S(f.ph), pull = sp.diff() * (0.3 + surge * TUNE.surge * assist) * (1 + 0.1 * stage);
    if (SET.reelToggle && strike) { f.reeling = !f.reeling; sfx('move', 0.4); }
    const held = SET.reelToggle ? f.reeling : K(' '), reeling = held && !(SET.reelAssist && f.jump);   // assist lets go during jumps
    // telegraph: look a moment ahead so the warning shows before the surge lands
    f.surge = surge; f.warn = S(f.ph + 0.5) > 0.9 && sp.diff() > 0.3 && sp.fight !== 'steady';
    if (sp.fight === 'jumper' || sp.fight === 'boss') {
      if (f.jumpT === undefined) f.jumpT = 2 + Math.random() * 2;
      if (f.jump) {
        f.jump.t += dt; if (reeling) f.tension += 1.6 * dt;
        if (f.jump.t > 0.75) { f.jump = null; spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 1, r0: 2, grow: 7 }); for (let i = 0; i < 8; i++) spawn({ kind: 'dot', x: f.tx, y: f.ty, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.5 }); sfx('oar', 1, 0.7); }
      } else if ((f.jumpT -= dt) <= 0) { f.jump = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 }; f.jumpT = 2.2 + Math.random() * 2.2; sfx('oar', 0.8, 1.2); }
      f.jumpWarn = !f.jump && f.jumpT < 0.5;
    }
    f.reelOn = reeling;
    if (reeling) {
      f.tension += (0.36 + pull * TUNE.k - rod * 0.05) * dt * (SET.reelAssist ? 0.85 : 1);
      f.prog += (0.4 - sp.diff() * 0.24 + rod * 0.025) * (1 + 0.12 * G.up.reel) * dt * (1 - Math.min(0.6, surge * 0.35));
      if ((f.reelT += dt) > 0.07) { f.reelT = 0; sfx('reel'); }
    } else { f.tension += (pull * 0.2 - 0.75 - rod * 0.05) * dt; f.prog = Math.max(0, f.prog - 0.035 * dt); }
    f.tension = Math.max(0, f.tension);
    if (surge > 1) G.shake = Math.max(G.shake, 0.6);
    if (Math.random() < dt * (3 + surge * 10)) spawn({ kind: 'dot', x: f.tx + (Math.random() - 0.5) * 4, y: f.ty + (Math.random() - 0.5) * 3, vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.5) * 18, life: 0.35 });
    if (f.tension >= lineMax()) { sfx('snap'); toast(f.jump ? 'It threw the hook mid-jump!' : 'Line snapped!', 'bad'); G.fish = null; }
    else if (f.prog >= 1 && sp.fight === 'boss' && stage < 2) {
      f.stage = stage + 1; f.prog = 0.12; f.tension = Math.min(f.tension, 0.4); G.shake = 4; sfx('crash', 0.6, 0.5);
      toast(`It is still fighting! Round ${f.stage + 1} of 3`, 'bad');
    }
    else if (f.prog >= 1) landFish();
  }
}
for (const s of SPECIES) s.diff = () => Math.min(0.95, 0.12 + s.rod * 0.18 + Math.min(0.2, s.base / 900));

function rollCatch(spIdx, f) {
  const s = SPECIES[spIdx];
  let r = Math.pow(Math.random(), 2.2); if (f?.perfect) r = Math.min(1, r + 0.1);
  const chance = Math.min(0.3, 0.04 + G.pity * 0.006) + (f?.bait === 'shrimp' ? 0.05 : f?.bait === 'glow' ? 0.12 : 0) + (f?.frenzy ? 0.1 : 0) + (f?.perfect ? 0.04 : 0) + trophyBonus();
  const trophy = Math.random() < chance;
  if (trophy) { r = Math.max(r, 0.82 + Math.random() * 0.18); G.pity = 0; } else G.pity++;
  const kg = Math.round((s.kg[0] + (s.kg[1] - s.kg[0]) * r) * 100) / 100;
  return { sp: spIdx, kg, value: Math.max(1, Math.round(s.base * (0.55 + 0.9 * r) * (trophy ? 1.8 : 1))), trophy };
}
function landFish(netted = null, who = 'NETTED') {
  const f = G.fish, spIdx = netted ?? f.s.sp, sp = SPECIES[spIdx], fish = rollCatch(spIdx, netted !== null ? null : f);
  fish.t = G.clock; G.hold.push(fish);
  const school = netted !== null ? G.netSchool : f.s; school.stock--; if (school.stock <= 0) school.respawn = G.t + (school.boss ? 1200 : 90);
  if (WX.state === 'storm') G.stats.storm = (G.stats.storm || 0) + 1;
  const prev = G.log[sp.id], first = !prev, record = prev && fish.kg > prev.best;
  const firstTrophy = fish.trophy && !prev?.trophy;
  G.log[sp.id] = { n: (prev?.n || 0) + 1, best: Math.max(prev?.best || 0, fish.kg), trophy: !!(prev?.trophy || fish.trophy) };
  if (firstTrophy && netted !== null) toast(`First ${sp.name} trophy!`, 'good');
  G.stats.caught++; if (fish.trophy) G.stats.trophies++; if (isNight()) G.stats.night++; if (f?.frenzy) G.stats.frenzy++;
  let bonus = null;
  if (netted === null && Math.random() < 0.12) {
    const map = G.maps.length < 2 && Math.random() < 0.4 ? makeMap() : null;
    if (map) { G.maps.push(map); bonus = 'A bottle with a treasure map! Check your chart'; }
    else if (Math.random() < 0.6) { const c = 6 + Math.floor(Math.random() * (10 + sp.base * 0.4)); addCoins(c); bonus = `Also hooked a bottle with $${c} inside`; }
    else { G.bait.shrimp += 3; bonus = 'Also hooked 3 shrimp bait'; }
  }
  if (netted === null) {
    G.card = { fish, first, record, perfect: f.perfect, bonus, t: 0 };
    sfx(fish.trophy || first ? 'fanfare' : 'catch');
    G.catchAnim = { sp: spIdx, t: 0, x: f.tx, y: f.ty };
  } else { toast(`${who === 'DECKHAND' ? 'Your deckhand landed' : 'Netted'} ${sp.name}, ${fmtKg(fish.kg)}`); sfx('coin', 0.5, 0.8); }
  if (G.hold.length >= cap()) toast('Hold full. Head to a port to sell', 'good');
  if (netted === null) { G.fish = null; bonusFromDeckhand(spIdx); }
  saveGame();
}

// ---------- treasure maps ----------
function makeMap() {
  const b = G.boat;
  for (let k = 0; k < 80; k++) {
    const a = Math.random() * 6.283, d = 500 + Math.random() * 900, x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d, h = heightAt(x, y);
    if (h > -0.16 && h < -0.05) return { id: Math.random().toString(36).slice(2, 7), x: Math.round(x), y: Math.round(y), reward: Math.round(150 + d * 0.25 + Math.random() * 150) };
  }
  return null;
}
function haul(m) {
  G.maps = G.maps.filter(q => q !== m); G.stats.treasures++; addCoins(m.reward);
  const lures = Math.random() < 0.5; if (lures) G.bait.glow += 3;
  toast(`Treasure! +$${m.reward}${lures ? ' and 3 glow lures' : ''}`, 'good'); sfx('fanfare'); celebrate(); G.shake = 2;
  for (let i = 0; i < 20; i++) spawn({ kind: 'spark', x: m.x, y: m.y, vx: (Math.random() - 0.5) * 50, vy: (Math.random() - 0.5) * 50, life: 1 }); saveGame();
}

// ---------- frenzies ----------
function updateFrenzy(dt) {
  if (WX.state === 'storm') G.nextFrenzy -= dt;
  if (G.frenzy && Math.random() < dt * 7) { const s = G.frenzy.s, x = s.x + (Math.random() - 0.5) * 22, y = s.y + (Math.random() - 0.5) * 14; spawn({ kind: 'ring', x, y, life: 0.7, r0: 1, grow: 4 }); for (let i = 0; i < 3; i++) spawn({ kind: 'dot', x, y, vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16, life: 0.4 }); }
  if (G.frenzy && G.t > G.frenzy.until) { G.frenzy = null; G.nextFrenzy = G.t + (70 + Math.random() * 50) * (G.up.radio ? 0.65 : 1); }
  if (!G.frenzy && G.t > G.nextFrenzy) {
    const b = G.boat, cands = schoolsNear(b.x, b.y, 420).filter(s => { const d = Math.hypot(s.x - b.x, s.y - b.y); return d > 120 && d < 420 && activeAt(s.sp, env()) && SPECIES[s.sp].rod <= G.up.rod + 1 && !s.boss && !SPECIES[s.sp].legend; });
    if (cands.length) { const s = cands[Math.floor(Math.random() * cands.length)]; s.stock = Math.max(s.stock, 6); s.spooked = 0; G.frenzy = { s, until: G.t + 70 }; toast(`Feeding frenzy! Follow the gulls to the ${SPECIES[s.sp].name}`, 'good'); sfx('gulls'); }
    else G.nextFrenzy = G.t + 20;
  }
}

// ---------- ports ----------
export function priceAt(p, spIdx, extra = 0) { const s = (G.sat[p.id]?.[spIdx] || 0) + extra; return p.mult[spIdx] * Math.max(0.5, 1 - s * 0.07); }
function reserved() {          // fish set aside for active contracts (best ones by species)
  const keep = new Set();
  for (const c of G.active) { let n = c.n; G.hold.map((f, i) => [f, i]).filter(([f]) => f.sp === c.sp && !keep.has(f)).sort((a, b) => b[0].value - a[0].value).forEach(([f]) => { if (n-- > 0) keep.add(f); }); }
  return keep;
}
export function saleValue(p) {
  const keep = reserved(), cnt = {}; let tot = 0, n = 0;
  for (const f of G.hold) { if (keep.has(f)) continue; tot += Math.round(fishValue(f) * priceAt(p, f.sp, cnt[f.sp] || 0) * (1 + 0.1 * G.up.cook)); cnt[f.sp] = (cnt[f.sp] || 0) + 1; n++; }
  return { tot, n, kept: keep.size };
}
function sell(p) {
  const { tot, n } = saleValue(p); if (!n) return sfx('deny');
  const keep = reserved(), sat = G.sat[p.id] || (G.sat[p.id] = {});
  for (const f of G.hold) if (!keep.has(f)) sat[f.sp] = (sat[f.sp] || 0) + 1;
  G.hold = G.hold.filter(f => keep.has(f));
  addCoins(tot); G.stats.sold++;
  sfx('coin'); setTimeout(() => sfx('coin', 0.7, 1.3), 90); toast(`Sold ${n} fish for $${tot}`, 'good'); saveGame();
}
function repair() {
  const m = hpMax(), miss = m - G.boat.hp; if (miss <= 0 || G.coins <= 0) return sfx('deny');
  const cost = Math.ceil(miss * 0.3), pay = Math.min(cost, G.coins);
  addCoins(-pay); G.boat.hp = Math.min(m, G.boat.hp + Math.ceil(pay / 0.3)); sfx('select'); toast(G.boat.hp >= m ? 'Hull repaired' : 'Patched what you could afford'); saveGame();
}
function buy(k) {
  const lvl = G.up[k], u = UPGRADES[k]; if (lvl >= u.costs.length) return sfx('deny');
  const cost = u.costs[lvl]; if (G.coins < cost) { toast(`You need $${cost - G.coins} more`, 'bad'); return sfx('deny'); }
  const before = hpMax(); addCoins(-cost); G.up[k]++; G.stats.upgrades++;
  if (k === 'hull') G.boat.hp += hpMax() - before;
  sfx('levelup'); toast(`${u.name(boatDef())} upgraded to level ${G.up[k] + 1}`, 'good'); celebrate(); G.bought = { id: k, t: G.t }; saveGame();
}
export function buySupply(kind) {
  const it = SUPPLIES[kind];
  if (G.coins < it.cost) { toast(`You need $${it.cost - G.coins} more`, 'bad'); return sfx('deny'); }
  addCoins(-it.cost); G.bait[kind] = (G.bait[kind] || 0) + it.n; if (kind !== 'chum') G.baitSel = kind;
  sfx('select'); toast(`+${it.n} ${it.name.toLowerCase()}`); G.bought = { id: kind, t: G.t }; saveGame();
}
function useChum() {
  if (!(G.bait.chum > 0)) { toast('No chum. Buy some at a port', 'bad'); return sfx('deny'); }
  const b = G.boat, s = schoolsNear(b.x, b.y, 170).filter(q => schoolActive(q) && !q.boss && !SPECIES[q.sp].legend).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y))[0];
  if (!s) { toast('No school close enough to chum', 'bad'); return sfx('deny'); }
  G.bait.chum--; s.stock = Math.max(s.stock, 6); s.spooked = 0; G.frenzy = { s, until: G.t + 45 };
  sfx('splash'); sfx('gulls'); toast(`Chum in the water. The ${SPECIES[s.sp].name} are feeding`, 'good');
  for (let i = 0; i < 14; i++) spawn({ kind: 'dot', x: s.x + (Math.random() - 0.5) * 20, y: s.y + (Math.random() - 0.5) * 14, vx: 0, vy: 0, life: 1.5, foam: true });
}
export function bonusFromDeckhand(spIdx) {
  const chance = [0, 0.25, 0.4][G.up.deckhand];
  if (!chance || Math.random() > chance || G.hold.length >= cap()) return;
  const small = SPECIES[spIdx].rod === 0 ? spIdx : SP.sardine;
  G.netSchool = { stock: 99, max: 99 }; landFish(small, 'DECKHAND');
}
function buyPaint(pt) {
  if (G.paints.includes(pt.id)) { if (G.paint === pt.id) return sfx('deny'); G.paint = pt.id; sfx('select'); toast(`Painted ${pt.name.toLowerCase()}`); G.bought = { id: pt.id, t: G.t }; saveGame(); return; }
  if (G.coins < pt.cost) { toast(`You need $${pt.cost - G.coins} more`, 'bad'); return sfx('deny'); }
  addCoins(-pt.cost); G.paints.push(pt.id); G.paint = pt.id; sfx('levelup'); toast(`Fresh coat of ${pt.name.toLowerCase()}`, 'good'); celebrate(); G.bought = { id: pt.id, t: G.t }; saveGame();
}
function buyBoat(bd) {
  if (G.owned.includes(bd.id)) { if (G.boatId === bd.id) return sfx('deny'); switchBoat(bd.id); toast(`Now sailing the ${bd.name}`); sfx('select'); G.bought = { id: bd.id, t: G.t }; saveGame(); return; }
  if (G.coins < bd.cost) { toast(`You need $${bd.cost - G.coins} more`, 'bad'); return sfx('deny'); }
  addCoins(-bd.cost); G.owned.push(bd.id); switchBoat(bd.id); sfx('fanfare'); toast(`You bought the ${bd.name}!`, 'good'); celebrate(); G.bought = { id: bd.id, t: G.t }; saveGame();
}
function switchBoat(id) {
  const frac0 = G.boat.hp / hpMax(); G.boatId = id; G.boat.hp = Math.round(hpMax() * Math.max(frac0, 1));
  while (G.hold.length > cap()) G.hold.pop();
}
function celebrate() { const b = G.boat; for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28; spawn({ kind: 'spark', x: b.x, y: b.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.9 }); } }
function makeOffer(p) {
  const ports = [...G.found].filter(id => id.startsWith('port:') && id !== p.id).map(portById);
  const dest = ports.length ? ports[Math.floor(Math.random() * ports.length)] : p;
  const cands = SPECIES.filter(s => s.w > 0 && s.rod <= G.up.rod + 1);
  let tot = 0; for (const s of cands) tot += s.w; let v = Math.random() * tot, sp = cands[0];
  for (const s of cands) { v -= s.w; if (v <= 0) { sp = s; break; } }
  const n = sp.base < 12 ? 3 + Math.floor(Math.random() * 3) : sp.base < 40 ? 2 + Math.floor(Math.random() * 2) : 1;
  const dist = Math.hypot(dest.x - p.x, dest.y - p.y);
  return { id: Math.random().toString(36).slice(2, 8), from: p.id, to: dest.id, toName: dest.name, sp: SP[sp.id], n, reward: Math.round(n * sp.base * (1.7 + Math.random() * 0.6) + dist / 20) };
}
function offersAt(p) { if (!G.offers[p.id]) G.offers[p.id] = [makeOffer(p), makeOffer(p)]; return G.offers[p.id]; }
export const have = sp => G.hold.filter(f => f.sp === sp).length;
function deliver(c) {
  let n = c.n; G.hold = G.hold.filter(f => !(f.sp === c.sp && n-- > 0));
  const pay = Math.round(c.reward * (1 + 0.15 * G.up.quarter));
  G.active = G.active.filter(a => a !== c); addCoins(pay); G.stats.contracts++;
  sfx('fanfare'); toast(`Contract done  +$${pay}`, 'good'); celebrate(); saveGame();
}
function take(p, c) {
  if (G.active.length >= contractSlots()) { toast(`You can hold ${contractSlots()} contracts at once`, 'bad'); return sfx('deny'); }
  G.active.push(c); G.offers[p.id] = G.offers[p.id].filter(o => o !== c); G.offers[p.id].push(makeOffer(p));
  sfx('select'); toast(`Contract taken: ${c.n} ${SPECIES[c.sp].name} to ${c.toName}`); saveGame();
}
export const ferryCost = (a, b) => 8 + Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 28);
function ferry(from, to) {
  const cost = ferryCost(from, to); if (G.coins < cost) { toast(`You need $${cost - G.coins} more`, 'bad'); return sfx('deny'); }
  addCoins(-cost); G.clock += Math.hypot(from.x - to.x, from.y - to.y) / 6; placeAtPort(to); G.menu.port = to; G.lastPort = to.id; G.menu.tab = 0; G.menu.sel = 1;
  sfx('dock'); toast(`Ferried to ${to.name}`); saveGame();
}
// port menu: one row of tabs; each tab is a single list grouped under section headers.
// Every item says what it costs, whether it can be bought, and if not, why.
export function portTabs(p) { return ['MARKET', 'OUTFITTER', ...(p.shipyard ? ['SHIPYARD'] : []), 'FERRY']; }
const cash = n => '$' + Math.round(n).toLocaleString('en-US');
const short = cost => G.coins < cost ? `You need ${cash(cost - G.coins)} more` : '';
export function portItems(p) {
  const tab = portTabs(p)[G.menu.tab] || 'MARKET', items = [], head = label => items.push({ kind: 'header', label });
  const bonus = 1 + 0.15 * G.up.quarter;
  if (tab === 'MARKET') {
    const sv = saleValue(p);
    head('SELL');
    items.push({ kind: 'sell', icon: 'coin', label: 'Sell your catch', sub: sv.n ? `${sv.n} fish${sv.kept ? `, ${sv.kept} kept for contracts` : ''}` : 'Your hold is empty',
      right: sv.n ? '+' + cash(sv.tot) : '', ok: sv.n > 0, why: sv.n ? '' : (sv.kept ? 'Every fish is kept back for a contract' : 'Your hold is empty. Go fishing!'), action: 'Sell all', act: () => sell(p) });
    head('CONTRACTS');
    for (const c of G.active) if (c.to === p.id) {
      const pay = Math.round(c.reward * bonus), n = have(c.sp);
      items.push({ kind: 'deliver', c, fish: c.sp, label: `Deliver ${c.n} ${SPECIES[c.sp].name}`, sub: `You have ${n} of ${c.n}`, right: '+' + cash(pay), ok: n >= c.n, why: n >= c.n ? '' : `Catch ${c.n - n} more ${SPECIES[c.sp].name}`, action: 'Deliver', act: () => n >= c.n ? deliver(c) : sfx('deny') });
    }
    for (const c of offersAt(p)) {
      const full = G.active.length >= contractSlots();
      items.push({ kind: 'take', c, fish: c.sp, label: `${c.n} ${SPECIES[c.sp].name}`, sub: `Bring them to ${c.toName}`, right: cash(Math.round(c.reward * bonus)), ok: !full,
        why: full ? `You can hold ${contractSlots()} contracts at once` : '', action: 'Take contract', act: () => take(p, c),
        what: `Catch ${c.n} ${SPECIES[c.sp].name} and bring them to ${c.toName}. You are holding ${G.active.length} of ${contractSlots()} contracts.` });
    }
    head('SUPPLIES');
    const miss = hpMax() - G.boat.hp, rc = Math.ceil(miss * 0.3);
    items.push({ kind: 'repair', icon: 'repair', label: 'Repair hull', sub: `${G.boat.hp} of ${hpMax()} hull`, cost: rc, right: miss > 0 ? cash(rc) : 'Sound', ok: miss > 0 && G.coins > 0,
      why: miss <= 0 ? 'Your hull is in good shape' : G.coins <= 0 ? 'You have no coins' : '', action: 'Repair', act: repair, what: 'Patch up your hull. If you are short on coin, you get a partial repair.' });
    for (const [k, it] of Object.entries(SUPPLIES)) items.push({ kind: 'supply', key: k, icon: k, label: `${it.name} ×${it.n}`, sub: `You have ${G.bait[k] || 0}`, cost: it.cost, right: cash(it.cost), ok: G.coins >= it.cost, why: short(it.cost), action: 'Buy', act: () => buySupply(k), what: it.what, repeat: true });
  } else if (tab === 'OUTFITTER') {
    for (const cat of UP_CATS) {
      head(cat);
      for (const k of Object.keys(UPGRADES)) {
        const u = UPGRADES[k]; if (u.cat !== cat) continue;
        const lvl = G.up[k], max = u.costs.length, cost = u.costs[lvl];
        items.push({ kind: 'upgrade', key: k, icon: k, label: u.name(boatDef()), cost: lvl < max ? cost : null, right: lvl >= max ? 'Max' : cash(cost), ok: lvl < max && G.coins >= cost,
          why: lvl >= max ? 'Fully upgraded' : short(cost), action: 'Buy', act: () => buy(k), what: lvl >= max ? null : u.lv[lvl], now: lvl > 0 ? u.lv[lvl - 1] : 'Not fitted yet', pips: [lvl, max] });
      }
    }
  } else if (tab === 'SHIPYARD') {
    head('BOATS');
    for (const bd of BOATS) {
      const own = G.owned.includes(bd.id), on = G.boatId === bd.id;
      items.push({ kind: 'boat', key: bd.id, boat: bd, label: bd.name, sub: bd.what, cost: own ? null : bd.cost, right: on ? 'Sailing' : own ? 'Owned' : cash(bd.cost), ok: own ? !on : G.coins >= bd.cost,
        why: on ? 'You are sailing this boat' : own ? '' : short(bd.cost), action: own ? 'Sail this boat' : 'Buy', act: () => buyBoat(bd) });
    }
    head('PAINT');
    for (const pt of PAINTS) {
      const own = G.paints.includes(pt.id), on = G.paint === pt.id;
      items.push({ kind: 'paint', key: pt.id, pt, paint: pt.id, boat: boatDef(), label: pt.name, sub: own ? 'Owned' : '', cost: own ? null : pt.cost, right: on ? 'On' : own ? 'Owned' : cash(pt.cost), ok: own ? !on : G.coins >= pt.cost,
        why: on ? 'Your boat wears this paint' : own ? '' : short(pt.cost), action: own ? 'Apply' : 'Buy', act: () => buyPaint(pt) });
    }
  } else {
    head('ROUTES');
    const ports = [...G.found].filter(id => id.startsWith('port:') && id !== p.id).map(portById).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 8);
    if (!ports.length) items.push({ kind: 'note', icon: 'map', label: 'No routes yet', sub: 'Chart other ports to open ferry routes', ok: false, why: 'Sail out and discover another port first', act: () => sfx('deny') });
    for (const q of ports) { const cost = ferryCost(p, q); items.push({ kind: 'ferry', q, icon: 'map', label: q.name, sub: `${Math.round(Math.hypot(q.x - p.x, q.y - p.y) / 10)} m away`, cost, right: cash(cost), ok: G.coins >= cost, why: short(cost), action: 'Travel', act: () => ferry(p, q), what: 'Skip the trip. Time still passes while you travel.' }); }
  }
  return items;
}
function dock(p) {
  G.mode = 'port'; G.menu = { tab: 0, sel: 1, port: p }; G.lastPort = p.id; G.fish = null;   // opens on Market with "Sell your catch" selected
  const b = G.boat; b.vx = b.vy = b.w = 0; sfx('dock');
  if (G.active.some(c => c.to === p.id && have(c.sp) >= c.n)) toast('You can deliver a contract here', 'good');
  saveGame();
}
export function leavePort() { const p = G.menu.port; G.mode = 'play'; placeAtPort(p); const b = G.boat; b.vx = Math.cos(b.a) * 6; b.vy = Math.sin(b.a) * 6; sfx('move'); }
function discover(p) {
  G.found.add(p.id);
  const bounty = p.type === 'light' ? 15 : p.type === 'port' ? 10 : 0;
  if (bounty) addCoins(bounty); if (p.type === 'light') G.stats.lights++;
  toast(`Charted ${p.name}${bounty ? `  +$${bounty}` : ''}`, 'good'); sfx('discover'); saveGame();
}
function salvage(p) {
  G.salvaged.add(p.id); addCoins(p.loot); G.stats.wrecks++;
  const extra = Math.random() < 0.5; if (extra) G.bait.glow += 2;
  toast(`Salvaged $${p.loot}${extra ? ' and 2 glow lures' : ''}`, 'good'); sfx('coin'); setTimeout(() => sfx('coin', 0.8, 1.2), 100);
  for (let i = 0; i < 16; i++) spawn({ kind: 'spark', x: p.x, y: p.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.8 }); saveGame();
}

// ---------- per-frame update ----------
export function update(dt) {
  G.t += dt;
  for (let i = G.toasts.length - 1; i >= 0; i--) if ((G.toasts[i].t -= dt) <= 0) G.toasts.splice(i, 1);
  for (let i = G.captions.length - 1; i >= 0; i--) if ((G.captions[i].t -= dt) <= 0) G.captions.splice(i, 1);
  for (let i = G.floaters.length - 1; i >= 0; i--) if ((G.floaters[i].t -= dt) <= 0) G.floaters.splice(i, 1);
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.exp(-3 * dt); p.vx *= k; p.vy *= k; if (p.kind === 'spout') p.vy += 40 * dt; }
    if ((p.life -= dt) <= 0) G.parts.splice(i, 1);
  }
  const dc = G.coins - G.coinsShown; G.coinsShown += Math.abs(dc) < 1 ? dc : Math.sign(dc) * Math.max(1, Math.abs(dc) * 6 * dt);
  G.crashCd -= dt; G.spookCd -= dt;
  G.shake *= Math.exp(-7 * dt);
  G.shakeX = G.shake > 0.05 ? (Math.random() - 0.5) * G.shake : 0; G.shakeY = G.shake > 0.05 ? (Math.random() - 0.5) * G.shake : 0;
  for (const id in G.sat) for (const s in G.sat[id]) G.sat[id][s] = Math.max(0, G.sat[id][s] - dt * 0.02);
  if (G.catchAnim && (G.catchAnim.t += dt) > 0.7) G.catchAnim = null;
  if (G.card) { G.card.t += dt; if (G.card.t > 3.2 || (G.card.t > 0.4 && hit(' ', 'Enter'))) { G.card = null; G.pressed.delete(' '); } }
  if (G.mode !== 'title') checkGoals();
  if (G.mode === 'sunk') { if ((G.sunkT += dt) > 3.4) { placeAtPort(portById(G.lastPort)); G.boat.hp = Math.round(hpMax() * 0.6); G.mode = 'play'; saveGame(); } return; }
  { // soundscape follows the boat: speed wash, nearby surf, weather, engine, luffing sails
    const b0 = G.boat, bd0 = boatDef(), playing = G.mode === 'play';
    let shore = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (hAt(b0.x + Math.cos(a) * 40, b0.y + Math.sin(a) * 40) > -0.05) shore += 0.125; }
    soundscape({ speed: playing ? boatSpeed() : 0, shore, wind: WX.wind, rain: WX.rain, engine: playing && bd0.prop === 'ENGINE', throttle: G.throttle ? 1 : 0,
      luff: playing && bd0.prop === 'SAIL' && G.throttle && sailEff(b0.a) < 0.6 ? 1 : 0, mute: G.mode === 'sunk' }, dt);
  }
  music(dt, G.musicOn, isNight());
  if (G.mode !== 'play') { G.prompt = null; return; }
  G.clock += dt;
  updateWeather(dt, s => toast(s === 'storm' ? 'A storm rolls in. Big fish bite, but mind the wind' : s === 'rain' ? 'Rain. The fish are biting' : s === 'cloudy' ? 'Clouds gather' : 'The sky clears', s === 'storm' ? 'bad' : 'info'),
    () => setTimeout(() => sfx('thunder', 1, 0.8 + Math.random() * 0.4), 200 + Math.random() * 900));
  if (logged() >= 10 && !G.lairTold) { G.lairTold = true; toast('Sailors whisper of the Old One. Its lair is on your chart', 'bad'); }
  const b = G.boat, sp = boatSpeed(), bd = boatDef();
  updateFishing(dt); updateFrenzy(dt);
  for (const s of schoolsNear(b.x, b.y, 260)) {
    if (s.stock <= 0 && G.t > s.respawn) s.stock = s.max;
    if (bd.prop === 'ENGINE' && sp > 22 && Math.hypot(s.x - b.x, s.y - b.y) < 60 && schoolActive(s) && !(G.frenzy?.s === s)) {
      s.spooked = G.t + 25; if (G.spookCd <= 0) { G.spookCd = 20; toast('Your engine spooked a school. Slow down near fish', 'bad'); }
    }
  }
  if (netLvl() > 0 && !G.fish && sp > 3 && sp < 20 && G.hold.length < cap()) {
    const s = schoolsNear(b.x, b.y, 40).find(q => schoolActive(q) && SPECIES[q.sp].rod === 0 && Math.hypot(q.x - b.x, q.y - b.y) < 10 + bd.B * 2);
    if (s && (G.netT += dt) > [0, 3.6, 2.9, 2.2][netLvl()]) { G.netT = 0; G.netSchool = s; landFish(s.sp); }
  }
  G.nearPort = null; G.nearWreck = null;
  for (const p of poisNear(b.x, b.y, 220)) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (!G.found.has(p.id) && d < (p.type === 'light' ? 140 : p.type === 'port' ? 150 : 100) * [1, 1.5, 2][G.up.spyglass]) discover(p);
    if (p.type === 'port' && Math.hypot(p.end.x - b.x, p.end.y - b.y) < 30 + bd.L) G.nearPort = p;
    if (p.type === 'wreck' && !G.salvaged.has(p.id) && d < 30 + bd.L * 0.5) G.nearWreck = p;
  }
  G.nearSchool = G.fish ? null : nearestSchool();
  G.nearTreasure = G.maps.find(m => Math.hypot(m.x - b.x, m.y - b.y) < 16 + bd.L * 0.6) || null;
  for (const c of cratesNear(b.x, b.y, 120)) {
    if (c.taken) { if (G.t > c.respawn) c.taken = false; continue; }
    if (Math.hypot(c.x - b.x, c.y - b.y) < 8 + bd.B) {
      c.taken = true; c.respawn = G.t + 240;
      if (Math.random() < 0.3) { G.bait.shrimp += 2; toast('Flotsam: 2 shrimp bait'); } else { addCoins(c.value); toast(`Flotsam  +$${c.value}`, 'good'); }
      sfx('coin');
      for (let i = 0; i < 10; i++) spawn({ kind: 'debris', x: c.x, y: c.y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.8 });
    }
  }
  const f = G.fish; let pr = null;
  if (f) pr = f.st === 'reel' ? (f.jump || f.jumpWarn ? 'It is jumping. Let go!' : f.warn ? 'It is about to run. Ease off!' : (SET.reelToggle ? 'Press [SPACE] to start or stop reeling' : 'Hold [SPACE] to reel. Let go before the line snaps')) : f.st === 'bite' ? 'Strike now! [SPACE]' : f.st === 'wait' ? 'Wait for the bobber to dip' : null;
  else if (G.nearPort) pr = sp < 14 ? `[E] Dock at ${G.nearPort.name}` : 'Slow down to dock';
  else if (G.nearTreasure) pr = sp < 12 ? '[E] Haul up the treasure chest' : 'Slow down over the X';
  else if (G.nearWreck) pr = sp < 12 ? `[E] Salvage the ${G.nearWreck.name.replace('Wreck of the ', '')}` : 'Slow down to salvage';
  else if (G.nearSchool) { const s = SPECIES[G.nearSchool.sp]; pr = sp < 10 ? `[SPACE] Cast for ${s.name}${s.rod > G.up.rod ? `, needs a level ${s.rod + 1} rod` : ''}` : 'Stop to fish'; }
  G.prompt = pr;
  if (hit('e', 'E', 'Enter')) { if (G.nearPort && sp < 14) dock(G.nearPort); else if (G.nearTreasure && sp < 12) haul(G.nearTreasure); else if (G.nearWreck && sp < 12) salvage(G.nearWreck); }
  if (hit('u', 'U')) { G.musicOn = !G.musicOn; toast(G.musicOn ? 'Music on' : 'Music off'); }
  if (!f && !G.card && hit(' ') && G.nearSchool && sp < 10) tryCast();
  if (hit('c', 'C')) useChum();
  if (hit('b', 'B')) { const order = ['none', 'shrimp', 'glow']; G.baitSel = order[(order.indexOf(G.baitSel) + 1) % 3]; sfx('move'); toast(G.baitSel === 'none' ? 'No bait' : `Using ${SUPPLIES[G.baitSel].name.toLowerCase()}, ${G.bait[G.baitSel]} left`); }
  const c = Math.cos(b.a), s = Math.sin(b.a);
  G.wakeAcc += sp * dt * (bd.prop === 'ENGINE' ? 1.1 : 0.6);
  while (G.wakeAcc >= 1) {
    G.wakeAcc -= 1;
    for (const sg of [-1, 1]) { const [x, y] = toWorld(bd.L * 0.75, sg * bd.B * 0.8); spawn({ kind: 'dot', x, y, vx: -s * sg * 7 - c * 3, vy: c * sg * 7 - s * 3, life: 1.6 + Math.random() * 0.6 }); }
    const [x, y] = toWorld(-bd.L - 1, (Math.random() - 0.5) * bd.B * 0.7); spawn({ kind: 'dot', x, y, vx: 0, vy: 0, life: bd.prop === 'ENGINE' ? 2.2 : 1.4, foam: bd.prop === 'ENGINE' });
  }
  if ((G.idleRing -= dt) <= 0) { G.idleRing = 1.8 + Math.random(); if (sp < 4) spawn({ kind: 'ring', x: b.x, y: b.y, life: 1.6, r0: bd.L - 1, grow: 5 }); }
  if (G.up.bilge > 0 && b.hp < hpMax() && (G.bilgeT = (G.bilgeT || 0) + dt) > [0, 4, 1.4][G.up.bilge]) { G.bilgeT = 0; b.hp++; }
  if ((G.saveT += dt) > 15) { G.saveT = 0; saveGame(); }
}
export function updateCamera(dt, bx, by) {
  const b = G.boat;
  G.look.x += (b.vx * 0.75 - G.look.x) * (1 - Math.exp(-2 * dt)); G.look.y += (b.vy * 0.75 - G.look.y) * (1 - Math.exp(-2 * dt));
  const tx = bx + G.look.x - W / 2, ty = by + G.look.y - H / 2, k = 1 - Math.exp(-8 * dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.y += (ty - G.cam.y) * k;
}
// tabs: Left/Right, Q/E, number keys, shoulder buttons or a click. Up/Down walk the list (headers are skipped).
export const selectable = it => it.kind !== 'header';
export function setTab(i) {
  const tabs = portTabs(G.menu.port); G.menu.tab = (i + tabs.length) % tabs.length;
  const items = portItems(G.menu.port); G.menu.sel = Math.max(0, items.findIndex(selectable)); sfx('move');
}
let repeatT = 0;
export function portMenuInput(dt = 1 / 60) {
  const p = G.menu.port, tabs = portTabs(p), items = portItems(p), m = G.menu;
  for (let k = 1; k <= tabs.length; k++) if (hit(String(k))) return setTab(k - 1);
  if (hit('ArrowLeft', 'a', 'A', 'q', 'Q', 'PageUp')) return setTab(m.tab - 1);
  if (hit('ArrowRight', 'd', 'D', 'e', 'E', 'PageDown')) return setTab(m.tab + 1);
  if (!selectable(items[m.sel] || {})) m.sel = Math.max(0, items.findIndex(selectable));
  const step = d => { let i = m.sel; for (let n = 0; n < items.length; n++) { i = (i + d + items.length) % items.length; if (selectable(items[i])) { m.sel = i; sfx('move'); return; } } };
  if (hit('ArrowUp', 'w', 'W')) step(-1);
  if (hit('ArrowDown', 's', 'S')) step(1);
  const it = items[m.sel];
  if (it && selectable(it) && hit(' ', 'Enter')) { it.act(); repeatT = -0.45; }
  else if (it?.repeat && (G.keys[' '] || G.keys.Enter) && (repeatT += dt) > 0.18) { repeatT = 0; it.act(); }   // hold to keep buying supplies
  if (hit('Escape', 'Backspace')) leavePort();
}
// ship screen: browse the hold, release fish you don't want
export function shipInput() {
  const n = G.hold.length;
  if (hit('ArrowLeft', 'a', 'A')) G.shipSel = Math.max(0, G.shipSel - 1);
  if (hit('ArrowRight', 'd', 'D')) G.shipSel = Math.min(Math.max(0, n - 1), G.shipSel + 1);
  if (hit('ArrowUp', 'w', 'W')) G.shipSel = Math.max(0, G.shipSel - 3);
  if (hit('ArrowDown', 's', 'S')) G.shipSel = Math.min(Math.max(0, n - 1), G.shipSel + 3);
  if (hit('x', 'X', 'Delete', 'Backspace') && n) {
    const f = G.hold.splice(Math.min(G.shipSel, n - 1), 1)[0]; G.shipSel = Math.min(G.shipSel, G.hold.length - 1);
    toast(`Released the ${SPECIES[f.sp].name}`); sfx('splash', 0.6); spawn({ kind: 'ring', x: G.boat.x + 14, y: G.boat.y, life: 1, r0: 1, grow: 6 }); saveGame();
  }
}
