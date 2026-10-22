// Procedural sound design on the Web Audio API.
// Everything is synthesised from filtered noise, damped sines and physically-modelled bubbles
// (a sine whose pitch rises as it decays), mixed through a gentle compressor with a shared reverb send.
// Pitched sounds are voiced on the chord the music is playing, so nothing ever clashes with it.
import { compose, restAfter, rng, type MusicEvent, type Piece } from './music';

type Bus = 'sfx' | 'music' | 'amb';
type NoiseColor = 'white' | 'pink' | 'brown';
/** Semitones from C4 of a triad, e.g. [9, 12, 16] for A minor. */
type Chord = readonly number[];

/** The shared mix graph. Rebuilt into an OfflineAudioContext by renderOffline(). */
interface Graph {
  dry: GainNode;
  revIn: GainNode;
  /** music voices enter here: wow/flutter, lowpass, then the ducker */
  tapeIn: GainNode;
  duck: GainNode;
  bus: Record<Bus, GainNode>;
}

const BUSES: readonly Bus[] = ['sfx', 'music', 'amb'];
const VOL: Record<Bus, number> = { sfx: 0.8, music: 0.6, amb: 0.8 };
let ac: AudioContext | null = null;
let graph: Graph | null = null;
let curBus: Bus = 'sfx';

export function setVolumes(v: Partial<Record<Bus, number>>): void {
  Object.assign(VOL, v);
  if (graph) for (const k of BUSES) graph.bus[k].gain.value = VOL[k];
  wake();
}
// with every volume at zero the graph (reverb, loops) would still run for nothing: sleep until a volume comes back
let tabHidden = false;
const silent = (): boolean => BUSES.every(k => VOL[k] <= 0);
function wake(): void {
  if (!ac) return;
  if (tabHidden || silent()) ac.suspend().catch(() => { }); else resume(ac);
}

// Safari before 14.1 only has the prefixed constructor
type LegacyWindow = Window & { webkitAudioContext?: typeof AudioContext };

// iOS refuses to start audio outside a tap, or while a call or another app holds the speaker ("Failed to start the
// audio device"); that's expected, so it is swallowed and the next tap tries again
const resume = (c: AudioContext): void => { c.resume().catch(() => { }); };

/** Pause all sound while the tab is hidden, and pick it back up when it returns. */
export function suspendAudio(hidden: boolean): void {
  tabHidden = hidden;
  wake();
}
export function unlockAudio(): void {
  if (ac) {
    if (ac.state !== 'running' && !silent()) resume(ac);
    return;
  }
  try {
    const Ctor = window.AudioContext || (window as LegacyWindow).webkitAudioContext;
    ac = new Ctor();
    graph = buildGraph(ac, ac.destination);
    startLoops(ac, graph);
    wake();
  } catch {
    ac = null;
  }
}

function buildGraph(ctx: BaseAudioContext, dest: AudioNode): Graph {
  // glue, not a pump: soft knee, low ratio, an attack slow enough to let transients through and a long release
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.012;
  comp.release.value = 0.4;
  // a little low-mid warmth and a high shelf that takes the fizz off everything
  const warm = ctx.createBiquadFilter(), soft = ctx.createBiquadFilter();
  warm.type = 'peaking'; warm.frequency.value = 260; warm.Q.value = 0.7; warm.gain.value = 2;
  soft.type = 'highshelf'; soft.frequency.value = 4500; soft.gain.value = -5;
  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(warm).connect(soft).connect(comp).connect(dest);
  const dry = ctx.createGain();
  dry.gain.value = 1.5;
  dry.connect(master);

  const makeBus = (k: Bus) => {
    const g = ctx.createGain();
    g.gain.value = VOL[k];
    g.connect(dry);
    return g;
  };
  const bus: Record<Bus, GainNode> = { sfx: makeBus('sfx'), music: makeBus('music'), amb: makeBus('amb') };

  const conv = ctx.createConvolver();
  conv.buffer = impulse(ctx, 2.6, 2.2);
  const revIn = ctx.createGain(), wet = ctx.createGain();
  wet.gain.value = 0.32;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 220;
  revIn.connect(hp).connect(conv).connect(wet).connect(master);

  // lo-fi tape on the music: voices -> wow/flutter delay line -> soft lowpass -> duck -> bus.music (volume) -> dry + one reverb send.
  // Pitch deviation of a modulated delay is d'(t) = 2*pi*f*depth: 0.5 ms at 0.5 Hz ~ 2.7 cents of wow,
  // 0.25 ms at 0.31 Hz ~ 0.8 cents of drift (so the wobble never repeats exactly), 20 us at 6 Hz ~ 1.3 cents of flutter.
  const tapeIn = ctx.createGain(), wob = ctx.createDelay(0.05), tlp = ctx.createBiquadFilter(), send = ctx.createGain();
  wob.delayTime.value = 0.006;
  for (const [hz, depth] of [[0.5, 0.0005], [0.31, 0.00025], [6, 0.00002]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = hz;
    g.gain.value = depth;
    o.connect(g).connect(wob.delayTime);
    o.start();
  }
  tlp.type = 'lowpass'; tlp.frequency.value = 7000; tlp.Q.value = 0;   // tape warmth without dulling the piano
  const duck = ctx.createGain();                                  // dips the music under sound effects, see duckMusic()
  send.gain.value = 0.55;                                         // what each music voice used to send on its own
  tapeIn.connect(wob).connect(tlp).connect(duck).connect(bus.music);
  bus.music.connect(send).connect(revIn);
  return { dry, revIn, tapeIn, duck, bus };
}

function wiring(): Graph {
  if (!graph) throw new Error('audio graph not built');
  return graph;
}

function impulse(ctx: BaseAudioContext, secs: number, decay: number): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return b;
}

// three seconds of each noise colour, made once per context
const noiseBufs = new Map<string, { ctx: BaseAudioContext; b: AudioBuffer }>();
function noise(ctx: BaseAudioContext, kind: NoiseColor): AudioBuffer {
  const key = kind + ctx.sampleRate, hit = noiseBufs.get(key);
  if (hit && hit.ctx === ctx) return hit.b;
  const n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let l = 0, p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') {
      l = (l + 0.02 * w) / 1.02;
      d[i] = l * 3.5;
    } else if (kind === 'pink') {
      p0 = 0.997 * p0 + w * 0.029591;
      p1 = 0.985 * p1 + w * 0.032534;
      p2 = 0.95 * p2 + w * 0.048056;
      d[i] = (p0 + p1 + p2 + w * 0.05) * 2.2;
    } else d[i] = w * 0.6;
  }
  noiseBufs.set(key, { ctx, b });
  return b;
}

// ---------- harmony shared by the music and every pitched sound ----------
// Pitched effects are voiced on the chord the music is currently on (music.ts sends each chord change), so rewards and UI
// blips land inside the harmony instead of against it; between pieces they keep the last one.
let harmony: Chord = [0, 4, 7];
const N = (s: number) => 440 * Math.pow(2, (s - 9) / 12);       // semitones from C4 → Hz (0 = C4)
// the i-th note of the current chord counting up (0 root, 1 third, 2 fifth, 3 root an octave up, -1 fifth below...).
// The root sits within a fifth of C in octave `oct` (G and A drop an octave), so every chord keeps the sound in the same register.
const chordNote = (i: number, oct = 4) =>
  N(12 * (oct - 4) + harmony[((i % 3) + 3) % 3] + 12 * Math.floor(i / 3) - (harmony[0] >= 7 ? 12 : 0));

// ---------- voice helpers (all take the context explicitly so they can render offline for tests) ----------
/** A silent gain feeding the current bus (music goes through the tape), with optional pan and reverb send. */
function out(ctx: BaseAudioContext, pan: number, rev: number): GainNode {
  const { bus, tapeIn, dry, revIn } = wiring();
  const g = ctx.createGain();
  g.gain.value = 0;
  let node: AudioNode = g;
  if (pan && 'createStereoPanner' in ctx) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    node = p;
  }
  const tape = curBus === 'music';                               // the tape has its own reverb send
  node.connect(tape ? tapeIn : bus[curBus] || dry);
  if (rev && !tape) {
    const s = ctx.createGain();
    s.gain.value = rev * VOL[curBus];
    node.connect(s).connect(revIn);
  }
  return g;
}

// every voice ramps in (2 ms at the very least, so nothing clicks) and decays exponentially
function envelope(g: GainNode, t: number, a: number, d: number, peak: number, hold = 0): void {
  a = Math.max(a, 0.002);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold) g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}

interface ToneOpts {
  f: number;
  /** pitch to glide to by the end of the decay */
  f1?: number;
  t?: number; a?: number; d?: number; hold?: number; vol?: number;
  type?: OscillatorType; pan?: number; rev?: number;
  /** lowpass cutoff, Hz */
  lp?: number;
}
function tone(ctx: BaseAudioContext, { f, f1, t = 0, a = 0.005, d = 0.3, hold = 0, vol = 0.2, type = 'sine', pan = 0, rev = 0, lp }: ToneOpts): void {
  const t0 = ctx.currentTime + t, o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + a + hold + d);
  const g = out(ctx, pan, rev);
  envelope(g, t0, a, d, vol, hold);
  if (lp) {
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = lp;
    o.connect(fl).connect(g);
  } else o.connect(g);
  o.start(t0);
  o.stop(t0 + Math.max(a, 0.002) + hold + d + 0.05);
}

interface HissOpts {
  t?: number; a?: number; d?: number; hold?: number; vol?: number;
  /** filter type over the noise */
  type?: BiquadFilterType;
  f?: number; f1?: number; q?: number;
  color?: NoiseColor; pan?: number; rev?: number;
}
function hiss(ctx: BaseAudioContext, { t = 0, a = 0.01, d = 0.2, hold = 0, vol = 0.2, type = 'bandpass', f = 1000, f1, q = 1, color = 'white', pan = 0, rev = 0 }: HissOpts): void {
  const t0 = ctx.currentTime + t, s = ctx.createBufferSource();
  s.buffer = noise(ctx, color);
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  const fl = ctx.createBiquadFilter();
  fl.type = type;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(f, t0);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t0 + a + hold + d);
  const g = out(ctx, pan, rev);
  envelope(g, t0, a, d, vol, hold);
  s.connect(fl).connect(g);
  s.start(t0, Math.random() * 2);
  s.stop(t0 + Math.max(a, 0.002) + hold + d + 0.05);
}

// a bubble: short sine whose pitch rises as it decays (Minnaert resonance); rise = 2 makes a tuned bubble that ends an octave up
const bubble = (ctx: BaseAudioContext, t: number, f: number, vol: number, dur = 0.06, pan = 0, rise = 1.6 + Math.random() * 0.6) =>
  tone(ctx, { f, f1: f * rise, t, a: 0.003, d: dur, vol, pan, rev: 0.12 });

// soft mallet: rounded attack, a warm octave partial and a faint marimba overtone that dies fast
const mallet = (ctx: BaseAudioContext, f: number, t: number, vol: number, d = 0.6, rev = 0.3) => {
  tone(ctx, { f, t, a: 0.006, d, vol, rev });
  tone(ctx, { f: f * 2, t, a: 0.004, d: d * 0.4, vol: vol * 0.12, rev });
  tone(ctx, { f: f * 3.98, t, a: 0.003, d: d * 0.12, vol: vol * 0.07, rev });
};

/** uniform random in [a, b) */
const r = (a: number, b: number) => a + Math.random() * (b - a);

/** A sound effect: `v` scales its volume, `p` pans it (-1 left .. 1 right). */
type Recipe = (c: BaseAudioContext, v: number, p: number) => void;

const SFX = {
  oar: (c, v, p) => {                                            // blade dips, pulls, then a trickle of bubbles; every stroke, so soft and dark
    hiss(c, { a: 0.04, d: 0.32, vol: 0.12 * v, f: 1000, f1: 360, q: 0.8, color: 'pink', pan: p, rev: 0.1 });
    hiss(c, { t: 0.05, a: 0.08, d: 0.45, vol: 0.095 * v, type: 'lowpass', f: 380, color: 'brown', pan: p });
    for (let i = 0; i < 4; i++) bubble(c, r(0.05, 0.32), r(340, 700), 0.035 * v, r(0.035, 0.07), p);
  },
  splash: (c, v, p) => {
    hiss(c, { a: 0.02, d: 0.55, vol: 0.17 * v, f: 1400, f1: 450, q: 0.7, color: 'pink', pan: p, rev: 0.15 });
    for (let i = 0; i < 6; i++) bubble(c, r(0.05, 0.4), r(250, 700), 0.03 * v, r(0.04, 0.09), p);
  },
  crash: (c, v, p) => {                                          // hull hits rock: thud + wood knock + spray
    tone(c, { f: 110, f1: 46, a: 0.006, d: 0.4, vol: 0.29 * v, pan: p });
    tone(c, { f: r(180, 200), a: 0.003, d: 0.22, vol: 0.075 * v, type: 'triangle', lp: 800, pan: p, rev: 0.1 });
    tone(c, { f: r(290, 320), a: 0.003, d: 0.16, vol: 0.045 * v, type: 'triangle', lp: 800, pan: p });
    hiss(c, { a: 0.003, d: 0.05, vol: 0.06 * v, f: 1600, q: 0.8, pan: p });
    hiss(c, { t: 0.03, a: 0.03, d: 0.5, vol: 0.1 * v, f: 1100, f1: 400, q: 0.7, color: 'pink', pan: p, rev: 0.2 });
  },
  slap: (c, v, p) => {                                           // two hulls meet: a flat wet smack, a hollow knock, water sloshing between
    hiss(c, { a: 0.001, d: 0.07, vol: 0.2 * v, f: 2400, f1: 900, q: 0.9, pan: p });
    tone(c, { f: r(230, 260), f1: 150, a: 0.002, d: 0.14, vol: 0.12 * v, type: 'triangle', lp: 1200, pan: p, rev: 0.12 });
    tone(c, { f: 90, f1: 60, a: 0.004, d: 0.18, vol: 0.12 * v, pan: p });
    hiss(c, { t: 0.04, a: 0.03, d: 0.35, vol: 0.07 * v, f: 900, f1: 380, q: 0.7, color: 'pink', pan: p, rev: 0.2 });
  },
  scrape: (c, v, p) => {
    hiss(c, { a: 0.05, d: 0.35, hold: 0.1, vol: 0.055 * v, f: 480, f1: 360, q: 2, color: 'pink', pan: p });
    tone(c, { f: 70, a: 0.05, d: 0.3, vol: 0.075 * v, pan: p });
  },
  coin: (c, v) => {
    mallet(c, chordNote(2, 5), 0, 0.085 * v, 0.4, 0.25);
    mallet(c, chordNote(3, 5), 0.075, 0.08 * v, 0.6, 0.3);
  },
  cast: (c, v) => {                                              // a soft whoosh of the rod, then the line ticking off the spool
    hiss(c, { a: 0.07, d: 0.3, vol: 0.1 * v, f: 1500, f1: 450, q: 1, color: 'pink', rev: 0.1 });
    for (let i = 0; i < 6; i++) hiss(c, { t: 0.03 + i * 0.04, a: 0.002, d: 0.014, vol: 0.014 * v * (1 - i / 8), f: 2200, q: 3 });
  },
  plop: (c, v) => {
    bubble(c, 0, chordNote(2, 3), 0.125 * v, 0.09, 0, 2);
    hiss(c, { a: 0.006, d: 0.14, vol: 0.032 * v, type: 'lowpass', f: 800, color: 'pink' });
    bubble(c, 0.08, chordNote(3, 4), 0.03 * v, 0.06, 0, 2);
  },
  nibble: (c, v, p) => {                                         // the bobber tested: one tiny plip and a tick, never quite the same twice
    const k = v * r(0.75, 1), f = chordNote([2, 3, 4][Math.floor(Math.random() * 3)], 4);
    bubble(c, 0, f, 0.06 * k, r(0.025, 0.04), p + r(-0.1, 0.1), r(1.4, 1.9));
    hiss(c, { a: 0.002, d: 0.018, vol: 0.016 * k, f: r(1700, 2300), q: 2, pan: p });
  },
  bite: (c, v, p) => {                                           // the bobber pulled under: a deep plunk dropping an octave, a splash, a bubble after
    tone(c, { f: chordNote(3, 3), f1: chordNote(0, 3), a: 0.004, d: 0.16, vol: 0.17 * v, pan: p });
    tone(c, { f: 140, f1: 70, a: 0.004, d: 0.12, vol: 0.08 * v, pan: p });
    hiss(c, { a: 0.008, d: 0.3, vol: 0.09 * v, f: 1300, f1: 480, q: 0.8, color: 'pink', pan: p, rev: 0.15 });
    bubble(c, 0.09, chordNote(1, 4), 0.06 * v, 0.06, p, 2);
  },
  creak: (c, v, p) => {                                          // the rod bending before a surge: a low wooden groan and a rubbing creak, both rising
    tone(c, { f: 46, f1: 54, a: 0.08, hold: 0.12, d: 0.25, vol: 0.045 * v, type: 'sawtooth', lp: 520, pan: p });
    hiss(c, { a: 0.1, hold: 0.08, d: 0.25, vol: 0.035 * v, f: chordNote(0, 4), f1: chordNote(1, 4), q: 7, color: 'pink', pan: p });
  },
  // one ratchet click, ~14 a second: dull and quiet
  reel: (c, v) => hiss(c, { a: 0.002, d: 0.02, vol: 0.22 * v * r(0.8, 1), f: r(1500, 1800), q: 1.2 }),
  catch: (c, v) => {
    SFX.splash(c, 0.7 * v, 0);
    for (let i = 0; i < 4; i++) mallet(c, chordNote(i, 5), 0.12 + i * 0.09, 0.09 * v, 0.7, 0.35);
  },
  snap: (c, v) => {
    tone(c, { f: 1100, f1: 150, a: 0.003, d: 0.22, vol: 0.13 * v, type: 'triangle', lp: 1800 });
    hiss(c, { a: 0.002, d: 0.03, vol: 0.07 * v, f: 2200, q: 0.8 });
  },
  move: (c, v) => {
    tone(c, { f: chordNote(3, 4), a: 0.004, d: 0.07, vol: 0.048 * v });
    tone(c, { f: chordNote(3, 5), a: 0.003, d: 0.025, vol: 0.01 * v });
  },
  select: (c, v) => {
    mallet(c, chordNote(2, 4), 0, 0.063 * v, 0.3, 0.2);
    mallet(c, chordNote(3, 4), 0.06, 0.063 * v, 0.4, 0.25);
  },
  deny: (c, v) => {                                              // a low, muted "uh-oh": two chord tones falling a third, rounded, never a buzz
    for (const [i, t, d, k] of [[2, 0, 0.14, 1], [1, 0.11, 0.22, 0.85]]) {
      tone(c, { f: chordNote(i, 3), t, a: 0.012, d, vol: 0.066 * v * k, lp: 600 });
      tone(c, { f: chordNote(i, 3), t, a: 0.012, d: d * 0.7, vol: 0.022 * v * k, type: 'triangle', lp: 500 });
    }
  },
  fanfare: (c, v) => {
    for (let i = 0; i < 4; i++) mallet(c, chordNote(i, 5), i * 0.1, 0.09 * v, 0.8, 0.35);
    for (const i of [0, 2, 4]) tone(c, { f: chordNote(i, 4), t: 0.3, a: 0.3, d: 1.3, vol: 0.03 * v, type: 'triangle', lp: 1400, rev: 0.4 });
  },
  stinger: (c, v) => {                                           // a big moment, gentler than the fanfare: root, fifth, octave, landing on the high third, over a shimmer
    [0, 2, 3].forEach((i, k) => mallet(c, chordNote(i, 4), k * 0.08, 0.07 * v, 0.6, 0.35));
    mallet(c, chordNote(4, 4), 0.3, 0.08 * v, 1.1, 0.45);
    for (const [i, t] of [[0, 0.3], [1, 0.4], [2, 0.52]]) tone(c, { f: chordNote(i, 6), t, a: 0.004, d: 0.5, vol: 0.012 * v, rev: 0.6 });
    hiss(c, { t: 0.25, a: 0.15, d: 0.7, vol: 0.012 * v, f: 5200, q: 1.5, rev: 0.5 });
  },
  glint: (c, v, p) => {                                          // a rare school catching the light: two faint high chime notes, up or down
    const [a, b] = Math.random() < 0.5 ? [3, 4] : [4, 3];
    for (const [i, t] of [[a, 0], [b, 0.07]]) {
      tone(c, { f: chordNote(i, 5), t, a: 0.002, d: 0.3, vol: 0.02 * v, pan: p, rev: 0.5 });
      tone(c, { f: chordNote(i, 5) * 3, t, a: 0.002, d: 0.08, vol: 0.004 * v, pan: p, rev: 0.5 });
    }
  },
  levelup: (c, v) => {
    for (let i = 0; i < 6; i++) mallet(c, chordNote(i, 4), i * 0.06, 0.068 * v, 0.5, 0.35);
    tone(c, { f: chordNote(6, 4), t: 0.36, a: 0.03, d: 0.9, vol: 0.025 * v, rev: 0.5 });
  },
  perfect: (c, v) => {                                           // a clear bell on the root, harmonic overtones
    for (const [m, k, d] of [[1, 1, 0.8], [2, 0.3, 0.45], [3, 0.1, 0.25]]) tone(c, { f: chordNote(3, 5) * m, a: 0.004, d, vol: 0.12 * v * k, rev: 0.4 });
  },
  sink: (c, v) => {
    for (let i = 0; i < 22; i++) bubble(c, i * 0.07 + r(0, 0.05), r(500, 900) * (1 - i / 30), 0.05 * v, r(0.05, 0.1));
    hiss(c, { a: 0.2, d: 1.4, vol: 0.18 * v, type: 'lowpass', f: 400, f1: 120, color: 'brown' });
  },
  discover: (c, v) => {
    [0, 2, 3, 4].forEach((i, k) => mallet(c, chordNote(i, 5), k * 0.13, 0.065 * v, 1, 0.5));
  },
  dock: (c, v) => {                                              // hull bumps the jetty: a soft low bump on the chord root, a short rope creak between chord tones
    tone(c, { f: chordNote(0, 3), f1: chordNote(0, 3) * 0.97, a: 0.008, d: 0.25, vol: 0.165 * v });
    hiss(c, { t: 0.06, a: 0.06, d: 0.32, vol: 0.03 * v, f: chordNote(2, 4), f1: chordNote(3, 4), q: 9 });
  },
  gulls: (c, v) => {
    for (let k = 0; k < 3; k++) {
      const t0 = c.currentTime + k * r(0.22, 0.35);
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter();
      const g = out(c, r(-0.6, 0.6), 0.35);
      o.type = 'triangle';
      o.frequency.setValueAtTime(1150, t0);
      o.frequency.linearRampToValueAtTime(1900, t0 + 0.06);
      o.frequency.exponentialRampToValueAtTime(1250, t0 + 0.26);
      lfo.frequency.value = 32;
      lg.gain.value = 70;
      lfo.connect(lg).connect(o.frequency);
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 2;
      envelope(g, t0, 0.03, 0.25, 0.05 * v);
      o.connect(bp).connect(g);
      o.start(t0); lfo.start(t0);
      o.stop(t0 + 0.35); lfo.stop(t0 + 0.35);
    }
  },
  purr: (c, v, p) => {                                           // an out-breath, then a softer in-breath
    const t0 = c.currentTime;
    purrBreath(c, t0, 0.62, 0.06 * v, 26, 650, p);
    purrBreath(c, t0 + 0.68, 0.52, 0.04 * v, 23, 520, p);
  },
  meow: (c, v, p) => {                                           // soft "mi-a-ow": a voiced glide through moving formants
    const t0 = c.currentTime, T = 0.55, vol = 0.09 * v;
    const o = c.createOscillator(), vib = c.createOscillator(), vg = c.createGain(), open = c.createBiquadFilter(), g = out(c, p, 0.12);
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(600, t0);
    o.frequency.exponentialRampToValueAtTime(900, t0 + 0.17);
    o.frequency.exponentialRampToValueAtTime(500, t0 + T);
    vib.frequency.value = 6;
    vg.gain.value = 8;
    vib.connect(vg).connect(o.frequency);
    open.type = 'lowpass'; open.Q.value = 0;                     // lips: closed "m", open "a", rounding to "ow"
    open.frequency.setValueAtTime(700, t0);
    open.frequency.exponentialRampToValueAtTime(2600, t0 + 0.08);
    open.frequency.exponentialRampToValueAtTime(1400, t0 + T);
    o.connect(open);
    const formants: [[number, number, number], number, number][] = [[[380, 950, 520], 4, 1], [[1900, 1500, 950], 6, 0.4]];
    for (const [[f0, f1, f2], q, k] of formants) {
      const bp = c.createBiquadFilter(), bg = c.createGain();
      bp.type = 'bandpass'; bp.Q.value = q; bg.gain.value = k;
      bp.frequency.setValueAtTime(f0, t0);
      bp.frequency.exponentialRampToValueAtTime(f1, t0 + 0.16);
      bp.frequency.exponentialRampToValueAtTime(f2, t0 + T);
      open.connect(bp).connect(bg).connect(g);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.05);
    g.gain.setValueAtTime(vol, t0 + 0.22);
    g.gain.linearRampToValueAtTime(vol * 0.6, t0 + 0.4);
    g.gain.linearRampToValueAtTime(0, t0 + T);
    hiss(c, { a: 0.04, d: 0.35, vol: 0.01 * v, f: 1700, q: 1.2, pan: p });   // a little breath
    o.start(t0); vib.start(t0);
    o.stop(t0 + T + 0.1); vib.stop(t0 + T + 0.1);
  },
  thunder: (c, v) => {                                           // a softened crack, then the long low roll
    hiss(c, { a: 0.02, d: 0.3, vol: 0.075 * v, f: 900, q: 0.6, rev: 0.4 });
    hiss(c, { t: 0.05, a: 0.25, d: 3.2, vol: 0.31 * v, type: 'lowpass', f: 600, f1: 80, color: 'brown', rev: 0.3 });
  },
  whale: (c, v, p) => {                                          // a distant humpback: a slow moan gliding between chord tones, mostly reverb
    const t0 = c.currentTime, T = r(2.2, 2.8), vol = 0.045 * v, g = out(c, p, 1.2);
    const o = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain(), lp = c.createBiquadFilter(), vib = c.createOscillator(), vg = c.createGain();
    const [lo, root, third] = [chordNote(-1, 3), chordNote(0, 3), chordNote(1, 3)];
    // [time, Hz]: sung on chord tones, short glides between them
    const path: [number, number][] = Math.random() < 0.5
      ? [[0, lo], [0.5, lo], [0.8, root], [1.4, root], [1.65, third], [T - 0.3, third], [T, lo]]
      : [[0, third], [0.6, third], [0.9, root], [1.5, root], [1.8, lo], [T, lo * 0.97]];
    for (const [osc, m] of [[o, 1], [o2, 2]] as const) {
      osc.frequency.setValueAtTime(path[0][1] * m, t0);
      for (const [at, f] of path.slice(1)) osc.frequency.exponentialRampToValueAtTime(f * m, t0 + at);
    }
    o.type = 'triangle';
    g2.gain.value = 0.35;
    vib.frequency.value = 4.5; vg.gain.value = 18;               // ±18 cents of slow vibrato
    vib.connect(vg);
    vg.connect(o.detune);
    vg.connect(o2.detune);
    lp.type = 'lowpass'; lp.frequency.value = 800; lp.Q.value = 2;   // a soft resonance, as if heard through water
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.4);
    g.gain.linearRampToValueAtTime(vol * 0.5, t0 + T * 0.55);
    g.gain.linearRampToValueAtTime(vol * 0.8, t0 + T * 0.7);
    g.gain.linearRampToValueAtTime(0, t0 + T);
    for (const osc of [o, o2, vib]) { osc.start(t0); osc.stop(t0 + T + 0.05); }
  },
  bigsplash: (c, v, p) => {                                      // a whale breaching or slapping its tail: deep, soft and wide
    tone(c, { f: 90, f1: 40, a: 0.015, d: 0.6, vol: 0.14 * v, pan: p });
    hiss(c, { a: 0.03, d: 1.1, vol: 0.2 * v, type: 'lowpass', f: 900, f1: 200, color: 'brown', pan: p, rev: 0.3 });
    hiss(c, { t: 0.02, a: 0.05, d: 0.8, vol: 0.08 * v, f: 1100, f1: 380, q: 0.6, color: 'pink', pan: p, rev: 0.35 });
    for (let i = 0; i < 8; i++) bubble(c, r(0.15, 0.9), r(150, 380), 0.025 * v, r(0.06, 0.12), p);
  },
} satisfies Record<string, Recipe>;

type SfxName = keyof typeof SFX;

// one breath of a purr: pink noise and a low sawtooth, both gated by narrow ~25 Hz pulses
function purrBreath(c: BaseAudioContext, t0: number, len: number, vol: number, hz: number, fc: number, p: number): void {
  const n = c.createBufferSource(), lp = c.createBiquadFilter(), saw = c.createOscillator(), slp = c.createBiquadFilter(), sg = c.createGain();
  const am = c.createGain(), lfo = c.createOscillator(), sh = c.createWaveShaper(), g = out(c, p, 0.04), end = t0 + len;
  n.buffer = noise(c, 'pink');
  n.loop = true;
  lp.type = 'lowpass'; lp.frequency.value = fc; lp.Q.value = 2;
  for (const o of [saw, lfo]) {
    o.frequency.setValueAtTime(hz, t0);
    o.frequency.linearRampToValueAtTime(hz * 1.06, end);
  }
  saw.type = 'sawtooth';
  slp.type = 'lowpass'; slp.frequency.value = 300;
  sg.gain.value = 0.4;
  const curve = new Float32Array(257);                           // sine -> narrow pulses 0..1
  for (let i = 0; i < 257; i++) curve[i] = Math.pow(i / 256, 4);
  sh.curve = curve;
  am.gain.value = 0.08;
  lfo.connect(sh).connect(am.gain);
  n.connect(lp).connect(am);
  saw.connect(slp).connect(sg).connect(am);
  am.connect(g);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.15);
  g.gain.setValueAtTime(vol, end - 0.2);
  g.gain.linearRampToValueAtTime(0, end);
  n.start(t0, Math.random() * 2);
  saw.start(t0);
  lfo.start(t0);
  for (const o of [n, saw, lfo]) o.stop(end + 0.05);
}

// short text for sounds that carry information, shown when captions are on
const CAPTION: Partial<Record<SfxName, string>> = {
  nibble: 'Bobber twitches', bite: 'Bobber splashes', creak: 'Rod creaks', glint: 'Something glints',
  snap: 'Line snaps', crash: 'Hull crunches', slap: 'Boats bump', scrape: 'Hull scrapes', thunder: 'Thunder rumbles',
  gulls: 'Gulls crying', sink: 'Boat sinking', discover: 'Bell rings', purr: 'Cat purring', meow: 'Cat meows',
  whale: 'Whale song', bigsplash: 'Big splash',
};
let onCaption: ((text: string) => void) | null = null;
export const setCaptionHook = (f: (text: string) => void): void => { onCaption = f; };

// how far and how long a sound pushes the music down: [gain, hold s]. Rapid little ticks never duck, that would pump.
const DUCK: Partial<Record<SfxName, [number, number]>> = {
  fanfare: [0.5, 1.3], stinger: [0.6, 1], levelup: [0.5, 0.9], discover: [0.5, 1.1], sink: [0.5, 1.2], catch: [0.56, 0.7],
  perfect: [0.56, 0.5], thunder: [0.56, 1.4], whale: [0.6, 1.8], bigsplash: [0.6, 0.6],
};
const NO_DUCK = new Set<SfxName>(['reel', 'move', 'oar', 'scrape', 'purr', 'gulls', 'plop', 'splash', 'nibble', 'glint']);
let duckEnd = 0;
// ~-4 to -6 dB in ~30 ms, held while the sound speaks, back over ~0.6 s
function duckMusic(ctx: AudioContext, name: SfxName): void {
  if (!graph || NO_DUCK.has(name)) return;
  const [depth, hold] = DUCK[name] ?? [0.63, 0.15], t = ctx.currentTime, g = graph.duck.gain;
  if (t + hold <= duckEnd) return;                               // already ducked for at least as long
  duckEnd = t + hold;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.setTargetAtTime(depth, t, 0.01);
  g.setTargetAtTime(1, t + hold, 0.2);
}

const RETRIGGER = 0.06;                                          // the same sound twice within 60 ms only gets louder and phasier
const lastPlayed: Partial<Record<SfxName, number>> = {};
export function sfx(name: SfxName, vol = 1, pan = 0): void {
  const caption = CAPTION[name];
  if (onCaption && caption) onCaption(caption);
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  if (t - (lastPlayed[name] ?? -1) < RETRIGGER) return;
  lastPlayed[name] = t;
  duckMusic(ac, name);
  curBus = 'sfx';
  try { SFX[name](ac, vol, pan); } catch { /* a voice that fails to build stays silent */ }
}

// ---------- continuous soundscape ----------
interface LoopVoice { g: GainNode; fl: BiquadFilterNode }
interface Engine { g: GainNode; o1: OscillatorNode; o2: OscillatorNode; lfo: OscillatorNode; lp: BiquadFilterNode }
type LoopName = 'sea' | 'lap' | 'wash' | 'spray' | 'surf' | 'wind' | 'rain' | 'luff' | 'roof' | 'stove' | 'hiss' | 'school';
type Loops = Record<LoopName, LoopVoice> & { wall: LoopVoice; engine: Engine; drone: GainNode };
let loops: Loops | null = null;

function loopSource(ctx: AudioContext, kind: NoiseColor, type: BiquadFilterType, f: number, q: number, dest: AudioNode): LoopVoice {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx, kind);
  s.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  s.connect(fl).connect(g).connect(dest);
  s.start(0, Math.random() * 2);
  return { g, fl };
}

function startLoops(ctx: AudioContext, gr: Graph): void {
  // the outdoor ambience runs through a lowpass + gain ("walls") that close while docked in port
  const wall = ctx.createBiquadFilter(), wallG = ctx.createGain();
  wall.type = 'lowpass'; wall.frequency.value = 18000; wall.Q.value = -3;
  wall.connect(wallG).connect(gr.bus.amb);
  const loop = (kind: NoiseColor, type: BiquadFilterType, f: number, q = 0.7, dest: AudioNode = gr.bus.amb) => loopSource(ctx, kind, type, f, q, dest);
  const voices: Record<LoopName, LoopVoice> = {
    sea: loop('brown', 'lowpass', 330, 0.7, wall),               // distant swell
    lap: loop('pink', 'bandpass', 550, 0.9, wall),               // water lapping on the hull
    wash: loop('pink', 'lowpass', 500, 0.7, wall),               // water rushing past while moving
    spray: loop('pink', 'highpass', 2000, 0.7, wall),            // spray at speed
    surf: loop('brown', 'bandpass', 480, 0.6, wall),             // breakers near shore
    school: loop('pink', 'bandpass', 1100, 1.4, wall),           // a fish school stirring the surface nearby
    wind: loop('pink', 'bandpass', 450, 1.2, wall),              // kept under the melody's range
    rain: loop('pink', 'highpass', 1400, 0.7, wall),             // pink, not white: a patter rather than a fizz
    luff: loop('pink', 'bandpass', 320, 2, wall),                // sail flapping when pointing into the wind
    roof: loop('pink', 'lowpass', 480),                          // indoors: rain drumming on the roof, muffled
    stove: loop('brown', 'lowpass', 300),                        // indoors: warm low roar of the stove
    hiss: loop('white', 'bandpass', 2000, 0.5, gr.tapeIn),       // tape hiss under the music (music bus)
  };
  loops = { ...voices, wall: { fl: wall, g: wallG }, engine: startEngine(ctx, gr), drone: startDrone(ctx, wall) };
}

// the deep ocean: a low, slowly breathing drone of two detuned sines (a fifth apart), well under the music
function startDrone(ctx: AudioContext, dest: AudioNode): GainNode {
  const g = ctx.createGain(), lp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lfoG = ctx.createGain(), breath = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.4;
  breath.gain.value = 0.7; lfo.frequency.value = 0.07; lfoG.gain.value = 0.3;
  lfo.connect(lfoG).connect(breath.gain);
  for (const f of [49, 73.6, 98.4]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(lp); o.start(); }
  g.gain.value = 0;
  lp.connect(breath).connect(g).connect(dest);
  lfo.start();
  return g;
}

// engine: a low triangle and sine, gently saturated and softly pulsed, like a single-cylinder outboard heard from the tiller
function startEngine(ctx: AudioContext, gr: Graph): Engine {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), pre = ctx.createGain(), sh = ctx.createWaveShaper(), lp = ctx.createBiquadFilter();
  const am = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain(), g = ctx.createGain();
  o1.type = 'triangle'; o2.type = 'sine';
  o1.frequency.value = 46; o2.frequency.value = 92;
  pre.gain.value = 0.35;                                         // keeps the sum inside the shaper's range: no hard clip
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 127.5 - 1;
    curve[i] = Math.tanh(x * 1.5) / Math.tanh(1.5);
  }
  sh.curve = curve;
  lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.3;
  am.gain.value = 0.65;
  lfo.frequency.value = 9;
  lfoG.gain.value = 0.3;
  lfo.connect(lfoG).connect(am.gain);
  g.gain.value = 0;
  o1.connect(pre);
  o2.connect(pre);
  pre.connect(sh).connect(lp).connect(am).connect(g).connect(gr.bus.sfx);
  o1.start(); o2.start(); lfo.start();
  return { g, o1, o2, lfo, lp };
}

let lapPhase = 0, portMix = 0, deepMix = 0, schoolMix = 0;
const poisson = (rate: number, dt: number) => Math.floor(rate * dt + Math.random());   // event count with the right mean

// one-shots heard inside the harbour office: rain ticking on the wooden roof, a drip, the stove crackling
function portEvents(c: AudioContext, dt: number, rain: number): void {
  const m = portMix;
  curBus = 'amb';
  try {
    for (let i = poisson(8 * rain, dt); i-- > 0;) {
      const t = r(0, dt), p = r(-0.7, 0.7), v = r(0.4, 1) * m;
      tone(c, { f: r(420, 760), t, a: 0.002, d: r(0.02, 0.045), vol: 0.025 * v, type: 'triangle', lp: 900, pan: p });
      hiss(c, { t, a: 0.002, d: r(0.012, 0.03), vol: 0.045 * v, f: r(700, 1200), q: 1.6, pan: p });
    }
    for (let i = poisson(0.3 * rain, dt); i-- > 0;) bubble(c, r(0, dt), r(750, 1100), 0.03 * m, 0.05, r(-0.4, 0.4));
    for (let i = poisson(2.5, dt); i-- > 0;) {                   // crackles come in little clusters, with the odd pop
      const t = r(0, dt), p = r(-0.5, -0.25);
      for (let k = 0, n = 1 + Math.floor(Math.random() * 4); k < n; k++) {
        hiss(c, { t: t + k * r(0.012, 0.06), a: 0.002, d: r(0.004, 0.012), vol: r(0.04, 0.09) * m, f: r(900, 1900), q: r(1, 2.5), pan: p });
      }
      if (Math.random() < 0.15) {
        hiss(c, { t, a: 0.002, d: 0.035, vol: 0.08 * m, f: r(450, 750), q: 1.2, pan: p });
        tone(c, { f: r(140, 210), t, a: 0.002, d: 0.05, vol: 0.03 * m, type: 'triangle', lp: 600, pan: p });
      }
    }
  } catch { /* a dropped crackle is harmless */ }
  curBus = 'sfx';
}

// far out over deep water: whale song now and then, and trains of distant clicks (none with calm sounds on)
function deepEvents(c: AudioContext, dt: number, calm: boolean): void {
  const m = deepMix * (1 - portMix);
  if (m < 0.05) return;
  curBus = 'amb';
  try {
    if (poisson(m / (calm ? 90 : 45), dt)) {                     // a whale's phrase: two or three long glides, low and far away
      const p = r(-0.8, 0.8), base = r(120, 190), v = 0.03 * m;
      let t = r(0, dt);
      for (let k = 0, n = 2 + Math.floor(Math.random() * 2); k < n; k++) {
        const f = base * r(0.9, 2.4), f1 = base * r(0.8, 2.6), d = r(1.1, 2.2);
        tone(c, { f, f1, t, a: r(0.4, 0.8), d, vol: v, lp: 760, pan: p, rev: 0.9 });
        tone(c, { f: f * 2.01, f1: f1 * 2.01, t, a: r(0.4, 0.8), d: d * 0.8, vol: v * 0.25, lp: 900, pan: p, rev: 0.9 });   // a faint overtone
        t += d * r(0.7, 1.1);
      }
    }
    if (!calm && poisson(m / 30, dt)) {                           // clicks from somewhere below, in a short slowing train
      const p = r(-0.9, 0.9), f = r(2400, 4200);
      let t = r(0, dt), gap = r(0.04, 0.08);
      for (let k = 0, n = 6 + Math.floor(Math.random() * 9); k < n; k++) {
        hiss(c, { t, a: 0.001, d: 0.005, vol: 0.016 * m, f, q: 4, pan: p, rev: 0.5 });
        t += gap; gap *= r(1.02, 1.12);
      }
    }
  } catch { /* a dropped call is harmless */ }
  curBus = 'sfx';
}

// a fish school close by: bubbles rising and the odd fish flicking at the surface. Rates and levels both grow with
// closeness, so it is plain at 0.6 and barely there below 0.2.
function schoolEvents(c: AudioContext, dt: number): void {
  const m = schoolMix * (1 - portMix);
  if (m < 0.03) return;
  curBus = 'amb';
  try {
    for (let i = poisson(7 * m, dt); i-- > 0;) bubble(c, r(0, dt), r(420, 1000), 0.03 * m, r(0.03, 0.06), r(-0.6, 0.6));
    for (let i = poisson(0.9 * m, dt); i-- > 0;) {               // a flick: a small wet slap and a bubble after it
      const t = r(0, dt), p = r(-0.7, 0.7);
      hiss(c, { t, a: 0.003, d: r(0.06, 0.12), vol: 0.05 * m, f: r(1400, 2000), f1: 600, q: 0.9, color: 'pink', pan: p, rev: 0.2 });
      bubble(c, t + 0.04, r(500, 800), 0.025 * m, 0.05, p);
    }
  } catch { /* a dropped bubble is harmless */ }
  curBus = 'sfx';
}

/** The world around the boat, sampled every frame. Levels are 0..1 unless noted. */
interface SoundscapeState {
  /** boat speed, world units per second */
  speed: number;
  shore: number;
  wind: number;
  rain: number;
  engine: boolean;
  throttle: number;
  luff: number;
  mute: boolean;
  port: boolean;
  /** how far out over deep water the boat is (brings in the deep-ocean ambience) */
  deep: number;
  /** calm sounds: no clicks, rarer whale song */
  calm: boolean;
  /** closeness of the nearest active fish school, 0..1 (brings in its bubbling) */
  school?: number;
}

// called every frame with the state of the world around the boat
export function soundscape(s: SoundscapeState, dt: number): void {
  if (!ac || !loops || ac.state !== 'running') return;
  const L = loops, t = ac.currentTime;
  const set = (node: GainNode, v: number, tc = 0.15) => node.gain.setTargetAtTime(v, t, tc);
  lapPhase += dt * (0.7 + Math.random() * 0.6);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.21 + 1);
  set(L.sea.g, s.mute ? 0 : 0.045 + 0.035 * swell + 0.03 * s.wind, 0.5);
  const lapping = 0.02 + 0.025 * Math.max(0, Math.sin(lapPhase * 2.1) * Math.sin(lapPhase * 0.9));
  set(L.lap.g, s.mute ? 0 : lapping * (1 - Math.min(1, s.speed / 30) * 0.5), 0.08);
  const k = Math.min(1, s.speed / 45);
  set(L.wash.g, s.mute ? 0 : 0.03 * k);
  L.wash.fl.frequency.setTargetAtTime(300 + 400 * k, t, 0.2);
  set(L.spray.g, s.mute ? 0 : 0.035 * k * k);
  const wave = Math.pow(Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.3) * 2)), 3);
  set(L.surf.g, s.mute ? 0 : s.shore * (0.035 + 0.08 * wave), 0.12);
  set(L.wind.g, s.mute ? 0 : 0.017 * s.wind * (0.6 + 0.4 * Math.sin(t * 0.7)), 0.4);
  L.wind.fl.frequency.setTargetAtTime(400 + 220 * Math.sin(t * 0.23), t, 0.5);
  set(L.rain.g, s.mute ? 0 : 0.05 * s.rain, 0.6);
  set(L.luff.g, s.mute ? 0 : s.luff * 0.04 * (0.5 + 0.5 * Math.sin(t * 40)), 0.03);

  const e = L.engine;
  set(e.g, s.mute || !s.engine ? 0 : 0.024 + 0.016 * s.throttle, 0.25);
  const rpm = 0.8 + Math.min(1, s.speed / 60) * 1.1 + s.throttle * 0.2;
  e.o1.frequency.setTargetAtTime(46 * rpm, t, 0.3);
  e.o2.frequency.setTargetAtTime(92 * rpm, t, 0.3);
  e.lfo.frequency.setTargetAtTime(8 * rpm, t, 0.3);
  e.lp.frequency.setTargetAtTime(130 + 70 * rpm, t, 0.3);

  // docked in port: the sea goes muffled behind walls (~0.6 s), the roof and the stove fade in
  const dtc = Math.min(dt, 0.1), rain = s.rain || 0;
  portMix += ((s.port && !s.mute ? 1 : 0) - portMix) * (1 - Math.exp(-dtc / 0.2));
  if (portMix < 0.001) portMix = 0;
  L.wall.fl.frequency.setTargetAtTime(18000 * Math.pow(900 / 18000, portMix), t, 0.03);   // sweeps evenly in pitch
  L.wall.g.gain.setTargetAtTime(1 - 0.4 * portMix, t, 0.03);
  set(L.roof.g, 0.018 * rain * portMix, 0.3);
  set(L.stove.g, 0.05 * portMix * (0.8 + 0.2 * Math.sin(t * 1.3) * Math.sin(t * 0.7 + 2)), 0.2);
  if (portMix > 0.02) portEvents(ac, dtc, rain);

  // the deep ocean comes in slowly as the water darkens far from shore
  deepMix += ((s.mute ? 0 : s.deep) - deepMix) * (1 - Math.exp(-dtc / 4));
  set(L.drone, 0.022 * deepMix * (1 - portMix) * (s.calm ? 0.7 : 1), 0.5);
  deepEvents(ac, dtc, s.calm);

  // a fish school fades in over about a second as the boat closes on it
  schoolMix += ((s.mute ? 0 : s.school ?? 0) - schoolMix) * (1 - Math.exp(-dtc / 0.8));
  if (schoolMix < 0.001) schoolMix = 0;
  set(L.school.g, 0.016 * schoolMix * schoolMix * (1 - portMix) * (0.7 + 0.3 * Math.sin(t * 2.3) * Math.sin(t * 0.8)), 0.3);
  schoolEvents(ac, dtc);
}

// ---------- music: quiet piano pieces with silence between them (composed in music.ts), through tape and reverb ----------
// The piano is sampled: Salamander Grand Piano by Alexander Holm (CC BY 3.0), one note every minor third from C2 to C7,
// trimmed and compressed in src/piano/. They load once audio is unlocked (never on the startup path); each note plays the
// nearest sample re-pitched, softer notes darker (a felt piano), held like a sustain pedal and released gently.
const PIANO_FILES = import.meta.glob('./piano/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const PITCH: Record<string, number> = { C: 0, Ds: 3, Fs: 6, A: 9 };
const pianoSamples: { s: number; buf: AudioBuffer }[] = [];
let pianoLoad: Promise<void> | null = null, pianoReady = false;
/** Fetch and decode the piano samples once (an AudioBuffer works in any context, so offline renders share them). */
function loadPiano(ctx: BaseAudioContext): Promise<void> {
  return pianoLoad ??= Promise.all(Object.entries(PIANO_FILES).map(async ([path, url]) => {
    const [, name, oct] = path.match(/\/([A-Z]s?)(\d)\.mp3$/)!;
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    pianoSamples.push({ s: PITCH[name] + 12 * (Number(oct) - 4), buf });
  })).then(() => { pianoSamples.sort((a, b) => a.s - b.s); pianoReady = true; }, () => { pianoLoad = null; pianoSamples.length = 0; });   // a failed load tries again later
}
const piano = (c: BaseAudioContext, s: number, t: number, vel: number, dur: number) => {
  let smp = pianoSamples[0];
  for (const x of pianoSamples) if (Math.abs(x.s - s) < Math.abs(smp.s - s)) smp = x;
  if (!smp) return;
  const t0 = c.currentTime + t, rate = Math.pow(2, (s - smp.s) / 12), end = Math.min(dur, smp.buf.duration / rate - 0.6);
  const src = c.createBufferSource(), lp = c.createBiquadFilter(), g = out(c, Math.max(-0.35, Math.min(0.35, s / 40)), 0);
  src.buffer = smp.buf; src.playbackRate.value = rate;
  lp.type = 'lowpass'; lp.frequency.value = 2200 + 7000 * vel;        // a softer touch is a little darker
  g.gain.setValueAtTime(0.5 * vel, t0);
  g.gain.setValueAtTime(0.5 * vel, t0 + Math.max(0.05, end));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, end) + 0.6);                 // the damper comes down
  src.connect(lp).connect(g);
  src.start(t0); src.stop(t0 + Math.max(0.05, end) + 0.7);
};
const playEvent = (c: BaseAudioContext, e: MusicEvent, t: number): void => {
  if (e.kind === 'chord') { harmony = e.triad!; return; }          // what the pitched sound effects voice on
  if (e.kind === 'piano' || e.kind === 'bass') { piano(c, e.s, t, e.vel, e.dur); return; }
  // a warm pad under the slow pieces: two detuned triangles, filtered dark, swelling in and out
  const f = N(e.s);
  for (const cents of [-6, 6]) tone(c, { f: f * Math.pow(2, cents / 1200), t, a: Math.min(2.5, e.dur * 0.35), hold: e.dur * 0.3, d: e.dur * 0.6, vol: 0.011 * e.vel, type: 'triangle', lp: 650, rev: 0.7 });
};

const AHEAD = 0.25;                                              // notes are booked this far ahead on the audio clock
const tune = { piece: null as Piece | null, at: 0, next: 0, restUntil: -1, last: undefined as string | undefined, R: rng(Date.now()) };

/** Called every frame: plays the current piece's notes at their exact times, so the timing holds however uneven the frames
 * are, then rests before writing the next piece (night picks the night styles). */
export function music(on: boolean, night: boolean): void {
  if (!ac || ac.state !== 'running') return;
  const now = ac.currentTime;
  if (!on) { tune.piece = null; tune.restUntil = -1; if (loops) loops.hiss.g.gain.setTargetAtTime(0, now, 0.5); return; }
  if (!tune.piece) {
    if (!pianoReady) { void loadPiano(ac); return; }               // first the piano (audio is unlocked by now)
    if (tune.restUntil < 0) tune.restUntil = now + 4;            // music switched on, or the game just started: begin soon
    if (now < tune.restUntil) { if (loops) loops.hiss.g.gain.setTargetAtTime(0, now, 1.5); return; }
    tune.piece = compose(Math.floor(tune.R() * 2 ** 31), night, tune.last);
    tune.last = tune.piece.style; tune.at = now + 0.3; tune.next = 0;
  }
  if (loops) loops.hiss.g.gain.setTargetAtTime(0.003, now, 0.5); // tape hiss only while a piece plays
  const p = tune.piece;
  curBus = 'music';
  for (; tune.next < p.events.length && tune.at + p.events[tune.next].t < now + AHEAD; tune.next++) {
    const e = p.events[tune.next], when = tune.at + e.t - now;
    if (when < -0.1 && e.kind !== 'chord') continue;              // back from a stall (a hidden tab): skip, don't pile up
    try { playEvent(ac, e, Math.max(0, when)); } catch { /* a missed note is harmless */ }
  }
  curBus = 'sfx';
  if (now > tune.at + p.length) { tune.piece = null; tune.restUntil = now + restAfter(tune.R); }
}

/** Render the start of a piece offline (tests and listening checks): `seed` picks it, as in play. */
export async function renderMusicOffline(seed: number, night: boolean, secs = 20, tempo = 1): Promise<{ piece: Piece; left: Float32Array; right: Float32Array }> {
  const off = new OfflineAudioContext(2, 44100 * secs, 44100), prevGraph = graph, prevHarmony = harmony, piece = compose(seed, night, undefined, tempo);
  await loadPiano(off);
  try {
    graph = buildGraph(off, off.destination);
    curBus = 'music';
    for (const e of piece.events) if (e.t < secs) playEvent(off, e, e.t);
  } finally {
    curBus = 'sfx'; graph = prevGraph; harmony = prevHarmony;
  }
  const buf = await off.startRendering();
  return { piece, left: buf.getChannelData(0), right: buf.getChannelData(1) };
}

// ---------- offline rendering, used by tests to inspect levels and spectra ----------
// `chord` optionally voices pitched effects on another chord (semitones from C4, e.g. [9, 12, 16] for A minor)
export async function renderOffline(name: SfxName, secs = 2, chord: Chord = harmony): Promise<Float32Array> {
  const off = new OfflineAudioContext(2, 44100 * secs, 44100), prevGraph = graph, prevHarmony = harmony;
  harmony = chord;
  try {
    graph = buildGraph(off, off.destination);
    SFX[name](off, 1, 0);
  } finally {
    graph = prevGraph;                                           // restore before awaiting so live sounds keep their graph
    harmony = prevHarmony;
  }
  const buf = await off.startRendering();
  return buf.getChannelData(0);
}

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
