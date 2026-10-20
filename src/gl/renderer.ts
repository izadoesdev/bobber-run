// WebGL2 renderer. Terrain + water come from one fragment shader reading the heightfield; boats, landmarks,
// trees and sea life are lit voxel meshes; shadows are projected along the sun into a world-aligned buffer;
// wakes/splashes are stamped into a foam buffer the water shader reads; then HDR post (bloom, tilt-shift,
// filmic grading, vignette, grain, rain).
import { W, H, clamp, lerp } from '../config';
import { ONLINE, type Sailor } from '../online';
import { SET, type Quality, type PixelStyle } from '../prefs';
import { TS, TN, getTile, hasTile, poisNear, schoolsNear, cratesNear, type HeightTile } from '../world';
import { hash01 } from '../noise';
import { SPECIES, BOATS, warmth, coldness, activeAt } from '../econ';
import { schoolLook } from '../species';
import { DIVE_S, SCATTER_S } from '../game/schools';
import { G, darkness, lightR, schoolActive, isNight, dayFrac, equipment, windAngle, boatDef, env } from '../game';
import { WX } from '../weather';
import { LIFE, type Whale, type Giant, type Ship } from '../life';
import { hasOars, oarGeom, BOAT_MODELS, NP, SHIPPED, PLAIN, type Fit } from '../models';
import { program, texture, target, msTarget, free, type Program, type Target, type MsTarget } from './glutil';
import * as SH from './shaders';
import * as MS from './meshes';
import { trackFailure } from '../analytics';
import { minScale } from '../camera';
import type { BoatId, FishLine, Point, Poi, School, Crate } from '../types';

export interface RenderOptions {
  /** whole device pixels per world unit at the ship's default view: fixes the canvas and render-target sizes (main.ts) */
  S0: number;
  /** device pixels per world unit shown now; eases toward S0 x the player's zoom (main.ts) */
  S: number;
  /** internal resolution scale for the 'smooth' style (adapted when quality is 'auto') */
  scale: number;
  quality: Quality;
  /** post effect strengths, 0..1 */
  fx: { bloom: number; tilt: number; grade: number; ink?: number };
}
export const R: RenderOptions = { S0: 1, S: 1, scale: 1, quality: 'auto', fx: { bloom: 1, tilt: 1, grade: 1 } };

type GL = WebGL2RenderingContext;
let gl: GL, cv: HTMLCanvasElement, hdr = false;
let quadVao: WebGLVertexArrayObject, foamVao: WebGLVertexArrayObject, foamBuf: WebGLBuffer, partVao: WebGLVertexArrayObject, partBuf: WebGLBuffer;
interface Programs { ground: Program; mesh: Program; foam: Program; part: Program; bright: Program; blur: Program; comp: Program; copy: Program; present: Program }
let PG: Programs;

export function initRender(canvas: HTMLCanvasElement): void {
  cv = canvas;
  const ctx = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!ctx) {
    document.body.innerHTML = '<p style="color:#efe9dc;font:16px monospace;padding:2em">This game needs a browser with WebGL2.</p>';
    throw new Error('WebGL2 unavailable');
  }
  gl = ctx;
  setupGL();
  // The GPU can drop the context (driver reset, too many tabs). Pause drawing, and rebuild everything when it comes
  // back; if it doesn't, offer a reload.
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); lost = true; trackFailure('webgl_context_lost');
    setTimeout(() => { if (lost) offerReload(); }, 4000);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try { setupGL(); lost = false; } catch (err) { console.error(err); trackFailure('webgl_restore_failed'); offerReload(); }
  });
}
let lost = false;
function offerReload(): void {
  if (document.getElementById('gl-reset')) return;
  const b = document.createElement('button');
  b.id = 'gl-reset'; b.textContent = 'Graphics were reset. Click to reload.';
  b.style.cssText = 'position:fixed;inset:0;margin:auto;width:max-content;height:max-content;padding:1em 1.6em;font:16px monospace;color:#efe9dc;background:#1b2a33;border:2px solid #efe9dc;cursor:pointer;z-index:99';
  b.onclick = () => location.reload();
  document.body.append(b);
}
// programs, buffers and vertex arrays; every target and mesh is (re)built on demand afterwards
function setupGL(): void {
  hdr = !!gl.getExtension('EXT_color_buffer_float');
  PG = {
    ground: program(gl, SH.QUAD_VS, SH.GROUND_FS), mesh: program(gl, SH.MESH_VS, SH.MESH_FS),
    foam: program(gl, SH.FOAM_VS, SH.FOAM_FS), part: program(gl, SH.PART_VS, SH.PART_FS),
    bright: program(gl, SH.QUAD_VS, SH.BRIGHT_FS), blur: program(gl, SH.QUAD_VS, SH.BLUR_FS),
    comp: program(gl, SH.QUAD_VS, SH.COMPOSITE_FS), copy: program(gl, SH.QUAD_VS, SH.COPY_FS), present: program(gl, SH.QUAD_VS, SH.PRESENT_FS),
  };
  // full-screen quad
  quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // foam stamps: 2 x vec4 per point
  foamVao = gl.createVertexArray(); gl.bindVertexArray(foamVao);
  foamBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, foamBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, FOAM_STRIDE * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FOAM_STRIDE * 4, 16);
  // scene particles: vec4 position+size, vec4 colour, float style
  partVao = gl.createVertexArray(); gl.bindVertexArray(partVao);
  partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PART_STRIDE * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PART_STRIDE * 4, 16);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, PART_STRIDE * 4, 32);
  gl.bindVertexArray(null);
  MS.init(gl, gl.createBuffer()); MS.reset();
  field = null; frame = null;
}

// ---------- render targets ----------
// Every buffer is sized once per window for the widest view the player can zoom out to; each frame draws into the
// part its view needs, so zooming never reallocates. One art pixel stays one world unit at every zoom: zoomed out,
// the frame simply spans more render pixels, each smaller on screen.
// The heightfield, foam and shadow buffers cover the view plus a margin; their origin moves in SNAP-unit steps, so
// the heights upload (skipped while the field stays put) runs a few times a second while sailing, not every frame.
const PAD = 40, FR = 2, SNAP = 8;               // margin in world units; foam/shadow texels per world unit; origin step
/** the widest view (world units) this window can show */
const maxView = () => { const s = minScale(R.S0, cv.width, cv.height); return [cv.width / s, cv.height / s]; };
interface Field {
  /** texture size in texels */
  TW: number; TH: number;
  hdata: Float32Array; tex: WebGLTexture; foam: Target; shadow: Target;
  /** the last upload (x0, y0, step, w, h): heights never change, so an unmoved field skips the upload */
  last: number[];
}
let field: Field | null = null;
function ensureField(): Field {
  const [vw, vh] = maxView(), tw = Math.ceil(vw) + PAD * 2 + SNAP + 2, th = Math.ceil(vh) + PAD * 2 + SNAP + 2;
  if (field && tw === field.TW && th === field.TH) return field;
  if (field) { gl.deleteTexture(field.tex); free(gl, field.foam); free(gl, field.shadow); }
  field = {
    TW: tw, TH: th, hdata: new Float32Array(tw * th), last: [],
    tex: texture(gl, tw, th, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR),
    foam: target(gl, tw * FR, th * FR, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE),
    shadow: target(gl, tw * FR, th * FR, gl.R8, gl.RED, gl.UNSIGNED_BYTE),
  };
  return field;
}
// pixel styles draw the scene at a fixed number of pixels per world unit, without MSAA, then scale up to the canvas
// with hard edges; 'smooth' draws at canvas resolution
const PIXEL: Partial<Record<PixelStyle, number>> = { chunky: 1, crisp: 2 };
interface Frame {
  /** allocated size; a frame uses the part its view needs */
  w: number; h: number;
  /** render pixels per world unit (0 = smooth) */
  px: number;
  scene: MsTarget;
  /** bloom chain (half, quarter) and tilt-shift blur (quarter) */
  half: Target; qa: Target; qb: Target; ta: Target; tb: Target;
  /** pixel styles composite here, then scale up to the canvas */
  out: Target | null;
}
let frame: Frame | null = null;
function ensureTargets(): Frame {
  const px = PIXEL[SET.pixel] || 0;
  let w, h;
  if (px) {                                       // the widest view at px per world unit (never more than the canvas), plus a spare pixel to slide
    const [vw, vh] = maxView(), k = Math.min(px, cv.width / vw);
    w = Math.ceil(vw * k) + 1; h = Math.ceil(vh * k) + 1;
  } else { const sc = Math.min(1, 1920 / cv.width) * R.scale; w = Math.max(64, Math.round(cv.width * sc)); h = Math.max(40, Math.round(cv.height * sc)); }
  if (frame && w === frame.w && h === frame.h && px === frame.px) return frame;
  if (frame) for (const t of [frame.scene, frame.half, frame.qa, frame.qb, frame.ta, frame.tb, frame.out]) free(gl, t);
  const IF = hdr ? gl.RGBA16F : gl.RGBA8, TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const mk = (a: number, b: number) => target(gl, Math.max(1, a), Math.max(1, b), IF, gl.RGBA, TY);
  const samples: number = px ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
  frame = {
    w, h, px, scene: msTarget(gl, w, h, IF, gl.RGBA, TY, samples),
    half: mk(w >> 1, h >> 1), qa: mk(w >> 2, h >> 2), qb: mk(w >> 2, h >> 2), ta: mk(w >> 2, h >> 2), tb: mk(w >> 2, h >> 2),
    out: px ? target(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE) : null,
  };
  return frame;
}

// ---------- uniforms ----------
// the pixel-style dither is anchored to world pixels: STY.org = world pixel of the frame's top-left, and frame height
const STY = { px: 0, org: [0, 0, 1] };
function styleUniforms(pg: Program): void { U1(pg, 'uPx', STY.px); U3(pg, 'uOrg', STY.org); }
function U1(pg: Program, name: string, x: number): void { const l = pg.u[name]; if (l) gl.uniform1f(l, x); }
function U2(pg: Program, name: string, x: number, y: number): void { const l = pg.u[name]; if (l) gl.uniform2f(l, x, y); }
function U3(pg: Program, name: string, v: ArrayLike<number>): void { const l = pg.u[name]; if (l) gl.uniform3f(l, v[0], v[1], v[2]); }
function U4(pg: Program, name: string, v: ArrayLike<number>): void { const l = pg.u[name]; if (l) gl.uniform4f(l, v[0], v[1], v[2], v[3]); }
function bindTex(pg: Program, name: string, t: WebGLTexture, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  const l = pg.u[name];
  if (l) gl.uniform1i(l, unit);
}
function into(t: { fb: WebGLFramebuffer; w: number; h: number } | null, w?: number, h?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
  gl.viewport(0, 0, w ?? t!.w, h ?? t!.h);
}
function quad(): void { gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }

// ---------- heightfield around the camera ----------
// hw x hh heights from world (x0, y0), one every fs units, into the corner of the heights texture
function uploadHeights(F: Field, x0: number, y0: number, fs: number, hw: number, hh: number): void {
  const L = F.last;
  if (L[0] === x0 && L[1] === y0 && L[2] === fs && L[3] === hw && L[4] === hh) return;
  L[0] = x0; L[1] = y0; L[2] = fs; L[3] = hw; L[4] = hh;
  const hdata = F.hdata;
  let i = 0;
  for (let j = 0; j < hh; j++) {
    const wy = y0 + j * fs, ty = Math.floor(wy / TS), row = (wy - ty * TS + 1) * TN;
    let tx = Math.floor(x0 / TS), tile = getTile(tx, ty), base = tx * TS - 1;
    for (let k = 0; k < hw; k++, i++) {
      const wx = x0 + k * fs;
      if (wx - base > TS) { tx++; tile = getTile(tx, ty); base = tx * TS - 1; }
      hdata[i] = tile.h[row + wx - base];
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, F.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, hw, hh, gl.RED, gl.FLOAT, hdata);
}

// ---------- trees: deterministic per height tile ----------
const KINDS = MS.TREE_KINDS;
const KI: Record<string, number> = Object.fromEntries(KINDS.map((k, i) => [k, i]));
// one candidate per 6x6 cell, chosen by height band and climate; cached on the tile as [x, y, kind, scale, yaw] runs
function tileTrees(t: HeightTile): number[] {
  if (t.trees) return t.trees;
  const L: number[] = [], x0 = t.tx * TS, y0 = t.ty * TS, GS = 6;
  for (let gy = Math.floor(y0 / GS); gy <= Math.floor((y0 + TS - 1) / GS); gy++) for (let gx = Math.floor(x0 / GS); gx <= Math.floor((x0 + TS - 1) / GS); gx++) {
    const r = hash01(gx, gy, 41), px = gx * GS + Math.floor(hash01(gx, gy, 42) * GS), py = gy * GS + Math.floor(hash01(gx, gy, 43) * GS);
    if (px < x0 || px >= x0 + TS || py < y0 || py >= y0 + TS) continue;
    const v = t.h[(py - y0 + 1) * TN + px - x0 + 1];
    if (v < 0.03) continue;
    let kind: string | null = null;
    if (v < 0.12) { if (r < 0.025) kind = 'boulders'; }                     // the odd heap of stones on the beach
    else if (v >= 0.36 && v < 0.76) { if (r < 0.72) kind = v > 0.5 || r < 0.25 ? 'pine' : 'round'; }
    else if (v < 0.36) { if (r < 0.06) kind = 'round'; else if (r < 0.08) kind = 'rock'; else if (r < 0.17) kind = r < 0.13 ? 'bush' : 'berrybush'; }
    else if (r < 0.06) kind = r < 0.025 ? 'boulders' : 'rock';
    const wm = warmth(py), cd = coldness(py), rr = hash01(gx, gy, 45);
    const stony = kind === 'rock' || kind === 'boulders', shrub = kind === 'bush' || kind === 'berrybush';
    if (wm > rr && v >= 0.12 && v < 0.24 && r < 0.14) kind = 'palm';
    else if (kind && !stony && !shrub && cd > rr) kind = 'snowpine';
    else if (kind === 'pine' && wm > rr) kind = 'round';
    if (!kind) continue;
    if (kind === 'pine' || kind === 'round' || kind === 'snowpine') { if (hash01(gx, gy, 44) < 0.3) kind += 'B'; }   // big variant
    L.push(px + 0.5, py + 0.5, KI[kind], 0.85 + hash01(gx, gy, 46) * 0.35, hash01(gx, gy, 47) * 6.283);
  }
  return (t.trees = L);
}

// ---------- instance pools ----------
interface Pool { mesh: MS.Mesh; arr: Float32Array; n: number }
const POOLS = [new Map<MS.Mesh, Pool>(), new Map<MS.Mesh, Pool>()];   // [casts shadow, no shadow]
// tint: a brightness or an [r,g,b]; glow: how strongly the mesh's glowable voxels shine (lamps 1, sea life by night);
// clear: how slowly it fades into the water below the waterline (1 for hulls; sea life shows through a little more)
function inst(mesh: MS.Mesh, x: number, y: number, yaw = 0, scale = 1, z = 0, pitch = 0, roll = 0, noShadow = false,
  tint: number | readonly number[] = 1, glow = 1, clear = 1): void {
  const pool = POOLS[noShadow ? 1 : 0];
  let e = pool.get(mesh);
  if (!e) { e = { mesh, arr: new Float32Array(MS.INST * 32), n: 0 }; pool.set(mesh, e); }
  if ((e.n + 1) * MS.INST > e.arr.length) { const a = new Float32Array(e.arr.length * 2); a.set(e.arr); e.arr = a; }
  const A = e.arr, o = e.n * MS.INST, mono = typeof tint === 'number';
  A[o] = x; A[o + 1] = y; A[o + 2] = yaw; A[o + 3] = scale;
  A[o + 4] = z; A[o + 5] = pitch; A[o + 6] = roll; A[o + 7] = glow;
  A[o + 8] = mono ? tint : tint[0]; A[o + 9] = mono ? tint : tint[1]; A[o + 10] = mono ? tint : tint[2]; A[o + 11] = clear;
  e.n++;
}
const resetPool = (e: Pool) => { e.n = 0; };
const DYN = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1]);   // the oars/rod/line instance, placed at the boat
export interface BoatPose { x: number; y: number; a: number }
/** the player's boat interpolated between physics steps */
const pose: BoatPose = { x: 0, y: 0, a: 0 };
/** the player's boat interpolated between physics steps (a shared object, overwritten by the next call) */
export function boatRenderState(alpha: number): BoatPose {
  const b = G.boat;
  pose.x = lerp(b.px, b.x, alpha); pose.y = lerp(b.py, b.y, alpha); pose.a = lerp(b.pa, b.a, alpha);
  return pose;
}
const frac = (x: number) => x - Math.floor(x);
const strokePose = (ph: number) => Math.floor(frac(ph) * NP) % NP;
const near = (o: Point, cx: number, cy: number, mx: number, my: number) => Math.abs(o.x - cx) < mx && Math.abs(o.y - cy) < my;

// ---------- sea life ----------
const WHALE_K = 26 / MS.WHALE.len;                 // a humpback is ~26 units long at size 1
function drawWhale(w: Whale): void {
  const s = w.size * WHALE_K, ca = Math.cos(w.a), sa = Math.sin(w.a);
  const zAxis = w.z - 1.6 * s, under = w.z < 2;    // z: 0 = the back just breaking the surface
  inst(MS.whaleMesh(), w.x, w.y, w.a, s, zAxis, w.pitch, w.roll, under, 1, 0, 0.6);
  // the tail stock hinges at the end of the body: it beats while swimming and lifts the fluke clear to dive or slap
  const jx = MS.WHALE.joint * s * Math.cos(w.pitch), jz = MS.WHALE.joint * s * Math.sin(w.pitch);
  const beat = Math.sin(G.t * 1.7 + w.t) * 0.22 * (1 - w.tail);
  inst(MS.flukeMesh(), w.x + ca * jx, w.y + sa * jx, w.a, s, zAxis + jz, w.pitch - w.tail * 1.35 + beat, w.roll, under, 1, 0, 0.6);
}
// eels undulate: a chain of segments, each swinging a little more than the one ahead
function drawEel(g: Giant): void {
  const N = 10, segL = g.len / N, s = segL / 4;
  let x = g.x, y = g.y;
  for (let i = 0; i < N; i++) {
    const yaw = g.a + Math.sin(g.ph * 2 - i * 0.75) * 0.45 * (0.25 + i / N), c = Math.cos(yaw), sn = Math.sin(yaw);
    inst(MS.eelMesh(i === 0 ? 'head' : i === N - 1 ? 'tail' : 'seg'), x - c * segL * 0.35, y - sn * segL * 0.35, yaw, s, g.z, 0, 0, true, 1, g.glow);
    x -= c * segL; y -= sn * segL;
  }
}
function drawGiant(g: Giant): void {
  const { z, len, ph, glow, a } = g;
  if (g.kind === 'ray') inst(MS.mantaMesh(ph), g.x, g.y, a, len / MS.MANTA_LEN, z, Math.sin(ph) * 0.05, Math.sin(ph * 0.5) * 0.12, true, 1, glow);
  else if (g.kind === 'squid') inst(MS.squidMesh(), g.x, g.y, a + Math.sin(ph * 0.7) * 0.05, len / MS.SQUID_LEN * (1 + Math.sin(ph * 2) * 0.04), z, 0, Math.sin(ph) * 0.15, true, 1, glow);
  else if (g.kind === 'eel') drawEel(g);
  else inst(MS.shadowFishMesh(), g.x, g.y, a + Math.sin(ph) * 0.07, len / MS.SHADOW_LEN, z, 0, 0, true, 1, 0);
}
// NPC ships and other players' boats: a plain fit-out in their paint, lamp lit
const shipEq = new Map<string, Fit>();
function eqFor(paint: string): Fit {
  let e = shipEq.get(paint);
  if (!e) { e = { ...PLAIN, paint: paint || 'classic', lantern: 1 }; shipEq.set(paint, e); }
  return e;
}
const isBoatId = (id: string): id is BoatId => id in BOAT_MODELS;
const shipDef = (id: string) => BOATS.find(b => b.id === id) || BOATS[0];

// ---------- fish schools ----------
// Each species shows in its own colours, size and habits. Scattered fish dart off and regroup, fished-out schools
// thin to a straggler and fill back in, and diving schools sink out of sight. Surface effects found while placing
// the fish are kept in `schoolFx` (x, y, kind per entry) for the foam and particle passes.
const FX_RING = 0, FX_GOLD = 1, FX_GLOW = 2, FX_SPRAY = 3;
const schoolFx: number[] = [];
const shownCount = new WeakMap<School, number>();   // eased number of fish on show, so they come and go smoothly
let sceneT = 0, schoolEase = 0;
const GOLD_TINT = 1.2;
const smooth01 = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const tint3 = [1, 1, 1];
/** How far a school has sunk on a dive (0 swimming .. 1 out of sight); it rises back the same way. */
function sunk(s: School): number {
  const end = s.spooked ?? 0;
  return G.t < end ? smooth01((G.t - (end - DIVE_S)) / 1.6) : 1 - smooth01((G.t - end) / 1.6);
}
// Fish come from the school's swim simulation (game/schools); here they get depth, colour, glow and their tricks.
function drawSchool(s: School, night: boolean, lit: boolean): void {
  const fish = s.swim, dive = sunk(s);
  if (!fish || dive >= 1) { shownCount.delete(s); return; }
  const sp = SPECIES[s.sp], look = schoolLook(s.sp), m = MS.fishMesh(s.sp);
  const full = look.count + (G.frenzy?.s === s ? 2 : 0), straggler = s.stock <= 0;
  const want = straggler ? 1 : Math.max(1, Math.round(full * Math.min(1, s.stock / Math.max(1, s.max))));
  const was = shownCount.get(s) ?? want, n = was + (want - was) * schoolEase;
  shownCount.set(s, n);
  const cnt = Math.min(fish.length, Math.ceil(n - 0.02)), age = G.t - (s.scatterT ?? -99), dip = age < SCATTER_S ? Math.sin(Math.PI * Math.min(1, age / 2)) : 0;
  const leapCycle = 6 + frac(s.ph) * 3, leap = sp.fight === 'jumper' && !straggler && !dip && !dive ? frac(G.t / leapCycle + s.ph) * leapCycle / 0.8 : 9;
  for (let k = 0; k < cnt; k++) {
    const f = fish[k], p = clamp(n - k, 0, 1), speed = Math.hypot(f.vx, f.vy);
    const yaw = Math.atan2(f.vy, f.vx) + Math.sin(G.t * (6 + speed) + k) * 0.08 * Math.min(1, speed / 3);   // tails beat faster at speed
    const z = look.z - (1 - p) * 5 - dive * 7 - (straggler ? 1.2 : 0) - dip * 1.2;
    if (age < 0.45) schoolFx.push(f.x, f.y, FX_RING);          // scattering fish ruffle the surface
    const gold = s.gold && k === 0 && !straggler, shimmer = sp.legend ? 1 + 0.3 * Math.sin(G.t * 2.5 + k * 2) : 1;
    let tint: number | readonly number[] = (look.bottom ? 0.72 : 1) * (straggler ? 0.75 : 1) * (lit ? 1 : 0.45) * shimmer;
    if (gold) { tint = GOLD_TINT; schoolFx.push(f.x, f.y, FX_GOLD); }
    else if (sp.legend) { tint3[0] = shimmer * 0.95; tint3[1] = shimmer; tint3[2] = shimmer * 1.15; tint = tint3; }
    const mesh = gold ? MS.fishMesh(s.sp, true) : m, glow = look.glow ? (night ? 0.4 : 0.15) : 0;
    if (glow && night) schoolFx.push(f.x, f.y, FX_GLOW);
    if (k === 0 && leap < 1) {                            // a jumper breaks the surface now and then
      const side = Math.cos(yaw) > 0 ? 0 : Math.PI;
      inst(mesh, f.x, f.y, side, look.size, look.z + Math.sin(Math.PI * leap) * (5 + look.size * 6), (0.5 - leap) * (side ? -1.6 : 1.6), 0, true, tint, glow, look.fade);
      if (leap < 0.15 || leap > 0.85) schoolFx.push(f.x, f.y, FX_SPRAY);
      continue;
    }
    inst(mesh, f.x, f.y, yaw, look.size * (0.7 + 0.3 * p), z, 0, Math.PI / 2, true, tint, glow, Math.min(1.2, look.fade + dive * 0.6 + (1 - p) * 0.5));
  }
}
/** The fish on the line: a shadow closing in on the bait, under the bobber as it bites, then fighting where the line runs. */
function drawHookedFish(f: FishLine, bx: number, by: number): void {
  const look = schoolLook(f.s.sp), b = G.boat;
  let x = bx, y = by, yaw = Math.atan2(by - b.y, bx - b.x), z = look.z - 0.6, tint: number | readonly number[] = 0.5, fade = 0.85;
  if (f.st === 'wait') {
    const k = smooth01(f.t / Math.max(0.1, f.wait)), nib = f.teaseT !== undefined ? 1 - smooth01((G.t - f.teaseT) / 0.5) : 0;
    const ang = f.s.ph + G.t * 0.7, r = 3 + 14 * (1 - k) * (1 - nib * 0.8);
    x = f.tx + Math.cos(ang) * r; y = f.ty + Math.sin(ang) * r * 0.75; yaw = ang + Math.PI / 2; z = look.z - 2.5 + k;
  } else if (f.st === 'bite') {
    if (f.run !== undefined) yaw = f.run;
  } else if (f.st === 'reel') {
    const surge = Math.min(1, f.surge || 0);
    yaw += Math.sin(f.ph * 0.7) * 0.6; z = look.z - 0.8 + surge * 0.6; tint = 0.85 + surge * 0.3; fade = 0.5;
  } else return;
  const gold = !!f.gold && f.st !== 'wait';
  if (gold) tint = GOLD_TINT;
  inst(MS.fishMesh(f.s.sp, gold), x, y, yaw + Math.sin(G.t * 9) * 0.1, look.size * 1.1, z, 0, Math.PI / 2, true, tint, look.glow && isNight() ? 1 : 0, fade);
}

// ---------- scene ----------
const SIDES = [-1, 1];
const W3a = [0, 0, 0], W3b = [0, 0, 0];           // scratch points for boat-local -> world transforms
const sceneSchools: School[] = [], sceneCrates: Crate[] = [];
// oar geometry depends only on the two stroke poses and the propulsion level, so it is built once per combination
const oarCache = new Map<number, ReturnType<typeof oarGeom>>();
function oarsFor(poseL: number, prop: number, poseR: number): ReturnType<typeof oarGeom> {
  const key = (poseL * 16 + poseR) * 16 + prop;
  let g = oarCache.get(key);
  if (!g) { g = oarGeom(poseL, prop, poseR); oarCache.set(key, g); }
  return g;
}
// the rod and fishing line, in world space (scratch, rebuilt each frame)
const ROD_RGB = [94, 68, 48], LINE_RGB = [236, 232, 220];
const hand = [0, 0, 0], tip = [0, 0, 0], bob = [0, 0, 0], linePrev = [0, 0, 0], lineNext = [0, 0, 0];
function buildScene(bs: BoatPose, pois: Poi[], camX: number, camY: number): void {
  POOLS[0].forEach(resetPool); POOLS[1].forEach(resetPool);
  MS.dynBegin(); DYN[0] = bs.x; DYN[1] = bs.y;
  const cx = camX + W / 2, cy = camY + H / 2;
  // trees
  for (let ty = Math.floor((camY - 30) / TS); ty <= Math.floor((camY + H + 60) / TS); ty++) for (let tx = Math.floor((camX - 30) / TS); tx <= Math.floor((camX + W + 30) / TS); tx++) {
    const t = getTile(tx, ty);
    if (!t.land) continue;
    const L = tileTrees(t);
    for (let i = 0; i < L.length; i += 5) {
      const x = L[i], y = L[i + 1];
      if (x < camX - 24 || x > camX + W + 24 || y < camY - 12 || y > camY + H + 50) continue;
      inst(MS.treeMesh(KINDS[L[i + 2]]), x, y, L[i + 4], L[i + 3]);
    }
  }
  // landmarks, flotsam, treasure buoys
  for (const p of pois) {
    if (p.type === 'light') inst(MS.lighthouseMesh(), p.x, p.y);
    else if (p.type === 'port') inst(MS.harbourMesh(), p.x, p.y, p.ang);
    else inst(MS.wreckMesh(), p.x, p.y, p.dir / 16 * Math.PI * 2, 1, -0.6);
  }
  for (const c of cratesNear(cx, cy, 230, sceneCrates)) if (!c.taken) inst(MS.crateMesh(), c.x, c.y, c.ph, 1, -1.3 + Math.sin(G.t * 2 + c.ph) * 0.35, Math.sin(G.t * 1.3 + c.ph) * 0.1);
  for (const m of G.maps) if (Math.abs(m.x - cx) < W && Math.abs(m.y - cy) < H) inst(MS.buoyMesh(), m.x, m.y, 0, 1, -1.2 + Math.sin(G.t * 2 + m.x) * 0.3, Math.sin(G.t * 1.7) * 0.08);
  // fish schools swim under the surface; at night glowing fish and the ones in your light show clearly, others as dim shapes nearby
  const night = isNight(), lr = lightR() + 14;
  schoolFx.length = 0;
  schoolEase = 1 - Math.exp(-2.5 * clamp(G.t - sceneT, 0, 0.1)); sceneT = G.t;
  for (const s of schoolsNear(cx, cy, 240, sceneSchools)) {
    if (s.boss) {
      if (schoolActive(s)) { const a = G.t * 0.35; inst(MS.leviMesh(), s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 12, a + Math.PI / 2, 1, -5.5, 0, 0, true, 1); }
      continue;
    }
    const d = Math.hypot(s.x - G.boat.x, s.y - G.boat.y);
    const lit = !night || G.frenzy?.s === s || schoolLook(s.sp).glow || d < lr;
    if ((lit || d < 90) && activeAt(s.sp, env())) drawSchool(s, night, lit);
    else shownCount.delete(s);
  }
  // whales, giants, jellies, NPC ships, dolphins
  const mx = W / 2 + 60, my = H / 2 + 60;
  for (const w of LIFE.whales) if (near(w, cx, cy, mx, my)) drawWhale(w);
  for (const g of LIFE.giants) if (near(g, cx, cy, mx + g.len, my + g.len)) drawGiant(g);
  for (const j of LIFE.jellies) if (near(j, cx, cy, mx, my)) {
    const pulse = Math.sin(j.ph), sz = 0.55 * j.size;
    inst(MS.jellyMesh(pulse > 0.35), j.x, j.y, j.ph * 0.15, sz * (1 + pulse * 0.06), j.z, 0, 0, true, j.col, j.glow * (0.8 + 0.2 * pulse), 0.6);
  }

  for (let i = 0; i < fleet.length; i++) {
    const sh = fleet[i];
    if (!isBoatId(sh.id) || !near(sh, cx, cy, mx + 30, my + 30)) continue;
    const ph = i * 1.7 + (sh.x + sh.y) * 0.002, sw = 1 + WX.wind * 1.6;
    inst(MS.boatMesh(sh.id, eqFor(sh.paint)), sh.x, sh.y, sh.a, 1, Math.sin(G.t * 1.4 + ph) * (0.2 + WX.wind * 0.4) - 0.4, Math.sin(G.t * 1.0 + ph) * 0.02 * sw, Math.sin(G.t * 1.2 + ph + 1) * 0.03 * sw);
  }
  for (const p of LIFE.pods) for (const m of p.m) {          // each dolphin leaps in turn, then runs just under
    const ph = frac(p.t * 0.9 + m.ph);
    if (ph < 0.38) { const k = ph / 0.38; inst(MS.dolphinMesh(), m.x, m.y, m.a, 1, Math.sin(Math.PI * k) * 7 - 1.2, (0.5 - k) * 1.4); }
    else inst(MS.dolphinMesh(), m.x, m.y, m.a, 1, -2.6, 0, 0, true);
  }
  if (G.frenzy) for (let k = 0; k < 8; k++) {                 // gulls wheel over a feeding frenzy
    const a = G.t * (0.8 + k * 0.11) * (k % 2 ? 1 : -1) + k * 1.3, r = 10 + (k % 4) * 6;
    inst(MS.gullMesh(Math.floor(G.t * 5 + k * 0.7) % 2), G.frenzy.s.x + Math.cos(a) * r, G.frenzy.s.y + Math.sin(a) * r * 0.6, a + (k % 2 ? Math.PI / 2 : -Math.PI / 2), 0.8, 18 + (k % 3) * 5);
  }
  drawPlayerBoat(bs);
}
// boat-local [u, v, z] -> world, for the boat pose set in drawPlayerBoat
let b3x = 0, b3y = 0, b3c = 1, b3s = 0, b3z = 0;
function W3(q: readonly number[], out: number[]): number[] {
  out[0] = b3x + q[0] * b3c - q[1] * b3s; out[1] = b3y + q[0] * b3s + q[1] * b3c; out[2] = q[2] + b3z;
  return out;
}
// the boat, bobbing with the swell, plus oars/rod/line built in world space
function drawPlayerBoat(bs: BoatPose): void {
  const eq = equipment(), wob = 1 + WX.wind * 2.2;
  let bz = Math.sin(G.t * 1.6) * (0.2 + WX.wind * 0.45) - 0.4, roll = Math.sin(G.t * 1.3 + 1) * 0.035 * wob;
  if (G.mode === 'sunk') { bz -= G.sunkT * 3; roll += G.sunkT * 0.2; }
  const pitch = Math.sin(G.t * 1.1) * 0.025 * wob;
  inst(MS.boatMesh(G.boatId, eq), bs.x, bs.y, bs.a, 1, bz, pitch, roll);
  b3x = bs.x; b3y = bs.y; b3c = Math.cos(bs.a); b3s = Math.sin(bs.a); b3z = bz;
  if (hasOars(G.boatId)) {
    const stow = G.fish || G.mode !== 'play';
    const g = oarsFor(stow ? SHIPPED : strokePose(G.boat.phaseL), eq.prop, stow ? SHIPPED : strokePose(G.boat.phaseR));
    for (const l of g.lines) MS.dynBox(W3(l.a, W3a), W3(l.b, W3b), l.wide ? 0.95 : 0.6, l.col);
    for (const pt of g.points) {
      const q = W3(pt.p, W3a);
      W3b[0] = q[0] + 0.4; W3b[1] = q[1]; W3b[2] = q[2]; q[0] -= 0.4;
      MS.dynBox(q, W3b, 0.8, pt.col);
    }
  }
  const f = G.fish;
  if (f) {
    const ang = Math.atan2(f.ty - bs.y, f.tx - bs.x);
    hand[0] = bs.x + Math.cos(ang) * 2; hand[1] = bs.y + Math.sin(ang) * 2; hand[2] = 8 + bz;
    tip[0] = bs.x + Math.cos(ang) * 12; tip[1] = bs.y + Math.sin(ang) * 12; tip[2] = 16 + bz;
    let bx = f.tx, by = f.ty, lift = 0;
    if (f.st === 'cast') { const k = Math.min(1, f.t / 0.55); bx = lerp(bs.x, f.tx, k); by = lerp(bs.y, f.ty, k); lift = Math.sin(Math.PI * k) * 22; }
    if (f.st === 'bite' && f.run !== undefined) { const d = Math.min(f.t, 1.5) * 6; bx += Math.cos(f.run) * d; by += Math.sin(f.run) * d; }   // it runs with the bait
    if (f.st === 'reel') { bx = (f.fx ?? f.tx) + Math.sin(G.t * 37) * (f.surge || 0); by = (f.fy ?? f.ty) + Math.cos(G.t * 29) * (f.surge || 0) * 0.6; }
    const nibble = f.st === 'wait' && f.teaseT !== undefined ? 1 - smooth01((G.t - f.teaseT) / 0.3) : 0;
    drawHookedFish(f, bx, by);
    MS.dynBox(hand, tip, 0.45, ROD_RGB);                       // the rod
    // the line sags between the rod tip and the bobber
    bob[0] = bx; bob[1] = by; bob[2] = lift + (f.st === 'bite' ? -1.4 : 0.2) - nibble * 0.9;
    const sag = f.st === 'wait' ? 4 : f.st === 'cast' ? 0 : 1.2;
    linePrev[0] = tip[0]; linePrev[1] = tip[1]; linePrev[2] = tip[2];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      lineNext[0] = lerp(tip[0], bob[0], t); lineNext[1] = lerp(tip[1], bob[1], t); lineNext[2] = lerp(tip[2], bob[2] + 1, t) - Math.sin(Math.PI * t) * sag;
      MS.dynBox(linePrev, lineNext, 0.22, LINE_RGB, 1);
      linePrev[0] = lineNext[0]; linePrev[1] = lineNext[1]; linePrev[2] = lineNext[2];
    }
    inst(MS.bobberMesh(), bob[0], bob[1], 0, 1, bob[2] - 0.6 + Math.sin(G.t * 3) * 0.15);
    if (f.jump) {
      const k = Math.min(1, f.jump.t / 0.75), size = Math.max(0.6, schoolLook(f.s.sp).size);
      inst(MS.fishMesh(f.s.sp, !!f.gold), (f.fx ?? f.tx) + f.jump.dir * (k - 0.5) * 14, f.fy ?? f.ty, f.jump.dir > 0 ? 0 : Math.PI, size, Math.sin(Math.PI * k) * 16 - 1, (0.5 - k) * 1.6, 0, false, f.gold ? GOLD_TINT : 1, isNight() ? 1 : 0.2);
    }
  }
  // a landed fish arcs into the boat
  if (G.catchAnim) { const c2 = G.catchAnim, k = Math.min(1, c2.t / 0.7); inst(MS.fishMesh(c2.sp), lerp(c2.x, bs.x, k), lerp(c2.y, bs.y, k), Math.atan2(bs.y - c2.y, bs.x - c2.x), 0.6, Math.sin(Math.PI * k) * 24 + 2, k * 6.28, 0, false, 1, isNight() ? 1 : 0.2); }
}

// ---------- lighting environment for the time of day and weather ----------
// Colours are mixed in place into the reused ENV vectors (no per-frame arrays).
type Vec3 = number[];
function mix3(out: Vec3, a: readonly number[], b: readonly number[], t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}
function scale3(out: Vec3, a: readonly number[], k: number): Vec3 { out[0] = a[0] * k; out[1] = a[1] * k; out[2] = a[2] * k; return out; }
const bell = (x: number, m: number, w: number) => Math.exp(-(((x - m) / w) ** 2));
interface Env {
  /** unit direction toward the sun (or moon by night) and its colour */
  sun: Vec3; sunC: Vec3;
  amb: Vec3; sky: Vec3;
  /** post tint, darkness, dusk glow, cloud cover, saturation, exposure */
  tint: Vec3; dk: number; dusk: number; cloud: number; sat: number; exp: number;
  /** mid-depth water colour for the climate at the view centre */
  water: Vec3;
}
const ENV: Env = { sun: [0, 0, 0], sunC: [0, 0, 0], amb: [0, 0, 0], sky: [0, 0, 0], tint: [0, 0, 0], dk: 0, dusk: 0, cloud: 0, sat: 0, exp: 0, water: [0, 0, 0] };
const MOON = [Math.cos(Math.PI * 1.6), Math.sin(Math.PI * 1.6), 0.7];
const SUN_DAY = [1.0, 0.95, 0.86], SUN_DUSK = [1.3, 0.66, 0.32], SUN_NIGHT = [0.26, 0.35, 0.52];
const AMB_DAY = [0.5, 0.58, 0.68], AMB_DUSK = [0.42, 0.36, 0.56], AMB_NIGHT = [0.1, 0.155, 0.25], AMB_OVERCAST = [0.42, 0.46, 0.5];
const SKY_DAY = [0.72, 0.84, 0.96], SKY_DUSK = [1.15, 0.62, 0.42], SKY_NIGHT = [0.07, 0.12, 0.19], SKY_OVERCAST = [0.55, 0.6, 0.64];
const TINT_DAY = [1.02, 1.0, 0.97], TINT_DUSK = [1.14, 0.95, 0.86], TINT_NIGHT = [0.93, 1.01, 1.0];
const WATER = [0.17, 0.43, 0.55], WATER_WARM = [0.07, 0.53, 0.62], WATER_COLD = [0.22, 0.36, 0.46];
const sun0 = [0, 0, 0], grey = [0, 0, 0];
function environment(cy: number): Env {
  const E = ENV, c = dayFrac(), dk = darkness();
  const dusk = Math.max(bell(c, 0.6, 0.05), bell(c, 0.95, 0.04), bell(c, -0.05, 0.04)) * (1 - dk * 0.5);
  // the sun arcs across the sky through the day; by night the light comes from a fixed moon
  const dayT = clamp(((c + 0.05) % 1) / 0.69, 0, 1), up = Math.sin(Math.PI * dayT), a = Math.PI * 1.25 + (dayT - 0.5) * 1.3;
  sun0[0] = Math.cos(a); sun0[1] = Math.sin(a); sun0[2] = 0.3 + 0.6 * up;
  mix3(sun0, sun0, MOON, dk);
  const sl = Math.hypot(sun0[0], sun0[1], sun0[2]);
  E.sun[0] = sun0[0] / sl; E.sun[1] = sun0[1] / sl; E.sun[2] = sun0[2] / sl;
  const oc = clamp(WX.dark / 0.36, 0, 1), storm = WX.state === 'storm' ? 1 : 0;   // overcast
  mix3(E.sunC, mix3(E.sunC, SUN_DAY, SUN_DUSK, dusk), SUN_NIGHT, dk);
  scale3(E.sunC, E.sunC, (1 - dk * 0.62) * (1 - oc * 0.6));
  mix3(E.amb, mix3(E.amb, AMB_DAY, AMB_DUSK, dusk), AMB_NIGHT, dk);
  mix3(E.amb, E.amb, scale3(grey, AMB_OVERCAST, 1 - dk * 0.75), oc * 0.5);
  mix3(E.sky, mix3(E.sky, SKY_DAY, SKY_DUSK, dusk), SKY_NIGHT, dk);
  mix3(E.sky, E.sky, scale3(grey, SKY_OVERCAST, 1 - dk * 0.8), oc * 0.7);
  mix3(E.tint, mix3(E.tint, TINT_DAY, TINT_DUSK, dusk), TINT_NIGHT, dk);
  mix3(E.water, mix3(E.water, WATER, WATER_WARM, warmth(cy)), WATER_COLD, coldness(cy));
  E.dk = dk; E.dusk = dusk; E.cloud = 0.45 + oc * 0.5; E.sat = 1.12 - storm * 0.25 - oc * 0.1; E.exp = 1.06 + dk * 0.25;
  return E;
}

// ---------- point lights and lighthouse beams (uniform arrays, reused every frame) ----------
const MAX_LIGHTS = 16, MAX_BEAMS = 6;
const LT = {
  /** x, y, radius, strength per light; rgb per light; x, y, angle, length per beam */
  L: new Float32Array(MAX_LIGHTS * 4), LC: new Float32Array(MAX_LIGHTS * 3), B: new Float32Array(MAX_BEAMS * 4),
  nl: 0, nb: 0,
};
type Lights = typeof LT;
const AMBER = [1.0, 0.62, 0.26], PORT_LAMP = [1.0, 0.58, 0.24], LIGHTHOUSE_LAMP = [1.0, 0.72, 0.38], FRENZY_GLOW = [1.0, 0.9, 0.6];
const EEL_GLOW = [0.35, 0.7, 1.0], SEA_GLOW = [0.3, 0.95, 0.95];
function addLight(x: number, y: number, r: number, k: number, c: readonly number[]): void {
  if (LT.nl >= MAX_LIGHTS || k <= 0.01) return;
  const o = LT.nl * 4, oc = LT.nl * 3;
  LT.L[o] = x; LT.L[o + 1] = y; LT.L[o + 2] = r; LT.L[o + 3] = k;
  LT.LC[oc] = c[0]; LT.LC[oc + 1] = c[1]; LT.LC[oc + 2] = c[2];
  LT.nl++;
}
// jelly swarms light as one source per 48-unit cell; entries are pooled and reused
interface SwarmLight { x: number; y: number; n: number; g: number; c: Vec3; used: boolean }
const swarmLights = new Map<number, SwarmLight>(), swarmPool: SwarmLight[] = [], swarmOrder: SwarmLight[] = [], swarmC = [0, 0, 0];
function swarmEntry(): SwarmLight {
  const e = swarmPool[swarmOrder.length] ?? (swarmPool[swarmOrder.length] = { x: 0, y: 0, n: 0, g: 0, c: [0, 0, 0], used: false });
  e.x = 0; e.y = 0; e.n = 0; e.g = 0; e.c[0] = 0; e.c[1] = 0; e.c[2] = 0; e.used = false;
  swarmOrder.push(e);
  return e;
}
function lightsFor(bs: BoatPose, pois: Poi[], dk: number): Lights {
  LT.L.fill(0); LT.LC.fill(0); LT.B.fill(0); LT.nl = 0; LT.nb = 0;
  // warm amber (#ffb860) pools; the shader's falloff is soft, so radii run large
  addLight(bs.x, bs.y, lightR() * 1.6, 0.8 * dk, AMBER);
  for (const p of pois) {
    if (p.type === 'port') { addLight(p.end.x, p.end.y, 58, 0.7 * dk, AMBER); addLight(p.x, p.y, 40, 0.6 * dk, PORT_LAMP); }
    else if (p.type === 'light') {
      addLight(p.x, p.y, 54, 0.8 * dk, LIGHTHOUSE_LAMP);
      if (LT.nb < MAX_BEAMS) {
        const o = LT.nb * 4;
        LT.B[o] = p.x; LT.B[o + 1] = p.y; LT.B[o + 2] = G.t * 0.5 + p.beam; LT.B[o + 3] = 150;
        LT.nb++;
      }
    }
  }
  if (G.frenzy) addLight(G.frenzy.s.x, G.frenzy.s.y, 20, 0.25, FRENZY_GLOW);
  // sea life: glowing giants, jelly swarms (one light per cluster) and the lamps of passing boats
  const cx = G.cam.x + W / 2, cy = G.cam.y + H / 2, mx = W / 2 + 60, my = H / 2 + 60;
  for (const g of LIFE.giants) if (g.glow > 0.05 && near(g, cx, cy, mx, my)) addLight(g.x, g.y, g.len * 1.3, g.glow * 0.5, g.kind === 'eel' ? EEL_GLOW : SEA_GLOW);
  swarmLights.clear(); swarmOrder.length = 0;
  for (const j of LIFE.jellies) if (j.glow > 0.05 && near(j, cx, cy, mx, my)) {
    const k = Math.floor(j.x / 48) * 4096 + Math.floor(j.y / 48), c = j.col;
    let e = swarmLights.get(k);
    if (!e) swarmLights.set(k, e = swarmEntry());
    e.x += j.x; e.y += j.y; e.n++; e.g += j.glow;
    for (let i = 0; i < 3; i++) e.c[i] += c[i] * j.glow;
  }
  // the four brightest swarms, brightest first (ties keep first-seen order, like a stable sort)
  for (let r = 0; r < 4; r++) {
    let best: SwarmLight | null = null;
    for (const e of swarmOrder) if (!e.used && (!best || e.g > best.g)) best = e;
    if (!best) break;
    best.used = true;
    swarmC[0] = best.c[0] / best.g; swarmC[1] = best.c[1] / best.g; swarmC[2] = best.c[2] / best.g;
    addLight(best.x / best.n, best.y / best.n, 22 + 7 * Math.sqrt(best.n), Math.min(0.55, 0.1 * best.g), swarmC);
  }
  for (const sh of fleet) if (near(sh, cx, cy, mx, my)) addLight(sh.x, sh.y, 34, 0.55 * dk, AMBER);
  return LT;
}

// ---------- foam / ripple stamps ----------
// per stamp: x, y, size (long axis), alpha | kind (0 disc, 1 ring), heading, aspect (short/long), foam share (rest is ripple)
const FOAM_STRIDE = 8;
let foamArr = new Float32Array(FOAM_STRIDE * 1024), fN = 0;
function foam(x: number, y: number, s: number, a: number, kind = 0, ang = 0, asp = 1, fk = 1): void {
  if ((fN + 1) * FOAM_STRIDE > foamArr.length) { const t = new Float32Array(foamArr.length * 2); t.set(foamArr); foamArr = t; }
  const F = foamArr, o = fN * FOAM_STRIDE;
  F[o] = x; F[o + 1] = y; F[o + 2] = s; F[o + 3] = a; F[o + 4] = kind; F[o + 5] = ang; F[o + 6] = asp; F[o + 7] = fk;
  fN++;
}
// the hull currently being washed: position and heading (set by hullWash for washAt)
let wx = 0, wy = 0, wc = 1, ws = 0;
// a disc stamp at hull-local (u, v)
function washAt(u: number, v: number, size: number, alpha: number, ang: number, asp: number): void {
  foam(wx + wc * u - ws * v, wy + ws * u + wc * v, size, alpha, 0, ang, asp);
}
// water around a hull: at rest, soft hull-shaped ripples swell out from the waterline and fade (mostly ripple, a
// little foam); under way, a curling bow wave, wash along both sides and churned water at the stern
function hullWash(x: number, y: number, a: number, L: number, B: number, sp: number, seed: number, amt = 1, vee = false): void {
  const c = Math.cos(a), s = Math.sin(a), t = G.t + seed;
  wx = x; wy = y; wc = c; ws = s;
  const idle = clamp(1 - sp / 10, 0, 1) * amt;
  if (idle > 0.01) for (let i = 0; i < 3; i++) {
    const ph = frac(t * 0.28 + i / 3);
    foam(x, y, L * (1.3 + ph * 1.2), idle * 0.9 * Math.sin(Math.PI * Math.sqrt(ph)) * (1 - ph * 0.5), 1, a, Math.min(1, B / L * (1.5 + ph * 1.2)), 0.45);
  }
  const k = clamp(sp / 40, 0, 1) * amt;
  if (sp < 2 || k < 0.01) return;
  const fl = 1 + Math.sin(t * 9) * 0.08, hl = L / 2, hb = B / 2;
  for (const sg of SIDES) {
    washAt(hl * 0.45, sg * (hb + L * 0.16), L * 0.8 * fl, 1.2 * k, a - sg * 0.38, 0.4);               // bow wave peels off the stem
    for (let i = 0; i < 3; i++) washAt(hl * (0.05 - i * 0.6), sg * (hb + 1.6 + i * 1.5), L * 0.5, 0.9 * k * (1 - i * 0.2), a - sg * 0.2, 0.38);
    if (vee) for (let i = 1; i <= 5; i++) washAt(-hl - i * L * 0.42, sg * (hb + i * L * 0.2) + Math.sin(t * 2 + i) * 0.6, 3.2 + i * 0.5, 0.9 * k * (1 - i / 6), a + sg * 0.6, 0.45);
  }
  washAt(hl + 0.5, 0, B * 1.1 * fl, 0.9 * k, a + Math.PI / 2, 0.55);                                      // cap of foam at the stem
  washAt(-hl - hb * 0.6, 0, B * 1.6 * (1 + Math.sin(t * 7) * 0.1), 1.0 * k, a, 0.75);                    // stern churn
  for (let i = 1; i <= 3; i++) washAt(-hl - hb - i * L * 0.4, Math.sin(t * 3 + i * 1.7) * hb * 0.3, B * (1.4 + i * 0.3), 0.85 * k / i, a, 0.6);
}
function foamPoints(bs: BoatPose): number {
  fN = 0;
  for (const p of G.parts) {
    const k = p.life / p.max;
    if (p.kind === 'ring') foam(p.x, p.y, ((p.r0! + (1 - k) * p.grow!) * 2 + 1.5) * 0.9, k * 0.85, 1);
    else if (p.kind === 'dot') foam(p.x, p.y, p.foam ? 4 : 2.6, k * 0.8, 0);
  }
  const b = G.boat, bd = boatDef();
  hullWash(bs.x, bs.y, bs.a, bd.L, bd.B, G.mode === 'play' ? Math.hypot(b.vx, b.vy) : 0, 0);
  const cx = G.cam.x + W / 2, cy = G.cam.y + H / 2, mx = W / 2 + 60, my = H / 2 + 60;
  for (let i = 0; i < fleet.length; i++) {
    const sh = fleet[i];
    if (!near(sh, cx, cy, mx, my)) continue;
    const d = shipDef(sh.id);
    hullWash(sh.x, sh.y, sh.a, d.L, d.B, Math.hypot(sh.vx, sh.vy), i * 2.3, 1, true);
  }
  for (const w of LIFE.whales) {                          // a surfacing whale pushes up a slick of ripples and foam
    const s = w.size * WHALE_K;
    if (!near(w, cx, cy, mx, my)) continue;
    const up = clamp(1 - Math.abs(w.z - 0.5) / 3, 0, 1);
    if (up > 0) hullWash(w.x - Math.cos(w.a) * 3 * s, w.y - Math.sin(w.a) * 3 * s, w.a, 30 * s, 8 * s, 0, w.t, up);
    if (w.tail > 0.25) foam(w.x + Math.cos(w.a) * (MS.WHALE.joint - 5) * s, w.y + Math.sin(w.a) * (MS.WHALE.joint - 5) * s, 10 * s, w.tail * 0.5, 0, w.a + Math.PI / 2, 0.5);
  }
  for (let i = 0; i < schoolFx.length; i += 3) {          // darting and leaping fish ruffle the surface
    const kind = schoolFx[i + 2];
    if (kind === FX_RING) foam(schoolFx[i], schoolFx[i + 1], 5, 0.35, 0);
    else if (kind === FX_SPRAY) foam(schoolFx[i], schoolFx[i + 1], 9, 0.6, 1);
  }
  for (const g of LIFE.giants) {                           // something big just under the surface bulges the water
    if (g.z < -5 || !near(g, cx, cy, mx, my)) continue;
    for (let i = 0; i < 2; i++) {
      const ph = frac(G.t * 0.25 + i / 2 + g.ph * 0.1);
      foam(g.x, g.y, g.len * (1 + ph * 0.6), (1 + g.z / 5) * 0.45 * Math.sin(Math.PI * ph), 1, g.a, g.kind === 'ray' ? 0.9 : 0.4, 0);
    }
  }
  return fN;
}

// ---------- coloured points drawn in the scene ----------
// per point: x, y, z, size | r, g, b, a | style (0 soft dot, 1 lit smoke puff, 2 glow)
const PART_STRIDE = 9;
let partArr = new Float32Array(PART_STRIDE * 1024), pN = 0;
function point(x: number, y: number, z: number, sz: number, r: number, g: number, b: number, a: number, st = 0): void {
  if ((pN + 1) * PART_STRIDE > partArr.length) { const t = new Float32Array(partArr.length * 2); t.set(partArr); partArr = t; }
  const P = partArr, o = pN * PART_STRIDE;
  P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = sz; P[o + 4] = r; P[o + 5] = g; P[o + 6] = b; P[o + 7] = a; P[o + 8] = st;
  pN++;
}
const nearSchools: School[] = [], lightSchools: School[] = [];
let blendN = 0, glowN = 0;                                  // blended points first, then additive glow
function partPoints(): void {
  pN = 0;
  for (const p of G.parts) {
    const k = p.life / p.max;
    if (p.kind === 'debris') point(p.x, p.y, 0.5, 1.4, 0.62, 0.45, 0.27, Math.min(1, k * 2));
    else if (p.kind === 'spark') point(p.x, p.y, 2, 1.3, 2.2, 1.8, 0.9, k);
    else if (p.kind === 'spout') point(p.x, p.y, 2, 1.6, 1.3, 1.35, 1.4, k * 0.9);
  }
  // legendary fish and frenzies glint at the surface
  for (const s of schoolsNear(G.cam.x + W / 2, G.cam.y + H / 2, 230, nearSchools)) if (schoolActive(s) && (SPECIES[s.sp].legend || G.frenzy?.s === s)) {
    for (let k = 0; k < 3; k++) {
      const q = Math.floor(G.t * 5) + k * 13;
      if (hash01(q, s.ph * 100 | 0, 3) < 0.55) point(s.x + (hash01(q, 1, 9) - 0.5) * 16, s.y + (hash01(q, 2, 9) - 0.5) * 10, 0.3, 1.2, 2.0, 1.7, 0.8, 0.9);
    }
  }
  // night fish blink in your lamplight
  if (isNight()) for (const s of schoolsNear(G.boat.x, G.boat.y, lightR() * 2.2, lightSchools)) {
    if (!schoolActive(s) || SPECIES[s.sp].time !== 'night' || Math.floor(G.t * 3 + s.ph) % 3 !== 0) continue;
    const glowing = SPECIES[s.sp].shape === 'glow';
    point(s.x + Math.sin(G.t + s.ph) * 4, s.y, 0.2, 1.3, glowing ? 2.2 : 1.3, glowing ? 1.8 : 1.4, glowing ? 0.7 : 1.5, 0.9);
  }
  // golden fish twinkle, leaping fish throw spray
  for (let i = 0; i < schoolFx.length; i += 3) {
    const x = schoolFx[i], y = schoolFx[i + 1], kind = schoolFx[i + 2], q = Math.floor(G.t * 6) + i;
    if (kind === FX_GOLD && hash01(q, 7, 5) < 0.6) point(x + (hash01(q, 1, 9) - 0.5) * 6, y + (hash01(q, 2, 9) - 0.5) * 4, 0.4, 1.3, 2.4, 1.9, 0.6, 1);
    else if (kind === FX_SPRAY) for (let k = 0; k < 3; k++) point(x + (hash01(q, k, 4) - 0.5) * 5, y + (hash01(q, k, 6) - 0.5) * 3, 1 + hash01(q, k, 8) * 3, 1.2, 1.3, 1.35, 1.4, 0.8);
  }
  // smoke drifts downwind as it rises, swelling to ~3x and thinning out; drawn after the rest so it sits on top
  const wa = windAngle(), wdx = Math.cos(wa), wdy = Math.sin(wa);
  for (const p of G.parts) if (p.kind === 'smoke') {
    const k = clamp(p.life / p.max, 0, 1), age = 1 - k, lean = age * (2 + WX.wind * 8), g = lerp(0.82, 0.24, p.dark || 0);
    point(p.x + wdx * lean, p.y + wdy * lean, p.z ?? 10, (p.size || 2) * (1 + 2 * age) * 1.5, g, g * 0.98, g * 0.95, Math.min(1, age * 8) * Math.pow(k, 0.6) * 0.9, 1);
  }
  blendN = pN;
  for (const p of G.parts) if (p.kind === 'glow') {        // bioluminescent plankton, added on top
    const k = clamp(p.life / p.max, 0, 1);
    point(p.x, p.y, p.z || 0, p.size || 1.2, 0.35, 1.5, 1.3, k, 2);
  }
  for (let i = 0; i < schoolFx.length; i += 3) if (schoolFx[i + 2] === FX_GLOW) {   // glowing fish light the water around them
    point(schoolFx[i], schoolFx[i + 1], -0.5, 3.2, 1.6, 1.4, 0.7, 0.35 + 0.15 * Math.sin(G.t * 3 + i), 2);
  }
  glowN = pN - blendN;
}

// ---------- prefetch heights (and tree lists) so new terrain never hitches ----------
export function prefetch(budgetMs = 4): void {
  const t0 = performance.now(), cx = G.cam.x + W / 2, cy = G.cam.y + H / 2, mx = W / 2 + TS * 1.5, my = H / 2 + TS * 1.5;
  for (let ty = Math.floor((cy - my) / TS); ty <= Math.floor((cy + my) / TS); ty++) for (let tx = Math.floor((cx - mx) / TS); tx <= Math.floor((cx + mx) / TS); tx++) {
    if (performance.now() - t0 > budgetMs) return;
    if (!hasTile(tx, ty)) getTile(tx, ty);
    else { const t = getTile(tx, ty); if (t.land && !t.trees) tileTrees(t); }
  }
}

// ---------- frame ----------
// per-frame camera and heightfield rectangles, reused: CAM = [x, y, w, h] in world units, HR = [x0, y0, w, h] in texels
const CAM = [0, 0, 0, 0], HR = [0, 0, 0, 0], SHXY = [0, 0];
const viewPois: Poi[] = [];
// NPC ships then other players' boats, gathered once per frame
const fleet: (Ship | Sailor)[] = [];
function gatherFleet(): void {
  fleet.length = 0;
  for (const s of LIFE.ships) fleet.push(s);
  for (const s of ONLINE.sailors) fleet.push(s);
}
const drawPool = (e: Pool) => MS.drawInstances(e.mesh, e.arr, e.n);
function drawMeshes(mode: 0 | 1, F: Field, E: Env, Lt: Lights): void {
  const pg = PG.mesh;
  gl.useProgram(pg.p);
  U4(pg, 'uCam', CAM); U4(pg, 'uHR', HR); U2(pg, 'uShXY', SHXY[0], SHXY[1]); gl.uniform1i(pg.u.uMode ?? null, mode); styleUniforms(pg);
  if (mode === 0) {
    U3(pg, 'uSun', E.sun); U3(pg, 'uSunC', E.sunC); U3(pg, 'uAmb', E.amb); U1(pg, 'uNight', E.dk); U3(pg, 'uWater', E.water);
    bindTex(pg, 'uH', F.tex, 0);
    gl.uniform1i(pg.u.uNL ?? null, Lt.nl); gl.uniform4fv(pg.u.uL ?? null, Lt.L); gl.uniform3fv(pg.u.uLC ?? null, Lt.LC);
    if (pg.u.uNB) gl.uniform1i(pg.u.uNB, 0);
  }
  POOLS[0].forEach(drawPool);
  if (mode === 0) POOLS[1].forEach(drawPool);       // sea life and other no-shadow meshes skip the shadow pass
  MS.drawInstances(MS.dynMesh(DYN[0], DYN[1]), DYN, 1);
}
// the share of each frame buffer this frame uses (its view can be smaller than the buffers)
const UVS = [1, 1];
// draw into the used part of dst
function intoUsed(dst: Target): void { into(dst, Math.ceil(dst.w * UVS[0]), Math.ceil(dst.h * UVS[1])); }
// a full-screen post pass: bind dst, the program and src (as uT); the caller sets extra uniforms and calls quad()
function begin(pg: Program, dst: Target, src: Target): void {
  intoUsed(dst); gl.useProgram(pg.p);
  bindTex(pg, 'uT', src.tex, 0); U2(pg, 'uUVS', UVS[0], UVS[1]);
}
// dynamic resolution: keep frames under ~20ms by trading internal resolution
const QUALITY_SCALE: Record<Quality, number> = { auto: 1, high: 1, medium: 0.75, low: 0.5 };
let lastT = 0, acc = 0, frames = 0;
function adaptScale(): void {
  if (PIXEL[SET.pixel]) return;                   // pixel styles are already cheap; their size is fixed
  if (R.quality !== 'auto') { R.scale = QUALITY_SCALE[R.quality] || 1; return; }
  const now = performance.now(), dt = now - lastT;
  lastT = now;
  if (dt <= 0 || dt > 250) return;
  acc += dt; frames++;
  if (acc < 1500) return;
  const avg = acc / frames;
  acc = 0; frames = 0;
  if (avg > 20 && R.scale > 0.5) R.scale = Math.max(0.5, R.scale - 0.125);
  else if (avg < 13 && R.scale < 1) R.scale = Math.min(1, R.scale + 0.125);
}
export function render(alpha: number): void {
  if (lost) return;
  adaptScale();
  const F = ensureField(), FB = ensureTargets(), px = FB.px, bs = boatRenderState(alpha);
  // Pixel styles draw upx render pixels per world unit: one per art pixel (two for crisp), but never more than the
  // screen shows. The world is drawn with the camera snapped to whole render pixels, so static things (lighthouses,
  // glints, ripples) sit still on the pixel grid instead of shimmering as the camera glides; the leftover fraction
  // is applied when the frame is scaled up to the screen (present, at the end).
  const upx = px && Math.min(px, R.S, (FB.w - 1) / W, (FB.h - 1) / H);
  const w = px ? Math.min(FB.w, Math.ceil(W * upx - 1e-6) + 1) : FB.w, h = px ? Math.min(FB.h, Math.ceil(H * upx - 1e-6) + 1) : FB.h;
  UVS[0] = w / FB.w; UVS[1] = h / FB.h;
  const camX0 = G.cam.x + G.shakeX, camY0 = G.cam.y + G.shakeY;
  const camX = upx ? Math.floor(camX0 * upx) / upx : camX0, camY = upx ? Math.floor(camY0 * upx) / upx : camY0;
  CAM[0] = camX; CAM[1] = camY; CAM[2] = upx ? w / upx : W; CAM[3] = upx ? h / upx : H;
  // the heightfield around the view (a heights texel spans fs world units, 1 unless a view outgrows the buffers)
  let fs = 1;
  while ((CAM[2] + PAD * 2 + SNAP) / fs + 2 > F.TW || (CAM[3] + PAD * 2 + SNAP) / fs + 2 > F.TH) fs *= 2;
  const x0 = Math.floor(camX / SNAP) * SNAP - PAD, y0 = Math.floor(camY / SNAP) * SNAP - PAD;
  uploadHeights(F, x0, y0, fs, Math.ceil((CAM[2] + PAD * 2 + SNAP) / fs) + 2, Math.ceil((CAM[3] + PAD * 2 + SNAP) / fs) + 2);
  STY.px = upx; STY.org[0] = Math.round(camX * upx); STY.org[1] = Math.round(camY * upx); STY.org[2] = h;
  // heightfield texture: world position of texel 0's corner and the world size of the whole texture
  HR[0] = x0 - fs / 2; HR[1] = y0 - fs / 2; HR[2] = F.TW * fs; HR[3] = F.TH * fs;
  const E = environment(camY + H / 2);
  gatherFleet();
  const pois = poisNear(camX + W / 2, camY + H / 2, 300, viewPois), Lt = lightsFor(bs, pois, E.dk);
  buildScene(bs, pois, camX, camY);
  SHXY[0] = E.sun[0] / Math.max(0.25, E.sun[2]); SHXY[1] = E.sun[1] / Math.max(0.25, E.sun[2]);   // shadow offset per unit height
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  // 1. object shadows projected onto the ground plane (only the part of the field in use is cleared)
  const fw = Math.ceil(((CAM[2] + PAD * 2 + SNAP) / fs + 2) * FR), fh = Math.ceil(((CAM[3] + PAD * 2 + SNAP) / fs + 2) * FR);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, fw, fh);
  into(F.shadow); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  drawMeshes(1, F, E, Lt);
  // 2. foam / ripple stamps
  into(F.foam); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
  const nf = foamPoints(bs);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  gl.useProgram(PG.foam.p); U4(PG.foam, 'uHR', HR); U1(PG.foam, 'uPx', FR / fs);
  gl.bindVertexArray(foamVao); gl.bindBuffer(gl.ARRAY_BUFFER, foamBuf);
  if (nf) { gl.bufferData(gl.ARRAY_BUFFER, foamArr, gl.STREAM_DRAW, 0, nf * FOAM_STRIDE); gl.drawArrays(gl.POINTS, 0, nf); }
  gl.disable(gl.BLEND);
  // 3. scene: ground, meshes, particles
  into(FB.scene, w, h); gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const pg = PG.ground;
  gl.useProgram(pg.p);
  bindTex(pg, 'uH', F.tex, 0); bindTex(pg, 'uFoam', F.foam.tex, 1); bindTex(pg, 'uShadow', F.shadow.tex, 2);
  U4(pg, 'uHR', HR); U4(pg, 'uCam', CAM); U1(pg, 'uT', G.t); U1(pg, 'uWT', WX.waveT); U1(pg, 'uWind', WX.wind); U1(pg, 'uRain', WX.rain);
  U1(pg, 'uNight', E.dk); U1(pg, 'uCloud', E.cloud); U1(pg, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U2(pg, 'uWD', Math.cos(windAngle()), Math.sin(windAngle()));
  U3(pg, 'uSun', E.sun); U3(pg, 'uSunC', E.sunC); U3(pg, 'uAmb', E.amb); U3(pg, 'uSky', E.sky); styleUniforms(pg);
  gl.uniform1i(pg.u.uNL ?? null, Lt.nl); gl.uniform4fv(pg.u.uL ?? null, Lt.L); gl.uniform3fv(pg.u.uLC ?? null, Lt.LC);
  gl.uniform1i(pg.u.uNB ?? null, Lt.nb); gl.uniform4fv(pg.u.uB ?? null, Lt.B);
  quad();
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  drawMeshes(0, F, E, Lt);
  // particles blend over the colour but leave alpha (the solid-voxel mask for the outline) alone; glow adds
  gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  partPoints();
  const pp = PG.part;
  gl.useProgram(pp.p); U4(pp, 'uCam', CAM); U1(pp, 'uPpu', w / CAM[2]); U3(pp, 'uSun', E.sun); U3(pp, 'uSunC', E.sunC); U3(pp, 'uAmb', E.amb); styleUniforms(pp);
  gl.bindVertexArray(partVao); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  if (pN) gl.bufferData(gl.ARRAY_BUFFER, partArr, gl.STREAM_DRAW, 0, pN * PART_STRIDE);
  gl.drawArrays(gl.POINTS, 0, blendN);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); gl.drawArrays(gl.POINTS, blendN, glowN);
  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, FB.scene.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, FB.scene.resolve.fb);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  const scene = FB.scene.resolve;
  // 4. post: bloom chain, tilt-shift blur, composite
  begin(PG.bright, FB.half, scene); U1(PG.bright, 'uTh', hdr ? 1.0 : 0.82); quad();
  begin(PG.copy, FB.qa, FB.half); quad();
  for (let i = 0; i < 2; i++) {
    begin(PG.blur, FB.qb, FB.qa); U2(PG.blur, 'uDir', 1 / FB.qa.w, 0); quad();
    begin(PG.blur, FB.qa, FB.qb); U2(PG.blur, 'uDir', 0, 1 / FB.qa.h); quad();
  }
  begin(PG.copy, FB.ta, scene); quad();
  begin(PG.blur, FB.tb, FB.ta); U2(PG.blur, 'uDir', 1.5 / FB.ta.w, 0); quad();
  begin(PG.blur, FB.ta, FB.tb); U2(PG.blur, 'uDir', 0, 1.5 / FB.ta.h); quad();
  const out = FB.out;
  if (out) intoUsed(out); else into(null, cv.width, cv.height);
  const cp = PG.comp;
  gl.useProgram(cp.p);
  bindTex(cp, 'uScene', scene.tex, 0); bindTex(cp, 'uBloom', FB.qa.tex, 1); bindTex(cp, 'uBlur', FB.ta.tex, 2); U2(cp, 'uUVS', UVS[0], UVS[1]);
  // pixel styles: the ink edge replaces film grain; tilt-shift is gentler
  styleUniforms(cp); U1(cp, 'uQ', 0); U1(cp, 'uInk', px ? 0.75 * (R.fx.ink ?? 1) : 0);
  U1(cp, 'uT', G.t); U1(cp, 'uExp', E.exp); U1(cp, 'uSat', E.sat); U1(cp, 'uVig', 0.42); U1(cp, 'uTilt', (px ? 0.45 : 0.7) * R.fx.tilt); U1(cp, 'uGrain', SET.calm || px ? 0 : 0.01);
  U1(cp, 'uGrade', R.fx.grade ?? 1); U1(cp, 'uDusk', E.dusk);
  U1(cp, 'uRain', WX.rain); U1(cp, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U1(cp, 'uBloomK', (0.5 + E.dk * 0.5) * R.fx.bloom); U1(cp, 'uSlant', 0.3 + WX.wind * 0.7);
  U3(cp, 'uTint', E.tint); U2(cp, 'uRes', out ? w : cv.width, out ? h : cv.height);
  quad();
  if (out) present(out, h, (camX0 - camX) * upx, (camY0 - camY) * upx, R.S / upx);
  gl.bindVertexArray(null);
}
// Scale the pixel-style frame (its used w x h) up to the canvas: k device pixels per render pixel, sliding by the
// camera's leftover fraction of a render pixel (dx, dy) rounded to whole device pixels. Whole-number scales give
// hard nearest-neighbour pixels; in between, pixel edges get one device pixel of blend instead of uneven widths.
const PMAP = [0, 0, 0, 0];
function present(out: Target, h: number, dx: number, dy: number, k: number): void {
  into(null, cv.width, cv.height);
  const pg = PG.present;
  gl.useProgram(pg.p); bindTex(pg, 'uT', out.tex, 0);
  PMAP[0] = -Math.round(dx * k); PMAP[1] = cv.height + Math.round(dy * k) - h * k; PMAP[2] = k;   // device position of the frame's corner (y up), scale
  U4(pg, 'uMap', PMAP);
  quad();
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, out.fb);    // reads (the test suites) see the internal frame, as before
}
