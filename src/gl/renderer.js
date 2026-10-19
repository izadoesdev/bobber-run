// WebGL2 renderer. Terrain + water come from one fragment shader reading the heightfield; boats, landmarks,
// trees and sea life are lit voxel meshes; shadows are projected along the sun into a world-aligned buffer;
// wakes/splashes are stamped into a foam buffer the water shader reads; then HDR post (bloom, tilt-shift,
// filmic grading, vignette, grain, rain).
import { W, H, clamp, lerp } from '../config.js';
import { ONLINE, shipsAndSailors } from '../online.js';
import { SET } from '../prefs.js';
import { TS, TN, getTile, hasTile, poisNear, schoolsNear, cratesNear } from '../world.js';
import { hash01 } from '../noise.js';
import { SPECIES, BOATS, warmth, coldness } from '../econ.js';
import { G, darkness, lightR, schoolActive, isNight, dayFrac, equipment, windAngle, boatDef } from '../game.js';
import { WX } from '../weather.js';
import { LIFE } from '../life.js';
import { hasOars, NP, SHIPPED, PLAIN } from '../models.js';
import { program, texture, target, msTarget, free } from './glutil.js';
import * as SH from './shaders.js';
import * as MS from './meshes.js';

export const R = { S: 1, scale: 1, quality: 'auto', fx: { bloom: 1, tilt: 1, grade: 1 } };
let gl, cv, hdr = false, quadVao, instBuf, foamVao, foamBuf, partVao, partBuf;
const PG = {}, RT = {}; let tex, rtSize = [0, 0];
const PAD = 40, FR = 2; let HW = 0, HH = 0, hdata;

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
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
  partVao = gl.createVertexArray(); gl.bindVertexArray(partVao); partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 36, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 16);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 36, 32);
  gl.bindVertexArray(null);
  instBuf = gl.createBuffer(); MS.init(gl, instBuf);
}
// heightfield, foam and shadow buffers cover the view plus a margin, so they follow the view size
function ensureField() {
  const hw = W + PAD * 2 + 2, hh = H + PAD * 2 + 2;
  if (hw === HW && hh === HH) return;
  HW = hw; HH = hh; hdata = new Float32Array(HW * HH);
  if (tex) gl.deleteTexture(tex); free(gl, RT.foam); free(gl, RT.shadow);
  tex = texture(gl, HW, HH, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR);
  RT.foam = target(gl, HW * FR, HH * FR, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  RT.shadow = target(gl, HW * FR, HH * FR, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
}
// pixel styles draw the scene at a fixed number of pixels per world unit, without MSAA,
// then upscale to the canvas with hard edges; 'smooth' draws at canvas resolution
export const PIXEL = { chunky: 1, crisp: 2 };
function ensureTargets() {
  const px = PIXEL[SET.pixel] || 0;
  let w, h;
  if (px) { w = Math.ceil(W * px) + 1; h = Math.ceil(H * px) + 1; }   // one spare pixel so the snapped frame can slide
  else { const sc = Math.min(1, 1920 / cv.width) * R.scale; w = Math.max(64, Math.round(cv.width * sc)); h = Math.max(40, Math.round(cv.height * sc)); }
  if (w === rtSize[0] && h === rtSize[1] && px === rtSize[2]) return;
  for (const k of ['scene', 'half', 'qa', 'qb', 'ta', 'tb', 'out']) { free(gl, RT[k]); RT[k] = null; }
  const IF = hdr ? gl.RGBA16F : gl.RGBA8, TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, mk = (a, b) => target(gl, Math.max(1, a), Math.max(1, b), IF, gl.RGBA, TY);
  RT.scene = msTarget(gl, w, h, IF, gl.RGBA, TY, px ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES)));
  RT.half = mk(w >> 1, h >> 1); RT.qa = mk(w >> 2, h >> 2); RT.qb = mk(w >> 2, h >> 2); RT.ta = mk(w >> 2, h >> 2); RT.tb = mk(w >> 2, h >> 2);
  if (px) RT.out = target(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  rtSize = [w, h, px];
}

// ---------- uniforms ----------
// the pixel-style dither is anchored to world pixels: STY.org = world pixel of the frame's top-left, and frame height
const STY = { px: 0, org: [0, 0, 1] };
function styleUniforms(pg) { U(pg, 'uPx', STY.px); U(pg, 'uOrg', ...STY.org); }
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
// tint: a brightness or an [r,g,b]; glow: how strongly the mesh's glowable voxels shine (lamps 1, sea life by night);
// clear: how slowly it fades into the water below the waterline (1 for hulls; sea life shows through a little more)
function inst(mesh, x, y, yaw = 0, scale = 1, z = 0, pitch = 0, roll = 0, noShadow = false, tint = 1, glow = 1, clear = 1) {
  const pool = POOLS[noShadow ? 1 : 0]; let e = pool.get(mesh);
  if (!e) { e = { mesh, arr: new Float32Array(12 * 32), n: 0 }; pool.set(mesh, e); }
  if ((e.n + 1) * 12 > e.arr.length) { const a = new Float32Array(e.arr.length * 2); a.set(e.arr); e.arr = a; }
  const [r, g, b] = typeof tint === 'number' ? [tint, tint, tint] : tint;
  e.arr.set([x, y, yaw, scale, z, pitch, roll, glow, r, g, b, clear], e.n * 12); e.n++;
}
const DYN = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1]);   // the oars/rod/line instance, placed at the boat
export function boatRenderState(alpha) { const b = G.boat; return { x: lerp(b.px, b.x, alpha), y: lerp(b.py, b.y, alpha), a: lerp(b.pa, b.a, alpha) }; }
const frac = x => x - Math.floor(x);

// ---------- sea life poses (life.js data, tolerant of missing fields and of the older whale shape) ----------
const WHALE_K = 26 / MS.WHALE.len;                 // a humpback is ~26 units long at size 1
function whalePose(w) {
  if (w.a !== undefined) return { x: w.x, y: w.y, a: w.a, z: w.z ?? -2, pitch: w.pitch || 0, roll: w.roll || 0, tail: w.tail || 0, size: w.size || 1, ph: w.t || 0 };
  const t = w.t || 0, z = t < 1.2 ? lerp(-6, -1.7, t / 1.2) : t < 8 ? -1.7 + Math.sin(t * 1.3) * 0.25 : -1.7 - (t - 8) * 2.2;
  return { x: w.x, y: w.y, a: w.dir > 0 ? 0 : Math.PI, z: z + 1.7, pitch: t > 8 ? -(t - 8) * 0.35 : 0, roll: 0, tail: t > 8 && t < 9.8 ? Math.sin((t - 8) / 1.8 * Math.PI) : 0, size: 1, ph: t };
}
function drawWhale(w) {
  const q = whalePose(w), s = q.size * WHALE_K, ca = Math.cos(q.a), sa = Math.sin(q.a);
  const zAxis = q.z - 1.6 * s, under = q.z < 2;         // contract z: 0 = the back just breaking the surface
  inst(MS.whaleMesh(), q.x, q.y, q.a, s, zAxis, q.pitch, q.roll, under, 1, 0, 0.6);
  // the tail stock hinges at the end of the body: it beats while swimming and lifts the fluke clear to dive or slap
  const jx = MS.WHALE.joint * s * Math.cos(q.pitch), jz = MS.WHALE.joint * s * Math.sin(q.pitch);
  const beat = Math.sin(G.t * 1.7 + q.ph) * 0.22 * (1 - q.tail);
  inst(MS.flukeMesh(), q.x + ca * jx, q.y + sa * jx, q.a, s, zAxis + jz, q.pitch - q.tail * 1.35 + beat, q.roll, under, 1, 0, 0.6);
}
// eels undulate: a chain of segments, each swinging a little more than the one ahead
function drawEel(g, glow) {
  const N = 10, segL = (g.len || 30) / N, s = segL / 4, ph = g.ph || 0, z = g.z ?? -6;
  let x = g.x, y = g.y;
  for (let i = 0; i < N; i++) {
    const yaw = (g.a || 0) + Math.sin(ph * 2 - i * 0.75) * 0.45 * (0.25 + i / N), c = Math.cos(yaw), sn = Math.sin(yaw);
    inst(MS.eelMesh(i === 0 ? 'head' : i === N - 1 ? 'tail' : 'seg'), x - c * segL * 0.35, y - sn * segL * 0.35, yaw, s, z, 0, 0, true, 1, glow);
    x -= c * segL; y -= sn * segL;
  }
}
function drawGiant(g) {
  const z = g.z ?? -6, len = g.len || 24, ph = g.ph || 0, glow = g.glow || 0, a = g.a || 0;
  if (g.kind === 'ray') inst(MS.mantaMesh(ph), g.x, g.y, a, len / MS.MANTA_LEN, z, Math.sin(ph) * 0.05, Math.sin(ph * 0.5) * 0.12, true, 1, glow);
  else if (g.kind === 'squid') inst(MS.squidMesh(), g.x, g.y, a + Math.sin(ph * 0.7) * 0.05, len / MS.SQUID_LEN * (1 + Math.sin(ph * 2) * 0.04), z, 0, Math.sin(ph) * 0.15, true, 1, glow);
  else if (g.kind === 'eel') drawEel(g, glow);
  else inst(MS.shadowFishMesh(), g.x, g.y, a + Math.sin(ph) * 0.07, len / MS.SHADOW_LEN, z, 0, 0, true, 1, 0);
}
const shipEq = new Map();                              // NPC fishing boats: plain fit-out in their paint, lamp lit
const eqFor = paint => { let e = shipEq.get(paint); if (!e) { e = { ...PLAIN, paint: paint || 'classic', lantern: 1 }; shipEq.set(paint, e); } return e; };
const shipDef = id => BOATS.find(b => b.id === id) || BOATS[0];
const shipAng = sh => sh.a ?? Math.atan2(sh.vy || 0, sh.vx || 1);
const near = (o, cx, cy, mx, my) => Math.abs(o.x - cx) < mx && Math.abs(o.y - cy) < my;

function buildScene(bs, pois, camX, camY) {
  for (const p of POOLS) for (const e of p.values()) e.n = 0;
  MS.dynBegin(); DYN[0] = bs.x; DYN[1] = bs.y;
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
  // whales, giants, jellies, NPC ships, dolphins
  const mx = W / 2 + 60, my = H / 2 + 60;
  for (const w of LIFE.whales || []) if (near(w, cx, cy, mx, my)) drawWhale(w);
  for (const g of LIFE.giants || []) if (near(g, cx, cy, mx + (g.len || 24), my + (g.len || 24))) drawGiant(g);
  for (const j of LIFE.jellies || []) if (near(j, cx, cy, mx, my)) {
    const ph = j.ph || 0, pulse = Math.sin(ph), sz = 0.55 * (j.size || 1);
    inst(MS.jellyMesh(pulse > 0.35), j.x, j.y, ph * 0.15, sz * (1 + pulse * 0.06), j.z ?? -1.5, 0, 0, true, j.col || [0.75, 0.85, 1], (j.glow || 0) * (0.8 + 0.2 * pulse), 0.6);
  }
  // messages in bottles left by other players, bobbing where they were thrown
  for (const bo of ONLINE.bottles) if (Math.abs(bo.x - cx) < W && Math.abs(bo.y - cy) < H) inst(MS.bottleMesh(), bo.x, bo.y, bo.x * 0.37, 1, -0.6 + Math.sin(G.t * 2.1 + bo.x) * 0.3, Math.sin(G.t * 1.6 + bo.y) * 0.25, 0.4);
  shipsAndSailors(LIFE.ships).forEach((sh, i) => {
    if (!MS.BOAT_MODELS[sh.id] || !near(sh, cx, cy, mx + 30, my + 30)) return;
    const ph = i * 1.7 + (sh.x + sh.y) * 0.002, sw = 1 + WX.wind * 1.6;
    inst(MS.boatMesh(sh.id, eqFor(sh.paint)), sh.x, sh.y, shipAng(sh), 1, Math.sin(G.t * 1.4 + ph) * (0.2 + WX.wind * 0.4) - 0.4, Math.sin(G.t * 1.0 + ph) * 0.02 * sw, Math.sin(G.t * 1.2 + ph + 1) * 0.03 * sw);
  });
  for (const p of LIFE.pods || []) for (const m of p.m) {          // each dolphin has its own position and heading (life.js)
    const ph = frac(p.t * 0.9 + m.ph);
    if (ph < 0.38) { const k = ph / 0.38; inst(MS.dolphinMesh(), m.x, m.y, m.a, 1, Math.sin(Math.PI * k) * 7 - 1.2, (0.5 - k) * 1.4); }
    else inst(MS.dolphinMesh(), m.x, m.y, m.a, 1, -2.6, 0, 0, true);
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
    const stow = G.fish || G.mode !== 'play', pz = k => stow ? SHIPPED : Math.floor(frac(G.boat[k] ?? 0.5) * NP) % NP, g = MS.oarGeom(pz('phaseL'), eq.prop, pz('phaseR'));
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
  let sunC = mix3(mix3([1.0, 0.95, 0.86], [1.3, 0.66, 0.32], dusk), [0.26, 0.35, 0.52], dk);
  sunC = mul3(sunC, (1 - dk * 0.62) * (1 - oc * 0.6));
  let amb = mix3(mix3([0.5, 0.58, 0.68], [0.42, 0.36, 0.56], dusk), [0.1, 0.155, 0.25], dk);
  amb = mix3(amb, [0.42, 0.46, 0.5].map(v => v * (1 - dk * 0.75)), oc * 0.5);
  let sky = mix3(mix3([0.72, 0.84, 0.96], [1.15, 0.62, 0.42], dusk), [0.07, 0.12, 0.19], dk);
  sky = mix3(sky, [0.55, 0.6, 0.64].map(v => v * (1 - dk * 0.8)), oc * 0.7);
  const tint = mix3(mix3([1.02, 1.0, 0.97], [1.14, 0.95, 0.86], dusk), [0.93, 1.01, 1.0], dk);
  return { sun, sunC, amb, sky, tint, dk, dusk, cloud: 0.45 + oc * 0.5, sat: 1.12 - storm * 0.25 - oc * 0.1, exp: 1.06 + dk * 0.25 };
}
const AMBER = [1.0, 0.62, 0.26];
function lightsFor(bs, pois, dk) {
  const L = new Float32Array(64), LC = new Float32Array(48), B = new Float32Array(24); let nl = 0, nb = 0;
  const add = (x, y, r, k, c) => { if (nl >= 16 || k <= 0.01) return; L.set([x, y, r, k], nl * 4); LC.set(c, nl * 3); nl++; };
  // warm amber (#ffb860) pools; the shader's falloff is soft, so radii run large
  add(bs.x, bs.y, lightR() * 1.6, 0.8 * dk, AMBER);
  for (const p of pois) {
    if (p.type === 'port') { add(p.end.x, p.end.y, 58, 0.7 * dk, AMBER); add(p.x, p.y, 40, 0.6 * dk, [1.0, 0.58, 0.24]); }
    else if (p.type === 'light') { add(p.x, p.y, 54, 0.8 * dk, [1.0, 0.72, 0.38]); if (nb < 6) { B.set([p.x, p.y, G.t * 0.5 + p.beam, 150], nb * 4); nb++; } }
  }
  if (G.frenzy) add(G.frenzy.s.x, G.frenzy.s.y, 20, 0.25, [1.0, 0.9, 0.6]);
  // sea life: glowing giants, jelly swarms (one light per cluster) and the lamps of passing boats
  const cx = G.cam.x + W / 2, cy = G.cam.y + H / 2, mx = W / 2 + 60, my = H / 2 + 60;
  for (const g of LIFE.giants || []) if ((g.glow || 0) > 0.05 && near(g, cx, cy, mx, my)) add(g.x, g.y, (g.len || 24) * 1.3, g.glow * 0.5, g.kind === 'eel' ? [0.35, 0.7, 1.0] : [0.3, 0.95, 0.95]);
  const swarms = new Map();
  for (const j of LIFE.jellies || []) if ((j.glow || 0) > 0.05 && near(j, cx, cy, mx, my)) {
    const k = Math.floor(j.x / 48) * 4096 + Math.floor(j.y / 48), c = j.col || [0.75, 0.85, 1]; let e = swarms.get(k);
    if (!e) swarms.set(k, e = { x: 0, y: 0, n: 0, g: 0, c: [0, 0, 0] });
    e.x += j.x; e.y += j.y; e.n++; e.g += j.glow; for (let i = 0; i < 3; i++) e.c[i] += c[i] * j.glow;
  }
  [...swarms.values()].sort((a, b) => b.g - a.g).slice(0, 4).forEach(e => add(e.x / e.n, e.y / e.n, 22 + 7 * Math.sqrt(e.n), Math.min(0.55, 0.1 * e.g), e.c.map(v => v / e.g)));
  for (const sh of shipsAndSailors(LIFE.ships)) if (near(sh, cx, cy, mx, my)) add(sh.x, sh.y, 34, 0.55 * dk, AMBER);
  return { L, LC, B, nl, nb };
}

// ---------- particles ----------
let foamArr = new Float32Array(8 * 1024), partArr = new Float32Array(9 * 1024);
let fN = 0;
// x, y, size (long axis), alpha, kind (0 disc, 1 ring), heading, aspect (short/long), foam share (rest is ripple)
function foam(x, y, s, a, kind = 0, ang = 0, asp = 1, fk = 1) {
  if ((fN + 1) * 8 > foamArr.length) { const t = new Float32Array(foamArr.length * 2); t.set(foamArr); foamArr = t; }
  foamArr.set([x, y, s, a, kind, ang, asp, fk], fN * 8); fN++;
}
// water around a hull: at rest, soft hull-shaped ripples swell out from the waterline and fade (mostly ripple, a
// little foam); under way, a curling bow wave, wash along both sides and churned water at the stern
function hullWash(x, y, a, L, B, sp, seed, amt = 1, vee = false) {
  const c = Math.cos(a), s = Math.sin(a), at = (u, v) => [x + c * u - s * v, y + s * u + c * v], t = G.t + seed;
  const idle = clamp(1 - sp / 10, 0, 1) * amt;
  if (idle > 0.01) for (let i = 0; i < 3; i++) {
    const ph = frac(t * 0.28 + i / 3);
    foam(x, y, L * (1.3 + ph * 1.2), idle * 0.9 * Math.sin(Math.PI * Math.sqrt(ph)) * (1 - ph * 0.5), 1, a, Math.min(1, B / L * (1.5 + ph * 1.2)), 0.45);
  }
  const k = clamp(sp / 40, 0, 1) * amt;
  if (sp < 2 || k < 0.01) return;
  const fl = 1 + Math.sin(t * 9) * 0.08, hl = L / 2, hb = B / 2;
  for (const sg of [-1, 1]) {
    foam(...at(hl * 0.45, sg * (hb + L * 0.16)), L * 0.8 * fl, 1.2 * k, 0, a - sg * 0.38, 0.4);               // bow wave peels off the stem
    for (let i = 0; i < 3; i++) foam(...at(hl * (0.05 - i * 0.6), sg * (hb + 1.6 + i * 1.5)), L * 0.5, 0.9 * k * (1 - i * 0.2), 0, a - sg * 0.2, 0.38);
    if (vee) for (let i = 1; i <= 5; i++) foam(...at(-hl - i * L * 0.42, sg * (hb + i * L * 0.2) + Math.sin(t * 2 + i) * 0.6), 3.2 + i * 0.5, 0.9 * k * (1 - i / 6), 0, a + sg * 0.6, 0.45);
  }
  foam(...at(hl + 0.5, 0), B * 1.1 * fl, 0.9 * k, 0, a + Math.PI / 2, 0.55);                                      // cap of foam at the stem
  foam(...at(-hl - hb * 0.6, 0), B * 1.6 * (1 + Math.sin(t * 7) * 0.1), 1.0 * k, 0, a, 0.75);                    // stern churn
  for (let i = 1; i <= 3; i++) foam(...at(-hl - hb - i * L * 0.4, Math.sin(t * 3 + i * 1.7) * hb * 0.3), B * (1.4 + i * 0.3), 0.85 * k / i, 0, a, 0.6);
}
function foamPoints(bs) {
  fN = 0;
  for (const p of G.parts) {
    const k = p.life / p.max;
    if (p.kind === 'ring') foam(p.x, p.y, ((p.r0 + (1 - k) * p.grow) * 2 + 1.5) * 0.9, k * 0.85, 1);
    else if (p.kind === 'dot') foam(p.x, p.y, p.foam ? 4 : 2.6, k * 0.8, 0);
  }
  const b = G.boat, bd = boatDef();
  hullWash(bs.x, bs.y, bs.a, bd.L, bd.B, G.mode === 'play' ? Math.hypot(b.vx, b.vy) : 0, 0);
  const cx = G.cam.x + W / 2, cy = G.cam.y + H / 2, mx = W / 2 + 60, my = H / 2 + 60;
  shipsAndSailors(LIFE.ships).forEach((sh, i) => { if (near(sh, cx, cy, mx, my)) { const d = shipDef(sh.id); hullWash(sh.x, sh.y, shipAng(sh), d.L, d.B, Math.hypot(sh.vx || 0, sh.vy || 0), i * 2.3, 1, true); } });
  for (const w of LIFE.whales || []) {                    // a surfacing whale pushes up a slick of ripples and foam
    const q = whalePose(w), s = q.size * WHALE_K; if (!near(q, cx, cy, mx, my)) continue;
    const up = clamp(1 - Math.abs(q.z - 0.5) / 3, 0, 1); if (up > 0) hullWash(q.x - Math.cos(q.a) * 3 * s, q.y - Math.sin(q.a) * 3 * s, q.a, 30 * s, 8 * s, 0, q.ph, up);
    if (q.tail > 0.25) foam(q.x + Math.cos(q.a) * (MS.WHALE.joint - 5) * s, q.y + Math.sin(q.a) * (MS.WHALE.joint - 5) * s, 10 * s, q.tail * 0.5, 0, q.a + Math.PI / 2, 0.5);
  }
  for (const g of LIFE.giants || []) {                     // something big just under the surface bulges the water
    const z = g.z ?? -6, len = g.len || 24; if (z < -5 || !near(g, cx, cy, mx, my)) continue;
    for (let i = 0; i < 2; i++) { const ph = frac(G.t * 0.25 + i / 2 + (g.ph || 0) * 0.1); foam(g.x, g.y, len * (1 + ph * 0.6), (1 + z / 5) * 0.45 * Math.sin(Math.PI * ph), 1, g.a || 0, g.kind === 'ray' ? 0.9 : 0.4, 0); }
  }
  return fN;
}
// coloured points drawn in the scene: [x, y, z, size, r, g, b, a, style]; style 0 soft dot, 1 lit smoke puff, 2 glow
function partPoints() {
  let n = 0; const push = (x, y, z, sz, r, g, b, a, st = 0) => { if ((n + 1) * 9 > partArr.length) { const t = new Float32Array(partArr.length * 2); t.set(partArr); partArr = t; } partArr.set([x, y, z, sz, r, g, b, a, st], n * 9); n++; };
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
  // smoke drifts downwind as it rises, swelling to ~3x and thinning out; drawn after the rest so it sits on top
  const wa = windAngle(), wx = Math.cos(wa), wy = Math.sin(wa);
  for (const p of G.parts) if (p.kind === 'smoke') {
    const k = clamp(p.life / p.max, 0, 1), age = 1 - k, lean = age * (2 + WX.wind * 8), g = lerp(0.82, 0.24, p.dark || 0);
    push(p.x + wx * lean, p.y + wy * lean, p.z ?? 10, (p.size || 2) * (1 + 2 * age) * 1.5, g, g * 0.98, g * 0.95, Math.min(1, age * 8) * Math.pow(k, 0.6) * 0.9, 1);
  }
  const n0 = n;
  for (const p of G.parts) if (p.kind === 'glow') {        // bioluminescent plankton, added on top
    const k = clamp(p.life / p.max, 0, 1); push(p.x, p.y, p.z || 0, p.size || 1.2, 0.35, 1.5, 1.3, k, 2);
  }
  return [n0, n - n0];
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
  U(pg, 'uCam', ...CAM); U(pg, 'uHR', ...HR); U(pg, 'uShXY', ...shXY); gl.uniform1i(pg.u.uMode, mode); styleUniforms(pg);
  if (mode === 0) {
    U(pg, 'uSun', ...E.sun); U(pg, 'uSunC', ...E.sunC); U(pg, 'uAmb', ...E.amb); U(pg, 'uNight', E.dk); U(pg, 'uWater', ...E.water);
    bindTex(pg, 'uH', tex, 0); gl.uniform1i(pg.u.uNL, Lt.nl); gl.uniform4fv(pg.u.uL, Lt.L); gl.uniform3fv(pg.u.uLC, Lt.LC); if (pg.u.uNB) gl.uniform1i(pg.u.uNB, 0);
  }
  for (const e of POOLS[0].values()) MS.drawInstances(e.mesh, e.arr, e.n);
  if (mode === 0) for (const e of POOLS[1].values()) MS.drawInstances(e.mesh, e.arr, e.n);
  MS.drawInstances(MS.dynMesh(DYN[0], DYN[1]), DYN, 1);
}
// dynamic resolution: keep frames under ~20ms by trading internal resolution
let lastT = 0, acc = 0, frames = 0;
function adaptScale() {
  if (PIXEL[SET.pixel]) return;                   // pixel styles are already cheap; their size is fixed
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
  ensureField(); ensureTargets();
  const [w, h] = rtSize, bs = boatRenderState(alpha);
  // Pixel styles draw the world with the camera snapped to whole pixels, so static things (lighthouses, glints,
  // ripples) sit still on the pixel grid instead of shimmering as the camera glides. The leftover fraction is
  // applied when the frame is scaled up to the screen, which keeps scrolling smooth.
  const px = rtSize[2], camX0 = G.cam.x + G.shakeX, camY0 = G.cam.y + G.shakeY;
  const camX = px ? Math.floor(camX0 * px) / px : camX0, camY = px ? Math.floor(camY0 * px) / px : camY0;
  const x0 = Math.floor(camX) - PAD, y0 = Math.floor(camY) - PAD;
  uploadHeights(x0, y0);
  STY.px = px; STY.org = [Math.round(camX * px), Math.round(camY * px), h];
  const HR = [x0, y0, HW, HH], CAM = px ? [camX, camY, w / px, h / px] : [camX, camY, W, H], E = environment();
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
  gl.bindVertexArray(foamVao); gl.bindBuffer(gl.ARRAY_BUFFER, foamBuf); gl.bufferData(gl.ARRAY_BUFFER, foamArr.subarray(0, nf * 8), gl.STREAM_DRAW); gl.drawArrays(gl.POINTS, 0, nf);
  gl.disable(gl.BLEND);
  // 3. scene: ground, meshes, particles
  into(RT.scene, w, h); gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const pg = PG.ground; gl.useProgram(pg.p);
  bindTex(pg, 'uH', tex, 0); bindTex(pg, 'uFoam', RT.foam.tex, 1); bindTex(pg, 'uShadow', RT.shadow.tex, 2);
  U(pg, 'uHR', ...HR); U(pg, 'uCam', ...CAM); U(pg, 'uT', G.t); U(pg, 'uWT', WX.waveT); U(pg, 'uWind', WX.wind); U(pg, 'uRain', WX.rain);
  U(pg, 'uNight', E.dk); U(pg, 'uCloud', E.cloud); U(pg, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U(pg, 'uWD', Math.cos(windAngle()), Math.sin(windAngle()));
  U(pg, 'uSun', ...E.sun); U(pg, 'uSunC', ...E.sunC); U(pg, 'uAmb', ...E.amb); U(pg, 'uSky', ...E.sky); styleUniforms(pg);
  gl.uniform1i(pg.u.uNL, Lt.nl); gl.uniform4fv(pg.u.uL, Lt.L); gl.uniform3fv(pg.u.uLC, Lt.LC); gl.uniform1i(pg.u.uNB, Lt.nb); gl.uniform4fv(pg.u.uB, Lt.B);
  quad();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  drawMeshes(0, CAM, HR, E, Lt, shXY);
  // particles blend over the colour but leave alpha (the solid-voxel mask for the outline) alone; glow adds
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  const [np, ng] = partPoints(), pp = PG.part;
  gl.useProgram(pp.p); U(pp, 'uCam', ...CAM); U(pp, 'uPpu', w / CAM[2]); U(pp, 'uSun', ...E.sun); U(pp, 'uSunC', ...E.sunC); U(pp, 'uAmb', ...E.amb); styleUniforms(pp);
  gl.bindVertexArray(partVao); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf); gl.bufferData(gl.ARRAY_BUFFER, partArr.subarray(0, (np + ng) * 9), gl.STREAM_DRAW); gl.drawArrays(gl.POINTS, 0, np);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); gl.drawArrays(gl.POINTS, np, ng);
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
  const out = RT.out;
  if (out) into(out); else into(null, cv.width, cv.height);
  const cp = PG.comp; gl.useProgram(cp.p);
  bindTex(cp, 'uScene', scene.tex, 0); bindTex(cp, 'uBloom', RT.qa.tex, 1); bindTex(cp, 'uBlur', RT.ta.tex, 2);
  // pixel styles: ordered-dither palette steps and the ink edge replace film grain; tilt-shift is gentler
  styleUniforms(cp); U(cp, 'uQ', 0); U(cp, 'uInk', px ? 0.75 * (R.fx.ink ?? 1) : 0);
  U(cp, 'uT', G.t); U(cp, 'uExp', E.exp); U(cp, 'uSat', E.sat); U(cp, 'uVig', 0.42); U(cp, 'uTilt', (px ? 0.45 : 0.7) * R.fx.tilt); U(cp, 'uGrain', SET.calm || px ? 0 : 0.01);
  U(cp, 'uGrade', R.fx.grade ?? 1); U(cp, 'uDusk', E.dusk);
  U(cp, 'uRain', WX.rain); U(cp, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U(cp, 'uBloomK', (0.5 + E.dk * 0.5) * R.fx.bloom); U(cp, 'uSlant', 0.3 + WX.wind * 0.7);
  U(cp, 'uTint', ...E.tint); U(cp, 'uRes', out ? out.w : cv.width, out ? out.h : cv.height);
  quad();
  if (out) {
    // k device pixels per render pixel; slide by the sub-pixel camera remainder (y is up in GL)
    const k = cv.width / (W * px), ox = Math.round((camX0 - camX) * px * k), oy = Math.round((camY0 - camY) * px * k);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, out.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blitFramebuffer(0, 0, out.w, out.h, -ox, cv.height + oy - Math.round(out.h * k), -ox + Math.round(out.w * k), cv.height + oy, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  gl.bindVertexArray(null);
}
