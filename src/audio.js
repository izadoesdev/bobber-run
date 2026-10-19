// Procedural sound design on the Web Audio API.
// Everything is synthesised from filtered noise, damped sines and physically-modelled bubbles
// (a sine whose pitch rises as it decays), mixed through a compressor with a shared reverb send.
let ac = null, master, comp, dry, revIn, tapeIn = null, loops = null, BUS = {}, curBus = 'sfx';
const VOL = { sfx: 0.8, music: 0.6, amb: 0.8 };
export function setVolumes(v) { Object.assign(VOL, v); for (const k in BUS) if (BUS[k]) BUS[k].gain.value = VOL[k]; }
const bufs = {};

export function unlockAudio() {
  if (ac) { if (ac.state !== 'running') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    buildGraph(ac, ac.destination);
    startLoops();
    ac.resume();
  } catch (_) { ac = null; }
}
function buildGraph(ctx, out) {
  comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0.85; master.connect(comp).connect(out);
  dry = ctx.createGain(); dry.gain.value = 1.5; dry.connect(master);
  for (const k of ['sfx', 'music', 'amb']) { BUS[k] = ctx.createGain(); BUS[k].gain.value = VOL[k]; BUS[k].connect(dry); }
  const conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.6, 2.2);
  revIn = ctx.createGain(); const wet = ctx.createGain(); wet.gain.value = 0.32;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 220;
  revIn.connect(hp).connect(conv).connect(wet).connect(master);
  // lo-fi tape on the music: voices -> wow/flutter delay line -> soft lowpass -> BUS.music (volume) -> dry + one reverb send.
  // Pitch deviation of a modulated delay is d'(t) = 2*pi*f*depth: 0.5 ms at 0.5 Hz ~ 2.7 cents of wow,
  // 0.25 ms at 0.31 Hz ~ 0.8 cents of drift (so the wobble never repeats exactly), 20 us at 6 Hz ~ 1.3 cents of flutter.
  tapeIn = ctx.createGain(); const wob = ctx.createDelay(0.05), tlp = ctx.createBiquadFilter(), send = ctx.createGain();
  wob.delayTime.value = 0.006;
  for (const [hz, depth] of [[0.5, 0.0005], [0.31, 0.00025], [6, 0.00002]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = hz; g.gain.value = depth; o.connect(g).connect(wob.delayTime); o.start(); }
  tlp.type = 'lowpass'; tlp.frequency.value = 4000; tlp.Q.value = -1;
  send.gain.value = 0.55;                                         // what each music voice used to send on its own
  tapeIn.connect(wob).connect(tlp).connect(BUS.music); BUS.music.connect(send).connect(revIn);
}
function impulse(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return b;
}
function noise(ctx, kind) {
  const key = kind + ctx.sampleRate; if (bufs[key] && bufs[key].ctx === ctx) return bufs[key].b;
  const n = ctx.sampleRate * 3, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let l = 0, p0 = 0, p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { l = (l + 0.02 * w) / 1.02; d[i] = l * 3.5; }
    else if (kind === 'pink') { p0 = 0.997 * p0 + w * 0.029591; p1 = 0.985 * p1 + w * 0.032534; p2 = 0.95 * p2 + w * 0.048056; d[i] = (p0 + p1 + p2 + w * 0.05) * 2.2; }
    else d[i] = w * 0.6;
  }
  bufs[key] = { ctx, b }; return b;
}

// ---------- voice helpers (all take the context explicitly so they can render offline for tests) ----------
function out(ctx, vol, pan, rev) {
  const g = ctx.createGain(); g.gain.value = 0;
  let node = g;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
  const tape = curBus === 'music' && tapeIn;                     // music goes through the tape, which has its own reverb send
  node.connect(tape || BUS[curBus] || dry);
  if (rev && !tape) { const s = ctx.createGain(); s.gain.value = rev * VOL[curBus]; node.connect(s).connect(revIn); }
  return g;
}
function envelope(g, t, a, d, peak, hold = 0) {
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
  if (hold) g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}
function tone(ctx, { f, f1, t = 0, a = 0.005, d = 0.3, hold = 0, vol = 0.2, type = 'sine', pan = 0, rev = 0, lp }) {
  const t0 = ctx.currentTime + t, o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + a + hold + d);
  const g = out(ctx, vol, pan, rev); envelope(g, t0, a, d, vol, hold);
  if (lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; o.connect(fl).connect(g); } else o.connect(g);
  o.start(t0); o.stop(t0 + a + hold + d + 0.05);
}
function hiss(ctx, { t = 0, a = 0.01, d = 0.2, hold = 0, vol = 0.2, type = 'bandpass', f = 1000, f1, q = 1, color = 'white', pan = 0, rev = 0 }) {
  const t0 = ctx.currentTime + t, s = ctx.createBufferSource(); s.buffer = noise(ctx, color);
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t0);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t0 + a + hold + d);
  const g = out(ctx, vol, pan, rev); envelope(g, t0, a, d, vol, hold);
  s.connect(fl).connect(g); s.start(t0, Math.random() * 2); s.stop(t0 + a + hold + d + 0.05);
}
// a bubble: short sine whose pitch rises as it decays (Minnaert resonance)
const bubble = (ctx, t, f, vol, dur = 0.06, pan = 0) => tone(ctx, { f, f1: f * (1.6 + Math.random() * 0.6), t, a: 0.002, d: dur, vol, pan, rev: 0.12 });
// marimba-ish mallet: fundamental + quiet 4x partial, fast decay
const mallet = (ctx, f, t, vol, d = 0.6, rev = 0.3) => { tone(ctx, { f, t, a: 0.002, d, vol, rev }); tone(ctx, { f: f * 3.98, t, a: 0.001, d: d * 0.18, vol: vol * 0.22, rev }); };
const N = s => 440 * Math.pow(2, (s - 9) / 12);                 // semitones from C4 → Hz (0 = C4)
const r = (a, b) => a + Math.random() * (b - a);

const SFX = {
  oar: (c, v, p) => {                                            // blade dips, pulls, then trickle of bubbles
    hiss(c, { a: 0.025, d: 0.3, vol: 0.26 * v, f: 1400, f1: 420, q: 0.8, color: 'pink', pan: p, rev: 0.1 });
    hiss(c, { t: 0.05, a: 0.08, d: 0.45, vol: 0.14 * v, type: 'lowpass', f: 420, color: 'brown', pan: p });
    for (let i = 0; i < 5; i++) bubble(c, r(0.04, 0.32), r(380, 900), 0.06 * v, r(0.035, 0.07), p);
  },
  splash: (c, v, p) => {
    hiss(c, { a: 0.01, d: 0.55, vol: 0.22 * v, f: 1800, f1: 500, q: 0.7, color: 'pink', pan: p, rev: 0.15 });
    for (let i = 0; i < 6; i++) bubble(c, r(0.05, 0.4), r(250, 800), 0.04 * v, r(0.04, 0.09), p);
  },
  crash: (c, v, p) => {                                          // hull hits rock: thud + wood knock + spray
    tone(c, { f: 120, f1: 48, a: 0.004, d: 0.4, vol: 0.55 * v, pan: p });
    tone(c, { f: r(180, 200), a: 0.002, d: 0.22, vol: 0.12 * v, type: 'triangle', lp: 900, pan: p, rev: 0.1 });
    tone(c, { f: r(290, 320), a: 0.002, d: 0.16, vol: 0.08 * v, type: 'triangle', lp: 900, pan: p });
    hiss(c, { a: 0.002, d: 0.04, vol: 0.18 * v, type: 'highpass', f: 1500, pan: p });
    hiss(c, { t: 0.03, a: 0.02, d: 0.5, vol: 0.18 * v, f: 1300, f1: 450, q: 0.7, color: 'pink', pan: p, rev: 0.2 });
  },
  scrape: (c, v, p) => { hiss(c, { a: 0.04, d: 0.35, hold: 0.1, vol: 0.09 * v, f: 520, f1: 380, q: 2.5, color: 'pink', pan: p }); tone(c, { f: 70, a: 0.05, d: 0.3, vol: 0.12 * v, pan: p }); },
  coin: (c, v) => { mallet(c, N(31), 0, 0.09 * v, 0.35, 0.25); mallet(c, N(36), 0.07, 0.08 * v, 0.5, 0.3); },
  cast: (c, v) => {
    hiss(c, { a: 0.06, d: 0.28, vol: 0.22 * v, f: 2200, f1: 600, q: 1.2, rev: 0.1 });
    for (let i = 0; i < 7; i++) hiss(c, { t: 0.02 + i * 0.035, a: 0.001, d: 0.012, vol: 0.025 * v, f: 3400, q: 8 });
  },
  plop: (c, v) => { bubble(c, 0, r(180, 230), 0.22 * v, 0.09); hiss(c, { a: 0.005, d: 0.14, vol: 0.06 * v, type: 'lowpass', f: 900, color: 'pink' }); bubble(c, 0.08, r(400, 600), 0.05 * v); },
  bite: (c, v) => { bubble(c, 0, 320, 0.18 * v, 0.06); bubble(c, 0.1, 380, 0.15 * v, 0.06); hiss(c, { a: 0.005, d: 0.1, vol: 0.05 * v, f: 1200, q: 1 }); },
  reel: (c, v) => { hiss(c, { a: 0.001, d: 0.022, vol: 0.7 * v, f: r(2100, 2600), q: 1.4 }); tone(c, { f: r(1700, 1900), a: 0.001, d: 0.012, vol: 0.03 * v }); },
  catch: (c, v) => { SFX.splash(c, 0.8 * v, 0); [0, 4, 7].forEach((s, i) => mallet(c, N(24 + s), 0.12 + i * 0.09, 0.1 * v)); },
  snap: (c, v) => { tone(c, { f: 1300, f1: 160, a: 0.001, d: 0.22, vol: 0.15 * v, type: 'triangle', lp: 2500 }); hiss(c, { a: 0.001, d: 0.03, vol: 0.12 * v, type: 'highpass', f: 2500 }); },
  move: (c, v) => { tone(c, { f: 1050, a: 0.001, d: 0.045, vol: 0.12 * v }); tone(c, { f: 2100, a: 0.001, d: 0.02, vol: 0.03 * v }); },
  select: (c, v) => { mallet(c, N(19), 0, 0.08 * v, 0.3, 0.2); mallet(c, N(24), 0.06, 0.08 * v, 0.4, 0.25); },
  deny: (c, v) => { tone(c, { f: 196, a: 0.004, d: 0.12, vol: 0.1 * v, type: 'triangle', lp: 700 }); tone(c, { f: 165, t: 0.09, a: 0.004, d: 0.16, vol: 0.1 * v, type: 'triangle', lp: 700 }); },
  fanfare: (c, v) => { [0, 4, 7, 12].forEach((s, i) => mallet(c, N(24 + s), i * 0.085, 0.1 * v, 0.7, 0.35)); [0, 7, 16].forEach(s => tone(c, { f: N(12 + s), t: 0.3, a: 0.25, d: 1.2, vol: 0.03 * v, rev: 0.4 })); },
  levelup: (c, v) => { [0, 2, 4, 7, 9, 12].forEach((s, i) => mallet(c, N(19 + s), i * 0.055, 0.08 * v, 0.45, 0.35)); tone(c, { f: N(43), t: 0.33, a: 0.02, d: 0.8, vol: 0.025 * v, rev: 0.5 }); },
  perfect: (c, v) => { for (const [m, k] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) tone(c, { f: 1568 * m, a: 0.001, d: 0.7 / m, vol: 0.14 * v * k, rev: 0.4 }); },
  sink: (c, v) => { for (let i = 0; i < 22; i++) bubble(c, i * 0.07 + r(0, 0.05), r(500, 900) * (1 - i / 30), 0.06 * v, r(0.05, 0.1)); hiss(c, { a: 0.2, d: 1.4, vol: 0.18 * v, type: 'lowpass', f: 400, f1: 120, color: 'brown' }); },
  discover: (c, v) => { [4, 7, 11, 16].forEach((s, i) => mallet(c, N(19 + s), i * 0.12, 0.07 * v, 0.9, 0.5)); },
  dock: (c, v) => { tone(c, { f: 150, f1: 70, a: 0.004, d: 0.22, vol: 0.3 * v }); hiss(c, { t: 0.06, a: 0.05, d: 0.35, vol: 0.05 * v, f: 520, f1: 760, q: 14 }); },
  gulls: (c, v) => {
    for (let k = 0; k < 3; k++) {
      const t0 = c.currentTime + k * r(0.22, 0.35), o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), bp = c.createBiquadFilter(), g = out(c, 0, r(-0.6, 0.6), 0.35);
      o.type = 'triangle'; o.frequency.setValueAtTime(1150, t0); o.frequency.linearRampToValueAtTime(1900, t0 + 0.06); o.frequency.exponentialRampToValueAtTime(1250, t0 + 0.26);
      lfo.frequency.value = 32; lg.gain.value = 70; lfo.connect(lg).connect(o.frequency);
      bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 2;
      envelope(g, t0, 0.03, 0.25, 0.055 * v);
      o.connect(bp).connect(g); o.start(t0); lfo.start(t0); o.stop(t0 + 0.35); lfo.stop(t0 + 0.35);
    }
  },
  purr: (c, v, p) => {                                           // an out-breath, then a softer in-breath
    const t0 = c.currentTime;
    purrBreath(c, t0, 0.62, 0.09 * v, 26, 650, p);
    purrBreath(c, t0 + 0.68, 0.52, 0.06 * v, 23, 520, p);
  },
  meow: (c, v, p) => {                                           // soft "mi-a-ow": a voiced glide through moving formants
    const t0 = c.currentTime, T = 0.55, o = c.createOscillator(), vib = c.createOscillator(), vg = c.createGain(), open = c.createBiquadFilter(), vol = 0.11 * v, g = out(c, vol, p, 0.12);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(600, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + 0.17); o.frequency.exponentialRampToValueAtTime(500, t0 + T);
    vib.frequency.value = 6; vg.gain.value = 8; vib.connect(vg).connect(o.frequency);
    open.type = 'lowpass'; open.Q.value = 0;                     // lips: closed "m", open "a", rounding to "ow"
    open.frequency.setValueAtTime(700, t0); open.frequency.exponentialRampToValueAtTime(3000, t0 + 0.08); open.frequency.exponentialRampToValueAtTime(1500, t0 + T);
    o.connect(open);
    for (const [[f0, f1, f2], q, k] of [[[380, 950, 520], 4, 1], [[1900, 1500, 950], 6, 0.45]]) {
      const bp = c.createBiquadFilter(), bg = c.createGain(); bp.type = 'bandpass'; bp.Q.value = q; bg.gain.value = k;
      bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + 0.16); bp.frequency.exponentialRampToValueAtTime(f2, t0 + T);
      open.connect(bp).connect(bg).connect(g);
    }
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.05); g.gain.setValueAtTime(vol, t0 + 0.22);
    g.gain.linearRampToValueAtTime(vol * 0.6, t0 + 0.4); g.gain.linearRampToValueAtTime(0, t0 + T);
    hiss(c, { a: 0.04, d: 0.35, vol: 0.012 * v, f: 1700, q: 1.2, pan: p });   // a little breath
    o.start(t0); vib.start(t0); o.stop(t0 + T + 0.1); vib.stop(t0 + T + 0.1);
  },
  thunder: (c, v) => {
    hiss(c, { a: 0.003, d: 0.25, vol: 0.25 * v, type: 'highpass', f: 900, rev: 0.4 });
    hiss(c, { t: 0.05, a: 0.15, d: 3.2, vol: 0.55 * v, type: 'lowpass', f: 700, f1: 90, color: 'brown', rev: 0.3 });
  },
};
// one breath of a purr: pink noise and a low sawtooth, both gated by narrow ~25 Hz pulses
function purrBreath(c, t0, len, vol, hz, fc, p) {
  const n = c.createBufferSource(), lp = c.createBiquadFilter(), saw = c.createOscillator(), slp = c.createBiquadFilter(), sg = c.createGain(),
    am = c.createGain(), lfo = c.createOscillator(), sh = c.createWaveShaper(), g = out(c, vol, p, 0.04), end = t0 + len;
  n.buffer = noise(c, 'pink'); n.loop = true; lp.type = 'lowpass'; lp.frequency.value = fc; lp.Q.value = 2;
  for (const o of [saw, lfo]) { o.frequency.setValueAtTime(hz, t0); o.frequency.linearRampToValueAtTime(hz * 1.06, end); }
  saw.type = 'sawtooth'; slp.type = 'lowpass'; slp.frequency.value = 300; sg.gain.value = 0.4;
  const curve = new Float32Array(257); for (let i = 0; i < 257; i++) curve[i] = Math.pow(i / 256, 4); sh.curve = curve;   // sine -> narrow pulses 0..1
  am.gain.value = 0.08; lfo.connect(sh).connect(am.gain);
  n.connect(lp).connect(am); saw.connect(slp).connect(sg).connect(am); am.connect(g);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.15); g.gain.setValueAtTime(vol, end - 0.2); g.gain.linearRampToValueAtTime(0, end);
  n.start(t0, Math.random() * 2); saw.start(t0); lfo.start(t0);
  for (const o of [n, saw, lfo]) o.stop(end + 0.05);
}
// short text for sounds that carry information, shown when captions are on
const CAPTION = { bite: 'Bobber splashes', snap: 'Line snaps', crash: 'Hull crunches', scrape: 'Hull scrapes', thunder: 'Thunder rumbles', gulls: 'Gulls crying', sink: 'Boat sinking', discover: 'Bell rings', purr: 'Cat purring', meow: 'Cat meows', deny: null, oar: null };
let onCaption = null;
export const setCaptionHook = f => { onCaption = f; };
export function sfx(name, vol = 1, rate = 1, pan = 0) {
  if (onCaption && CAPTION[name]) onCaption(CAPTION[name]);
  if (!ac || ac.state !== 'running' || !SFX[name]) return;
  curBus = 'sfx'; try { SFX[name](ac, vol, pan); } catch (_) { }
}

// ---------- continuous soundscape ----------
function loopSource(kind, type, f, q = 0.7, dest = BUS.amb) {
  const s = ac.createBufferSource(); s.buffer = noise(ac, kind); s.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = ac.createGain(); g.gain.value = 0;
  s.connect(fl).connect(g).connect(dest); s.start(0, Math.random() * 2);
  return { g, fl };
}
function startLoops() {
  // the outdoor ambience runs through a lowpass + gain ("walls") that close while docked in port
  const wall = ac.createBiquadFilter(), wallG = ac.createGain(); wall.type = 'lowpass'; wall.frequency.value = 18000; wall.Q.value = -3; wall.connect(wallG).connect(BUS.amb);
  loops = {
    sea: loopSource('brown', 'lowpass', 330, 0.7, wall),         // distant swell
    lap: loopSource('pink', 'bandpass', 650, 0.9, wall),         // water lapping on the hull
    wash: loopSource('pink', 'lowpass', 500, 0.7, wall),         // water rushing past while moving
    spray: loopSource('white', 'highpass', 2600, 0.7, wall),     // spray at speed
    surf: loopSource('brown', 'bandpass', 480, 0.6, wall),       // breakers near shore
    wind: loopSource('pink', 'bandpass', 600, 1.5, wall),
    rain: loopSource('white', 'highpass', 1900, 0.7, wall),
    luff: loopSource('pink', 'bandpass', 320, 2, wall),          // sail flapping when pointing into the wind
    roof: loopSource('pink', 'lowpass', 480),                    // indoors: rain drumming on the roof, muffled
    stove: loopSource('brown', 'lowpass', 300),                  // indoors: warm low roar of the stove
    hiss: loopSource('white', 'bandpass', 2600, 0.5, tapeIn),    // tape hiss under the music (music bus)
  };
  loops.wall = { fl: wall, g: wallG };
  // engine: two low oscillators, soft-clipped, amplitude-pulsed like a single-cylinder outboard
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), sh = ac.createWaveShaper(), lp = ac.createBiquadFilter(), am = ac.createGain(), lfo = ac.createOscillator(), lfoG = ac.createGain(), g = ac.createGain();
  o1.type = 'sawtooth'; o2.type = 'sine'; o1.frequency.value = 46; o2.frequency.value = 92;
  const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); } sh.curve = curve;
  lp.type = 'lowpass'; lp.frequency.value = 260; am.gain.value = 0.5; lfo.frequency.value = 9; lfoG.gain.value = 0.5; lfo.connect(lfoG).connect(am.gain);
  g.gain.value = 0; o1.connect(sh); o2.connect(sh); sh.connect(lp).connect(am).connect(g).connect(BUS.sfx);
  o1.start(); o2.start(); lfo.start();
  loops.engine = { g, o1, o2, lfo, lp };
}
let lapPhase = 0, portMix = 0;
const poisson = (rate, dt) => Math.floor(rate * dt + Math.random());   // event count with the right mean
// one-shots heard inside the harbour office: rain ticking on the wooden roof, a drip, the stove crackling
function portEvents(dt, rain) {
  const c = ac, m = portMix; curBus = 'amb';
  try {
    for (let i = poisson(8 * rain, dt); i-- > 0;) {
      const t = r(0, dt), p = r(-0.7, 0.7), v = r(0.4, 1) * m;
      tone(c, { f: r(420, 760), t, a: 0.001, d: r(0.02, 0.045), vol: 0.03 * v, type: 'triangle', lp: 1000, pan: p });
      hiss(c, { t, a: 0.001, d: r(0.012, 0.03), vol: 0.06 * v, f: r(700, 1300), q: 1.6, pan: p });
    }
    for (let i = poisson(0.3 * rain, dt); i-- > 0;) bubble(c, r(0, dt), r(750, 1100), 0.03 * m, 0.05, r(-0.4, 0.4));
    for (let i = poisson(2.5, dt); i-- > 0;) {                     // crackles come in little clusters, with the odd pop
      const t = r(0, dt), p = r(-0.5, -0.25);
      for (let k = 0, n = 1 + Math.floor(Math.random() * 4); k < n; k++) hiss(c, { t: t + k * r(0.012, 0.06), a: 0.0005, d: r(0.004, 0.012), vol: r(0.06, 0.14) * m, f: r(1300, 2600), q: r(1, 2.5), pan: p });
      if (Math.random() < 0.15) { hiss(c, { t, a: 0.001, d: 0.035, vol: 0.12 * m, f: r(450, 750), q: 1.2, pan: p }); tone(c, { f: r(140, 210), t, a: 0.001, d: 0.05, vol: 0.03 * m, type: 'triangle', lp: 600, pan: p }); }
    }
  } catch (_) { }
  curBus = 'sfx';
}
// called every frame with the state of the world around the boat
export function soundscape(s, dt) {
  if (!loops || ac.state !== 'running') return;
  const t = ac.currentTime, set = (node, v, tc = 0.15) => node.gain.setTargetAtTime(v, t, tc);
  lapPhase += dt * (0.7 + Math.random() * 0.6);
  const swell = 0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.21 + 1);
  set(loops.sea.g, s.mute ? 0 : 0.05 + 0.04 * swell + 0.05 * s.wind, 0.5);
  set(loops.lap.g, s.mute ? 0 : (0.025 + 0.03 * Math.max(0, Math.sin(lapPhase * 2.1) * Math.sin(lapPhase * 0.9))) * (1 - Math.min(1, s.speed / 30) * 0.5), 0.08);
  const k = Math.min(1, s.speed / 45);
  set(loops.wash.g, s.mute ? 0 : 0.2 * k); loops.wash.fl.frequency.setTargetAtTime(350 + 900 * k, t, 0.2);
  set(loops.spray.g, s.mute ? 0 : 0.035 * k * k);
  const wave = Math.pow(Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.3) * 2)), 3);
  set(loops.surf.g, s.mute ? 0 : s.shore * (0.04 + 0.1 * wave), 0.12);
  set(loops.wind.g, s.mute ? 0 : 0.035 * s.wind * (0.6 + 0.4 * Math.sin(t * 0.7)), 0.4); loops.wind.fl.frequency.setTargetAtTime(450 + 400 * Math.sin(t * 0.23), t, 0.5);
  set(loops.rain.g, s.mute ? 0 : 0.06 * s.rain, 0.6);
  set(loops.luff.g, s.mute ? 0 : s.luff * 0.05 * (0.5 + 0.5 * Math.sin(t * 40)), 0.03);
  const e = loops.engine;
  set(e.g, s.mute || !s.engine ? 0 : 0.07 + 0.09 * s.throttle, 0.25);
  const rpm = 0.8 + Math.min(1, s.speed / 60) * 1.1 + s.throttle * 0.2;
  e.o1.frequency.setTargetAtTime(46 * rpm, t, 0.3); e.o2.frequency.setTargetAtTime(92 * rpm, t, 0.3); e.lfo.frequency.setTargetAtTime(8 * rpm, t, 0.3); e.lp.frequency.setTargetAtTime(220 + 160 * rpm, t, 0.3);
  // docked in port: the sea goes muffled behind walls (~0.6 s), the roof and the stove fade in
  const dtc = Math.min(dt, 0.1), rain = s.rain || 0;
  portMix += ((s.port && !s.mute ? 1 : 0) - portMix) * (1 - Math.exp(-dtc / 0.2));
  if (portMix < 0.001) portMix = 0;
  loops.wall.fl.frequency.setTargetAtTime(18000 * Math.pow(900 / 18000, portMix), t, 0.03);   // sweeps evenly in pitch
  loops.wall.g.gain.setTargetAtTime(1 - 0.4 * portMix, t, 0.03);
  set(loops.roof.g, 0.018 * rain * portMix, 0.3);
  set(loops.stove.g, 0.05 * portMix * (0.8 + 0.2 * Math.sin(t * 1.3) * Math.sin(t * 0.7 + 2)), 0.2);
  if (portMix > 0.02) portEvents(dtc, rain);
}

// ---------- music: mallet melody over slow pads, pentatonic, through the reverb ----------
const DAY = [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], NIGHT = [[9, 12, 16], [4, 7, 11], [5, 9, 12], [0, 4, 7]];
const PENTA = [0, 2, 4, 7, 9];
let bar = 0, beat = 0, nextBeat = 1.5, chord = 0;
export function music(dt, on, night) {
  if (!ac || ac.state !== 'running') return;
  if (loops) loops.hiss.g.gain.setTargetAtTime(on ? 0.0045 : 0, ac.currentTime, 0.5);   // tape hiss only while music plays
  if (!on) return;
  if ((nextBeat -= dt) > 0) return;
  const tempo = night ? 0.62 : 0.48; nextBeat = tempo;
  curBus = 'music';
  try {
    const prog = night ? NIGHT : DAY, base = night ? 0 : 12;
    if (beat === 0) {                                              // new bar: soft pad chord every 2 bars
      if (bar % 2 === 0) { chord = (chord + 1) % 4; for (const s of prog[chord]) tone(ac, { f: N(base - 12 + s), a: 1.2, hold: tempo * 4, d: 2.2, vol: 0.012, rev: 0.6, lp: 900 }); }
      bar++;
    }
    if (Math.random() < (night ? 0.45 : 0.6)) {
      const ch = prog[chord], useChord = Math.random() < 0.55;
      const s = useChord ? ch[Math.floor(Math.random() * 3)] : PENTA[Math.floor(Math.random() * 5)] + (Math.random() < 0.3 ? 12 : 0);
      mallet(ac, N(base + s), 0, night ? 0.035 : 0.045, 0.9, 0.55);
    }
    beat = (beat + 1) % 4;
  } catch (_) { }
  curBus = 'sfx';
}

// ---------- offline rendering, used by tests to inspect levels and spectra ----------
export async function renderOffline(name, secs = 2) {
  const off = new OfflineAudioContext(2, 44100 * secs, 44100), prev = [master, comp, dry, revIn, tapeIn], prevBus = BUS;
  BUS = {};
  try { buildGraph(off, off.destination); SFX[name](off, 1, 0); }
  finally { [master, comp, dry, revIn, tapeIn] = prev; BUS = prevBus; }   // restore before awaiting so live sounds keep their graph
  const buf = await off.startRendering();
  return buf.getChannelData(0);
}
export const SFX_NAMES = Object.keys(SFX);
