// The chart's sea and land, drawn on the GPU for the minimap, the sea chart and the port's route map.
// The CPU only samples the world: heights on a 33 x 33 grid per tile and the region's seven colour bands on a 9 x 9
// grid, once per tile, in a pyramid of levels (each level's tiles twice as wide), so any zoom samples a few hundred
// tiles at most. The shader does the rest at screen resolution: smooth coasts with an inked shoreline, waterlines
// offshore, soft depth, hill shading and contour lines on land, floes in the far north. Pan and zoom cost nothing
// but the draw; the result is copied into the 2D chart, which draws its marks on top.
import { program, type Program } from '../gl/glutil';
import { heightAt, claimableNear } from '../world';
import { chartBands } from '../maptiles';
import { fogDirty, fogChunk, fogChunks } from '../game/explore';

type GL = WebGL2RenderingContext;
const N = 33, NC = 9, BANDS = 7;            // height samples per side, colour samples per side, colour bands
const SLOTS = 1024, HCOLS = 32, CCOLS = 16;  // tile slots, and how they're laid out in the two atlases
const BASE = 128;                           // world units per tile side at level 0 (samples every 4 units)
const MAXL = 7;
// the fog of war: one texel per 32-unit cell, 1024 x 1024 of them round the world's centre (+-16,384 units)
const FOG_TEX = 1024, FOG_HALF = FOG_TEX * 32 / 2, FOG_CN = 32;

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_rect;   // screen px: x0, y0, x1, y1
layout(location=2) in vec4 a_uv;     // the part of the tile it shows: u0, v0, u1, v1
layout(location=3) in vec2 a_slot;   // atlas slot, world units between height samples
uniform vec2 u_view;
out vec2 v_uv;
flat out float v_slot;
flat out float v_step;
void main() {
  vec2 px = mix(a_rect.xy, a_rect.zw, a_corner);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner);
  v_slot = a_slot.x; v_step = a_slot.y;
  gl_Position = vec4(px / u_view * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_h, u_c, u_fog;
uniform vec2 u_hsz, u_csz, u_view, u_origin;
uniform float u_wpp, u_dpr, u_vig, u_fogOn;
in vec2 v_uv;
flat in float v_slot;
flat in float v_step;
out vec4 o;

float H(vec2 uv) {
  vec2 cell = vec2(mod(v_slot, ${HCOLS}.0), floor(v_slot / ${HCOLS}.0)) * ${N}.0;
  return texture(u_h, (cell + 0.5 + clamp(uv, 0.0, 1.0) * ${N - 1}.0) / u_hsz).r;
}
vec3 B(float b, vec2 uv) {
  vec2 cell = vec2(mod(v_slot, ${CCOLS}.0) * ${NC * BANDS}.0 + b * ${NC}.0, floor(v_slot / ${CCOLS}.0) * ${NC}.0);
  return texture(u_c, (cell + 0.5 + clamp(uv, 0.0, 1.0) * ${NC - 1}.0) / u_csz).rgb;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 sat(vec3 c, float k) { return mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, k); }
// coverage of a line along the level c of h, w px wide, given how much h changes per pixel
float iso(float h, float c, float perPx, float w) {
  float d = abs(h - c) / max(perPx, 1e-6);
  return 1.0 - smoothstep(w * 0.5 - 0.6, w * 0.5 + 0.6, d);
}
void main() {
  float e = 1.0 / ${N - 1}.0, h = H(v_uv);
  // the slope over two samples each way: smooth enough to light and to space lines by, without the ground's grain
  vec2 g = vec2(H(v_uv + vec2(2.0 * e, 0.0)) - H(v_uv - vec2(2.0 * e, 0.0)), H(v_uv + vec2(0.0, 2.0 * e)) - H(v_uv - vec2(0.0, 2.0 * e))) / (4.0 * v_step);
  float perPx = max(length(g) * u_wpp, 1e-5);   // change in height per screen pixel
  float lw = u_dpr;                             // one CSS pixel
  vec2 world = u_origin + vec2(gl_FragCoord.x, u_view.y - gl_FragCoord.y) * u_wpp;
  vec3 deep = B(0.0, v_uv), mid = B(1.0, v_uv), shal = B(2.0, v_uv), sand = B(3.0, v_uv), grass = B(4.0, v_uv), forest = B(5.0, v_uv), rock = B(6.0, v_uv);
  vec3 col;
  if (h < 0.0) {
    // water: deep to shallow in soft steps, then light waterlines following the coast, fading where they'd crowd
    col = mix(deep, mid, smoothstep(-0.5, -0.3, h));
    col = mix(col, shal, smoothstep(-0.2, -0.05, h));
    vec3 lineCol = mix(shal, vec3(1.0), 0.55);
    float room = 0.05 / perPx;                  // px between neighbouring waterlines
    float fade = smoothstep(2.5, 6.0, room);
    col = mix(col, lineCol, 0.5 * iso(h, -0.045, perPx, 1.3 * lw) * fade);
    col = mix(col, lineCol, 0.3 * iso(h, -0.1, perPx, 1.1 * lw) * fade);
    col = mix(col, lineCol, 0.16 * iso(h, -0.18, perPx, 1.0 * lw) * fade);
    col = sat(col, 1.25) * 1.04;                // a little brighter and bluer than the ground palette
    col = mix(col, vec3(1.0), 0.35 * smoothstep(-0.03, -0.004, h));   // surf
    // ice floes in the far north: ragged patches in deep water
    float cold = clamp((-world.y - 1300.0) / 1000.0, 0.0, 1.0);
    if (cold > 0.3 && h < -0.15 && u_wpp < 2.0) {     // too small to read on a far view
      vec2 c = floor(world / 44.0), f = world / 44.0 - c;
      vec2 at = vec2(0.3) + 0.4 * vec2(hash(c + 3.1), hash(c + 7.7));
      float r = length(f - at) / 0.3, edge = hash(floor(world / 5.0));
      if (hash(c) < 0.07 * (cold - 0.3) / 0.7) {
        float ice = 1.0 - smoothstep(0.62 + 0.3 * edge, 0.75 + 0.3 * edge, r);
        col = mix(col, vec3(0.91, 0.95, 0.965), ice * smoothstep(2.0, 1.2, u_wpp));
      }
    }
  } else {
    // land: sand, grass, forest and rock, blended over a narrow height so the bands read but don't stair-step
    col = mix(sand, grass, smoothstep(0.07, 0.11, h));
    col = mix(col, forest, smoothstep(0.32, 0.4, h));
    col = mix(col, rock, smoothstep(0.68, 0.86, h));
    col = sat(col, 1.15) * 1.04;
    // hill shading, lit from the north-west, and engraved contours that thin out where they'd crowd
    vec3 n = normalize(vec3(-g * 70.0, 1.0));
    float lit = dot(n, normalize(vec3(-0.55, -0.6, 0.6)));
    col *= mix(1.0, 0.86 + 0.3 * lit, smoothstep(0.02, 0.1, h));
    float room = 0.2 / perPx, fade = smoothstep(4.0, 9.0, room);
    float k = fract((h - 0.2) / 0.2) * 0.2;
    float cline = h > 0.18 ? max(iso(k, 0.0, perPx, 0.8 * lw), iso(k, 0.2, perPx, 0.8 * lw)) : 0.0;
    col = mix(col, col * 0.7, 0.35 * cline * fade);
  }
  // the inked shoreline
  col = mix(col, vec3(0.106, 0.165, 0.2), 0.85 * iso(h, 0.0, perPx, 1.5 * lw));
  // the sea not seen yet: blank parchment, its edge ragged and singed like a chart still being drawn
  if (u_fogOn > 0.5) {
    // the 32-unit cells, blurred over nine taps so the edge runs smooth, then roughened with soft noise
    vec2 fuv = (world + ${FOG_HALF}.0) / ${FOG_HALF * 2}.0, o = vec2(28.0 / ${FOG_HALF * 2}.0);
    float f = 0.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) f += texture(u_fog, fuv + o * vec2(i, j)).r;
    f /= 9.0;
    float rag = (vnoise(world / 46.0) - 0.5) * 0.45 + (vnoise(world / 13.0) - 0.5) * 0.2;
    float s = smoothstep(0.42, 0.58, f + rag);
    vec3 paper = vec3(0.90, 0.85, 0.73) * (0.97 + 0.05 * hash(floor(gl_FragCoord.xy / (2.0 * u_dpr))));
    col = mix(paper, col, s);
    col = mix(col, vec3(0.45, 0.32, 0.19), 0.6 * s * (1.0 - s) * 4.0);   // a singed rim where the known meets the blank
  }
  // the full chart darkens a little toward its frame
  vec2 fc = vec2(gl_FragCoord.x, u_view.y - gl_FragCoord.y), edge = min(fc, u_view - fc);
  col *= mix(1.0, mix(0.8, 1.0, smoothstep(0.0, 70.0 * u_dpr, min(edge.x, edge.y))), u_vig);
  // a faint print grain
  col *= 0.985 + 0.03 * hash(floor(gl_FragCoord.xy / max(1.0, u_dpr)));
  o = vec4(col, 1.0);
}`;

interface Tile { slot: number; used: number }
let gl: GL | null = null, glc: HTMLCanvasElement | null = null, prog: Program | null = null, failed = false;
let hTex: WebGLTexture | null = null, cTex: WebGLTexture | null = null, fTex: WebGLTexture | null = null, vao: WebGLVertexArrayObject | null = null, inst: WebGLBuffer | null = null;
const tiles = new Map<number, Tile>(), free: number[] = [];
let frame = 0;
const key = (l: number, tx: number, ty: number): number => ((l * 4096 + (tx + 2048)) * 4096) + (ty + 2048);

function init(): boolean {
  if (gl) return true;
  if (failed) return false;
  try {
    glc = document.createElement('canvas');
    const g = glc.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!g) throw new Error('no webgl2');
    glc.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; tiles.clear(); free.length = 0; });
    glc.addEventListener('webglcontextrestored', () => { glc = null; });   // rebuilt on the next draw
    prog = program(g, VS, FS);
    const atlas = (w: number, h: number, internal: GLenum): WebGLTexture => {
      const t = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, t);
      g.texStorage2D(g.TEXTURE_2D, 1, internal, w, h);
      for (const p of [g.TEXTURE_MIN_FILTER, g.TEXTURE_MAG_FILTER]) g.texParameteri(g.TEXTURE_2D, p, g.LINEAR);
      for (const p of [g.TEXTURE_WRAP_S, g.TEXTURE_WRAP_T]) g.texParameteri(g.TEXTURE_2D, p, g.CLAMP_TO_EDGE);
      return t;
    };
    hTex = atlas(HCOLS * N, (SLOTS / HCOLS) * N, g.R16F);
    cTex = atlas(CCOLS * NC * BANDS, (SLOTS / CCOLS) * NC, g.RGBA8);
    fTex = atlas(FOG_TEX, FOG_TEX, g.R8);
    for (const k of fogChunks()) fogDirty.add(k);           // a fresh context starts blank: send everything seen
    vao = g.createVertexArray();
    g.bindVertexArray(vao);
    const quad = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    inst = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, inst);
    const stride = 10 * 4;
    g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 4, g.FLOAT, false, stride, 0); g.vertexAttribDivisor(1, 1);
    g.enableVertexAttribArray(2); g.vertexAttribPointer(2, 4, g.FLOAT, false, stride, 16); g.vertexAttribDivisor(2, 1);
    g.enableVertexAttribArray(3); g.vertexAttribPointer(3, 2, g.FLOAT, false, stride, 32); g.vertexAttribDivisor(3, 1);
    g.bindVertexArray(null);
    free.length = 0;
    for (let s = SLOTS - 1; s >= 0; s--) free.push(s);
    gl = g;
    return true;
  } catch (err) {
    console.warn('chart: GPU terrain unavailable', err);
    failed = true;
    return false;
  }
}

// float to half float, for the R16F height atlas
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function half(v: number): number {
  f32[0] = v;
  const x = u32[0], s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s;
  if (e >= 31) return s | 0x7c00;
  return s | (e << 10) | (m >>> 13);
}

const hBuf = new Uint16Array(N * N), cBuf = new Uint8Array(NC * BANDS * NC * 4), bands = new Float32Array(BANDS * 3);
/** Samples tile (l, tx, ty) of the world and uploads it into a free slot (the least recently drawn, if none is free). */
function build(g: GL, l: number, tx: number, ty: number): Tile {
  let slot = free.pop();
  if (slot === undefined) {
    let oldK = -1, old: Tile | null = null;
    for (const [k, t] of tiles) if (t.used < frame && (!old || t.used < old.used)) { old = t; oldK = k; }
    if (!old) { old = tiles.values().next().value!; oldK = tiles.keys().next().value!; }
    tiles.delete(oldK); slot = old.slot;
  }
  const side = BASE << l, step = side / (N - 1), x0 = tx * side, y0 = ty * side;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hBuf[j * N + i] = half(heightAt(x0 + i * step, y0 + j * step));
  const cstep = side / (NC - 1), islands = claimableNear(x0 + side / 2, y0 + side / 2, side * 0.75 + 460);
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    chartBands(x0 + i * cstep, y0 + j * cstep, islands, bands);
    for (let b = 0; b < BANDS; b++) {
      const o = (j * NC * BANDS + b * NC + i) * 4;
      cBuf[o] = bands[b * 3] * 255; cBuf[o + 1] = bands[b * 3 + 1] * 255; cBuf[o + 2] = bands[b * 3 + 2] * 255; cBuf[o + 3] = 255;
    }
  }
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  g.bindTexture(g.TEXTURE_2D, hTex);
  g.texSubImage2D(g.TEXTURE_2D, 0, (slot % HCOLS) * N, Math.floor(slot / HCOLS) * N, N, N, g.RED, g.HALF_FLOAT, hBuf);
  g.bindTexture(g.TEXTURE_2D, cTex);
  g.texSubImage2D(g.TEXTURE_2D, 0, (slot % CCOLS) * NC * BANDS, Math.floor(slot / CCOLS) * NC, NC * BANDS, NC, g.RGBA, g.UNSIGNED_BYTE, cBuf);
  const t = { slot, used: frame };
  tiles.set(key(l, tx, ty), t);
  return t;
}

// the shader compiles while the game idles after loading, not on the chart's first open
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => { init(); }, { timeout: 8000 });

// seen chunks that changed since the last draw go up to the fog texture
const fogBuf = new Uint8Array(FOG_CN * FOG_CN);
function uploadFog(g: GL): void {
  if (!fogDirty.size) return;
  g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
  g.bindTexture(g.TEXTURE_2D, fTex);
  for (const k of fogDirty) {
    const [cx, cy] = k.split(',').map(Number), c = fogChunk(cx, cy), ox = cx * FOG_CN + FOG_TEX / 2, oy = cy * FOG_CN + FOG_TEX / 2;
    if (!c || ox < 0 || oy < 0 || ox + FOG_CN > FOG_TEX || oy + FOG_CN > FOG_TEX) continue;
    for (let i = 0; i < FOG_CN * FOG_CN; i++) fogBuf[i] = c[i >> 3] & (1 << (i & 7)) ? 255 : 0;
    g.texSubImage2D(g.TEXTURE_2D, 0, ox, oy, FOG_CN, FOG_CN, g.RED, g.UNSIGNED_BYTE, fogBuf);
  }
  fogDirty.clear();
}
let instData = new Float32Array(10 * 256);
/** Tiles built so far, for tests and probes. */
export const terrainStats = { tiles: 0, built: 0 };

/**
 * Draws the terrain of the view whose top-left is world (wx0, wy0), `wpp` world units per canvas pixel, into `ctx`.
 * Missing tiles are built while `budget` ms last, nearest the centre first; until then a coarser level stands in.
 * Returns false where the GPU can't draw it (the caller fills the sea).
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, w: number, h: number, wx0: number, wy0: number, wpp: number, dpr: number, budget: number, vignette = false, fogOn = true): boolean {
  if (!init() || !gl || !glc || !prog) return false;
  const g = gl, t0 = performance.now();
  frame++;
  if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); }
  // the level whose samples fall 2 to 4 canvas pixels apart
  const L = Math.max(0, Math.min(MAXL, Math.floor(Math.log2(Math.max(1e-3, wpp)))));
  const side = BASE << L, tx0 = Math.floor(wx0 / side), ty0 = Math.floor(wy0 / side), tx1 = Math.floor((wx0 + w * wpp) / side), ty1 = Math.floor((wy0 + h * wpp) / side);
  const want: [number, number, number][] = [];
  const ccx = (wx0 + w * wpp / 2) / side - 0.5, ccy = (wy0 + h * wpp / 2) / side - 0.5;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty, (tx - ccx) ** 2 + (ty - ccy) ** 2]);
  want.sort((a, b) => a[2] - b[2]);
  // cover the view at once with a coarse level (few, quick tiles), then sharpen nearest-first while the budget lasts
  const C = Math.min(MAXL, L + 2), cside = BASE << C;
  for (let ty = Math.floor(wy0 / cside); ty <= Math.floor((wy0 + h * wpp) / cside); ty++) for (let tx = Math.floor(wx0 / cside); tx <= Math.floor((wx0 + w * wpp) / cside); tx++)
    if (!tiles.has(key(C, tx, ty))) build(g, C, tx, ty);
  let n = 0;
  if (instData.length < want.length * 10) instData = new Float32Array(want.length * 10 * 2);
  for (const [tx, ty] of want) {
    let t = tiles.get(key(L, tx, ty));
    if (!t && performance.now() - t0 < budget) { t = build(g, L, tx, ty); terrainStats.built++; }
    // the tile itself, or the part of the nearest cached ancestor that covers it
    let l = L, ax = tx, ay = ty, u0 = 0, v0 = 0, span = 1;
    while (!t && l < MAXL) {
      l++; span /= 2; u0 = (u0 + (ax & 1)) / 2; v0 = (v0 + (ay & 1)) / 2; ax >>= 1; ay >>= 1;
      t = tiles.get(key(l, ax, ay));
    }
    if (!t) continue;
    t.used = frame;
    const x = (tx * side - wx0) / wpp, y = (ty * side - wy0) / wpp, s = side / wpp, o = n * 10;
    instData.set([x, y, x + s, y + s, u0, v0, u0 + span, v0 + span, t.slot, (BASE << l) / (N - 1)], o);
    n++;
  }
  terrainStats.tiles = tiles.size;
  g.viewport(0, glc.height - h, w, h);
  g.disable(g.BLEND);
  g.clearColor(0.31, 0.45, 0.54, 1); g.clear(g.COLOR_BUFFER_BIT);
  g.useProgram(prog.p);
  g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, hTex); g.uniform1i(prog.u.u_h!, 0);
  g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, cTex); g.uniform1i(prog.u.u_c!, 1);
  uploadFog(g);
  g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, fTex); g.uniform1i(prog.u.u_fog!, 2);
  g.uniform1f(prog.u.u_fogOn!, fogOn ? 1 : 0);
  g.uniform2f(prog.u.u_hsz!, HCOLS * N, (SLOTS / HCOLS) * N);
  g.uniform2f(prog.u.u_csz!, CCOLS * NC * BANDS, (SLOTS / CCOLS) * NC);
  g.uniform2f(prog.u.u_view!, w, h);
  g.uniform2f(prog.u.u_origin!, wx0, wy0);
  g.uniform1f(prog.u.u_wpp!, wpp);
  g.uniform1f(prog.u.u_dpr!, dpr);
  g.uniform1f(prog.u.u_vig!, vignette ? 1 : 0);
  g.bindVertexArray(vao);
  g.bindBuffer(g.ARRAY_BUFFER, inst);
  g.bufferData(g.ARRAY_BUFFER, instData.subarray(0, n * 10), g.STREAM_DRAW);
  g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, n);
  g.bindVertexArray(null);
  ctx.drawImage(glc, 0, 0, w, h, 0, 0, w, h);
  return true;
}
