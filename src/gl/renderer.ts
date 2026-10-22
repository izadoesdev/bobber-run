// WebGL2 renderer: one fragment shader draws terrain and water from the heightfield; boats, landmarks, trees and sea
// life are lit voxel meshes; shadows go along the sun into a world-aligned buffer, wakes into a foam buffer the water
// reads; then HDR post (bloom, tilt-shift, grading, vignette, grain, rain).
import { W, H, clamp, lerp, frac, smooth01 } from '../config';
import { ONLINE, type Sailor } from '../online';
import { SET, type Quality, type PixelStyle } from '../prefs';
import { TS, TN, getTile, hasTile, hAt, poisNear, schoolsNear, cratesNear, claimableNear, homesteadSite, hotspotsNear, regionSites, type HeightTile, type Hotspot, type RegionSite } from '../world';
import { hash01 } from '../noise';
import { SPECIES, BOATS, activeAt } from '../econ';
import { biomeMix, coldness, warmth, themeHold, themeAt, THEMES, THEME_IDS, type Atmos, type Odds, type Theme, type ThemeHold } from '../biome';
import { schoolLook } from '../species';
import { DIVE_S, SCATTER_S, schoolDrawR } from '../game/schools';
import { LAMP_Z, landmarkKind, onGrounds } from '../landmarks';
import { G, darkness, lightR, schoolActive, isNight, dayFrac, equipment, windAngle, boatDef, env } from '../game';
import { WX, atmosAt } from '../weather';
import { seaPropsNear, type SeaProp, type SeaPropKind } from '../seaprops';
import { LIFE, type Whale, type Giant } from '../life';
import { hasOars, oarGeom, BOAT_MODELS, NP, SHIPPED, PLAIN, lookSeed, lookCoat, type Fit } from '../models';
import { NET } from '../net';
import { ISLANDS, islandColour } from '../islands';
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
let quadVao: WebGLVertexArrayObject, foamVao: WebGLVertexArrayObject, foamBuf: WebGLBuffer, partVao: WebGLVertexArrayObject, partBuf: WebGLBuffer, beamVao: WebGLVertexArrayObject;
interface Programs { ground: Program; mesh: Program; foam: Program; part: Program; beam: Program; bright: Program; blur: Program; comp: Program; copy: Program; present: Program }
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
    foam: program(gl, SH.FOAM_VS, SH.FOAM_FS), part: program(gl, SH.PART_VS, SH.PART_FS), beam: program(gl, SH.BEAM_VS, SH.BEAM_FS),
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
  beamVao = gl.createVertexArray();                     // no attributes: the beam's corners come from gl_VertexID
  partVao = gl.createVertexArray(); gl.bindVertexArray(partVao);
  partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PART_STRIDE * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PART_STRIDE * 4, 16);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, PART_STRIDE * 4, 32);
  gl.bindVertexArray(null);
  MS.init(gl, gl.createBuffer()); MS.reset();
  palTex = paletteTexture();
  field = null; frame = null;
}

// ---------- render targets ----------
// Every buffer is sized once per window for the widest view the player can zoom out to; each frame draws into the
// part its view needs, so zooming never reallocates. One art pixel stays one world unit at every zoom: zoomed out,
// the frame simply spans more render pixels, each smaller on screen.
// The foam and shadow buffers cover the view plus a margin, their origin moving in SNAP-unit steps. The heights
// texture wraps around (texel X of the world lands in column X mod TW): it keeps the rows and columns around the
// view it already holds, and as the view moves only the ones it uncovers are written.
const PAD = 40, FR = 2, SNAP = 8;               // margin in world units; foam/shadow texels per world unit; origin step
/** the widest view (world units) this window can show */
const maxView = () => { const s = minScale(R.S0, cv.width, cv.height); return [cv.width / s, cv.height / s]; };
interface Field {
  /** texture size in texels */
  TW: number; TH: number;
  /** scratch for uploads */
  hdata: Float32Array; tex: WebGLTexture; foam: Target; shadow: Target;
  /** the island themes beside the heights (see themeGrid), and their upload scratch */
  tdata: Uint8Array; th: WebGLTexture;
  /** the texels (world units / fs) the heights texture holds: x0, y0, x1, y1 (exclusive); and fs (0 until the first upload) */
  V: number[]; fs: number;
}
let field: Field | null = null;
function ensureField(): Field {
  const [vw, vh] = maxView(), tw = Math.ceil(vw) + PAD * 2 + SNAP * 2 + 8, th = Math.ceil(vh) + PAD * 2 + SNAP * 2 + 8;
  if (field && tw === field.TW && th === field.TH) return field;
  if (field) { gl.deleteTexture(field.tex); gl.deleteTexture(field.th); free(gl, field.foam); free(gl, field.shadow); }
  const tex = texture(gl, tw, th, gl.RGBA16F, gl.RGBA, gl.FLOAT);   // height, reef minus mangrove (never both), kelp, volcanic
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const ttex = texture(gl, tw, th, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);   // theme row, its weight, the island's shade
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);   // a theme row never blends
  field = {
    TW: tw, TH: th, hdata: new Float32Array(tw * th * 4), tex, tdata: new Uint8Array(tw * th * 4), th: ttex, V: [0, 0, 0, 0], fs: 0,
    foam: target(gl, tw * FR, th * FR, gl.RG8, gl.RG, gl.UNSIGNED_BYTE),
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
  /** the scene with its depth buffer; 'smooth' draws it multisampled into `ms` and resolves it here */
  scene: Target; ms: MsTarget | null;
  /** bloom (quarter size, ping-ponged) and tilt-shift blur (quarter) */
  qa: Target; qb: Target; ta: Target; tb: Target;
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
  if (frame) for (const t of [frame.ms ?? frame.scene, frame.qa, frame.qb, frame.ta, frame.tb, frame.out]) free(gl, t);
  const IF = hdr ? gl.RGBA16F : gl.RGBA8, TY = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  const mk = (a: number, b: number) => target(gl, Math.max(1, a), Math.max(1, b), IF, gl.RGBA, TY);
  // pixel styles draw without MSAA, straight into the texture the post passes read
  const ms = px ? null : msTarget(gl, w, h, IF, gl.RGBA, TY, Math.min(4, gl.getParameter(gl.MAX_SAMPLES)));
  frame = {
    w, h, px, ms, scene: ms ? ms.resolve : target(gl, w, h, IF, gl.RGBA, TY, true),
    qa: mk(w >> 2, h >> 2), qb: mk(w >> 2, h >> 2), ta: mk(w >> 2, h >> 2), tb: mk(w >> 2, h >> 2),
    out: px ? target(gl, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE) : null,
  };
  return frame;
}

// ---------- uniforms ----------
// the pixel-style dither is anchored to world pixels: STY.org = world pixel of the frame's top-left, and frame height
const STY = { px: 0, org: [0, 0, 1] };
function styleUniforms(pg: Program): void { U1(pg, 'uPx', STY.px); U3(pg, 'uOrg', STY.org); }
function sunUniforms(pg: Program, E: Env): void { U3(pg, 'uSun', E.sun); U3(pg, 'uSunC', E.sunC); U3(pg, 'uAmb', E.amb); }
function lightUniforms(pg: Program, Lt: Lights): void {
  gl.uniform1i(pg.u.uNL ?? null, Lt.nl); gl.uniform4fv(pg.u.uL ?? null, Lt.L); gl.uniform3fv(pg.u.uLC ?? null, Lt.LC); gl.uniform1fv(pg.u.uLZ ?? null, Lt.LZ);
}
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
const mod = (a: number, n: number) => ((a % n) + n) % n;
/**
 * Make the heights texture (one texel every fs world units) hold world rect [x0, x1) x [y0, y1), plus a SNAP-texel
 * margin when it has to move, writing only the texels it didn't hold.
 */
function holdHeights(F: Field, x0: number, y0: number, x1: number, y1: number, fs: number): void {
  const V = F.V, X0 = Math.floor(x0 / fs), Y0 = Math.floor(y0 / fs), X1 = Math.ceil(x1 / fs) + 1, Y1 = Math.ceil(y1 / fs) + 1;
  if (fs === F.fs && X0 >= V[0] && Y0 >= V[1] && X1 <= V[2] && Y1 <= V[3]) return;
  const N = [X0 - SNAP, Y0 - SNAP, X1 + SNAP, Y1 + SNAP];
  if (fs !== F.fs || N[0] >= V[2] || N[2] <= V[0] || N[1] >= V[3] || N[3] <= V[1]) {   // nothing to keep
    F.fs = fs;
    putHeights(F, N[0], N[1], N[2] - N[0], N[3] - N[1]);
  } else {                                        // the new columns either side, then new rows above and below
    if (N[0] < V[0]) putHeights(F, N[0], N[1], V[0] - N[0], N[3] - N[1]);
    if (N[2] > V[2]) putHeights(F, V[2], N[1], N[2] - V[2], N[3] - N[1]);
    const a = Math.max(N[0], V[0]), b = Math.min(N[2], V[2]);
    if (N[1] < V[1]) putHeights(F, a, N[1], b - a, V[1] - N[1]);
    if (N[3] > V[3]) putHeights(F, a, V[3], b - a, N[3] - V[3]);
  }
  V[0] = N[0]; V[1] = N[1]; V[2] = N[2]; V[3] = N[3];
}
// w x h texels from texel (X, Y), split where they wrap around the texture's edges
function putHeights(F: Field, X: number, Y: number, w: number, h: number): void {
  const c = mod(X, F.TW), r = mod(Y, F.TH), w1 = Math.min(w, F.TW - c), h1 = Math.min(h, F.TH - r);
  heightsRect(F, X, Y, c, r, w1, h1);
  if (w1 < w) heightsRect(F, X + w1, Y, 0, r, w - w1, h1);
  if (h1 < h) heightsRect(F, X, Y + h1, c, 0, w1, h - h1);
  if (w1 < w && h1 < h) heightsRect(F, X + w1, Y + h1, 0, 0, w - w1, h - h1);
}
// w x h texels from texel (X, Y) into column c, row r of the texture: the height, and the biome weights from the
// tile's coarse biome grid; and beside them the island theme (themeGrid)
function heightsRect(F: Field, X: number, Y: number, c: number, r: number, w: number, h: number): void {
  const fs = F.fs, x0 = X * fs, hdata = F.hdata, tdata = F.tdata;
  let i = 0;
  for (let j = 0; j < h; j++) {
    const wy = (Y + j) * fs, ty = Math.floor(wy / TS), ly = wy - ty * TS, row = (ly + 1) * TN;
    let tx = Math.floor(x0 / TS), tile = getTile(tx, ty), base = tx * TS - 1, bg = biomeGrid(tile), tg = themeGrid(tile);
    for (let k = 0; k < w; k++, i += 4) {
      const wx = x0 + k * fs;
      if (wx - base > TS) { tx++; tile = getTile(tx, ty); base = tx * TS - 1; bg = biomeGrid(tile); tg = themeGrid(tile); }
      hdata[i] = tile.h[row + wx - base];
      biomeLerp(bg, wx - base - 1, ly, bq, 0);
      hdata[i + 1] = bq[0] - bq[3]; hdata[i + 2] = bq[1]; hdata[i + 3] = bq[2];
      themeLerp(tg, wx - base - 1, ly, tq);
      tdata[i] = tq[0]; tdata[i + 1] = Math.round(tq[1] * 255); tdata[i + 2] = Math.round(tq[2] * 255); tdata[i + 3] = 0;
    }
  }
  gl.bindTexture(gl.TEXTURE_2D, F.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, w, h, gl.RGBA, gl.FLOAT, hdata, 0);
  gl.bindTexture(gl.TEXTURE_2D, F.th);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, w, h, gl.RGBA, gl.UNSIGNED_BYTE, tdata, 0);
}

// ---------- biomes: weights on a coarse grid per height tile (the noise is slow, the grid is not) ----------
// reef, kelp, volcanic, mangrove; the GPU gets reef and mangrove in one signed channel, since one always pushes
// the other out (both are warm shallows)
const BG = 8, BN = TS / BG + 1, NB = 4, bq = [0, 0, 0, 0];
const biomeGrids = new WeakMap<HeightTile, Float32Array>();
function biomeGrid(t: HeightTile): Float32Array {
  let g = biomeGrids.get(t);
  if (g) return g;
  g = new Float32Array(BN * BN * NB);
  for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) {
    const m = biomeMix(t.tx * TS + i * BG, t.ty * TS + j * BG), o = (j * BN + i) * NB;
    g[o] = m.reef; g[o + 1] = m.kelp; g[o + 2] = m.volcanic; g[o + 3] = m.mangrove;
  }
  biomeGrids.set(t, g);
  return g;
}
/** The reef, kelp, volcanic and mangrove weights at tile-local (lx, ly), written to out[o..o+3]. */
function biomeLerp(g: Float32Array, lx: number, ly: number, out: Float32Array | number[], o: number): void {
  const gx = clamp(lx / BG, 0, BN - 1.001), gy = clamp(ly / BG, 0, BN - 1.001), i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
  const a = (j * BN + i) * NB, b = a + NB, cc = a + BN * NB, d = cc + NB;
  for (let k = 0; k < NB; k++) {
    const top = g[a + k] + (g[b + k] - g[a + k]) * fx, bot = g[cc + k] + (g[d + k] - g[cc + k]) * fx;
    out[o + k] = top + (bot - top) * fy;
  }
}
const bmS = [0, 0, 0, 0];

// ---------- island themes: which island's theme holds each biome-grid point, and how strongly ----------
// Per point: theme row (THEME_IDS index), weight 0..1, the island's shade 0..1. Weights blend between points; the
// row and shade come from the nearest point (where the row changes the weight is ~0, see themeHold).
const NTH = 3, tq = [0, 0, 0], TROW: Record<string, number> = Object.fromEntries(THEME_IDS.map((t, i) => [t, i]));
const themeGrids = new WeakMap<HeightTile, Float32Array>(), holdS: ThemeHold = { theme: 'home', w: 0, jitter: 0 };
const ISLAND_REACH = 460;                        // claimableNear radius that finds every island whose theme can reach a tile
function themeGrid(t: HeightTile): Float32Array {
  let g = themeGrids.get(t);
  if (g) return g;
  g = new Float32Array(BN * BN * NTH);
  const islands = claimableNear(t.tx * TS + TS / 2, t.ty * TS + TS / 2, ISLAND_REACH);
  for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) {
    themeHold(t.tx * TS + i * BG, t.ty * TS + j * BG, islands, holdS);
    const o = (j * BN + i) * NTH;
    g[o] = TROW[holdS.theme]; g[o + 1] = holdS.w; g[o + 2] = holdS.jitter;
  }
  themeGrids.set(t, g);
  return g;
}
/** Theme row, weight and shade at tile-local (lx, ly), written to out[0..2]. */
function themeLerp(g: Float32Array, lx: number, ly: number, out: number[]): void {
  const gx = clamp(lx / BG, 0, BN - 1.001), gy = clamp(ly / BG, 0, BN - 1.001), i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
  const a = (j * BN + i) * NTH, b = a + NTH, cc = a + BN * NTH, d = cc + NTH;
  const top = g[a + 1] + (g[b + 1] - g[a + 1]) * fx, bot = g[cc + 1] + (g[d + 1] - g[cc + 1]) * fx;
  const n = (fy < 0.5 ? (fx < 0.5 ? a : b) : (fx < 0.5 ? cc : d));
  out[0] = g[n]; out[1] = top + (bot - top) * fy; out[2] = g[n + 2];
}
// the palette table the ground shader reads: a row of 16 RGBA texels per theme (layout in shaders.ts, TH/PAL)
let palTex: WebGLTexture;
function paletteTexture(): WebGLTexture {
  const D = new Float32Array(16 * THEME_IDS.length * 4);
  THEME_IDS.forEach((id, row) => {
    const T = THEMES[id], put = (k: number, v: readonly number[]) => D.set(v, (row * 16 + k) * 4);
    [T.wet, T.sand, T.sand2, T.grass, T.grass2, T.forest, T.rock, T.cliff, T.cliff2, T.accent, T.shallow, T.mid, T.deep].forEach((c, k) => put(k, c));
    put(13, [T.beach, T.patch, T.flowers, T.speckle]); put(14, [T.rockAt, T.snow, T.outcrops, T.glow]); put(15, [T.clarity, T.altBeach, T.bands, 0]);
  });
  const t = texture(gl, 16, THEME_IDS.length, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, THEME_IDS.length, gl.RGBA, gl.FLOAT, D);
  return t;
}

// ---------- per-tile scenery: one candidate spot per GS x GS cell, hashed into place, cached with the tile ----------
// fn gets the spot, its cell, and the tile's height there; spots that land outside the tile belong to its neighbour
function tileSpots(t: HeightTile, GS: number, salt: number, fn: (px: number, py: number, gx: number, gy: number, h: number) => void): void {
  const x0 = t.tx * TS, y0 = t.ty * TS;
  for (let gy = Math.floor(y0 / GS); gy <= Math.floor((y0 + TS - 1) / GS); gy++) for (let gx = Math.floor(x0 / GS); gx <= Math.floor((x0 + TS - 1) / GS); gx++) {
    const px = gx * GS + Math.floor(hash01(gx, gy, salt) * GS), py = gy * GS + Math.floor(hash01(gx, gy, salt + 1) * GS);
    if (px >= x0 && px < x0 + TS && py >= y0 && py < y0 + TS) fn(px, py, gx, gy, t.h[(py - y0 + 1) * TN + px - x0 + 1]);
  }
}
/** Calls fn for every height tile overlapping world rect [x0, x1] x [y0, y1]. */
function eachTile(x0: number, y0: number, x1: number, y1: number, fn: (tx: number, ty: number) => boolean | void): void {
  for (let ty = Math.floor(y0 / TS); ty <= Math.floor(y1 / TS); ty++) for (let tx = Math.floor(x0 / TS); tx <= Math.floor(x1 / TS); tx++) if (fn(tx, ty) === false) return;
}

// ---------- trees ----------
const KINDS = MS.TREE_KINDS;
const KI: Record<string, number> = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const pickOdds = (L: Odds, r: number): string => { let t = 0; for (const [, w] of L) t += w; let v = r * t; for (const [k, w] of L) { v -= w; if (v <= 0) return k; } return L[0][0]; };
const TOP: Odds = [['rock', 2], ['boulders', 1]];
const TROPICAL = new Set(['palm', 'fern', 'mangrove', 'bamboo', 'cactus']);
/** Groves and clearings: a slow lattice noise scaling tree density, ~0.15 in a clearing to ~2.4 in a thick grove. */
function grove(x: number, y: number): number {
  const fx = x / 44, fy = y / 44, i = Math.floor(fx), j = Math.floor(fy), u = smooth01(fx - i), v = smooth01(fy - j);
  const a = hash01(i, j, 71), b = hash01(i + 1, j, 71), c = hash01(i, j + 1, 71), d = hash01(i + 1, j + 1, 71);
  const n = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  return 0.15 + 2.2 * n * n;
}
/** What a theme grows at height v (r: the spot's roll), or null. */
function themeTree(T: Theme, v: number, r: number, r2: number, x: number, y: number): string | null {
  const [L, d] = v < 0.12 ? [T.shore, T.shoreD] : v < 0.36 ? [T.low, T.lowD] : v < 0.76 ? [T.high, T.highD] : [TOP, 0.05];
  return L.length && r < d * grove(x, y) ? pickOdds(L, r2) : null;
}
// one candidate per 6x6 cell, chosen by height band and climate, or by the island's theme; cached on the tile as
// [x, y, kind, scale, yaw, tint] runs (tint: the island's shade on its trees)
const TREE_STRIDE = 6;
const groundsScratch: Poi[] = [];
function tileTrees(t: HeightTile): number[] {
  if (t.trees) return t.trees;
  const L: number[] = [], x0 = t.tx * TS, y0 = t.ty * TS, tg = themeGrid(t), props = tileProps(t);
  const near = poisNear(x0 + TS / 2, y0 + TS / 2, TS + 40, groundsScratch);       // harbours and lighthouses keep their grounds clear
  tileSpots(t, 6, 42, (px, py, gx, gy, v) => {
    if (near.length && onGrounds(near, px, py)) return;
    if (onProp(props, px, py)) return;
    const r = hash01(gx, gy, 41);
    if (v < 0.03) {                                                         // mangroves stand out in the shallows
      if (v < -0.06) return;
      biomeLerp(biomeGrid(t), px - x0, py - y0, bmS, 0);
      if (r < 0.55 * bmS[3]) L.push(px + 0.5, py + 0.5, KI.mangrove, 0.8 + hash01(gx, gy, 46) * 0.35, hash01(gx, gy, 47) * 6.283, 1);
      return;
    }
    const wm = warmth(py), cd = coldness(py), rr = hash01(gx, gy, 45), r2 = hash01(gx, gy, 49);
    themeLerp(tg, px - x0, py - y0, tq);
    let kind: string | null = null, tint = 1;
    if (tq[1] > 0.02 && hash01(gx, gy, 50) < tq[1]) {                      // the island's theme decides
      kind = themeTree(THEMES[THEME_IDS[tq[0]]], v, r, r2, px, py);
      tint = 0.93 + tq[2] * 0.12 + (hash01(gx, gy, 51) - 0.5) * 0.06;
      if (kind && cd > rr && (kind === 'pine' || kind === 'round')) kind = 'snowpine';
      if (kind && cd > 0.5 && TROPICAL.has(kind)) kind = 'snowpine';      // nothing tropical on the ice
    } else {
      if (v < 0.12) { if (r < 0.025) kind = 'boulders'; }                   // the odd heap of stones on the beach
      else if (v >= 0.36 && v < 0.76) { if (r < 0.72) kind = v > 0.5 || r < 0.25 ? 'pine' : 'round'; }
      else if (v < 0.36) { if (r < 0.06) kind = 'round'; else if (r < 0.08) kind = 'rock'; else if (r < 0.17) kind = r < 0.13 ? 'bush' : 'berrybush'; }
      else if (r < 0.06) kind = r < 0.025 ? 'boulders' : 'rock';
      const stony = kind === 'rock' || kind === 'boulders', shrub = kind === 'bush' || kind === 'berrybush';
      if (wm > rr && v >= 0.12 && v < 0.24 && r < 0.14) kind = 'palm';
      else if (kind && !stony && !shrub && cd > rr) kind = 'snowpine';
      else if (kind === 'pine' && wm > rr) kind = 'round';
      // biomes: palms and ferns on coral islands, birch and ferns on kelp coasts, burnt snags on the ember isles
      biomeLerp(biomeGrid(t), px - x0, py - y0, bmS, 0);
      const [rf, kp, vc, mg] = bmS, rb = hash01(gx, gy, 48);
      const tall = kind === 'pine' || kind === 'round' || kind === 'snowpine';
      if (rb < vc) {
        if (tall || kind === 'palm') kind = r2 < 0.4 ? 'deadtree' : r2 < 0.55 ? 'ashbush' : null;
        else if (shrub) kind = 'ashbush';
        else if (!kind && v >= 0.12 && r < 0.05) kind = 'boulders';
      } else if (rb < vc + rf) {
        if (kind === 'pine' || kind === 'snowpine') kind = 'round';
        else if (shrub) kind = r2 < 0.5 ? 'fern' : kind;
        else if (!kind && v >= 0.05 && v < 0.3 && r < 0.16) kind = r2 < 0.75 ? 'palm' : 'fern';
      } else if (rb < vc + rf + kp) {
        if (kind === 'round') kind = r2 < 0.7 ? 'birch' : 'pine';
        else if (shrub) kind = 'fern';
        else if (!kind && v >= 0.1 && v < 0.36 && r < 0.12) kind = r2 < 0.5 ? 'fern' : 'birch';
      } else if (rb < vc + rf + kp + mg) {                                   // mangrove thickets on the low ground
        if (v < 0.22 && r < 0.45) kind = 'mangrove';
        else if (kind === 'pine' || kind === 'snowpine' || kind === 'palm') kind = 'round';
        else if (shrub) kind = 'fern';
      }
      if (cd > 0.5 && (kind === 'palm' || kind === 'fern' || kind === 'mangrove')) kind = 'snowpine';   // nothing tropical on the ice
    }
    if (!kind) return;
    if (kind === 'pine' || kind === 'round' || kind === 'snowpine') { if (hash01(gx, gy, 44) < 0.3) kind += 'B'; }   // big variant
    const k = KI[kind];                                                     // (tests/themes.test.ts checks every theme's kinds exist)
    if (k !== undefined) L.push(px + 0.5, py + 0.5, k, 0.85 + hash01(gx, gy, 46) * 0.35, hash01(gx, gy, 47) * 6.283, tint);
  });
  return (t.trees = L);
}

// ---------- land props: standing stones, ruins, huts and rocks by island theme (the sea's are in seaprops.ts) ----------
const PROP_I = new Map<string, number>(MS.PROP_KINDS.map((k, i) => [k, i]));
const propScale = (kind: string, r: number): number => kind === 'mesaRock' ? 1 + r * 0.4 : 1;   // mesas come in sizes; the rest as built
// how much ground a land prop keeps clear of trees
const FOOT: Record<string, number> = { ruinArch: 6, hut: 7, shack: 7, mesaRock: 7, standingStones: 8, whaleBones: 6, chalkRock: 5, basalt: 5, crystal: 4, log: 4 };
const propCache = new WeakMap<HeightTile, Float32Array>();
const PROP_STRIDE = 7;                           // x, y, kind, scale, yaw, z, footprint
// one candidate per 26 x 26 on level land
function tileProps(t: HeightTile): Float32Array {
  let A = propCache.get(t);
  if (A) return A;
  const L: number[] = [], x0 = t.tx * TS, y0 = t.ty * TS, tg = themeGrid(t);
  const near = poisNear(x0 + TS / 2, y0 + TS / 2, TS + 40, groundsScratch);
  if (t.land) tileSpots(t, 26, 131, (px, py, gx, gy, v) => {
    if (v < 0.12 || v > 0.62 || (near.length && onGrounds(near, px, py))) return;
    if (Math.abs(hAt(px + 4, py) - hAt(px - 4, py)) + Math.abs(hAt(px, py + 4) - hAt(px, py - 4)) > 0.08) return;   // level ground
    themeLerp(tg, px - x0, py - y0, tq);
    const T = THEMES[THEME_IDS[tq[0]]];
    if (tq[1] < 0.6 || !T.land.length || hash01(gx, gy, 132) > T.landD * tq[1]) return;
    const kind = pickOdds(T.land, hash01(gx, gy, 133)), k = PROP_I.get(kind);
    if (k !== undefined) L.push(px + 0.5, py + 0.5, k, propScale(kind, hash01(gx, gy, 134)), hash01(gx, gy, 135) * 6.283, MS.PROP_Z[MS.PROP_KINDS[k]], FOOT[kind] ?? 3);
  });
  A = new Float32Array(L);
  propCache.set(t, A);
  return A;
}
/** Whether (x, y) falls on a land prop's footprint in this tile's props. */
function onProp(A: Float32Array, x: number, y: number): boolean {
  for (let i = 0; i < A.length; i += PROP_STRIDE) if (Math.abs(A[i] - x) < A[i + 6] && Math.abs(A[i + 1] - y) < A[i + 6]) return true;
  return false;
}

// ---------- the sea floor: deterministic props per height tile, by biome ----------
const BEDS = MS.BED_KINDS;
const BI: Record<string, number> = Object.fromEntries(BEDS.map((k, i) => [k, i]));
type Pick = readonly (readonly [MS.BedKind, number])[];
// what grows where, with relative odds; deep: only below this depth (kelp needs room to stand)
const BED_REEF: Pick = [['coralPink', 5], ['coralOrange', 4], ['coralPurple', 4], ['domeYellow', 3], ['domePink', 2], ['tubesTeal', 3], ['tubesOrange', 2],
  ['fanPurple', 2], ['fanPink', 2], ['anemone', 3], ['starOrange', 2], ['starPink', 1], ['clam', 2], ['seagrass', 1]];
const BED_KELP: Pick = [['kelp', 6], ['kelpTall', 5], ['urchin', 3], ['pebble', 3], ['starOrange', 1], ['seagrass', 2]];
const BED_VOLC: Pick = [['basalt', 6], ['pebble', 4], ['urchin', 2], ['vent', 1]];
const BED_HOME: Pick = [['pebble', 4], ['starOrange', 2], ['shell', 3], ['seagrass', 4], ['clam', 1]];
const BED_MANG: Pick = [['roots', 5], ['oyster', 3], ['leaves', 4], ['seagrass', 1]];
const BED_ICE: Pick = [['pebble', 5], ['urchin', 3], ['shell', 2], ['kelp', 1]];   // grey and dark, nothing tropical
const pick = (L: Pick, r: number): MS.BedKind => { let t = 0; for (const [, w] of L) t += w; let v = r * t; for (const [k, w] of L) { v -= w; if (v <= 0) return k; } return L[0][0]; };
const bedProps = new WeakMap<HeightTile, Float32Array>();
const BED_STRIDE = 7;                            // x, y, kind, scale, yaw, z, clear
// one candidate per 5x5 cell in the shallows (the seabed shows through clear water there), denser on reefs and kelp
function tileBed(t: HeightTile): Float32Array {
  let A = bedProps.get(t);
  if (A) return A;
  const L: number[] = [], x0 = t.tx * TS, y0 = t.ty * TS, g = biomeGrid(t);
  tileSpots(t, 5, 61, (px, py, gx, gy, h) => {
    const depth = -h;
    if (depth < 0.025 || depth > 0.3) return;
    // a pond walled in by land on every side gets nothing (no coral in an inland pool)
    if (hAt(px + 20, py) > 0 && hAt(px - 20, py) > 0 && hAt(px, py + 20) > 0 && hAt(px, py - 20) > 0) return;
    biomeLerp(g, px - x0, py - y0, bmS, 0);
    // only the region that clearly holds this spot places props: where two meet, neither one's mix of coral,
    // kelp and basalt spills into the other's water
    const [rf, kp, vc, mg] = bmS, top = Math.max(rf, kp, vc, mg), r = hash01(gx, gy, 64), rk = hash01(gx, gy, 65);
    let list: Pick, odds: number, clear: number;
    if (top >= 0.45 && rf === top) { list = BED_REEF; odds = 0.6 * rf; clear = 0.28; }
    else if (top >= 0.45 && kp === top) { list = BED_KELP; odds = 0.5 * kp; clear = 0.34; }
    else if (top >= 0.45 && vc === top) { list = BED_VOLC; odds = 0.28 * vc; clear = 0.36; }
    else if (top >= 0.45 && mg === top) { if (depth < 0.04) return; list = BED_MANG; odds = 0.4 * mg; clear = 0.5; }
    else if (top < 0.25 && coldness(py) > 0.45) { list = BED_ICE; odds = 0.18; clear = 0.4; }
    else if (top < 0.25) { list = BED_HOME; odds = 0.07; clear = 0.4; }
    else return;                                                    // a border: bare sand between the two
    if (r > odds * (1 - smooth01((depth - 0.2) / 0.1) * 0.7)) return;     // thinning out toward the deep edge
    let kind = pick(list, rk);
    if ((kind === 'kelpTall' || kind === 'vent') && depth < 0.08) kind = list === BED_KELP ? 'kelp' : 'basalt';
    L.push(px + 0.5, py + 0.5, BI[kind], 0.75 + hash01(gx, gy, 66) * 0.45, hash01(gx, gy, 67) * 6.283, -1.4 - depth * 16, clear);
  });
  A = new Float32Array(L);
  bedProps.set(t, A);
  return A;
}
const SWAY = new Set<number>([BI.kelp, BI.kelpTall, BI.fanPurple, BI.fanPink, BI.seagrass]);

/** arr, or a copy twice its size when `need` floats won't fit (the scene, foam and particle lists grow as needed) */
function room(arr: Float32Array<ArrayBuffer>, need: number): Float32Array<ArrayBuffer> {
  if (need <= arr.length) return arr;
  const a = new Float32Array(arr.length * 2); a.set(arr); return a;
}

// ---------- instance pools ----------
interface Pool { mesh: MS.Mesh; arr: Float32Array<ArrayBuffer>; n: number; first: number }
const POOLS = [new Map<MS.Mesh, Pool>(), new Map<MS.Mesh, Pool>()];   // [casts shadow, no shadow]
// tint: a brightness or an [r,g,b]; glow: how strongly the mesh's glowable voxels shine (lamps 1, sea life by night);
// clear: how slowly it fades into the water below the waterline (1 for hulls; sea life shows through a little more)
function inst(mesh: MS.Mesh, x: number, y: number, yaw = 0, scale = 1, z = 0, pitch = 0, roll = 0, noShadow = false,
  tint: number | readonly number[] = 1, glow = 1, clear = 1): void {
  const pool = POOLS[noShadow ? 1 : 0];
  let e = pool.get(mesh);
  if (!e) { e = { mesh, arr: new Float32Array(MS.INST * 32), n: 0, first: 0 }; pool.set(mesh, e); }
  const A = e.arr = room(e.arr, (e.n + 1) * MS.INST), o = e.n * MS.INST, mono = typeof tint === 'number';
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
// other players' boats: a plain fit-out in their paint, lamp lit, with the look their captain's name gives them
const shipEq = new Map<string, Fit>();
function eqFor(paint: string, name: string): Fit {
  const key = paint + '|' + name;
  let e = shipEq.get(key);
  if (!e) {
    if (shipEq.size > 64) shipEq.clear();
    e = { ...PLAIN, paint: paint || 'classic', lantern: 1, look: lookSeed(name) }; shipEq.set(key, e);
  }
  return e;
}
// your own look: the same hash of your captain name that everyone else uses, or a seed kept on this device until you have one
const LOOK_KEY = 'bobber-run-look';
let deviceLook = 0, lookName: string | undefined, lookVal = 0;
function myLook(): number {
  const name = NET.profile?.name;
  if (name !== lookName || !lookVal) {
    lookName = name;
    if (name) lookVal = lookSeed(name);
    else {
      if (!deviceLook) {
        try { deviceLook = Number(localStorage.getItem(LOOK_KEY)) || 0; } catch { }
        if (!deviceLook) { deviceLook = (Math.random() * 4294967295 >>> 0) || 1; try { localStorage.setItem(LOOK_KEY, String(deviceLook)); } catch { } }
      }
      lookVal = deviceLook;
    }
  }
  return lookVal;
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
// eased presence (0..1): schools rise into view and sink away instead of popping, whether their species comes and goes
// with the hour or weather, or they come into sight in the dark. Schools are drawn from beyond the view's edge, so
// new ones never appear on screen; ones already on screen rise from the deep.
const shownVis = new WeakMap<School, number>();
/** How far from the view's centre things must be gathered so none appear on screen: its half-diagonal plus `pad` for their size. */
const viewReach = (pad: number): number => Math.hypot(W, H) / 2 + pad;
let visEase = 0;
let sceneT = 0, schoolEase = 0;
const GOLD_TINT = 1.2;
const tint3 = [1, 1, 1];
/** How far a school has sunk on a dive (0 swimming .. 1 out of sight); it rises back the same way. */
function sunk(s: School): number {
  const end = s.spooked ?? 0;
  return G.t < end ? smooth01((G.t - (end - DIVE_S)) / 1.6) : 1 - smooth01((G.t - end) / 1.6);
}
// Fish come from the school's swim simulation (game/schools); here they get depth, colour, glow and their tricks.
function drawSchool(s: School, night: boolean, lit: boolean, vis: number): void {
  const fish = s.swim, dive = Math.max(sunk(s), 1 - smooth01(vis));
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
function oarsFor(poseL: number, prop: number, poseR: number, coat: number): ReturnType<typeof oarGeom> {
  const key = ((poseL * 16 + poseR) * 16 + prop) * 1024 + coat;
  let g = oarCache.get(key);
  if (!g) { g = oarGeom(poseL, prop, poseR, coat); oarCache.set(key, g); }
  return g;
}
// ---------- owned islands ----------
// Each owned island in reach gets its homestead (see homesteadSite): the owner's flag on a tall pole, a cottage, bunting,
// and a lamp on the pole by night. Gathered once a frame for the scene and the lights.
interface Owned { key: string; x: number; y: number }
const owned: Owned[] = [];
function gatherOwned(cx: number, cy: number, reach: number): void {
  owned.length = 0;
  if (!ISLANDS.size) return;
  for (const c of claimableNear(cx, cy, reach)) {
    const at = ISLANDS.has(c.key) ? homesteadSite(c) : null;
    if (at) owned.push({ key: c.key, x: at.x, y: at.y });
  }
}
// the homestead's ground (cottage west of the pole, the flag east of it): trees there are left out while it is owned
const inYard = (x: number, y: number): boolean => owned.some(o => x > o.x - 34 && x < o.x + 38 && y > o.y - 14 && y < o.y + 18);
// logos as 32x32 RGBA, read once per URL (Convex storage sends CORS headers, so the canvas stays readable)
const logos = new Map<string, Uint8ClampedArray | null>();
function logoPixels(url: string): Uint8ClampedArray | null {
  if (logos.has(url)) return logos.get(url)!;
  logos.set(url, null);                                   // a plain pennant until it loads, and for good if it can't
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.canvas.width = ctx.canvas.height = 32;
    ctx.drawImage(img, 0, 0, 32, 32);
    try { logos.set(url, ctx.getImageData(0, 0, 32, 32).data); } catch { /* tainted: keep the pennant */ }
  };
  img.src = url;
  return null;
}
function drawOwned(): void {
  for (const o of owned) {
    const row = ISLANDS.get(o.key), c = islandColour(o.key);
    if (!row) continue;
    const logo = row.logoUrl ? logoPixels(row.logoUrl) : null;
    inst(MS.homesteadMesh(c), o.x, o.y);
    // the flag swings a little about its pole, more in a wind, but keeps facing the camera
    const sway = Math.sin(G.t * 1.7 + o.x * 0.1) * (0.04 + WX.wind * 0.08) + Math.sin(G.t * 4.1 + o.y) * 0.015;
    inst(MS.flagMesh(`${o.key}|${row.mine}|${logo ? row.logoUrl : ''}`, c, logo, row.mine), o.x, o.y, sway);
  }
}

// ---------- region sites: a village in each region and the legends (world.regionSites) ----------
// gathered once a frame; trees and land props keep off their ground, and they light up at night
interface Placed { site: RegionSite; x: number; y: number; yaw: number; z: number; mesh: () => MS.Mesh }
const sites: Placed[] = [], placedSites = new Map<string, Placed>();
const isLegend = (k: string | undefined): k is MS.LegendKind => !!k && (MS.LEGEND_KINDS as readonly string[]).includes(k);
// A village is drawn turned so its jetty (built running south, 15 units out at u = 15) points out to the water at s.a,
// and slid along s.a until the jetty's end stands in the water. Worked out once per site.
function placeSite(s: RegionSite): Placed {
  let p = placedSites.get(s.id);
  if (p) return p;
  if (s.kind === 'village') {
    const th = themeAt(s.x, s.y), ca = Math.cos(s.a), sa = Math.sin(s.a), jx = s.x + sa * 15, jy = s.y - ca * 15;   // the jetty's root
    let d = 0;
    while (d < 40 && hAt(jx + ca * d, jy + sa * d) > -0.02) d += 2;   // first water out along the jetty's line
    const slide = Math.max(0, d - 13);
    p = { site: s, x: s.x + ca * slide, y: s.y + sa * slide, yaw: s.a - Math.PI / 2, z: 0, mesh: () => MS.villageMesh(th) };
  } else {
    const k = isLegend(s.legend) ? s.legend : 'stoneCircle';
    p = { site: s, x: s.x, y: s.y, yaw: k === 'whaleFall' ? 0 : s.a, z: MS.LEGEND_Z[k], mesh: () => MS.legendMesh(k) };
  }
  placedSites.set(s.id, p);
  return p;
}
function gatherSites(cx: number, cy: number, reach: number): void {
  sites.length = 0;
  for (const s of regionSites()) if (Math.abs(s.x - cx) < reach && Math.abs(s.y - cy) < reach) sites.push(placeSite(s));
}
const SITE_R = 30;
const onSite = (x: number, y: number): boolean => sites.some(s => Math.abs(s.x - x) < SITE_R && Math.abs(s.y - y) < SITE_R);
function drawSites(): void { for (const s of sites) inst(s.mesh(), s.x, s.y, s.yaw, 1, s.z); }
const LEGEND_GLOW: Record<string, readonly number[]> = { crystalCave: [0.45, 0.9, 1.0], sunkenTemple: [0.3, 0.95, 0.85], stoneCircle: [0.7, 0.8, 1.0],
  wreckGraveyard: [0.5, 1.0, 0.7], whaleFall: [0.5, 0.8, 1.0], iceboundShip: [0.75, 0.9, 1.0] };

// ---------- hotspot signs: how players find fish ----------
// Gulls wheel and dive over bait, a dark knot of bait flickers silver under the surface, predators boil the water
// where they feed, and a golden fish puts a faint shimmer on the spot. Everything scales with how far the spot has
// surfaced, and is sized to read from a zoomed-out view.
const signs: Hotspot[] = [];
// how far out the view is zoomed, for the signs: 1 up close (>= ~3 screen pixels per world unit) .. 3.5 at the widest;
// farK runs 0..1 over the same range. Signs grow and the far-only cues fade in with it, so close up they stay subtle.
let signFar = 1, farK = 0;
function signScale(): void {
  signFar = clamp(3.2 / (R.S / (window.devicePixelRatio || 1)), 1, 3.5); farK = (signFar - 1) / 2.5;
}
const spotSeed = (h: Hotspot): number => frac(h.x * 0.0137 + h.y * 0.0071);
/** where the bait ball sits: on the bait school, else the spot's centre */
const ballAt = (h: Hotspot, out: number[]): number[] => { const s = h.schools[0]; out[0] = s ? s.x : h.x; out[1] = s ? s.y : h.y; return out; };
const ball = [0, 0];
// a predator's boil: one burst at a time, somewhere new in the spot every BOIL_S seconds
const BOIL_S = 1.1, boil = [0, 0, 0];
function boilAt(h: Hotspot, out: number[]): number[] {
  const c = G.t / BOIL_S + spotSeed(h), n = Math.floor(c);
  out[0] = h.x + (hash01(n, 1, h.x | 0) - 0.5) * Math.max(10, h.r); out[1] = h.y + (hash01(n, 2, h.y | 0) - 0.5) * Math.max(8, h.r * 0.7); out[2] = c - n;
  return out;
}
function drawGulls(h: Hotspot): void {
  const n = h.bait ? 6 : h.predator ? 3 : 0, up = smooth01((h.surf - 0.15) / 0.6), seed = spotSeed(h) * 6.283;
  if (!n || up <= 0.01) return;
  for (let k = 0; k < n; k++) {
    const dir = k % 2 ? 1 : -1, a = G.t * (0.55 + k * 0.09) * dir + k * 1.9 + seed, r = (10 + h.r * 0.3 + (k % 3) * 6) * (1 + farK * 0.6);
    const dv = frac(G.t / (3.2 + k * 0.7) + k * 0.31 + seed), dive = dv < 0.18 ? Math.sin(Math.PI * dv / 0.18) : 0;   // now and then one folds and drops
    const z = (15 + (k % 3) * 5) * (1 - dive * 0.85) * (1 + farK * 0.5) + (1 - up) * 45, rr = r * (1 - dive * 0.7);   // they arrive from on high as the spot surfaces
    inst(MS.gullMesh(dive > 0.2 ? 0 : Math.floor(G.t * 5 + k * 0.7) % 2), h.x + Math.cos(a) * rr, h.y + Math.sin(a) * rr * 0.6, a + dir * Math.PI / 2, 1.05 * Math.pow(signFar, 0.8), z, -dive * 1.1);   // a bigger flock from afar
  }
}
function signFoam(): void {
  for (const h of signs) {
    const k = h.surf, seed = spotSeed(h), R2 = Math.max(18, h.r * 1.2);
    // the patch: ruffled water flecked with foam over the whole spot, faint up close and plain from afar
    for (let i = 0; i < 12; i++) {
      const c = G.t * 0.8 + i / 12 + seed, n = Math.floor(c), ph = c - n, a = hash01(n, i, 23) * 6.283, d = Math.sqrt(hash01(n, i, 24)) * R2;
      const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d * 0.75, fade = Math.sin(Math.PI * ph) * k;
      foam(x, y, (2 + hash01(n, i, 25) * 2) * signFar, fade * (0.25 + 0.75 * farK), 0, 0, 1, 1);
      foam(x, y, 7 * signFar, fade * (0.3 + 0.7 * farK), 1, 0, 1, 0.1);
    }
    if (h.bait) {                                         // nervous water over the ball: rings swelling out, mostly ripple
      ballAt(h, ball);
      for (let i = 0; i < 2; i++) { const ph = frac(G.t * 0.32 + i / 2 + seed); foam(ball[0], ball[1], 12 + ph * 30, (1 - ph) * 0.9 * k, 1, 0, 0.75, 0.55); }
      for (let i = 0; i < 4; i++) {                       // and the surface shivers with little rings
        const c = G.t * 1.3 + i / 4 + seed, n = Math.floor(c), ph = c - n;
        foam(ball[0] + (hash01(n, i, 21) - 0.5) * 14, ball[1] + (hash01(n, i, 22) - 0.5) * 9, 3 + ph * 6, (1 - ph) * 0.8 * k, 1, 0, 1, 0.15);
      }
    }
    if (h.predator) {                                     // the boil: a burst of white water and a ring
      boilAt(h, boil);
      const ph = boil[2];
      foam(boil[0], boil[1], 6 + ph * 10, (1 - ph) * 1.3 * k, 0, 0, 1, 1);
      foam(boil[0], boil[1], 9 + ph * 22, (1 - ph) * 0.9 * k, 1, 0, 1, 0.6);
    }
  }
}
function signPoints(glow: boolean): void {
  const q = Math.floor(G.t * 6), night = nightK;
  for (const h of signs) {
    const k = h.surf, sd = (spotSeed(h) * 997) | 0;
    if (glow) {
      if (!h.rare) continue;
      // a rare fish: a soft gold glow under the spot by night, and from afar a gold glint that winks on the water
      if (night > 0.05) point(h.x, h.y, -0.5, 9 * signFar, 1.4, 1.1, 0.4, 0.22 * k * night * (0.8 + 0.2 * Math.sin(G.t * 2.4)), 2);
      const wink = Math.pow(Math.max(0, Math.sin(G.t * 2.2 + sd)), 6);
      if (farK > 0) point(h.x + Math.sin(G.t * 0.5 + sd) * 4, h.y, 0.4, (1.6 + wink * 1.6) * signFar, 2.4, 1.9, 0.7, k * farK * (0.35 + 0.65 * wink), 2);
      continue;
    }
    if (farK > 0) for (let i = 0; i < 5; i++) {           // from afar the water over the spot reads darker
      const a = i * 1.257 + spotSeed(h) * 6.283 + Math.sin(G.t * 0.3 + i) * 0.3, d = i ? Math.max(8, h.r * 0.55) : 0;
      point(h.x + Math.cos(a) * d, h.y + Math.sin(a) * d * 0.75, -1, Math.max(16, h.r * 1.3), 0.02, 0.06, 0.1, 0.13 * k * farK);
    }
    if (h.bait) {
      ballAt(h, ball);
      for (let i = 0; i < 3; i++)                         // the ball: a dark, shifting knot just under the surface
        point(ball[0] + Math.sin(G.t * 0.9 + i * 2.1) * 2.5, ball[1] + Math.cos(G.t * 0.7 + i * 2.1) * 1.8, -0.8, 11, 0.03, 0.08, 0.12, 0.22 * k);
      for (let i = 0; i < 16; i++) {
        const a = G.t * (1.3 + (i % 3) * 0.45) * (i % 2 ? 1 : -1) + i * 2.4, r = 1.5 + (i % 5) * 1.4 + Math.sin(G.t * 2.1 + i) * 0.8;
        point(ball[0] + Math.cos(a) * r, ball[1] + Math.sin(a) * r * 0.7, -0.6, (2.6 + (i % 3) * 0.9) * Math.sqrt(signFar), 0.04, 0.09, 0.14, 0.55 * k);
      }
      for (let i = 0; i < 4; i++) if (hash01(q, i, sd) < 0.45)   // silver flicks as the fish turn
        point(ball[0] + (hash01(q, i, sd + 3) - 0.5) * 11, ball[1] + (hash01(q, i, sd + 4) - 0.5) * 8, 0.1, 1.1, 1.7, 1.8, 1.9, 0.95 * k);
    }
    if (h.predator) {                                     // spray thrown up by the boil
      boilAt(h, boil);
      const ph = boil[2], n = Math.floor(G.t / BOIL_S);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * 6.283 + hash01(n, i, 7), r = 1 + ph * (3 + hash01(n, i, 8) * 3);
        point(boil[0] + Math.cos(a) * r, boil[1] + Math.sin(a) * r * 0.6, Math.sin(Math.PI * Math.min(1, ph * 1.4)) * (2.5 + hash01(n, i, 9) * 3), 1.3, 1.3, 1.35, 1.4, (1 - ph) * k);
      }
    }
    if (h.rare) for (let i = 0; i < 3; i++) {             // a faint gold shimmer on the water
      const qq = q + i * 13;
      if (hash01(qq, sd, 11) < 0.5) point(h.x + (hash01(qq, 1, 12) - 0.5) * (12 + h.r * 0.5), h.y + (hash01(qq, 2, 12) - 0.5) * (8 + h.r * 0.3), 0.3, 1.2 * signFar, 2.1, 1.7, 0.7, 0.85 * k);
    }
  }
}

// ---------- the air: snow, petals, leaves and ash by day; spores and fireflies glowing at night ----------
// The mix eases toward weather.atmosAt at the view's centre as you sail. Motes live in world-anchored cells (so the
// sea scrolls under them), at most one per cell, each on a loop: fade in, fall or drift, fade out, come back elsewhere.
const ATM: Atmos = { fog: 0, haze: 0, snow: 0, ash: 0, leaves: 0, petals: 0, spores: 0, fireflies: 0 };
const atmGoal: Atmos = { ...ATM };
let atmT = -1, nightK = 0;
function easeAtmos(cx: number, cy: number): void {
  atmosAt(cx, cy, atmGoal);
  const k = atmT < 0 ? 1 : 1 - Math.exp(-clamp(G.t - atmT, 0, 0.2) / 2.5);
  atmT = G.t;
  for (const key in ATM) { const a = key as keyof Atmos; ATM[a] += (atmGoal[a] - ATM[a]) * k; }
}
interface Mote { key: keyof Atmos; dens: number; life: number; glow: boolean }
const MOTES: Mote[] = [
  { key: 'snow', dens: 0.9, life: 7, glow: false }, { key: 'petals', dens: 0.45, life: 8, glow: false }, { key: 'leaves', dens: 0.35, life: 8, glow: false },
  { key: 'ash', dens: 0.5, life: 9, glow: false }, { key: 'spores', dens: 0.4, life: 9, glow: true }, { key: 'fireflies', dens: 0.3, life: 6, glow: true },
];
const LEAF_C = [[0.95, 0.45, 0.14], [0.86, 0.28, 0.12], [0.96, 0.72, 0.22]], SPORE_C = [[0.4, 1.0, 0.9], [0.75, 0.5, 1.0]];
// how many of a kind are about: glowing ones come out at night (spores show faintly by day too)
const moteAmt = (m: Mote): number => ATM[m.key] * m.dens * (!m.glow ? 1 : m.key === 'spores' ? 0.15 + 0.85 * nightK : nightK);
function motes(glow: boolean): void {
  let sum = 0;
  for (const m of MOTES) if (m.glow === glow) sum += moteAmt(m);
  if (sum < 0.02) return;
  const C = Math.max(20, Math.max(CAM[2], CAM[3]) / 36), wa = windAngle(), wdx = Math.cos(wa), wdy = Math.sin(wa), wind = 2 + WX.wind * 7;
  const i0 = Math.floor((CAM[0] - 10) / C), i1 = Math.floor((CAM[0] + CAM[2] + 10) / C), j0 = Math.floor((CAM[1] - 10) / C), j1 = Math.floor((CAM[1] + CAM[3] + 30) / C);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let r = hash01(i, j, 301) * (SET.calm ? 3.2 : 1.6);          // calm skies: half as many
    let m: Mote | null = null;
    for (const mm of MOTES) if (mm.glow === glow && (r -= moteAmt(mm)) < 0) { m = mm; break; }
    if (!m) continue;
    const off = hash01(i, j, 302), c = G.t / m.life + off, n = Math.floor(c), ph = c - n, age = ph * m.life;
    const x0 = (i + hash01(i * 31 + n, j, 303)) * C, y0 = (j + hash01(i, j * 31 + n, 304)) * C, a = Math.min(1, ph / 0.15, (1 - ph) / 0.2);
    const sway = Math.sin(G.t * 1.7 + off * 40), hv = hash01(i + n, j, 305);
    if (m.key === 'snow') point(x0 + wdx * wind * age * 0.6 + sway * 1.2, y0 + wdy * wind * age * 0.4, 26 * (1 - ph), 1.0, 0.96, 0.98, 1.02, 0.85 * a);
    else if (m.key === 'petals') point(x0 + wdx * wind * age + sway * 3, y0 + wdy * wind * age * 0.6, 3 + 16 * (1 - ph) + sway, 1.0, 1.0, 0.74 + 0.12 * hv, 0.84, 0.9 * a);
    else if (m.key === 'leaves') { const lc = LEAF_C[Math.floor(hv * 3)]; point(x0 + wdx * wind * age + sway * 3.5, y0 + wdy * wind * age * 0.6, 2 + 15 * (1 - ph) + sway * 1.5, 1.15, lc[0], lc[1], lc[2], 0.95 * a); }
    else if (m.key === 'ash') {
      if (hv < 0.12) point(x0 + wdx * wind * age, y0 + wdy * wind * age * 0.5, 4 + 20 * ph, 0.9, 2.2, 0.9, 0.3, 0.8 * a);   // an ember rising
      else point(x0 + wdx * wind * age * 0.8 + sway, y0 + wdy * wind * age * 0.4, 22 * (1 - ph), 0.95, 0.36, 0.34, 0.33, 0.7 * a);
    } else if (m.key === 'spores') { const sc = SPORE_C[hv < 0.5 ? 0 : 1]; point(x0 + sway * 2, y0 + Math.cos(G.t + off * 30) * 1.5, 1 + 10 * ph, 1.0, sc[0], sc[1], sc[2], 0.75 * a, 2); }
    else { const blink = Math.pow(Math.max(0, Math.sin(G.t * 2.3 + off * 40)), 3); point(x0 + sway * 3, y0 + Math.sin(G.t * 0.7 + off * 9) * 3, 2 + 2.5 * Math.sin(G.t * 0.9 + off * 7), 1.0, 1.6, 1.9, 0.6, blink * a, 2); }
  }
}
// fog banks and warm haze for the composite pass, lit like the scene: rgb and strength
const FOG_C = [0.84, 0.88, 0.9], HAZE_C = [1.0, 0.86, 0.66], FOGU = [0, 0, 0, 0], HAZEU = [0, 0, 0, 0];
function airUniforms(pg: Program, E: Env): void {
  for (let i = 0; i < 3; i++) { const lit = E.amb[i] + E.sunC[i] * 0.6; FOGU[i] = FOG_C[i] * lit; HAZEU[i] = HAZE_C[i] * lit; }
  FOGU[3] = ATM.fog * (SET.calm ? 0.5 : 1); HAZEU[3] = ATM.haze * (1 - E.dk);
  U4(pg, 'uFogC', FOGU); U4(pg, 'uHazeC', HAZEU);
}
const seaScratch: SeaProp[] = [];
const ICE_MESH: Partial<Record<SeaPropKind, MS.IceKind>> = { floeS: 'floeS', floeM: 'floeM', floeL: 'floeL', berg: 'berg' };
const FLOATS = new Set<SeaPropKind>(['log', 'weedMat', 'lilyPad', 'iceberg']);
// steam off the vents in view, and the props that glow at night (x, y, kind index), filled while building the scene
const vents: number[] = [], glowProps: number[] = [];
const PROP_GLOW: Partial<Record<string, readonly number[]>> = { crystal: [0.45, 0.9, 1.0], steamVent: [1.0, 0.5, 0.2] };

// the rod and fishing line, in world space (scratch, rebuilt each frame)
const ROD_RGB = [94, 68, 48], LINE_RGB = [236, 232, 220];
const hand = [0, 0, 0], tip = [0, 0, 0], bob = [0, 0, 0], linePrev = [0, 0, 0], lineNext = [0, 0, 0];
function buildScene(bs: BoatPose, pois: Poi[], camX: number, camY: number): void {
  POOLS[0].forEach(resetPool); POOLS[1].forEach(resetPool);
  MS.dynBegin(); DYN[0] = bs.x; DYN[1] = bs.y;
  const cx = camX + W / 2, cy = camY + H / 2;
  eachTile(camX - 30, camY - 30, camX + W + 30, camY + H + 60, (tx, ty) => {      // trees
    const t = getTile(tx, ty);
    if (!t.land) return;
    const L = tileTrees(t);
    for (let i = 0; i < L.length; i += TREE_STRIDE) {
      const x = L[i], y = L[i + 1];
      if (x < camX - 24 || x > camX + W + 24 || y < camY - 12 || y > camY + H + 50 || (owned.length && inYard(x, y)) || (sites.length && onSite(x, y))) continue;
      inst(MS.treeMesh(KINDS[L[i + 2]]), x, y, L[i + 4], L[i + 3], 0, 0, 0, false, L[i + 5]);
    }
  });
  // the sea floor in the shallows: coral, kelp swaying with the swell, stones (never casts a shadow)
  eachTile(camX - 20, camY - 20, camX + W + 20, camY + H + 40, (tx, ty) => {
    const A = tileBed(getTile(tx, ty));
    for (let i = 0; i < A.length; i += BED_STRIDE) {
      const x = A[i], y = A[i + 1];
      if (x < camX - 12 || x > camX + W + 12 || y < camY - 8 || y > camY + H + 30) continue;
      const k = A[i + 2], sway = SWAY.has(k) ? Math.sin(G.t * 1.3 + x * 0.21 + y * 0.13) * 0.16 : 0;
      inst(MS.bedMesh(BEDS[k]), x, y, A[i + 4], A[i + 3], A[i + 5], sway, sway * 0.6, true, 1, k === BI.vent ? 1 : 0, A[i + 6]);
    }
  });
  // props on the islands
  vents.length = 0; glowProps.length = 0;
  eachTile(camX - 30, camY - 30, camX + W + 30, camY + H + 60, (tx, ty) => {
    const A = tileProps(getTile(tx, ty));
    for (let i = 0; i < A.length; i += PROP_STRIDE) {
      const x = A[i], y = A[i + 1];
      if (x < camX - 30 || x > camX + W + 30 || y < camY - 12 || y > camY + H + 60 || (sites.length && onSite(x, y)) || (owned.length && inYard(x, y))) continue;
      const kind = MS.PROP_KINDS[A[i + 2]];
      inst(MS.propMesh(kind), x, y, A[i + 4], A[i + 3], A[i + 5]);
      if (kind === 'steamVent') vents.push(x, y);
      if (PROP_GLOW[kind]) glowProps.push(x, y, A[i + 2]);
    }
  });
  // and in the sea (seaprops.ts): ice and flotsam ride the swell in place, rock and bone stand still
  for (const p of seaPropsNear(cx, cy + 15, Math.max(W, H) / 2 + 45, seaScratch, true)) {
    if (p.x < camX - 30 || p.x > camX + W + 30 || p.y < camY - 12 || p.y > camY + H + 60 || (sites.length && onSite(p.x, p.y))) continue;
    const ice = ICE_MESH[p.kind], afloat = !!ice || FLOATS.has(p.kind), ph = p.yaw;
    const bob = afloat ? Math.sin(G.t * (ice ? 0.9 : 1.2) + ph * 3) * (ice ? 0.2 : 0.18) : 0, tilt = afloat ? Math.sin(G.t * 0.8 + ph) * (ice ? 0.035 : 0.04) : 0;
    if (ice) inst(MS.iceMesh(ice), p.x, p.y, ph, p.scale, -0.5 + bob, tilt, tilt * 0.8, true, 0.8);   // dimmed a touch: bright ice set off the bloom
    else inst(MS.propMesh(p.kind as MS.PropKind), p.x, p.y, ph, p.scale, MS.PROP_Z[p.kind as MS.PropKind] + bob, tilt, tilt * 0.7, afloat);
    if (p.kind === 'steamVent') vents.push(p.x, p.y);
  }
  drawSites();
  for (const h of signs) drawGulls(h);
  // landmarks, flotsam, treasure buoys
  for (const p of pois) {
    const k = landmarkKind(p);
    if (p.type === 'light') inst(MS.lighthouseMesh(k), p.x, p.y);
    else if (p.type === 'port') inst(MS.harbourMesh(k), p.x, p.y, p.ang);
    else inst(MS.wreckMesh(k), p.x, p.y, p.dir / 16 * Math.PI * 2, 1, -0.6);
  }
  drawOwned();
  for (const c of cratesNear(cx, cy, viewReach(30), sceneCrates)) if (!c.taken) inst(MS.crateMesh(), c.x, c.y, c.ph, 1, -1.3 + Math.sin(G.t * 2 + c.ph) * 0.35, Math.sin(G.t * 1.3 + c.ph) * 0.1);
  for (const m of G.maps) if (Math.abs(m.x - cx) < W && Math.abs(m.y - cy) < H) inst(MS.buoyMesh(), m.x, m.y, 0, 1, -1.2 + Math.sin(G.t * 2 + m.x) * 0.3, Math.sin(G.t * 1.7) * 0.08);
  // fish schools swim under the surface; at night glowing fish and the ones in your light show clearly, others as dim shapes nearby
  const night = isNight(), lr = lightR() + 14;
  schoolFx.length = 0;
  const step = clamp(G.t - sceneT, 0, 0.1); sceneT = G.t;
  schoolEase = 1 - Math.exp(-2.5 * step); visEase = 1 - Math.exp(-1.6 * step);
  for (const s of schoolsNear(cx, cy, schoolDrawR(), sceneSchools)) {
    if (s.boss) {
      if (schoolActive(s)) { const a = G.t * 0.35; inst(MS.leviMesh(), s.x + Math.cos(a) * 18, s.y + Math.sin(a) * 12, a + Math.PI / 2, 1, -5.5, 0, 0, true, 1); }
      continue;
    }
    const d = Math.hypot(s.x - G.boat.x, s.y - G.boat.y);
    const lit = !night || G.frenzy?.s === s || schoolLook(s.sp).glow || d < lr;
    const want = activeAt(s.sp, env()) ? (lit ? 1 : clamp((110 - d) / 30, 0, 1)) : 0;   // unlit schools at night fade with distance
    // a school first met out of sight is simply there; the fade is for changes you can see (dusk, a school waking)
    const off = s.x < camX - 20 || s.x > camX + W + 20 || s.y < camY - 20 || s.y > camY + H + 20;
    const was = shownVis.get(s) ?? (off ? want : 0), vis = was + (want - was) * visEase;
    shownVis.set(s, vis);
    if (vis > 0.01) drawSchool(s, night, lit, vis);
    else shownCount.delete(s);
  }
  // whales, giants, jellies, other players' boats, dolphins
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
    inst(MS.boatMesh(sh.id, eqFor(sh.paint, sh.name)), sh.x, sh.y, sh.a, 1, Math.sin(G.t * 1.4 + ph) * (0.2 + WX.wind * 0.4) - 0.4, Math.sin(G.t * 1.0 + ph) * 0.02 * sw, Math.sin(G.t * 1.2 + ph + 1) * 0.03 * sw);
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
  const eq: Fit = equipment(), wob = 1 + WX.wind * 2.2;
  eq.look = myLook();
  const b = G.boat, chop = Math.min(1, Math.hypot(b.vx, b.vy) / 50);      // under way the hull slaps through the chop
  let bz = Math.sin(G.t * 1.6) * (0.2 + WX.wind * 0.45) + Math.sin(G.t * 6.1) * chop * 0.2 - 0.4;
  let roll = Math.sin(G.t * 1.3 + 1) * 0.035 * wob + b.heel.x;
  if (G.mode === 'sunk') { bz -= G.sunkT * 3; roll += G.sunkT * 0.2; }
  const pitch = Math.sin(G.t * 1.1) * 0.025 * wob + Math.sin(G.t * 4.7 + 2) * chop * 0.012 + b.trim.x;
  inst(MS.boatMesh(G.boatId, eq), bs.x, bs.y, bs.a, 1, bz, pitch, roll);
  b3x = bs.x; b3y = bs.y; b3c = Math.cos(bs.a); b3s = Math.sin(bs.a); b3z = bz;
  if (hasOars(G.boatId)) {
    const stow = G.fish || G.mode !== 'play';
    const g = oarsFor(stow ? SHIPPED : strokePose(G.boat.phaseL), eq.prop, stow ? SHIPPED : strokePose(G.boat.phaseR), lookCoat(eq.look));
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
  /** x, y, radius, strength per light; rgb and height per light; x, y, angle, length and height per beam */
  L: new Float32Array(MAX_LIGHTS * 4), LC: new Float32Array(MAX_LIGHTS * 3), LZ: new Float32Array(MAX_LIGHTS),
  B: new Float32Array(MAX_BEAMS * 4), BZ: new Float32Array(MAX_BEAMS),
  nl: 0, nb: 0,
};
type Lights = typeof LT;
const AMBER = [1.0, 0.62, 0.26], PORT_LAMP = [1.0, 0.58, 0.24], LIGHTHOUSE_LAMP = [1.0, 0.72, 0.38], FRENZY_GLOW = [1.0, 0.9, 0.6];
const EEL_GLOW = [0.35, 0.7, 1.0], SEA_GLOW = [0.3, 0.95, 0.95];
// Lights and beams are gathered as candidates, then the ones nearest the middle of the view are kept up to the
// shader's limit. When there are more lights than that (a busy coast zoomed out), the kept ones dim over the last
// FADE units before the first one cut, so as the camera moves a far lamp fades away instead of switching off.
interface LightCand { x: number; y: number; r: number; k: number; c0: number; c1: number; c2: number; z: number; d: number }
interface BeamCand { x: number; y: number; a: number; len: number; z: number; d: number }
const lightCands: LightCand[] = [], beamCands: BeamCand[] = [];
let nLight = 0, nBeam = 0, viewX = 0, viewY = 0;
function addLight(x: number, y: number, r: number, k: number, c: readonly number[], z = 7): void {
  if (k <= 0.01) return;
  const e = lightCands[nLight] ?? (lightCands[nLight] = { x: 0, y: 0, r: 0, k: 0, c0: 0, c1: 0, c2: 0, z: 0, d: 0 });
  e.x = x; e.y = y; e.r = r; e.k = k; e.c0 = c[0]; e.c1 = c[1]; e.c2 = c[2]; e.z = z; e.d = Math.hypot(x - viewX, y - viewY);
  nLight++;
}
function addBeam(x: number, y: number, a: number, len: number, z: number): void {
  const e = beamCands[nBeam] ?? (beamCands[nBeam] = { x: 0, y: 0, a: 0, len: 0, z: 0, d: 0 });
  e.x = x; e.y = y; e.a = a; e.len = len; e.z = z; e.d = Math.hypot(x - viewX, y - viewY);
  nBeam++;
}
const byDist = (a: { d: number }, b: { d: number }): number => a.d - b.d;
const FADE = 80;
function finishLights(): void {
  const L = lightCands.slice(0, nLight).sort(byDist), n = Math.min(nLight, MAX_LIGHTS);
  const dCut = nLight > MAX_LIGHTS ? L[MAX_LIGHTS].d : Infinity;
  for (let i = 0; i < n; i++) {
    const e = L[i], o = i * 4, oc = i * 3, w = smooth01((dCut - e.d) / FADE);
    LT.L[o] = e.x; LT.L[o + 1] = e.y; LT.L[o + 2] = e.r; LT.L[o + 3] = e.k * w;
    LT.LC[oc] = e.c0; LT.LC[oc + 1] = e.c1; LT.LC[oc + 2] = e.c2; LT.LZ[i] = e.z;
  }
  LT.nl = n;
  const B = beamCands.slice(0, nBeam).sort(byDist), nb = Math.min(nBeam, MAX_BEAMS);
  for (let i = 0; i < nb; i++) {
    const e = B[i], o = i * 4;
    LT.B[o] = e.x; LT.B[o + 1] = e.y; LT.B[o + 2] = e.a; LT.B[o + 3] = e.len; LT.BZ[i] = e.z;
  }
  LT.nb = nb;
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
  LT.L.fill(0); LT.LC.fill(0); LT.LZ.fill(7); LT.B.fill(0); LT.BZ.fill(0); LT.nl = 0; LT.nb = 0;
  nLight = 0; nBeam = 0; viewX = G.cam.x + W / 2; viewY = G.cam.y + H / 2;
  // warm amber (#ffb860) pools; the shader's falloff is soft, so radii run large
  addLight(bs.x, bs.y, lightR() * 1.6, 0.8 * dk, AMBER);
  for (const p of pois) {
    if (p.type === 'port') { addLight(p.end.x, p.end.y, 58, 0.7 * dk, AMBER, 9); addLight(p.x, p.y, 40, 0.6 * dk, PORT_LAMP, 9); }
    else if (p.type === 'light') {
      const lz = LAMP_Z[landmarkKind(p)] ?? 31;          // the lantern room of this lighthouse design
      addLight(p.x, p.y, 54, 0.8 * dk, LIGHTHOUSE_LAMP, lz);
      addBeam(p.x, p.y, G.t * 0.5 + p.beam, 150, lz);
    }
  }
  // the pole's lamp shines down on the flag's face (it hangs east of the pole, facing the camera), and the cottage's windows glow
  for (const o of owned) { addLight(o.x + 17, o.y + 8, 42, 0.7 * dk, LIGHTHOUSE_LAMP, MS.POLE - 8); addLight(o.x - 13, o.y + 1, 22, 0.4 * dk, PORT_LAMP, 4); }
  if (G.frenzy) addLight(G.frenzy.s.x, G.frenzy.s.y, 20, 0.25, FRENZY_GLOW);
  for (const p of sites) {                                  // village windows, and each legend's own glow
    const s = p.site;
    if (s.kind === 'village') { addLight(p.x, p.y, 56, 0.7 * dk, PORT_LAMP, 7); addLight(p.x + Math.cos(s.a) * 18, p.y + Math.sin(s.a) * 18, 30, 0.5 * dk, AMBER, 5); }
    else addLight(p.x, p.y, 48, 0.55 * dk, LEGEND_GLOW[s.legend ?? ''] ?? SEA_GLOW, 6);
  }
  // crystals and vents: the few nearest the middle of the view (each light costs every pixel)
  for (let n = 0; n < 5 && dk > 0.05; n++) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < glowProps.length; i += 3) { const d = Math.abs(glowProps[i] - viewX) + Math.abs(glowProps[i + 1] - viewY); if (d < bd) { bd = d; best = i; } }
    if (best < 0) break;
    addLight(glowProps[best], glowProps[best + 1], 26, 0.45 * dk, PROP_GLOW[MS.PROP_KINDS[glowProps[best + 2]]]!, 3);
    glowProps[best] = Infinity;                            // taken
  }
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
  finishLights();
  return LT;
}

// ---------- foam / ripple stamps ----------
// per stamp: x, y, size (long axis), alpha | kind (0 disc, 1 ring), heading, aspect (short/long), foam share (rest is ripple)
const FOAM_STRIDE = 8;
let foamArr = new Float32Array(FOAM_STRIDE * 1024), fN = 0;
function foam(x: number, y: number, s: number, a: number, kind = 0, ang = 0, asp = 1, fk = 1): void {
  const F = foamArr = room(foamArr, (fN + 1) * FOAM_STRIDE), o = fN * FOAM_STRIDE;
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
  signFoam();
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
  const P = partArr = room(partArr, (pN + 1) * PART_STRIDE), o = pN * PART_STRIDE;
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
  // legendary fish, golden schools and frenzies glint at the surface, so they read from across the water
  for (const s of schoolsNear(G.cam.x + W / 2, G.cam.y + H / 2, viewReach(30), nearSchools)) if (schoolActive(s) && (SPECIES[s.sp].legend || s.gold || G.frenzy?.s === s)) {
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
  // the strike: water bursts up round the hooked fish for the first moments of the fight
  const hooked = G.fish;
  if (hooked?.st === 'reel' && hooked.t < 0.45) {
    const k = hooked.t / 0.45, hx = hooked.fx ?? hooked.tx, hy = hooked.fy ?? hooked.ty;
    for (let j = 0; j < 12; j++) {
      const a = j / 12 * Math.PI * 2 + hash01(j, 3, 1), r = 2 + k * (7 + hash01(j, 5, 1) * 5);
      point(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.6, Math.sin(Math.PI * Math.min(1, k * 1.3)) * (4 + hash01(j, 7, 1) * 5), 1.4, 1.3, 1.35, 1.4, 1 - k);
    }
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
  for (let i = 0; i < vents.length; i += 2) for (let k = 0; k < 3; k++) {   // steam rising off the vents
    const ph = frac(G.t * 0.35 + k / 3 + vents[i] * 0.013), lean = ph * (2 + WX.wind * 6);
    point(vents[i] + wdx * lean, vents[i + 1] + wdy * lean, 1 + ph * 12, 2 + ph * 4, 0.9, 0.9, 0.92, Math.sin(Math.PI * ph) * 0.45, 1);
  }
  signPoints(false);
  motes(false);
  blendN = pN;
  signPoints(true);
  motes(true);
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
  eachTile(cx - mx, cy - my, cx + mx, cy + my, (tx, ty) => {
    if (performance.now() - t0 > budgetMs) return false;
    if (!hasTile(tx, ty)) getTile(tx, ty);
    else { const t = getTile(tx, ty); if (t.land && !t.trees) tileTrees(t); }
  });
}

// ---------- frame ----------
// per-frame rectangles in world units, reused: the camera CAM, the foam/shadow buffers HR and the heights texture HT (x, y, w, h)
const CAM = [0, 0, 0, 0], HR = [0, 0, 0, 0], HT = [0, 0, 0, 0], SHXY = [0, 0];
const viewPois: Poi[] = [], lightPois: Poi[] = [];
// other players' boats, gathered once per frame
const fleet: Sailor[] = [];
function gatherFleet(): void { fleet.length = 0; for (const s of ONLINE.sailors) fleet.push(s); }
// every pool's instances (and the oars' one) go up in one upload per frame; each draw points at its own slice
let packed = new Float32Array(MS.INST * 1024), dynFirst = 0;
function uploadPools(): void {
  let n = 1;
  for (const P of POOLS) P.forEach(e => { n += e.n; });
  if (n * MS.INST > packed.length) { let L = packed.length; while (L < n * MS.INST) L *= 2; packed = new Float32Array(L); }
  let at = 0;
  for (const P of POOLS) P.forEach(e => { e.first = at; packed.set(e.arr.subarray(0, e.n * MS.INST), at * MS.INST); at += e.n; });
  dynFirst = at; packed.set(DYN, at * MS.INST); at++;
  MS.uploadInstances(packed, at);
}
const drawPool = (e: Pool) => MS.drawInstances(e.mesh, e.first, e.n);
function drawMeshes(mode: 0 | 1, F: Field, E: Env, Lt: Lights): void {
  const pg = PG.mesh;
  gl.useProgram(pg.p);
  U4(pg, 'uCam', CAM); U4(pg, 'uHR', HR); U2(pg, 'uShXY', SHXY[0], SHXY[1]); gl.uniform1i(pg.u.uMode ?? null, mode); styleUniforms(pg);
  if (mode === 0) {
    sunUniforms(pg, E); U1(pg, 'uNight', E.dk); U3(pg, 'uWater', E.water);
    bindTex(pg, 'uH', F.tex, 0); U4(pg, 'uHT', HT); lightUniforms(pg, Lt);
  }
  POOLS[0].forEach(drawPool);
  if (mode === 0) POOLS[1].forEach(drawPool);       // sea life and other no-shadow meshes skip the shadow pass
  MS.drawInstances(MS.dynMesh(DYN[0], DYN[1]), dynFirst, 1);
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
  while ((CAM[2] + PAD * 2) / fs + SNAP * 2 + 3 > F.TW || (CAM[3] + PAD * 2) / fs + SNAP * 2 + 3 > F.TH) fs *= 2;
  const x0 = Math.floor(camX / SNAP) * SNAP - PAD, y0 = Math.floor(camY / SNAP) * SNAP - PAD;
  holdHeights(F, camX - PAD, camY - PAD, camX + CAM[2] + PAD, camY + CAM[3] + PAD, fs);
  STY.px = upx; STY.org[0] = Math.round(camX * upx); STY.org[1] = Math.round(camY * upx); STY.org[2] = h;
  // foam and shadow buffers: world position of texel 0's corner and the world size of the whole buffer
  HR[0] = x0 - fs / 2; HR[1] = y0 - fs / 2; HR[2] = F.TW * fs; HR[3] = F.TH * fs;
  // heights texture: the same, for a texel 0 placed on a whole number of wraps near the window (so it repeats onto it)
  HT[2] = F.TW * fs; HT[3] = F.TH * fs;
  HT[0] = Math.floor(F.V[0] / F.TW) * HT[2] - fs / 2; HT[1] = Math.floor(F.V[1] / F.TH) * HT[3] - fs / 2;
  const E = environment(camY + H / 2);
  gatherFleet();
  // every landmark that could reach into view (a harbour is the widest model), nearest first so the closest get the lamps
  const pcx = camX + W / 2, pcy = camY + H / 2, pois = poisNear(pcx, pcy, viewReach(120), viewPois);
  pois.sort((a, b) => Math.hypot(a.x - pcx, a.y - pcy) - Math.hypot(b.x - pcx, b.y - pcy));
  // lamps light past their landmark and beams reach 150 out at lantern height: gather those wider, so none switches
  // on already in view (lightsFor keeps the nearest and fades the rest)
  gatherOwned(pcx, pcy, viewReach(120));
  gatherSites(pcx, pcy, viewReach(160));
  hotspotsNear(pcx, pcy, viewReach(40), signs);
  easeAtmos(pcx, pcy); nightK = E.dk; signScale();
  buildScene(bs, pois, camX, camY);
  const Lt = lightsFor(bs, poisNear(pcx, pcy, viewReach(200), lightPois), E.dk);
  SHXY[0] = E.sun[0] / Math.max(0.25, E.sun[2]); SHXY[1] = E.sun[1] / Math.max(0.25, E.sun[2]);   // shadow offset per unit height
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  // 1. object shadows projected onto the ground plane (only the part of the field in use is cleared)
  const fw = Math.ceil(((CAM[2] + PAD * 2 + SNAP) / fs + 2) * FR), fh = Math.ceil(((CAM[3] + PAD * 2 + SNAP) / fs + 2) * FR);
  gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, fw, fh);
  into(F.shadow); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  uploadPools();
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
  // 3. scene: meshes, ground, particles. The voxels go first, so the ground (at the far plane, behind them all)
  // only shades the pixels they leave uncovered. (Alpha 0 past the frame's used edge, where the ink outline looks
  // for solid voxels.)
  into(FB.ms ?? FB.scene, w, h); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  drawMeshes(0, F, E, Lt);
  gl.depthMask(false);
  const pg = PG.ground;
  gl.useProgram(pg.p);
  bindTex(pg, 'uH', F.tex, 0); bindTex(pg, 'uFoam', F.foam.tex, 1); bindTex(pg, 'uShadow', F.shadow.tex, 2);
  bindTex(pg, 'uTh', F.th, 3); bindTex(pg, 'uPal', palTex, 4);
  U4(pg, 'uHR', HR); U4(pg, 'uHT', HT); U4(pg, 'uCam', CAM); U1(pg, 'uT', G.t); U1(pg, 'uWT', WX.waveT); U1(pg, 'uWind', WX.wind); U1(pg, 'uRain', WX.rain);
  U1(pg, 'uNight', E.dk); U1(pg, 'uCloud', E.cloud); U1(pg, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U2(pg, 'uWD', Math.cos(windAngle()), Math.sin(windAngle()));
  sunUniforms(pg, E); U3(pg, 'uSky', E.sky); styleUniforms(pg); lightUniforms(pg, Lt);
  quad();
  if (Lt.nb && E.dk > 0.02) {                       // lighthouse beams in the air (depth test on, depth write still off)
    const bp = PG.beam;
    gl.useProgram(bp.p); U4(bp, 'uCam', CAM); U1(bp, 'uNight', E.dk); U1(bp, 'uBK', 1); styleUniforms(bp);
    gl.uniform4fv(bp.u.uB ?? null, Lt.B); gl.uniform1fv(bp.u.uBZ ?? null, Lt.BZ);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    gl.bindVertexArray(beamVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, Lt.nb);
    gl.disable(gl.BLEND);
  }
  gl.depthMask(true);
  // particles blend over the colour but leave alpha (the solid-voxel mask for the outline) alone; glow adds
  gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  partPoints();
  const pp = PG.part;
  gl.useProgram(pp.p); U4(pp, 'uCam', CAM); U1(pp, 'uPpu', w / CAM[2]); sunUniforms(pp, E); styleUniforms(pp);
  gl.bindVertexArray(partVao); gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  if (pN) gl.bufferData(gl.ARRAY_BUFFER, partArr, gl.STREAM_DRAW, 0, pN * PART_STRIDE);
  gl.drawArrays(gl.POINTS, 0, blendN);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); gl.drawArrays(gl.POINTS, blendN, glowN);
  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
  if (FB.ms) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, FB.ms.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, FB.scene.fb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  const scene = FB.scene;
  // 4. post: bloom and tilt-shift blur at quarter size, each skipped while its effect is off; then composite
  const bloomK = (0.5 + E.dk * 0.5) * R.fx.bloom, tilt = (px ? 0.45 : 0.7) * R.fx.tilt;
  if (bloomK > 0) {
    begin(PG.bright, FB.qa, scene); U1(PG.bright, 'uTh', hdr ? 1.0 : 0.82); quad();
    for (let i = 0; i < 2; i++) {
      begin(PG.blur, FB.qb, FB.qa); U2(PG.blur, 'uDir', 1 / FB.qa.w, 0); quad();
      begin(PG.blur, FB.qa, FB.qb); U2(PG.blur, 'uDir', 0, 1 / FB.qa.h); quad();
    }
  }
  if (tilt > 0) {
    begin(PG.copy, FB.ta, scene); quad();
    begin(PG.blur, FB.tb, FB.ta); U2(PG.blur, 'uDir', 1.5 / FB.ta.w, 0); quad();
    begin(PG.blur, FB.ta, FB.tb); U2(PG.blur, 'uDir', 0, 1.5 / FB.ta.h); quad();
  }
  const out = FB.out;
  if (out) intoUsed(out); else into(null, cv.width, cv.height);
  const cp = PG.comp;
  gl.useProgram(cp.p);
  bindTex(cp, 'uScene', scene.tex, 0); bindTex(cp, 'uBloom', FB.qa.tex, 1); bindTex(cp, 'uBlur', FB.ta.tex, 2); U2(cp, 'uUVS', UVS[0], UVS[1]);
  // pixel styles: the ink edge replaces film grain; tilt-shift is gentler
  styleUniforms(cp); U1(cp, 'uQ', 0); U1(cp, 'uInk', px ? 0.75 * (R.fx.ink ?? 1) : 0);
  U1(cp, 'uT', G.t); U1(cp, 'uExp', E.exp); U1(cp, 'uSat', E.sat); U1(cp, 'uVig', 0.42); U1(cp, 'uTilt', tilt); U1(cp, 'uGrain', SET.calm || px ? 0 : 0.01);
  U1(cp, 'uGrade', R.fx.grade ?? 1); U1(cp, 'uDusk', E.dusk);
  U1(cp, 'uRain', WX.rain); U1(cp, 'uDrops', WX.rain * (SET.calm ? 0.5 : 1)); U4(cp, 'uCam', CAM); U1(cp, 'uFlash', WX.flash * (SET.calm ? 0.15 : 1)); U1(cp, 'uBloomK', bloomK); U1(cp, 'uSlant', 0.3 + WX.wind * 0.7);
  U3(cp, 'uTint', E.tint); U2(cp, 'uRes', out ? w : cv.width, out ? h : cv.height);
  airUniforms(cp, E);
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
