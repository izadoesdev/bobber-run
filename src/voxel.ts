// Tiny voxel engine: models are built in (u,v,z) with z up, rendered as sprite stacks at any
// heading with normal-based lighting, 4x supersampling resolved by majority vote (stays on palette),
// a dark contact edge and a soft cast shadow.
import { hex } from './config';

export type RGB = [number, number, number];
/** a material's three tones: shadow, mid, lit */
export type Ramp = [RGB, RGB, RGB];
export type Vec3 = [number, number, number];

/** Material id -> its ramp. Id 0 means "empty", so slot 0 is a placeholder that is never drawn. */
export const RGB: Ramp[] = [[[0, 0, 0], [0, 0, 0], [0, 0, 0]]];
/** materials that ignore lighting (lamps, glass, photophores) */
export const EMISSIVE = new Set<number>();
export function mat(ramp: readonly [string, string, string], emissive = false): number {
  RGB.push([hex(ramp[0]), hex(ramp[1]), hex(ramp[2])]);
  const id = RGB.length - 1;
  if (emissive) EMISSIVE.add(id);
  return id;
}

/** A dense voxel grid over u in [u0, u1], v in [v0, v1], z in [0, nz). Out-of-range reads are empty and writes are dropped. */
export class Vox {
  readonly u0: number; readonly v0: number;
  readonly nu: number; readonly nv: number; readonly nz: number;
  /** material id per voxel (0 = empty) */
  readonly d: Uint8Array;
  /** per-voxel unit normals (3 floats each); filled by finalize() */
  n = new Float32Array(0);
  /** horizontal radius of the model; set by finalize() */
  rad = 0;
  constructor(u0: number, u1: number, v0: number, v1: number, nz: number) {
    this.u0 = u0; this.v0 = v0;
    this.nu = u1 - u0 + 1; this.nv = v1 - v0 + 1; this.nz = nz;
    this.d = new Uint8Array(this.nu * this.nv * nz);
  }
  idx(u: number, v: number, z: number): number { return (z * this.nv + (v - this.v0)) * this.nu + (u - this.u0); }
  inb(u: number, v: number, z: number): boolean {
    return u >= this.u0 && u < this.u0 + this.nu && v >= this.v0 && v < this.v0 + this.nv && z >= 0 && z < this.nz;
  }
  get(u: number, v: number, z: number): number { return this.inb(u, v, z) ? this.d[this.idx(u, v, z)] : 0; }
  set(u: number, v: number, z: number, m: number): void { if (this.inb(u, v, z)) this.d[this.idx(u, v, z)] = m; }
  box(u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, m: number): void {
    for (let z = z0; z <= z1; z++) for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) this.set(u, v, z, m);
  }
  line(a: readonly number[], b: readonly number[], m: number): void {
    const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.set(Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t), m);
    }
  }
  /** calls fn for every solid voxel */
  each(fn: (u: number, v: number, z: number, m: number) => void): void {
    for (let z = 0; z < this.nz; z++) for (let v = this.v0; v < this.v0 + this.nv; v++) for (let u = this.u0; u < this.u0 + this.nu; u++) {
      const m = this.d[this.idx(u, v, z)];
      if (m) fn(u, v, z, m);
    }
  }
  /** Computes normals (pointing away from the solid mass nearby, biased up on exposed tops) and the radius. */
  finalize(): this {
    this.n = new Float32Array(this.d.length * 3);
    let rad = 0;
    this.each((u, v, z) => {
      let nu = 0, nv = 0, nz = 0;
      for (let dz = -2; dz <= 2; dz++) for (let du = -2; du <= 2; du++) for (let dv = -2; dv <= 2; dv++) {
        if (this.get(u + du, v + dv, z + dz)) { nu -= du; nv -= dv; nz -= dz; }
      }
      if (!this.get(u, v, z + 1)) nz += 6;
      const l = Math.hypot(nu, nv, nz) || 1, k = this.idx(u, v, z) * 3;
      this.n[k] = nu / l; this.n[k + 1] = nv / l; this.n[k + 2] = nz / l;
      rad = Math.max(rad, Math.hypot(u, v));
    });
    this.rad = rad;
    return this;
  }
}

const LIGHT = (() => { const l = [-0.62, -0.15, 0.77], n = Math.hypot(...l); return l.map(x => x / n); })();
const SUB = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const INK = hex('#1b2a33');

/** thin parts drawn over the voxels (oar shafts); `wide` doubles them vertically */
export interface VoxLine { a: Vec3; b: Vec3; col: RGB; wide?: boolean }
export interface VoxPoint { p: Vec3; col: RGB }
export interface VoxRenderOpts {
  lines?: VoxLine[];
  points?: VoxPoint[];
  /** minimum radius of the canvas (room for parts that stick out) */
  rad?: number;
  /** only voxels below this height get the dark contact edge underneath */
  outlineZ?: number;
  shadow?: boolean;
}
/** A rendered sprite; (cx, cy) is where the model origin lands on `img`. */
export interface VoxFrame { img: HTMLCanvasElement; shadow: HTMLCanvasElement | null; cx: number; cy: number }

export function renderVox(M: Vox, angle: number, { lines = [], points = [], rad = 0, outlineZ = 3, shadow = true }: VoxRenderOpts = {}): VoxFrame {
  const c = Math.cos(angle), s = Math.sin(angle);
  const R = Math.ceil(Math.max(M.rad, rad)) + 2, w = R * 2, h = R * 2 + M.nz, cx = R, cy = R + M.nz;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!, id = g.createImageData(w, h), d = id.data, zb = new Float32Array(w * h).fill(-9);
  const put = (px: number, py: number, col: RGB, z: number) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const k = py * w + px;
    if (z < zb[k] - 0.5) return;
    zb[k] = z;
    const o = k * 4;
    d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
  };
  // ray down through the stack at a sub-pixel position: the first voxel hit, packed as material*3 + tone + z*4096
  const cast = (fx: number, fy: number) => {
    const dx = fx - cx;
    for (let z = M.nz - 1; z >= 0; z--) {
      const dy = fy - cy + z, iu = Math.round(dx * c + dy * s), iv = Math.round(-dx * s + dy * c);
      if (!M.inb(iu, iv, z)) continue;
      const ix = M.idx(iu, iv, z), m = M.d[ix];
      if (!m) continue;
      let tone = 2;
      if (!EMISSIVE.has(m)) {
        const nu = M.n[ix * 3], nv = M.n[ix * 3 + 1], nz = M.n[ix * 3 + 2];
        const lam = (nu * c - nv * s) * LIGHT[0] + (nu * s + nv * c) * LIGHT[1] + nz * LIGHT[2];
        tone = lam > 0.62 ? 2 : lam > 0.05 ? 1 : 0;
      }
      return m * 3 + tone + z * 4096;
    }
    return -1;
  };
  // each pixel takes the most common colour among its sub-samples (ties go to the higher voxel)
  const hits = [0, 0, 0, 0];
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let n = 0;
    for (const [ox, oy] of SUB) {
      const r = cast(px + ox - 0.5, py + oy - 0.5);
      if (r >= 0) hits[n++] = r;
    }
    if (n < 2) continue;
    let best = -1, bc = 0;
    for (let a = 0; a < n; a++) {
      const ka = hits[a] % 4096;
      let cnt = 0;
      for (let b = 0; b < n; b++) if (hits[b] % 4096 === ka) cnt++;
      if (cnt > bc || (cnt === bc && hits[a] > best)) { bc = cnt; best = hits[a]; }
    }
    const k = best % 4096, m = Math.floor(k / 3), tone = k % 3;
    put(px, py, RGB[m][tone], Math.floor(best / 4096));
  }
  const proj = (p: Vec3) => [cx + p[0] * c - p[1] * s, cy + p[0] * s + p[1] * c - p[2]];
  for (const L of lines) {
    const A = proj(L.a), B = proj(L.b), n = Math.ceil(Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1])) * 1.5) + 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = L.a[2] + (L.b[2] - L.a[2]) * t;
      const px = Math.round(A[0] + (B[0] - A[0]) * t), py = Math.round(A[1] + (B[1] - A[1]) * t);
      put(px, py, L.col, z + 0.6);
      if (L.wide) put(px, py + 1, L.col, z + 0.5);
    }
  }
  for (const pt of points) {
    const q = proj(pt.p);
    put(Math.round(q[0]), Math.round(q[1]), pt.col, pt.p[2] + 1);
  }
  // dark contact edge: an ink pixel under each low solid pixel that has nothing below it
  for (let py = h - 1; py > 0; py--) for (let px = 0; px < w; px++) {
    const o = (py * w + px) * 4, a = ((py - 1) * w + px) * 4;
    if (d[o + 3] === 0 && d[a + 3] === 255 && zb[(py - 1) * w + px] < outlineZ) {
      d[o] = INK[0]; d[o + 1] = INK[1]; d[o + 2] = INK[2]; d[o + 3] = 255;
      zb[py * w + px] = -1;
    }
  }
  g.putImageData(id, 0, 0);
  return { img: cv, shadow: shadow ? castShadow(M, c, s, w, h, cx, cy) : null, cx, cy };
}

// light comes from the upper left, so shadows fall down-right and lengthen with height
function castShadow(M: Vox, c: number, s: number, w: number, h: number, cx: number, cy: number): HTMLCanvasElement {
  const sw = w + Math.ceil(M.nz * 0.6) + 2, shh = h + Math.ceil(M.nz * 0.3) + 2;
  const sh = document.createElement('canvas');
  sh.width = sw; sh.height = shh;
  const sg = sh.getContext('2d')!, sd = sg.createImageData(sw, shh), sdd = sd.data;
  const mark = (x: number, y: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= sw || y >= shh) return;
    const o = (y * sw + x) * 4;
    sdd[o] = 27; sdd[o + 1] = 42; sdd[o + 2] = 51; sdd[o + 3] = 80;
  };
  M.each((u, v, z) => {
    const x = cx + u * c - v * s + z * 0.55, y = cy + u * s + v * c + z * 0.28;
    mark(x, y); mark(x + 1, y); mark(x, y + 1); mark(x + 1, y + 1);
  });
  sg.putImageData(sd, 0, 0);
  return sh;
}
