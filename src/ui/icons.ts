// Icons rendered from tiny voxel models with the same renderer as the world, cached as data URLs.
import { Vox, mat, renderVox } from '../voxel';
import { M } from '../models';
import { SPECIES } from '../econ';
import { FISH_T } from '../fishart';
import { hex } from '../config';

type Mat = number;

// materials only icons use
const X = {
  brass: mat(['#8a6a1e', '#c9a24a', '#f0d27a']),
  pink: mat(['#a8564a', '#e08a78', '#f4b8a8']),
  green: mat(['#2e5a3a', '#3f7a4a', '#5a9a62']),
  paper: mat(['#b8a07a', '#e6d6b0', '#f6ecd4']),
  glowy: mat(['#e2b94a', '#f8e08a', '#fff6d6'], true),
  hose: mat(['#1b2a33', '#2b3a44', '#3d4c56']),
  blue: mat(['#26405e', '#3f5f8a', '#5b7fae']),
  silver: mat(['#6d7780', '#a9b1b7', '#d3d8da']),
};

// a horizontal disc of radius r around (cx, cy), filling layers z0..z1
function disc(V: Vox, cx: number, cy: number, z0: number, z1: number, r: number, m: Mat): void {
  for (let z = z0; z <= z1; z++) for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) {
    if (Math.hypot(u - cx, v - cy) <= r) V.set(u, v, z, m);
  }
}

// a standing crew member, `tall` extra layers of hat
function person(V: Vox, coat: Mat, hat: Mat, tall = 0): void {
  V.box(-1, 0, -1, 0, 0, 2, M.pants);
  V.box(-1, 0, -1, 0, 3, 5, coat);
  V.box(-2, 1, -1, 0, 4, 5, coat);
  V.box(-1, 0, -1, 0, 6, 7, M.skin);
  V.box(-1, 0, -1, 0, 8, 8 + tall, hat);
}

// a head-and-shoulders figure for the story portraits: coat, hair (or hat brim) and an optional hat crown
function bust(coat: Mat, hair: Mat, hat: Mat | null, souwester = false): Vox {
  const V = new Vox(-5, 5, -4, 4, 14);
  for (let u = -4; u <= 4; u++) for (let v = -2; v <= 2; v++) for (let z = 0; z <= 4; z++) {
    if (Math.abs(u) <= 4 - Math.max(0, z - 3)) V.set(u, v, z, coat);
  }
  V.box(-2, 2, -2, 2, 5, 9, M.skin);
  V.box(-2, 2, -2, 2, 10, 10, hair);
  V.box(-2, 2, -2, -2, 7, 9, hair);
  V.box(-2, -2, -2, 1, 8, 9, hair);
  V.box(2, 2, -2, 1, 8, 9, hair);
  V.set(-1, 2, 8, M.iron); V.set(1, 2, 8, M.iron); V.set(0, 2, 6, M.redp);   // eyes and a smile face the viewer (south)
  if (hat) {
    V.box(-3, 3, -3, 3, 11, 11, hat);
    V.box(-2, 2, -2, 2, 12, 12 + (souwester ? 0 : 1), hat);
    if (souwester) V.box(-3, 3, -3, -3, 8, 10, hat);
  }
  return V;
}

// a puffy cloud, lifted `zo` layers to leave room for rain or lightning underneath
function cloud(zo: number): Vox {
  const V = new Vox(-7, 7, -2, 2, 9 + zo);
  for (const [cx, cz, r] of [[-3, 3, 2.6], [1, 4.5, 3.4], [4, 2.6, 2.4], [0, 2, 2.6]]) {
    for (let u = -7; u <= 7; u++) for (let v = -2; v <= 2; v++) for (let z = 0; z <= 8; z++) {
      if (Math.hypot(u - cx, v * 1.4, z - cz) <= r) V.set(u, v, z + zo, X.silver);
    }
  }
  return V;
}

const BUILD: Record<string, () => Vox> = {
  prop: () => {
    const V = new Vox(-6, 6, -6, 6, 6);
    V.box(-1, 1, -1, 1, 2, 3, M.iron);
    // four blades, the two on the +u/+v side pitched one layer up
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const z = 2 + (a + b > 0 ? 1 : 0);
      V.box(a > 0 ? 2 : a < 0 ? -5 : -1, a > 0 ? 5 : a < 0 ? -2 : 1, b > 0 ? 2 : b < 0 ? -5 : -1, b > 0 ? 5 : b < 0 ? -2 : 1, z, z, X.brass);
    }
    return V;
  },
  hull: () => {
    const V = new Vox(-5, 5, -2, 2, 10);
    for (let z = 0; z < 9; z++) { const w = z < 3 ? z + 2 : 5; V.box(-w, w, 0, 0, z, z, M.steel); }
    for (const [u, z] of [[-3, 6], [3, 6], [-3, 2], [3, 2], [0, 8]]) V.set(u, 1, z, M.gilt);
    return V;
  },
  hold: () => {
    const V = new Vox(-4, 4, -4, 4, 8);
    V.box(-3, 3, -3, 3, 0, 5, M.crate);
    for (const u of [-3, 3]) V.box(u, u, -3, 3, 0, 5, M.band);
    V.box(-3, 3, -3, 3, 5, 5, M.band);
    return V;
  },
  bilge: () => {
    const V = new Vox(-5, 5, -3, 3, 9);
    V.box(-1, 1, -1, 1, 0, 6, M.redp);
    V.box(-1, 1, -1, 1, 7, 7, M.iron);
    V.line([0, 0, 8], [3, 0, 8], M.iron);
    V.line([2, 0, 2], [5, 0, 0], X.hose);
    return V;
  },
  anchor: () => {
    const V = new Vox(-5, 5, -1, 1, 11);
    V.box(0, 0, 0, 0, 1, 9, M.iron);
    V.box(-2, 2, 0, 0, 7, 7, M.iron);
    V.box(-1, 1, 0, 0, 10, 10, M.iron);
    V.set(-1, 0, 9, M.iron); V.set(1, 0, 9, M.iron);
    for (let k = 0; k <= 4; k++) {
      const z = Math.round(1 + k * k / 6);
      V.set(-k, 0, z, M.iron); V.set(k, 0, z, M.iron);
    }
    return V;
  },
  net: () => {
    const V = new Vox(-5, 5, -3, 3, 7);
    for (let u = -4; u <= 4; u++) for (let v = -2; v <= 2; v++) for (let z = 0; z <= 4; z++) {
      if (Math.hypot(v, z - 2) <= 2.4 && (u + v + z) % 2 === 0) V.set(u, v, z, M.net);
    }
    V.box(-5, -5, 0, 0, 2, 2, M.post);
    V.box(5, 5, 0, 0, 2, 2, M.post);
    return V;
  },
  rod: () => {
    const V = new Vox(-6, 6, -1, 1, 12);
    V.line([-4, 0, 1], [5, 0, 11], M.post);
    V.box(-3, -2, 0, 1, 2, 3, X.brass);
    V.set(5, 0, 11, M.redp);
    return V;
  },
  reel: () => {
    const V = new Vox(-4, 4, -3, 3, 9);
    for (let z = 0; z <= 8; z++) for (let u = -4; u <= 4; u++) {
      const d = Math.hypot(u, z - 4);
      if (d > 4) continue;
      V.set(u, -2, z, X.brass); V.set(u, 2, z, X.brass);
      if (d <= 2.6) V.box(u, u, -1, 1, z, z, M.blade);
    }
    V.box(3, 4, 3, 3, 5, 6, M.post);
    return V;
  },
  line: () => {
    const V = new Vox(-4, 4, -4, 4, 8);
    disc(V, 0, 0, 0, 0, 3.6, X.brass);
    disc(V, 0, 0, 1, 5, 3.2, M.blade);
    disc(V, 0, 0, 6, 6, 3.6, X.brass);
    V.line([3, 0, 4], [4, 4, 1], M.blade);
    return V;
  },
  tackle: () => {
    const V = new Vox(-4, 4, -3, 3, 8);
    V.box(-4, 4, -3, 3, 0, 4, X.green);
    V.box(-4, 4, -3, 3, 4, 4, M.tackle);
    V.box(-1, 1, 0, 0, 5, 6, M.iron);
    V.set(0, 3, 2, X.brass);
    return V;
  },
  ice: () => {
    const V = new Vox(-4, 4, -3, 3, 8);
    V.box(-4, 4, -3, 3, 0, 4, M.white);
    V.box(-4, 4, -3, 3, 5, 5, M.stripe);
    V.box(-1, 1, -3, -3, 3, 3, M.stripe);
    return V;
  },
  sonar: () => {
    const V = new Vox(-5, 5, -5, 5, 8);
    V.box(-3, 3, -2, 2, 0, 2, M.iron);
    V.box(-2, 2, -2, -2, 1, 2, M.window);
    for (let u = -3; u <= 3; u++) for (let v = -3; v <= 3; v++) {   // the dish
      const d = Math.hypot(u, v);
      if (d <= 3.2) V.set(u, v, 3 + Math.round(d * d / 6), M.white);
    }
    V.box(0, 0, 0, 0, 3, 6, M.iron);
    return V;
  },
  lantern: () => {
    const V = new Vox(-3, 3, -3, 3, 11);
    V.box(-2, 2, -2, 2, 0, 0, M.iron);
    V.box(-1, 1, -1, 1, 1, 5, M.lamp);
    for (const [u, v] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) V.box(u, u, v, v, 1, 5, M.iron);
    V.box(-2, 2, -2, 2, 6, 6, M.iron);
    V.box(-1, 1, -1, 1, 7, 7, M.iron);
    V.box(0, 0, 0, 0, 8, 9, M.iron);
    return V;
  },
  spyglass: () => {
    const V = new Vox(-7, 7, -2, 2, 9);
    for (let u = -6; u <= 6; u++) {
      const r = u < -2 ? 1.2 : u < 2 ? 1.6 : 2.1;               // three telescoping sections
      for (let v = -2; v <= 2; v++) for (let z = 0; z <= 5; z++) {
        if (Math.hypot(v, z - 2.5) <= r) V.set(u, v, Math.round(z + (u + 6) * 0.3), u % 4 === 0 ? M.post : X.brass);
      }
    }
    return V;
  },
  sextant: () => {
    const V = new Vox(-6, 6, -1, 1, 10);
    for (let a = 0; a <= 12; a++) {                              // the arc
      const t = -1.0 + a / 12 * 2.0;
      V.set(Math.round(Math.sin(t) * 5), 0, 3, X.brass);
    }
    V.line([0, 0, 9], [-5, 0, 1], X.brass);
    V.line([0, 0, 9], [5, 0, 1], X.brass);
    V.line([0, 0, 9], [2, 0, 1], M.post);
    V.set(0, 0, 9, M.redp);
    return V;
  },
  radio: () => {
    const V = new Vox(-4, 4, -3, 3, 12);
    V.box(-4, 4, -2, 2, 0, 5, M.iron);
    V.box(-3, -1, 2, 2, 1, 4, X.blue);
    V.box(1, 3, 2, 2, 2, 3, M.white);
    V.line([3, 0, 6], [3, 0, 11], M.iron);
    V.set(3, 0, 11, M.redp);
    return V;
  },
  deckhand: () => { const V = new Vox(-3, 3, -3, 3, 11); person(V, M.stripe, M.hat); return V; },
  cook: () => { const V = new Vox(-3, 3, -3, 3, 12); person(V, M.white, M.white, 2); return V; },
  quarter: () => {
    const V = new Vox(-3, 3, -3, 3, 11);
    person(V, M.redp, M.iron);
    V.box(-2, 1, -2, 1, 8, 8, M.iron);
    V.box(1, 2, 1, 1, 3, 5, X.paper);
    return V;
  },
  shrimp: () => {
    const V = new Vox(-5, 5, -2, 2, 7);
    for (let a = 0; a <= 10; a++) {                              // a curled body
      const t = a / 10 * Math.PI * 1.2, u = Math.round(Math.cos(t) * 4), z = Math.round(Math.sin(t) * 3 + 2);
      V.box(u, u, -1, 0, z, z, X.pink);
    }
    V.line([4, 0, 2], [5, 0, 6], X.pink);
    return V;
  },
  glow: () => {
    const V = new Vox(-5, 5, -2, 2, 8);
    V.box(-3, 2, -1, 0, 2, 4, X.glowy);
    V.set(3, 0, 3, M.redp);
    V.line([-3, 0, 3], [-5, 0, 6], M.iron);
    V.box(1, 1, -1, 0, 1, 1, M.iron);
    return V;
  },
  chum: () => {
    const V = new Vox(-4, 4, -4, 4, 8);
    for (let z = 0; z <= 5; z++) for (let u = -4; u <= 4; u++) for (let v = -4; v <= 4; v++) {   // a bucket: wall and floor
      const d = Math.hypot(u, v), r = 2.6 + z * 0.25;
      if (d <= r && (d > r - 1.1 || z === 0)) V.set(u, v, z, M.plank);
    }
    disc(V, 0, 0, 4, 4, 2.5, M.redp);
    V.line([-3, 0, 6], [3, 0, 6], M.iron);
    return V;
  },
  coin: () => {
    const V = new Vox(-4, 4, -1, 1, 9);
    for (let u = -4; u <= 4; u++) for (let z = 0; z <= 8; z++) {
      const d = Math.hypot(u, z - 4);
      if (d > 4) continue;
      V.set(u, 0, z, X.brass);
      if (d <= 2.6 && (u === 0 || z === 4)) V.set(u, 1, z, M.gilt);
    }
    return V;
  },
  repair: () => {
    const V = new Vox(-6, 6, -1, 1, 10);
    V.line([-4, 0, 1], [3, 0, 8], X.silver);
    V.box(2, 5, 0, 0, 7, 9, X.silver);
    V.set(4, 0, 8, 0);                                           // the spanner's jaw
    V.box(-5, -3, 0, 0, 0, 2, M.post);
    return V;
  },
  sun: () => {
    const V = new Vox(-6, 6, -1, 1, 13);
    for (let u = -6; u <= 6; u++) for (let z = 0; z <= 12; z++) {
      const d = Math.hypot(u, z - 6);
      if (d <= 3.4) V.set(u, 0, z, X.glowy);
      else if (d <= 5.8 && d > 4.6 && (Math.abs(u) < 1 || Math.abs(z - 6) < 1 || Math.abs(Math.abs(u) - Math.abs(z - 6)) < 1)) V.set(u, 0, z, X.brass);
    }
    return V;
  },
  moon: () => {
    const V = new Vox(-5, 5, -1, 1, 11);
    for (let u = -5; u <= 5; u++) for (let z = 0; z <= 10; z++) {
      if (Math.hypot(u, z - 5) <= 4.6 && Math.hypot(u - 2.4, z - 6.4) > 3.6) V.set(u, 0, z, X.paper);
    }
    return V;
  },
  star: () => {
    const V = new Vox(-6, 6, -1, 1, 12);
    for (let u = -6; u <= 6; u++) for (let z = 0; z <= 11; z++) {
      const x = u, y = z - 5.5, a = Math.atan2(y, x), r = Math.hypot(x, y);
      const k = 2.6 + 3.2 * Math.pow(Math.abs(Math.cos(2.5 * (a + Math.PI / 2))), 3);   // five-pointed radius
      if (r <= k) V.set(u, 0, z, X.brass);
    }
    return V;
  },
  cloud: () => cloud(0),
  rain: () => {
    const V = cloud(4);
    for (const u of [-4, -1, 2, 5]) V.line([u, 0, 3], [u - 1, 0, 0], X.blue);
    return V;
  },
  storm: () => {
    const V = cloud(5);
    V.line([1, 0, 4], [-1, 0, 2], X.glowy);
    V.line([-1, 0, 2], [1, 0, 2], X.glowy);
    V.line([1, 0, 2], [-1, 0, 0], X.glowy);
    return V;
  },
  arrow: () => {
    const V = new Vox(-6, 6, -1, 1, 10);
    V.box(-5, 1, 0, 0, 4, 6, M.white);
    for (let k = 0; k <= 4; k++) V.box(2 + k, 2 + k, 0, 0, 1 + k, 9 - k, M.white);
    return V;
  },
  warn: () => {
    const V = new Vox(-6, 6, -1, 1, 12);
    for (let z = 0; z <= 10; z++) { const w = Math.round(z * 0.55); V.box(-5 + w, 5 - w, 0, 0, z, z, X.brass); }
    V.box(0, 0, 1, 1, 4, 7, M.iron);
    V.set(0, 1, 2, M.iron);
    return V;
  },
  // dry dock upgrades
  pots: () => {
    const V = new Vox(-6, 6, -4, 4, 10);
    for (let u = -4; u <= 4; u++) for (let v = -3; v <= 3; v++) for (let z = 0; z <= 5; z++) {
      const edge = Math.abs(u) === 4 || Math.abs(v) === 3 || z === 0 || z === 5, rim = z === 0 || z === 5;
      if (edge && ((u + v + z) % 2 === 0 || rim)) V.set(u, v, z, rim ? M.post : M.net);
    }
    V.line([4, 0, 5], [6, 0, 8], M.net);
    V.box(5, 6, -1, 0, 8, 9, M.redp);
    return V;
  },
  keel: () => {
    const V = new Vox(-6, 6, -3, 3, 10);
    for (let u = -6; u <= 6; u++) { const w = Math.max(0, 3 - Math.abs(u) * 0.4); V.box(u, u, -Math.round(w), Math.round(w), 6, 7, M.paint); }
    for (let u = -4; u <= 3; u++) { const d = Math.round(5 - Math.abs(u + 0.5) * 0.8); V.box(u, u, 0, 0, 6 - d, 5, M.iron); }
    V.box(-1, 1, -1, 1, 0, 1, M.copper);
    return V;
  },
  harpoon: () => {
    const V = new Vox(-7, 7, -2, 2, 10);
    V.line([-6, 0, 2], [6, 0, 8], M.iron);
    V.line([4, 0, 7], [7, 0, 9], X.silver);
    V.set(5, 1, 8, X.silver); V.set(5, -1, 8, X.silver);
    V.box(-5, -3, -1, 1, 0, 3, M.post);
    V.box(-4, -4, -2, 2, 2, 2, X.brass);
    V.line([-6, 0, 2], [-3, 2, 0], M.net);
    return V;
  },
  bell: () => {
    const V = new Vox(-5, 5, -5, 5, 12);
    for (let z = 0; z <= 9; z++) {
      const r = z < 7 ? 4.6 - z * 0.12 : 4.2 - (z - 6) * 1.1;   // flared lip, rounded crown
      for (let u = -5; u <= 5; u++) for (let v = -5; v <= 5; v++) {
        const d = Math.hypot(u, v);
        if (d <= r && d > r - 1.3 || (z === 9 && d <= r)) V.set(u, v, z, X.brass);
      }
    }
    for (const [u, v] of [[0, 4], [4, 0], [-4, 0]]) V.set(u, v, 4, X.blue);
    V.box(0, 0, 0, 0, 10, 11, M.iron);
    return V;
  },
  bottle: () => {
    const V = new Vox(-6, 6, -2, 2, 6);
    for (let u = -4; u <= 2; u++) for (let v = -2; v <= 2; v++) for (let z = 0; z <= 4; z++) {
      if (Math.hypot(v, z - 2) <= 2.2) V.set(u, v, z, X.green);
    }
    V.box(-2, 0, 0, 0, 2, 3, X.paper);
    V.box(3, 4, -1, 1, 1, 3, X.green);
    V.box(5, 5, -1, 1, 1, 3, M.post);
    return V;
  },
  // story portraits: head and shoulders, facing the viewer
  maren: () => bust(M.navy, M.iron, M.iron),
  ida: () => bust(X.green, M.post, null),
  tobias: () => bust(M.coat, M.coat, M.coat, true),
  wren: () => bust(M.gun, M.white, M.white),
  nell: () => bust(M.stone, M.white, null),
  map: () => {
    const V = new Vox(-6, 6, -4, 4, 4);
    V.box(-5, 5, -3, 3, 0, 0, X.paper);
    for (const u of [-6, 6]) V.box(u, u, -3, 3, 0, 1, M.plank);
    for (const [u, v] of [[1, 0], [2, 1], [0, 1], [2, -1], [0, -1]]) V.set(u, v, 1, M.redp);   // the X
    V.line([-4, 2, 1], [0, 0, 1], M.iron);
    return V;
  },
};

const cache = new Map<string, string>();
// portraits and the bottle are drawn face-on; everything else at a three-quarter turn
const FACE_ON = new Set(['maren', 'ida', 'tobias', 'wren', 'nell', 'bottle']);

// render, then crop to the drawn pixels so icons fill their boxes
function toURL(V: Vox, angle = -0.55): string {
  V.finalize();
  const c: HTMLCanvasElement = renderVox(V, angle, { outlineZ: 2, shadow: false }).img;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return c.toDataURL();
  // a square canvas with a one-pixel margin around the cropped sprite
  const w = x1 - x0 + 3, h = y1 - y0 + 3, s = Math.max(w, h), o = document.createElement('canvas');
  o.width = s;
  o.height = s;
  o.getContext('2d')!.drawImage(c, x0, y0, w - 2, h - 2, Math.floor((s - w) / 2) + 1, Math.floor((s - h) / 2) + 1, w - 2, h - 2);
  return o.toDataURL();
}

/** Data URL for a named voxel icon (upgrade keys, bait, weather, portraits...); '' for an unknown key. */
export function icon(key: string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const build = BUILD[key];
  const url = build ? toURL(build(), FACE_ON.has(key) ? 0 : -0.55) : '';
  cache.set(key, url);
  return url;
}

// fish: the species sprite extruded into a voxel slab, seen side-on
const matCache = new Map<string, Mat>();
const toHex = (rgb: number[]) => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function matFor(c: string): Mat {
  let m = matCache.get(c);
  if (m === undefined) {
    const [r, g, b] = hex(c);
    m = mat([toHex([r * 0.72, g * 0.72, b * 0.72]), c, toHex([r * 1.15, g * 1.15, b * 1.15])]);
    matCache.set(c, m);
  }
  return m;
}

/** Data URL for a species' icon, by index into SPECIES. */
export function fishIcon(spIdx: number): string {
  const key = 'fish:' + spIdx, hit = cache.get(key);
  if (hit !== undefined) return hit;
  const sp = SPECIES[spIdx], rows = FISH_T[sp.shape], h = rows.length, w = rows[0].length;
  // sprite letters -> palette: top, mid, belly, fins (F is a single-layer fin), eye
  const col: Record<string, string> = { T: sp.c[0], M: sp.c[1], B: sp.c[2], F: sp.c[3], G: sp.c[3], S: sp.c[0], E: '#1b2a33' };
  const V = new Vox(-Math.ceil(w / 2), Math.ceil(w / 2), -1, 1, h + 1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ch = rows[j][i];
    if (ch === '.') continue;
    const m = matFor(col[ch] || sp.c[1]), u = i - (w >> 1), z = h - 1 - j;
    V.set(u, 0, z, m);
    if (ch !== 'F') V.set(u, -1, z, m);
  }
  const url = toURL(V, 0);
  cache.set(key, url);
  return url;
}
