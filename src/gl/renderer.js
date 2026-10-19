// WebGL2 renderer. Terrain + water come from one fragment shader reading the heightfield; boats, landmarks,
// trees and sea life are lit voxel meshes; shadows are projected along the sun into a world-aligned buffer;
// wakes/splashes are stamped into a foam buffer the water shader reads; then HDR post (bloom, tilt-shift,
// filmic grading, vignette, grain, rain).
import { W, H, clamp, lerp } from '../config.js';
import { SET } from '../prefs.js';
import { TS, TN, getTile, hasTile, poisNear, schoolsNear, cratesNear } from '../world.js';
import { hash01 } from '../noise.js';
import { SPECIES, warmth, coldness } from '../econ.js';
import { G, darkness, lightR, schoolActive, isNight, dayFrac, equipment, windAngle, boatDef } from '../game.js';
import { WX } from '../weather.js';
import { LIFE } from '../life.js';
import { hasOars, NP, SHIPPED } from '../models.js';
import { program, texture, target, msTarget, free } from './glutil.js';
import * as SH from './shaders.js';
import * as MS from './meshes.js';

export const R = { S: 1, scale: 1, quality: 'auto', fx: { bloom: 1, tilt: 1 } };
let gl, cv, hdr = false, quadVao, instBuf, foamVao, foamBuf, partVao, partBuf;
const PG = {}, RT = {}; let tex, rtSize = [0, 0];
const PAD = 40, FR = 2, HW = W + PAD * 2 + 2, HH = H + PAD * 2 + 2, hdata = new Float32Array(HW * HH);

export function initRender(canvas) {
  cv = canvas;
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { document.body.innerHTML = '<p style="color:#efe9dc;font:16px monospace;padding:2em">This game needs a browser with WebGL2.</p>'; throw new Error('WebGL2 unavailable'); }
  hdr = !!gl.getExtension('EXT_color_buffer_float');
  PG.ground = program(gl, SH.QUAD_VS, SH.GROUND_FS); PG.mesh = program(gl, SH.MESH_VS, SH.MESH_FS);
  PG.foam = program(gl, SH.FOAM_VS, SH.FOAM_FS); PG.part = program(gl, SH.PART_VS, SH.PART_FS);
  PG.bright = program(gl, SH.QUAD_VS, SH.BRIGHT_FS); PG.blur = program(gl, SH.QUAD_VS, SH.BLUR_FS);
  PG.comp = program(gl, SH.QUAD_VS, SH.COMPOSITE_FS); PG.copy = program(gl, SH.QUAD_VS, SH.COPY_FS);
  quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  foamVao = gl.createVertexArray(); gl.bindVertexArray(foamVao); foamBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, foamBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  partVao = gl.createVertexArray(); gl.bindVertexArray(partVao); partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);
  instBuf = gl.createBuffer(); MS.init(gl, instBuf);
  tex = texture(gl, HW, HH, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR);
  RT.foam = target(gl, HW * FR, HH * FR, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  RT.shadow = target(gl, HW * FR, HH * FR, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
}
function ensureTargets() {
  const sc = Math.min(1, 1920 / cv.width) * R.scale, w = Math.max(64, Math.round(cv.width * sc)), h = Math.max(40, Math.round(cv.height * sc));
  if (w === rtSize[0] && h === rtSize[1]) return;
  for (const k of ['scene', 'half', 'qa', 'qb', 'ta', 'tb']) free(gl, RT[k]);
  const IF = hdr ? gl.RGBA16F : gl.RGBA8, TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, mk = (a, b) => target(gl, Math.max(1, a), Math.max(1, b), IF, gl.RGBA, TY);
  RT.scene = msTarget(gl, w, h, IF, gl.RGBA, TY, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)));
  RT.half = mk(w >> 1, h >> 1); RT.qa = mk(w >> 2, h >> 2); RT.qb = mk(w >> 2, h >> 2); RT.ta = mk(w >> 2, h >> 2); RT.tb = mk(w >> 2, h >> 2);
  rtSize = [w, h];
}

// ---------- uniforms ----------
function U(pg, name, ...v) {
  const l = pg.u[name]; if (l === undefined || l === null) return;
  [, gl.uniform1f, gl.uniform2f, gl.uniform3f, gl.uniform4f][v.length].call(gl, l, ...v);
}
function bindTex(pg, name, t, unit) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); const l = pg.u[name]; if (l) gl.uniform1i(l, unit); }
function into(t, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, w ?? t.w, h ?? t.h); }
function quad() { gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
function pass(pg, dst, src, extra) { into(dst); gl.useProgram(pg.p); if (src) bindTex(pg, 'uT', src.tex, 0); if (extra) extra(pg); quad(); }

// ---------- heightfield around the camera ----------
function uploadHeights(x0, y0) {
  let i = 0;
  for (let j = 0; j < HH; j++) {
    const wy = y0 + j, ty = Math.floor(wy / TS), row = (wy - ty * TS + 1) * TN;
    let tx = Math.floor(x0 / TS), tile = getTile(tx, ty), base = tx * TS - 1;
    for (let k = 0; k < HW; k++, i++) { const wx = x0 + k; if (wx - base > TS) { tx++; tile = getTile(tx, ty); base = tx * TS - 1; } hdata[i] = tile.h[row + wx - base]; }
  }
  gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, HH, gl.RED, gl.FLOAT, hdata);
}

// ---------- trees: deterministic per height tile ----------
const KINDS = MS.TREE_KINDS, KI = Object.fromEntries(KINDS.map((k, i) => [k, i]));
function tileTrees(t) {
  if (t.trees) return t.trees;
  const L = [], x0 = t.tx * TS, y0 = t.ty * TS, GS = 6;
  for (let gy = Math.floor(y0 / GS); gy <= Math.floor((y0 + TS - 1) / GS); gy++) for (let gx = Math.floor(x0 / GS); gx <= Math.floor((x0 + TS - 1) / GS); gx++) {
    const r = hash01(gx, gy, 41), px = gx * GS + Math.floor(hash01(gx, gy, 42) * GS), py = gy * GS + Math.floor(hash01(gx, gy, 43) * GS);
    if (px < x0 || px >= x0 + TS || py < y0 || py >= y0 + TS) continue;
    const v = t.h[(py - y0 + 1) * TN + px - x0 + 1]; if (v < 0.12) continue;
    let kind = null;
    if (v >= 0.36 && v < 0.76) { if (r < 0.72) kind = v > 0.5 || r < 0.25 ? 'pine' : 'round'; }
    else if (v < 0.36) { if (r < 0.06) kind = 'round'; else if (r < 0.08) kind = 'rock'; }
    else if (r < 0.06) kind = 'rock';
    const wm = warmth(py), cd = coldness(py), rr = hash01(gx, gy, 45);
    if (wm > rr && v < 0.24 && r < 0.14) kind = 'palm';
    else if (kind && kind !== 'rock' && cd > rr) kind = 'snowpine';
    else if (kind === 'pine' && wm > rr) kind = 'round';
    if (!kind) continue;
    if (kind !== 'rock' && kind !== 'palm' && hash01(gx, gy, 44) < 0.3) kind += 'B';
    L.push(px + 0.5, py + 0.5, KI[kind], 0.85 + hash01(gx, gy, 46) * 0.35, hash01(gx, gy, 47) * 6.283);
  }
  return (t.trees = L);
}

// ---------- instance pools ----------
const POOLS = [new Map(), new Map()];      // [casts shadow, no shadow]
function inst(mesh, x, y, yaw = 0, scale = 1, z = 0, pitch = 0, roll = 0, noShadow = false, tint = 1) {
  const pool = POOLS[noShadow ? 1 : 0]; let e = pool.get(mesh);
  if (!e) { e = { mesh, arr: new Float32Array(12 * 32), n: 0 }; pool.set(mesh, e); }
  if ((e.n + 1) * 12 > e.arr.length) { const a = new Float32Array(e.arr.length * 2); a.set(e.arr); e.arr = a; }
  e.arr.set([x, y, yaw, scale, z, pitch, roll, 0, tint, tint, tint, 1], e.n * 12); e.n++;
}
const IDENT = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1]);
export function boatRenderState(alpha) { const b = G.boat; return { x: lerp(b.px, b.x, alpha), y: lerp(b.py, b.y, alpha), a: lerp(b.pa, b.a, alpha) }; }
const frac = x => x - Math.floor(x);

function buildScene(bs, pois, camX, camY) {
  for (const p of POOLS) for (const e of p.values()) e.n = 0;
  MS.dynBegin();
  const cx = camX + W / 2, cy = camY + H / 2;
  // trees
  for (let ty = Math.floor((camY - 30) / TS); ty <= Math.floor((camY + H + 60) / TS); ty++) for (let tx = Math.floor((camX - 30) / TS); tx <= Math.floor((camX + W + 30) / TS); tx++) {
    const t = getTile(tx, ty); if (!t.land) continue; const L = tileTrees(t);
    for (let i = 0; i < L.length; i += 5) { const x = L[i], y = L[i + 1]; if (x < camX - 24 || x > camX + W + 24 || y < camY - 12 || y > camY + H + 50) continue; inst(MS.treeMesh(KINDS[L[i + 2]]), x, y, L[i + 4], L[i + 3]); }
  }
  // landmarks, flotsam, treasure buoys
  for (const p of pois) {
    if (p.type === 'light') inst(MS.lighthouseMesh(), p.x, p.y);
    else if (p.type === 'port') inst(MS.harbourMesh(), p.x, p.y, p.ang);
    else if (p.type === 'wreck') inst(MS.wreckMesh(), p.x, p.y, p.dir / 16 * Math.PI * 2, 1, -0.6);
  }
  for (const c of cratesNear(cx, cy, 230)) if (!c.taken) inst(MS.crateMesh(), c.x, c.y, c.ph, 1, -1.3 + Math.sin(G.t * 2 + c.ph) * 0.35, Math.sin(G.t * 1.3 + c.ph) * 0.1);
  for (const m of G.maps) if (Math.abs(m.x - cx) < W && Math.abs(m.y - cy) < H) inst(MS.buoyMesh(), m.x, m.y, 0, 1, -1.2 + Math.sin(G.t * 2 + m.x) * 0.3, Math.sin(G.t * 1.7) * 0.08);
  // fish schools swim under the surface; at night only the ones near your light show
  const night = isNight(), lr = lightR() + 14;
  for (const s of schoolsNear(cx, cy, 240)) {
    if (!schoolActive(s)) continue;
    if (s.boss) { const a = G.t * 0.35; inst(MS.leviMesh(), s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 12, a + Math.PI / 2, 1, -5.5, 0, 0, true, 1); continue; }
    if (night && Math.hypot(s.x - G.boat.x, s.y - G.boat.y) > lr && G.frenzy?.s !== s) continue;
    const sp = SPECIES[s.sp], n = Math.min(s.stock + 1, 5), m = MS.fishMesh(s.sp), sc = sp.base >= 40 ? 0.55 : 0.42;
    for (let k = 0; k < n; k++) {
      const a = G.t * (0.55 + 0.08 * k) + k * 6.283 / n + s.ph, r = 5 + (k % 2) * 3;
      inst(m, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r * 0.75, a + Math.PI / 2, sc, -2.2, 0, Math.PI / 2, true, 0.85);
    }
  }
  // whales and dolphins
  for (const w of LIFE.whales) {
    const z = w.t < 1.2 ? lerp(-6, -1.7, w.t / 1.2) : w.t < 8 ? -1.7 + Math.sin(w.t * 1.3) * 0.25 : -1.7 - (w.t - 8) * 2.2, yaw = w.dir > 0 ? 0 : Math.PI;
    inst(MS.whaleMesh(), w.x, w.y, yaw, 1, z, w.t > 8 ? -(w.t - 8) * 0.35 : 0, 0, z < -2.5);
    if (w.t > 8 && w.t < 9.8) inst(MS.flukeMesh(), w.x - w.dir * 11, w.y, 0, 1, -1 + Math.sin((w.t - 8) / 1.8 * Math.PI) * 3, 0, 0);
  }
  const b = G.boat, c = Math.cos(b.a), s = Math.sin(b.a);
  for (const p of LIFE.pods) for (const m of p.m) {
    const fade = Math.min(1, p.t, 11 - p.t), lead = m.lead + Math.sin(p.t * 0.7 + m.ph) * 4, off = m.side * m.off * fade * 1.4;
    const x = b.x + c * lead - s * off, y = b.y + s * lead + c * off, ph = frac(p.t * 0.9 + m.ph);
    if (ph < 0.38) { const k = ph / 0.38; inst(MS.dolphinMesh(), x, y, b.a, 1, Math.sin(Math.PI * k) * 7 - 1.2, (0.5 - k) * 1.4); }
    else inst(MS.dolphinMesh(), x, y, b.a, 1, -2.6, 0, 0, true);
  }
  if (G.frenzy) for (let k = 0; k < 8; k++) {
    const a = G.t * (0.8 + k * 0.11) * (k % 2 ? 1 : -1) + k * 1.3, r = 10 + (k % 4) * 6;
    inst(MS.gullMesh(Math.floor(G.t * 5 + k * 0.7) % 2), G.frenzy.s.x + Math.cos(a) * r, G.frenzy.s.y + Math.sin(a) * r * 0.6, a + (k % 2 ? Math.PI / 2 : -Math.PI / 2), 0.8, 18 + (k % 3) * 5);
  }
  // the boat, bobbing with the swell, plus oars/rod/line built in world space
  const bd = boatDef(), eq = equipment(), wob = 1 + WX.wind * 2.2;
  let bz = Math.sin(G.t * 1.6) * (0.2 + WX.wind * 0.45) - 0.4, roll = Math.sin(G.t * 1.3 + 1) * 0.035 * wob;
  if (G.mode === 'sunk') { bz -= G.sunkT * 3; roll += G.sunkT * 0.2; }
  const pitch = Math.sin(G.t * 1.1) * 0.025 * wob;
  inst(MS.boatMesh(G.boatId, eq), bs.x, bs.y, bs.a, 1, bz, pitch, roll);
  const ca = Math.cos(bs.a), sa = Math.sin(bs.a), W3 = q => [bs.x + q[0] * ca - q[1] * sa, bs.y + q[0] * sa + q[1] * ca, q[2] + bz];
  if (hasOars(G.boatId)) {
    const pose = G.fish || G.mode !== 'play' ? SHIPPED : Math.floor(frac(G.boat.phase) * NP) % NP, g = MS.oarGeom(pose, eq.prop);
    for (const l of g.lines) MS.dynBox(W3(l.a), W3(l.b), l.wide ? 0.95 : 0.6, l.col);
    for (const pt of g.points) { const q = W3(pt.p); MS.dynBox([q[0] - 0.4, q[1], q[2]], [q[0] + 0.4, q[1], q[2]], 0.8, pt.col); }
  }
  const f = G.fish;
  if (f) {
    const ang = Math.atan2(f.ty - bs.y, f.tx - bs.x), hand = [bs.x + Math.cos(ang) * 2, bs.y + Math.sin(ang) * 2, 8 + bz], tip = [bs.x + Math.cos(ang) * 12, bs.y + Math.sin(ang) * 12, 16 + bz];
    let bx = f.tx, by = f.ty, lift = 0;
    if (f.st === 'cast') { const k = Math.min(1, f.t / 0.55); bx = lerp(bs.x, f.tx, k); by = lerp(bs.y, f.ty, k); lift = Math.sin(Math.PI * k) * 22; }
    if (f.st === 'reel') { bx += Math.sin(G.t * 37) * (f.surge || 0); by += Math.cos(G.t * 29) * (f.surge || 0) * 0.6; }
    MS.dynBox(hand, tip, 0.45, [94, 68, 48]);
    const bob = [bx, by, lift + (f.st === 'bite' ? -1.4 : 0.2)], sag = f.st === 'wait' ? 4 : f.st === 'cast' ? 0 : 1.2;
    let prev = tip; for (let i = 1; i <= 6; i++) { const t = i / 6, q = [lerp(tip[0], bob[0], t), lerp(tip[1], bob[1], t), lerp(tip[2], bob[2] + 1, t) - Math.sin(Math.PI * t) * sag]; MS.dynBox(prev, q, 0.22, [236, 232, 220], 1); prev = q; }
    inst(MS.bobberMesh(), bob[0], bob[1], 0, 1, bob[2] - 0.6 + Math.sin(G.t * 3) * 0.15);
    if (f.jump) { const k = Math.min(1, f.jump.t / 0.75); inst(MS.fishMesh(f.s.sp), f.tx + f.jump.dir * (k - 0.5) * 14, f.ty, f.jump.dir > 0 ? 0 : Math.PI, 0.6, Math.sin(Math.PI * k) * 16 - 1, (0.5 - k) * 1.6); }
  }
  if (G.catchAnim) { const c2 = G.catchAnim, k = Math.min(1, c2.t / 0.7); inst(MS.fishMesh(c2.sp), lerp(c2.x, bs.x, k), lerp(c2.y, bs.y, k), Math.atan2(bs.y - c2.y, bs.x - c2.x), 0.6, Math.sin(Math.PI * k) * 24 + 2, k * 6.28); }
}

// ---------- lighting environment for the time of day and weather ----------
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
function environment() {
  const c = dayFrac(), dk = darkness(), bell = (x, m, w) => Math.exp(-(((x - m) / w) ** 2));
  const dusk = Math.max(bell(c, 0.6, 0.05), bell(c, 0.95, 0.04), bell(c, -0.05, 0.04)) * (1 - dk * 0.5);
  const dayT = clamp(((c + 0.05) % 1) / 0.69, 0, 1), up = Math.sin(Math.PI * dayT), a = Math.PI * 1.25 + (dayT - 0.5) * 1.3;
  let sun = [Math.cos(a), Math.sin(a), 0.3 + 0.6 * up], moon = [Math.cos(Math.PI * 1.6), Math.sin(Math.PI * 1.6), 0.7];
  sun = mix3(sun, moon, dk); const sl = Math.hypot(...sun); sun = sun.map(v => v / sl);
  const oc = clamp(WX.dark / 0.36, 0, 1), storm = WX.state === 'storm' ? 1 : 0;
  let sunC = mix3(mix3([1.0, 0.95, 0.86], [1.3, 0.66, 0.32], dusk), [0.3, 0.38, 0.6], dk);
  sunC = mul3(sunC, (1 - dk * 0.62) * (1 - oc * 0.6));
  let amb = mix3(mix3([0.5, 0.58, 0.68], [0.42, 0.36, 0.56], dusk), [0.1, 0.13, 0.25], dk);
  amb = mix3(amb, [0.42, 0.46, 0.5].map(v => v * (1 - dk * 0.75)), oc * 0.5);
  let sky = mix3(mix3([0.72, 0.84, 0.96], [1.15, 0.62, 0.42], dusk), [0.07, 0.09, 0.18], dk);
  sky = mix3(sky, [0.55, 0.6, 0.64].map(v => v * (1 - dk * 0.8)), oc * 0.7);
  const tint = mix3(mix3([1.02, 1.0, 0.97], [1.14, 0.95, 0.86], dusk), [0.86, 0.93, 1.12], dk);
  return { sun, sunC, amb, sky, tint, dk, cloud: 0.45 + oc * 0.5, sat: 1.12 - storm * 0.25 - oc * 0.1, exp: 1.06 + dk * 0.25 };
}
function lightsFor(bs, pois, dk) {
  const L = new Float32Array(64), LC = new Float32Array(48), B = new Float32Array(24); let nl = 0, nb = 0;
  const add = (x, y, r, k, c) => { if (nl >= 16 || k <= 0.01) return; L.set([x, y, r, k], nl * 4); LC.set(c, nl * 3); nl++; };
  add(bs.x, bs.y, lightR() * 1.3, 1.3 * dk, [1.0, 0.78, 0.5]);
  for (const p of pois) {
    if (p.type === 'port') { add(p.end.x, p.end.y, 46, 1.2 * dk, [1.0, 0.8, 0.5]); add(p.x, p.y, 30, 0.9 * dk, [1.0, 0.72, 0.42]); }
    else if (p.type === 'light') { add(p.x, p.y, 40, 1.0 * dk, [1.0, 0.86, 0.6]); if (nb < 6) { B.set([p.x, p.y, G.t * 0.5 + p.beam, 150], nb * 4); nb++; } }
  }
  if (G.frenzy) add(G.frenzy.s.x, G.frenzy.s.y, 20, 0.25, [1.0, 0.9, 0.6]);
  return { L, LC, B, nl, nb };
}

// ---------- particles ----------
let foamArr = new Float32Array(5 * 1024), partArr = new Float32Array(8 * 1024);
function foamPoints(bs) {
  let n = 0; const push = (x, y, s, a, k) => { if ((n + 1) * 5 > foamArr.length) { const t = new Float32Array(foamArr.length * 2); t.set(foamArr); foamArr = t; } foamArr.set([x, y, s, a, k], n * 5); n++; };
  for (const p of G.parts) {
    const k = p.life / p.max;
    if (p.kind === 'ring') push(p.x, p.y, (p.r0 + (1 - k) * p.grow) * 2 + 1.5, k * 0.85, 1);
    else if (p.kind === 'dot') push(p.x, p.y, p.foam ? 4 : 2.6, k * 0.8, 0);
  }
  const b = G.boat, bd = boatDef(), sp = Math.hypot(b.vx, b.vy), c = Math.cos(bs.a), s = Math.sin(bs.a);
  if (G.mode === 'play' && sp > 2) {
    const k = Math.min(1, sp / 40);
    push(bs.x + c * bd.L * 0.85, bs.y + s * bd.L * 0.85, bd.B * 1.8, 0.55 * k, 0);
    for (const sg of [-1, 1]) for (let i = 0; i < 4; i++) { const u = bd.L * (0.6 - i * 0.45); push(bs.x + c * u - s * sg * bd.B, bs.y + s * u + c * sg * bd.B, 2.4, 0.35 * k, 0); }
  }
  push(bs.x, bs.y, bd.L * 2.3, 0.12, 1);
  for (const w of LIFE.whales) if (w.t > 1.2 && w.t < 8.5) push(w.x, w.y + 1, 18, 0.25, 0);
  return n;
}
function partPoints() {
  let n = 0; const push = (x, y, z, sz, r, g, b, a) => { if ((n + 1) * 8 > partArr.length) { const t = new Float32Array(partArr.length * 2); t.set(partArr); partArr = t; } partArr.set([x, y, z, sz, r, g, b, a], n * 8); n++; };
  for (const p of G.parts) {
    const k = p.life / p.max;
    if (p.kind === 'debris') push(p.x, p.y, 0.5, 1.4, 0.62, 0.45, 0.27, Math.min(1, k * 2));
    else if (p.kind === 'spark') push(p.x, p.y, 2, 1.3, 2.2, 1.8, 0.9, k);
    else if (p.kind === 'spout') push(p.x, p.y, 2, 1.6, 1.3, 1.35, 1.4, k * 0.9);
  }
  for (const s of schoolsNear(G.cam.x + W / 2, G.cam.y + H / 2, 230)) if (schoolActive(s) && (SPECIES[s.sp].legend || G.frenzy?.s === s)) {
    for (let k = 0; k < 3; k++) { const q = Math.floor(G.t * 5) + k * 13; if (hash01(q, s.ph * 100 | 0, 3) < 0.55) push(s.x + (hash01(q, 1, 9) - 0.5) * 16, s.y + (hash01(q, 2, 9) - 0.5) * 10, 0.3, 1.2, 2.0, 1.7, 0.8, 0.9); }
  }
  if (isNight()) for (const s of schoolsNear(G.boat.x, G.boat.y, lightR() * 2.2)) if (schoolActive(s) && SPECIES[s.sp].time === 'night' && Math.floor(G.t * 3 + s.ph) % 3 === 0)
    push(s.x + Math.sin(G.t + s.ph) * 4, s.y, 0.2, 1.3, ...(SPECIES[s.sp].shape === 'glow' ? [2.2, 1.8, 0.7] : [1.3, 1.4, 1.5]), 0.9);
  return n;
}

// ---------- prefetch heights (and tree lists) so new terrain never hitches ----------
export function prefetch(budgetMs = 4) {
  const t0 = performance.now(), cx = G.cam.x + W / 2, cy = G.cam.y + H / 2;
  for (let ty = Math.floor((cy - H) / TS); ty <= Math.floor((cy + H) / TS); ty++) for (let tx = Math.floor((cx - W) / TS); tx <= Math.floor((cx + W) / TS); tx++) {
    if (performance.now() - t0 > budgetMs) return;
    if (!hasTile(tx, ty)) getTile(tx, ty); else { const t = getTile(tx, ty); if (t.land && !t.trees) tileTrees(t); }
  }
}

// ---------- frame ----------
function drawMeshes(mode, CAM, HR, E, Lt, shXY) {
  const pg = PG.mesh; gl.useProgram(pg.p);
  U(pg, 'uCam', ...CAM); U(pg, 'uHR', ...HR); U(pg, 'uShXY', ...shXY); gl.uniform1i(pg.u.uMode, mode);
  if (mode === 0) {
    U(pg, 'uSun', ...E.sun); U(pg, 'uSunC', ...E.sunC); U(pg, 'uAmb', ...E.amb); U(pg, 'uNight', E.dk); U(pg, 'uWater', ...E.water);
    bindTex(pg, 'uH', tex, 0); gl.uniform1i(pg.u.uNL, Lt.nl); gl.uniform4fv(pg.u.uL, Lt.L); gl.uniform3fv(pg.u.uLC, Lt.LC); if (pg.u.uNB) gl.uniform1i(pg.u.uNB, 0);
  }
  for (const e of POOLS[0].values()) MS.drawInstances(e.mesh, e.arr, e.n);
  if (mode === 0) for (const e of POOLS[1].values()) MS.drawInstances(e.mesh, e.arr, e.n);
  MS.drawInstances(MS.dynMesh(), IDENT, 1);
}
// dynamic resolution: keep frames under ~20ms by trading internal resolution
let lastT = 0, acc = 0, frames = 0;
function adaptScale() {
  if (R.quality !== 'auto') { R.scale = { high: 1, medium: 0.75, low: 0.5 }[R.quality] || 1; return; }
  const now = performance.now(), dt = now - lastT; lastT = now;
  if (dt <= 0 || dt > 250) return;
  acc += dt; frames++;
  if (acc < 1500) return;
  const avg = acc / frames; acc = 0; frames = 0;
  if (avg > 20 && R.scale > 0.5) R.scale = Math.max(0.5, R.scale - 0.125);
  else if (avg < 13 && R.scale < 1) R.scale = Math.min(1, R.scale + 0.125);
}
export function render(alpha) {
  adaptScale();
  ensureTargets();
  const [w, h] = rtSize, bs = boatRenderState(alpha);
  const camX = G.cam.x + G.shakeX, camY = G.cam.y + G.shakeY, x0 = Math.floor(camX) - PAD, y0 = Math.floor(camY) - PAD;
  uploadHeights(x0, y0);
  const HR = [x0, y0, HW, HH], CAM = [camX, camY, W, H], E = environment();
  const pois = poisNear(camX + W / 2, camY + H / 2, 300), Lt = lightsFor(bs, pois, E.dk);
  const wm = warmth(camY + H / 2), cd = coldness(camY + H / 2);
  E.water = mix3(mix3([0.17, 0.43, 0.55], [0.07, 0.53, 0.62], wm), [0.22, 0.36, 0.46], cd);
  buildScene(bs, pois, camX, camY);
  const shXY = [E.sun[0] / Math.max(0.25, E.sun[2]), E.sun[1] / Math.max(0.25, E.sun[2])];
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  // 1. object shadows projected onto the ground plane
  into(RT.shadow); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  drawMeshes(1, CAM, HR, E, Lt, shXY);
  // 2. foam / ripple stamps
  into(RT.foam); gl.clear(gl.COLOR_BUFFER_BIT);
  const nf = foamPoints(bs);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(PG.foam.p); U(PG.foam, 'uHR', ...HR); U(PG.foam, 'uPx', FR);
  gl.bindVertexArray(foamVao); gl.bindBuffer(gl.ARRAY_BUFFER, foamBuf); gl.bufferData(gl.ARRAY_BUFFER, foamArr.subarray(0, nf * 5), gl.STREAM_DRAW); gl.drawArrays(gl.POINTS, 0, nf);
  gl.disable(gl.BLEND);
  // 3. scene: ground, meshes, particles
  into(RT.scene, w, h); gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const pg = PG.ground; gl.useProgram(pg.p);
  bindTex(pg, 'uH', tex, 0); bindTex(pg, 'uFoam', RT.foam.tex, 1); bindTex(pg, 'uShadow', RT.shadow.tex, 2);
  U(pg, 'uHR', ...HR); U(pg, 'uCam', ...CAM); U(pg, 'uT', G.t); U(pg, 'uWT', WX.waveT); U(pg, 'uWind', WX.wind); U(pg, 'uRain', WX.rain);
  U(pg, 'uNight', E.dk); U(pg, 'uCloud', E.cloud); U(pg, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U(pg, 'uWD', Math.cos(windAngle()), Math.sin(windAngle()));
  U(pg, 'uSun', ...E.sun); U(pg, 'uSunC', ...E.sunC); U(pg, 'uAmb', ...E.amb); U(pg, 'uSky', ...E.sky);
  gl.uniform1i(pg.u.uNL, Lt.nl); gl.uniform4fv(pg.u.uL, Lt.L); gl.uniform3fv(pg.u.uLC, Lt.LC); gl.uniform1i(pg.u.uNB, Lt.nb); gl.uniform4fv(pg.u.uB, Lt.B);
  quad();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  drawMeshes(0, CAM, HR, E, Lt, shXY);
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const np = partPoints();
  gl.useProgram(PG.part.p); U(PG.part, 'uCam', ...CAM); U(PG.part, 'uPx', w / W);
  gl.bindVertexArray(partVao); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf); gl.bufferData(gl.ARRAY_BUFFER, partArr.subarray(0, np * 8), gl.STREAM_DRAW); gl.drawArrays(gl.POINTS, 0, np);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, RT.scene.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, RT.scene.resolve.fb);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  const scene = RT.scene.resolve;
  // 4. post: bloom chain, tilt-shift blur, composite
  pass(PG.bright, RT.half, scene, p => U(p, 'uTh', hdr ? 1.0 : 0.82));
  pass(PG.copy, RT.qa, RT.half);
  for (let i = 0; i < 2; i++) {
    pass(PG.blur, RT.qb, RT.qa, p => U(p, 'uDir', 1 / RT.qa.w, 0));
    pass(PG.blur, RT.qa, RT.qb, p => U(p, 'uDir', 0, 1 / RT.qa.h));
  }
  pass(PG.copy, RT.ta, scene);
  pass(PG.blur, RT.tb, RT.ta, p => U(p, 'uDir', 1.5 / RT.ta.w, 0));
  pass(PG.blur, RT.ta, RT.tb, p => U(p, 'uDir', 0, 1.5 / RT.ta.h));
  into(null, cv.width, cv.height);
  const cp = PG.comp; gl.useProgram(cp.p);
  bindTex(cp, 'uScene', scene.tex, 0); bindTex(cp, 'uBloom', RT.qa.tex, 1); bindTex(cp, 'uBlur', RT.ta.tex, 2);
  U(cp, 'uT', G.t); U(cp, 'uExp', E.exp); U(cp, 'uSat', E.sat); U(cp, 'uVig', 0.55); U(cp, 'uTilt', 0.7 * R.fx.tilt); U(cp, 'uGrain', 0.03);
  U(cp, 'uRain', WX.rain); U(cp, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U(cp, 'uBloomK', (0.5 + E.dk * 0.5) * R.fx.bloom); U(cp, 'uSlant', 0.3 + WX.wind * 0.7);
  U(cp, 'uTint', ...E.tint); U(cp, 'uRes', cv.width, cv.height);
  quad();
  gl.bindVertexArray(null);
}
