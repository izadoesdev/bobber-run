// Portraits for everyone who talks: little voxel busts built from a seed and the person's role, drawn by the same
// renderer as the world. The seed (their name and role) picks a face: skin, hair, brows, a beard, glasses, an earring,
// a scarf, a coat; the role picks what they wear and carry: a captain's cap, a diver's mask, a sou'wester, a straw hat,
// goggles, a fur hood, a miner's lamp. Age shows in grey hair and smooth young faces; a parrot is a parrot. Each comes
// in three frames, so a portrait blinks now and then and moves its mouth while a line is new.
import Alea from 'alea';
import { Vox, mat, RGB, EMISSIVE } from '../voxel';
import { M } from '../models';
import { PEOPLE } from '../story';

type Mat = number;
const ramp = (a: string, b: string, c: string): Mat => mat([a, b, c]);
const SKIN = [ramp('#c48a62', '#ecb994', '#f8d6b8'), ramp('#b07c58', '#d79f76', '#ecbd94'), ramp('#93603e', '#b98055', '#d29a6c'),
  ramp('#6e452a', '#8f5c38', '#ad7650'), ramp('#4e3020', '#68412a', '#85563a'), ramp('#d09a78', '#f0c4a4', '#fbe0cc')];
const HAIR: Record<string, Mat> = {
  black: ramp('#0e1418', '#1b2228', '#2e383e'), dark: ramp('#2a1c14', '#3e2a1c', '#56402c'), brown: ramp('#5a3a22', '#7a5230', '#9a6c44'),
  auburn: ramp('#6e2a18', '#9a4222', '#bc5e34'), blond: ramp('#a8803a', '#d8b060', '#f0d690'), ginger: ramp('#a04a1a', '#d06a2a', '#f08e4a'),
  grey: ramp('#6e7276', '#9aa0a4', '#c4c8ca'), white: ramp('#b4b0a8', '#e0dcd4', '#f8f6f0'),
};
const COATS = [M.navy, M.redp, ramp('#2e4a34', '#3f6a46', '#5a8a5a'), ramp('#8a6a1e', '#b8902e', '#dcb44a'), M.gun, M.trawl,
  ramp('#4a2a4a', '#6a3e66', '#8a5a86'), M.stone, M.orange, M.skiff];
const LIP = ramp('#7a3a30', '#a0504a', '#b8645a'), LID = ramp('#7a4a32', '#9a6244', '#b47a58'), EYE = M.iron, BLUSH = ramp('#c06a5a', '#e08a78', '#f0a898');
const STRAW = ramp('#a88a4a', '#d8b870', '#f0d898'), YELLOW = ramp('#b08a1a', '#e0b42a', '#f6d45a'), KHAKI = ramp('#6a6440', '#8e8658', '#b0a874');
const FUR = ramp('#b8b0a0', '#e6e0d4', '#faf8f2'), GLASS = ramp('#3f6a8a', '#7fb0cf', '#cfe8f4'), WOOD = M.post;
const GREEN = ramp('#2a6a2a', '#3e9a3a', '#6ac25a'), PARROT_FACE = ramp('#b0302a', '#e04a3a', '#f07a5a'), BEAK = ramp('#3a3430', '#5a524a', '#8a8070');

type Hat = 'none' | 'cap' | 'beanie' | 'souwester' | 'straw' | 'bandana' | 'ranger' | 'mask' | 'goggles' | 'miner' | 'hood' | 'big-cap';
type HairStyle = 'short' | 'long' | 'bun' | 'tail' | 'bald' | 'crop';
export interface Look {
  parrot?: boolean;
  skin: number; hair: keyof typeof HAIR; style: HairStyle; coat: Mat; shirt: Mat; stripes: boolean;
  hat: Hat; hatCol: Mat; beard: 'none' | 'beard' | 'moustache'; glasses: boolean; patch: boolean; earring: boolean; pipe: boolean;
  scarf: Mat | null; blush: boolean; brows: boolean;
  /** the medallion behind them: a hue in degrees */
  hue: number;
}

function hashStr(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** The look for someone, from their name and role: the role sets age and dress, the seed the rest. */
export function lookFor(name: string, role: string, seed = name + '|' + role): Look {
  const r = Alea(hashStr(seed)), pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)], chance = (p: number) => r() < p;
  const t = (name + ' ' + role).toLowerCase(), has = (re: RegExp) => re.test(t);
  const young = has(/\b(kid|boy|girl|nephew|niece|grandson|granddaughter|apprentice|young|lamp boy)\b/) || has(/great-grand/);
  const old = !young && has(/\b(old|gran|grandmother|grandfather|elder|storyteller)\b/);
  const L: Look = {
    skin: Math.floor(r() * SKIN.length), hair: pick(['black', 'dark', 'brown', 'brown', 'auburn', 'blond', 'ginger'] as const),
    style: pick(['short', 'short', 'long', 'bun', 'tail', 'crop'] as const), coat: pick(COATS), shirt: chance(0.5) ? M.white : M.paint,
    stripes: chance(0.2), hat: 'none', hatCol: pick(COATS), beard: 'none', glasses: chance(0.12), patch: false, earring: chance(0.18), pipe: false,
    scarf: chance(0.22) ? pick(COATS) : null, blush: chance(0.35), brows: chance(0.6), hue: Math.floor(r() * 360),
  };
  if (!young && chance(0.3)) L.beard = chance(0.6) ? 'beard' : 'moustache';
  if (old) { L.hair = chance(0.6) ? 'white' : 'grey'; if (chance(0.35)) L.style = 'bald'; L.glasses = chance(0.45); L.pipe = chance(0.25); }
  if (young) { L.blush = true; L.style = pick(['short', 'crop', 'tail'] as const); }
  // what the role wears; the first match wins
  const ROLE: [RegExp, Hat][] = [
    [/wants to be a captain/, 'big-cap'], [/parrot/, 'none'], [/diver|dive/, 'mask'], [/captain|skipper|harbourmaster|ferry/, 'cap'],
    [/north|ice|cold|surveyor/, 'hood'], [/storm|fisherman|net-mender|trawler/, 'souwester'], [/salvag|cutter|wreck|forge/, 'goggles'],
    [/rock|miner/, 'miner'], [/warden|watcher|naturalist/, 'ranger'], [/south|warm|fruit|trader|market|fishmonger/, pick(['straw', 'bandana'] as const)],
    [/keeper|lamp|light/, 'beanie'], [/chart|record|map/, 'none'],
  ];
  const role2 = ROLE.find(([re]) => has(re));
  L.hat = role2 ? role2[1] : pick(['none', 'none', 'beanie', 'bandana', 'cap', 'straw'] as const);
  if (L.hat === 'goggles' && chance(0.2)) L.patch = true;
  if (L.hat === 'souwester') L.hatCol = YELLOW;
  if (L.hat === 'straw') L.hatCol = STRAW;
  if (L.hat === 'ranger') L.hatCol = KHAKI;
  if (L.hat === 'hood') L.hatCol = pick([M.navy, M.redp, M.trawl]);
  if (L.hat === 'beanie' || L.hat === 'bandana') L.hatCol = pick([M.redp, M.navy, COATS[2], COATS[3], M.orange, COATS[6]]);
  if (L.hat === 'cap' || L.hat === 'big-cap') L.hatCol = M.navy;
  if (has(/chart|surveyor|record|naturalist|collector/)) L.glasses = L.glasses || chance(0.6);
  if (has(/parrot/)) L.parrot = true;
  return L;
}

const H0 = 6, H1 = 12;                 // the head: 7 wide (-3..3), from z 6 to 12; the face looks south (+v)
/** Builds the bust for a look; frame 0 is the face at rest, 1 has the eyes shut, 2 the mouth open. */
export function bust(L: Look, frame: 0 | 1 | 2): Vox {
  const V = new Vox(-7, 7, -6, 6, 19);
  if (L.parrot) return parrot(V, frame);
  const skin = SKIN[L.skin], hair = HAIR[L.hair];
  // shoulders and chest, a shirt showing at the neck, stripes on a sailor's jumper
  for (let z = 0; z <= 4; z++) for (let v = -2; v <= 2; v++) for (let u = -5; u <= 5; u++) {
    if (Math.abs(u) > 5 - Math.max(0, z - 2)) continue;
    V.set(u, v, z, L.stripes && z % 2 === 0 ? M.white : L.coat);
  }
  V.box(-1, 1, 2, 2, 3, 4, L.shirt); V.set(0, 2, 2, L.shirt);
  V.box(-1, 1, -1, 1, 5, 5, skin);
  // the head, corners rounded off
  for (let z = H0; z <= H1; z++) for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) {
    const edge = (Math.abs(u) === 3 ? 1 : 0) + (Math.abs(v) === 3 ? 1 : 0) + (z === H0 || z === H1 ? 1 : 0);
    if (edge < 2) V.set(u, v, z, skin);
  }
  V.set(-4, 0, 8, skin); V.set(4, 0, 8, skin); V.set(-4, 0, 9, skin); V.set(4, 0, 9, skin);   // ears
  // the face: eyes (shut on the blink frame), a nose, a mouth (open while talking), and maybe brows and blush
  const eye = frame === 1 ? LID : EYE;
  V.set(-1, 3, 9, eye); V.set(1, 3, 9, eye);
  if (L.patch) { V.set(1, 3, 9, M.iron); V.set(1, 3, 10, M.iron); V.line([2, 3, 10], [3, 1, 11], M.iron); V.line([-3, 1, 11], [-2, 3, 10], M.iron); }
  V.set(0, 4, 8, skin);
  V.set(0, 3, 7, frame === 2 ? M.iron : LIP);
  if (frame === 2) V.set(0, 3, 6, LIP); else { V.set(-1, 3, 7, skin); V.set(1, 3, 7, skin); }
  if (L.brows) { V.set(-1, 3, 10, hair); V.set(1, 3, 10, hair); }
  if (L.blush) { V.set(-2, 3, 8, BLUSH); V.set(2, 3, 8, BLUSH); }
  // hair
  const top = L.style !== 'bald';
  if (top) { V.box(-3, 3, -3, 3, H1 + 1, H1 + 1, hair); V.box(-2, 2, 3, 3, H1, H1, hair); }
  V.box(-3, 3, -4, -4, L.style === 'long' ? 5 : 8, H1, hair);                      // the back
  for (const s of [-4, 4]) V.box(s, s, -3, L.style === 'crop' ? -1 : 1, L.style === 'long' ? 5 : L.style === 'bald' ? 9 : 10, top ? H1 : 10, hair);
  if (L.style === 'bun') V.box(-1, 1, -2, 0, H1 + 2, H1 + 3, hair);
  if (L.style === 'tail') { V.box(0, 0, -5, -5, 7, 11, hair); V.set(0, -4, 11, M.redp); }
  if (L.style === 'long') { V.box(-4, -4, 2, 2, 6, 10, hair); V.box(4, 4, 2, 2, 6, 10, hair); }
  // beard or moustache
  if (L.beard === 'beard') {
    V.box(-3, 3, 3, 3, H0, 7, hair); V.box(-3, -3, 1, 3, H0, 8, hair); V.box(3, 3, 1, 3, H0, 8, hair); V.box(-2, 2, 2, 4, H0 - 1, H0 - 1, hair);
    V.set(0, 3, 7, frame === 2 ? M.iron : LIP); V.set(-1, 4, 7, hair); V.set(1, 4, 7, hair);
  } else if (L.beard === 'moustache') { V.set(-1, 4, 7, hair); V.set(1, 4, 7, hair); V.set(-2, 4, 7, hair); V.set(2, 4, 7, hair); }
  if (L.glasses) { for (const u of [-2, -1, 0, 1, 2]) if (u !== -1 && u !== 1) V.set(u, 4, 9, M.iron); V.set(-1, 4, 10, M.iron); V.set(1, 4, 10, M.iron); }
  if (L.earring) V.set(-4, 0, 7, M.gilt);
  if (L.pipe) { V.set(1, 4, 7, WOOD); V.set(2, 5, 7, WOOD); V.box(3, 3, 5, 5, 7, 8, WOOD); }
  if (L.scarf) { V.box(-3, 3, -3, 3, 5, 5, L.scarf); V.box(1, 1, 3, 3, 2, 4, L.scarf); }
  hat(V, L);
  return V;
}

function hat(V: Vox, L: Look): void {
  const c = L.hatCol, T = H1 + 1;
  switch (L.hat) {
    case 'cap': case 'big-cap': {
      const big = L.hat === 'big-cap' ? 1 : 0;
      V.box(-3 - big, 3 + big, -3 - big, 3 + big, T, T, c); V.box(-3 - big, 3 + big, -4 - big, 3 + big, T + 1, T + 1 + big, M.white);
      V.box(-3, 3, 4, 5 + big, T, T, M.iron); V.set(0, 4, T + 1, M.gilt);
      break;
    }
    case 'beanie':
      V.box(-4, 4, -4, 4, T - 1, T - 1, c); V.box(-3, 3, -3, 3, T, T + 2, c); V.box(-2, 2, -2, 2, T + 3, T + 3, c); V.set(0, 0, T + 4, M.white);
      break;
    case 'souwester':
      V.box(-5, 5, -5, 5, T - 1, T - 1, c); V.box(-3, 3, -3, 3, T, T + 2, c); V.box(-4, 4, -6, -5, T - 3, T - 1, c);
      break;
    case 'straw':
      for (let v = -6; v <= 6; v++) for (let u = -6; u <= 6; u++) if (Math.hypot(u, v) <= 6.3) V.set(u, v, T - 1, c);
      V.box(-3, 3, -3, 3, T, T + 2, c); V.box(-3, 3, 3, 3, T, T, M.redp); V.box(-3, 3, -3, -3, T, T, M.redp);
      break;
    case 'ranger':
      V.box(-5, 5, -5, 5, T - 1, T - 1, c); V.box(-3, 3, -3, 3, T, T + 2, c); V.box(-3, 3, -3, 3, T, T, M.wet); V.box(-1, 1, -3, 3, T + 2, T + 2, 0);
      V.box(-3, 3, -1, 1, T + 3, T + 3, c);
      break;
    case 'bandana':
      V.box(-4, 4, -4, 4, T - 2, T - 1, c); V.box(-3, 3, -3, 3, T, T, c); V.set(0, -5, T - 2, c); V.set(-1, -6, T - 3, c); V.set(1, -6, T - 3, c);
      break;
    case 'mask':
      V.box(-3, 3, 4, 4, 9, 10, GLASS); V.box(-4, 4, 4, 4, 11, 11, M.iron); V.box(-4, 4, 4, 4, 8, 8, M.iron); V.box(-4, -4, 4, 4, 9, 10, M.iron); V.box(4, 4, 4, 4, 9, 10, M.iron);
      V.box(-4, 4, -4, 3, 10, 10, M.iron); V.box(5, 5, 2, 2, 8, 15, M.orange); V.set(4, 3, 8, M.orange);
      break;
    case 'goggles':
      V.box(-4, 4, -4, 4, 11, 11, M.wet); V.set(-2, 4, 11, GLASS); V.set(-1, 4, 11, GLASS); V.set(1, 4, 11, GLASS); V.set(2, 4, 11, GLASS); V.set(0, 4, 11, M.copper);
      if (L.style === 'bald' || L.hair === 'white') V.box(-3, 3, -3, 3, T, T, M.redp);
      break;
    case 'miner':
      V.box(-4, 4, -4, 4, T - 1, T - 1, YELLOW); V.box(-3, 3, -3, 3, T, T + 2, YELLOW); V.box(-1, 1, 4, 4, T, T + 1, M.iron); V.set(0, 5, T, M.lamp); V.set(0, 5, T + 1, M.lamp);
      break;
    case 'hood':
      for (let z = H0; z <= T + 1; z++) for (let v = -4; v <= 3; v++) for (let u = -4; u <= 4; u++) {
        const out = Math.abs(u) === 4 || v === -4 || z >= T;
        if (out && !(Math.abs(u) === 4 && v === -4)) V.set(u, v, z, c);
      }
      for (let z = H0; z <= T; z++) { V.set(-4, 4, z, FUR); V.set(4, 4, z, FUR); }
      V.box(-4, 4, 4, 4, T, T + 1, FUR);
      break;
  }
}

/** Pip and friends: a parrot, green with a red face and a hooked beak. */
function parrot(V: Vox, frame: 0 | 1 | 2): Vox {
  for (let z = 0; z <= 6; z++) for (let v = -2; v <= 2; v++) for (let u = -3; u <= 3; u++) if (Math.hypot(u * 0.9, v * 1.2, (z - 3) * 0.7) < 3.4) V.set(u, v, z, GREEN);
  V.box(-4, -4, -1, 1, 1, 5, M.navy); V.box(4, 4, -1, 1, 1, 5, M.navy);         // wings
  for (let z = 7; z <= 12; z++) for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) if (Math.hypot(u, v, (z - 9.5) * 1.1) < 3.4) V.set(u, v, z, GREEN);
  V.box(-3, 3, 2, 3, 8, 11, PARROT_FACE); V.box(-1, 1, -4, -4, 12, 14, YELLOW);   // face, a crest behind
  const eye = frame === 1 ? PARROT_FACE : M.iron;
  V.set(-2, 3, 10, M.white); V.set(-2, 4, 10, eye); V.set(2, 3, 10, M.white); V.set(2, 4, 10, eye);
  V.box(-1, 1, 4, 4, 8, 9, BEAK); V.set(0, 5, 8, BEAK); V.set(0, 5, 7, frame === 2 ? M.iron : BEAK);
  return V;
}

/**
 * A portrait is seen nearly face-on, not from the world's high camera: each voxel is a 2 x 2 pixel block, shifted down
 * a pixel per two steps toward the viewer so the tops of things show as a thin ledge. A voxel is lit if nothing is
 * above it, mid-toned if nothing is in front, dark otherwise; then a one-pixel ink outline around the whole figure.
 */
function frontURL(V: Vox): string {
  const S = 2, nu = V.nu, nv = V.nv, nz = V.nz, w = nu * S + 2, h = nz * S + (nv >> 1) + 2;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!, im = g.createImageData(w, h), d = im.data;
  for (let vi = 0; vi < nv; vi++) for (let z = 0; z < nz; z++) for (let ui = 0; ui < nu; ui++) {    // back to front, bottom to top
    const u = ui + V.u0, v = vi + V.v0, m = V.get(u, v, z);
    if (!m) continue;
    const tone = EMISSIVE.has(m) || !V.get(u, v, z + 1) ? 2 : !V.get(u, v + 1, z) ? 1 : 0, c = RGB[m][tone];
    const x0 = 1 + ui * S, y0 = 1 + (nz - 1 - z) * S + (vi >> 1);
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) { const o = (y * w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
  }
  // the ink outline, and a crop to the figure
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] === 255;
  const ink: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) ink.push(y * w + x);
  for (const k of ink) { d[k * 4] = 27; d[k * 4 + 1] = 42; d[k * 4 + 2] = 51; d[k * 4 + 3] = 254; }
  g.putImageData(im, 0, 0);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, s = Math.max(cw, ch), o = document.createElement('canvas');
  o.width = s; o.height = s;
  o.getContext('2d')!.drawImage(cv, x0, y0, cw, ch, Math.floor((s - cw) / 2), s - ch, cw, ch);   // standing on the bottom edge
  return o.toDataURL();
}

const urls = new Map<string, string>();
/** The three frames of a portrait, as data URLs (made once). */
export function faceFrames(L: Look, key: string): [string, string, string] {
  return [0, 1, 2].map(f => { const k = key + '#' + f; let u = urls.get(k); if (!u) urls.set(k, u = frontURL(bust(L, f as 0 | 1 | 2))); return u; }) as [string, string, string];
}

// the main cast keep the looks they've always had
const CAST: Record<string, Partial<Look>> = {
  maren: { coat: M.navy, hat: 'cap', hatCol: M.navy, hair: 'black', style: 'short', beard: 'none', glasses: false, patch: false, pipe: false },
  ida: { coat: COATS[2], hat: 'none', skin: 1, hair: 'dark', style: 'bun', glasses: true, beard: 'none', pipe: false },
  tobias: { coat: M.coat, hat: 'souwester', hatCol: YELLOW, hair: 'grey', beard: 'beard', pipe: true },
  wren: { coat: M.gun, hat: 'ranger', hatCol: KHAKI, hair: 'auburn', style: 'tail', beard: 'none', glasses: true },
  nell: { coat: M.stone, hat: 'none', hair: 'white', style: 'bun', beard: 'none', glasses: true, scarf: M.redp, pipe: false },
};

/** Someone's look and portrait key: the main cast (by id, or met again by name and role in a story pack) keep theirs. */
export function lookOf(name: string, role: string, who?: string): [Look, string] {
  who ??= Object.entries(PEOPLE).find(([, p]) => p.name === name && p.role === role)?.[0];
  const key = who ?? name + '|' + role;
  return [{ ...lookFor(name, role, key), ...(who ? CAST[who] : {}) }, key];
}
/**
 * A portrait in a medallion: the person blinks every few seconds and, while `talking`, moves their mouth for a moment
 * (a new `line` starts it again). `who` is a main cast id; anyone else is drawn from their name and role.
 */
export function Face({ name, role, who, size = 'm', talking = false, line }: { name: string; role: string; who?: string; size?: 's' | 'm' | 'l'; talking?: boolean; line?: string }) {
  const [L, key] = lookOf(name, role, who);
  const [rest, blink, talk] = faceFrames(L, key), delay = -(hashStr(key) % 4000) / 1000;
  return (
    <span class={'face face-' + size} style={{ '--hue': L.hue } as Record<string, number>} aria-hidden="true">
      <img src={rest} alt="" />
      <img class="blink" src={blink} alt="" style={{ animationDelay: `${delay}s` }} />
      {talking && <img key={line} class="mouth" src={talk} alt="" />}
    </span>
  );
}
