// The music: piano pieces with room between them, in the spirit of open-world game soundtracks that make you want to
// go and build something: a tune you could hum, flowing broken chords under it, and a piece that grows (the tune,
// then the tune with more under it, then a high point) before it settles. Every piece is written fresh from a seed:
// a style (texture, mode, tempo, progression), a key and its tunes, so no two plays are alike.
// This file only composes (pure, testable); audio.ts plays the events on the audio clock.

/** A note or chord change in a piece. `s` is semitones from C4; times and lengths are seconds from the piece's start. */
export interface MusicEvent {
  t: number;
  kind: 'piano' | 'pad' | 'bass' | 'chord';
  s: number;
  dur: number;
  /** loudness 0..1 */
  vel: number;
  /** for 'chord': root, third and fifth (semitones from C, root 0..11), which the sound effects voice on */
  triad?: [number, number, number];
}
export interface Piece { style: string; key: number; bpm: number; length: number; events: MusicEvent[] }

type Texture = 'arp' | 'block' | 'pad' | 'ostinato';
interface Style {
  name: string; day: boolean; night: boolean;
  bpm: number; texture: Texture;
  /** the scale tunes are drawn from, semitones above the key */
  scale: number[];
  /** chords as semitones above the key: root, third, fifth, then a colour tone */
  prog: number[][];
  barsPerChord: 1 | 2;
}
const IONIAN = [0, 2, 4, 5, 7, 9, 11], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PENTA = [0, 2, 4, 7, 9], DORIAN = [0, 2, 3, 5, 7, 9, 10];
export const STYLES: Style[] = [
  { name: 'Tide', day: true, night: false, bpm: 62, texture: 'arp', scale: IONIAN, barsPerChord: 1,
    prog: [[0, 4, 7, 14], [7, 11, 14, 19], [9, 12, 16, 19], [5, 9, 12, 16]] },              // I add9, V, vi7, IVmaj7
  { name: 'Lantern', day: true, night: true, bpm: 58, texture: 'pad', scale: LYDIAN, barsPerChord: 2,
    prog: [[0, 4, 7, 14], [2, 6, 9, 14], [5, 9, 12, 16], [0, 4, 7, 11]] },                // I add9, II, IVmaj7, Imaj7
  { name: 'Driftwood', day: true, night: true, bpm: 76, texture: 'ostinato', scale: IONIAN, barsPerChord: 1,
    prog: [[5, 9, 12, 16], [7, 11, 14, 21], [4, 7, 11, 14], [9, 12, 16, 19]] },          // IVmaj7, V add9, iii7, vi7
  { name: 'Gull', day: true, night: false, bpm: 84, texture: 'block', scale: PENTA, barsPerChord: 1,
    prog: [[0, 4, 7, 14], [4, 7, 11, 16], [5, 9, 12, 14], [7, 11, 14, 17]] },             // I add9, iii, IV add9, V7
  { name: 'Hollow', day: false, night: true, bpm: 56, texture: 'arp', scale: DORIAN, barsPerChord: 2,
    prog: [[0, 3, 7, 14], [5, 9, 12, 14], [0, 3, 7, 10], [10, 14, 17, 21]] },            // i add9, IV add9, i7, bVII add9
  { name: 'Glass', day: false, night: true, bpm: 64, texture: 'arp', scale: IONIAN, barsPerChord: 1,
    prog: [[9, 12, 16, 19], [5, 9, 12, 16], [0, 4, 7, 14], [7, 11, 14, 21]] },           // vi7, IVmaj7, I add9, V add9
];
// keys stay near C so every piece sits in the same comfortable register
const KEYS = [0, 2, 5, 7, -3, -5];

/** A small seeded random generator (mulberry32), so a seed always writes the same piece. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- tunes ----------
// A tune is four two-bar phrases on an eighth-note grid, pitched as scale steps above the key: a statement, its answer,
// a climb to the high point, and the way home. Rhythms come from a small book of singable ones, not from chance.
interface Note { on: number; len: number; deg: number }
type Phrase = Note[];
const PHRASE = 16;                                                // eighths in two bars
const RHYTHMS: [number, number][][] = [
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]],             // walk, walk, hold; walk, walk, hold
  [[0, 3], [3, 1], [4, 4], [8, 3], [11, 1], [12, 4]],             // long-short, hold
  [[0, 2], [2, 1], [3, 1], [4, 4], [8, 8]],                       // a little turn, then a long note
  [[2, 2], [4, 2], [6, 2], [8, 6], [14, 2]],                      // after the beat, rising into a held note
  [[0, 4], [4, 2], [6, 2], [8, 8]],                               // slow and open
  [[0, 1], [1, 1], [2, 2], [4, 4], [8, 1], [9, 1], [10, 2], [12, 4]],
  [[0, 2], [2, 4], [6, 2], [8, 2], [10, 6]],                      // syncopated
];
const pick = <T>(R: () => number, xs: readonly T[]): T => xs[Math.floor(R() * xs.length)];

/** One phrase: a rhythm and a contour from `from`; 'arch' rises then falls, 'leap' jumps up and steps down, 'climb' rises. */
function phrase(R: () => number, rhythm: [number, number][], from: number, shape: 'arch' | 'leap' | 'climb'): Phrase {
  let deg = from;
  return rhythm.map(([on, len], i) => {
    if (i > 0) {
      const up = shape === 'climb' ? 0.8 : shape === 'arch' ? (i < rhythm.length / 2 ? 0.85 : 0.2) : i === 1 ? 1 : 0.3;
      const size = shape === 'leap' && i === 1 ? pick(R, [3, 4]) : R() < 0.12 ? 2 : 1;   // a fourth or fifth up once, otherwise steps
      deg += (R() < up ? 1 : -1) * size;
    }
    return { on, len, deg };
  });
}
/** A tune: statement, answer (the same rhythm, ending higher and open), the high point, and home (ending on the tonic). */
function tune(R: () => number, n: number, lift = 0): Phrase[] {
  const ra = pick(R, RHYTHMS), rb = pick(R, RHYTHMS), from = pick(R, [2, 4, 4, 0]) + lift;
  const p1 = phrase(R, ra, from, pick(R, ['arch', 'leap', 'climb'] as const));
  const p2 = p1.map((x, i) => ({ ...x, deg: x.deg + (i >= p1.length - 2 ? 1 + (R() < 0.5 ? 1 : 0) : 0) }));
  const top = Math.max(...p1.map(x => x.deg));
  const p3 = phrase(R, rb, top - 1 + pick(R, [0, 1, 2]), pick(R, ['arch', 'leap'] as const));
  const p4 = p1.map(x => ({ ...x }));
  const last = p4[p4.length - 1], before = p4[p4.length - 2];
  last.deg = Math.round(before.deg / n) * n + (R() < 0.75 ? 0 : 2);   // home: the tonic (or its third) nearest the note before
  if (Math.abs(before.deg - last.deg) > 2) before.deg = last.deg + (before.deg > last.deg ? 1 : -1);   // stepping into it
  last.len = PHRASE - last.on;
  return [p1, p2, p3, p4];
}
/** The same tune come back a little different: a new turn in the answer and on the way home. */
function retell(R: () => number, t: Phrase[]): Phrase[] {
  return t.map((p, k) => k % 2 === 0 ? p : p.map((x, i) => i === p.length - 2 && R() < 0.6 ? { ...x, deg: x.deg + pick(R, [1, -1, 2]) } : x));
}

/** A scale step (any integer, negative goes down) as semitones above the key. */
const step = (scale: number[], deg: number) => {
  const n = scale.length, o = Math.floor(deg / n);
  return scale[((deg % n) + n) % n] + 12 * o;
};
/** The chord tone nearest to `s` (both in semitones), so strong beats land in the harmony. */
const nearestChordTone = (s: number, chord: number[]) => {
  let best = s, bd = 99;
  for (const c of chord) for (let o = -24; o <= 24; o += 12) { const d = Math.abs(c + o - s); if (d < bd) { bd = d; best = c + o; } }
  return best;
};

/**
 * Write a piece. `night` picks from the night styles; `avoid` is the style just played, so the next one differs.
 */
export function compose(seed: number, night: boolean, avoid?: string, tempo = 1): Piece {
  const R = rng(seed), styles = STYLES.filter(s => (night ? s.night : s.day) && s.name !== avoid);
  const st = pick(R, styles), key = pick(R, KEYS);
  const bpm = Math.round((st.bpm + (R() - 0.5) * 6) * tempo), beat = 60 / bpm, bar = beat * 4, eighth = beat / 2;
  const prog = R() < 0.3 ? [...st.prog.slice(2), ...st.prog.slice(0, 2)] : st.prog.map(c => [...c]);   // now and then it starts midway
  const events: MusicEvent[] = [];
  const human = () => (R() - 0.5) * 0.016, soft = (v: number) => Math.min(1, v * (0.9 + R() * 0.2));
  const chordAt = (b: number) => prog[Math.floor(b / st.barsPerChord) % prog.length];
  const n = st.scale.length, home = 12 + key;                     // tunes sit around C5

  // the shape of the piece: each section has an energy (how much moves under the tune and how hard it's played)
  type Section = { kind: 'intro' | 'tune' | 'more' | 'high' | 'again' | 'outro'; bars: number; e: number };
  const form: Section[] = [
    { kind: 'intro', bars: 4, e: 0.35 }, { kind: 'tune', bars: 8, e: 0.55 }, { kind: 'more', bars: 8, e: 0.75 }, { kind: 'high', bars: 8, e: 1 },
  ];
  if (R() < 0.6) form.push({ kind: 'again', bars: 8, e: 0.5 });
  form.push({ kind: 'outro', bars: 4, e: 0.3 });
  const main = tune(R, n);                                          // one tune, coming back: that's what makes it stick

  const accompany = (barT: number, chord: number[], first: boolean, e: number, slow: number, left: number) => {
    // `left`: seconds until the chord changes; with the pedal down, every note rings until then
    const pc = (((key + chord[0]) % 12) + 12) % 12, low = pc <= 4 ? pc - 12 : pc - 24;   // the root between F2 and E3
    const v = [low, low + (chord[2] - chord[0]), low + 12 + (chord[1] - chord[0]), low + 12 + ((chord[3] ?? chord[0] + 12) - chord[0]), low + 24 + (chord[1] - chord[0])];
    const vel = 0.3 + 0.2 * e, ring = (at: number) => Math.max(eighth * 2, left - at);
    if (first) {
      events.push({ t: barT, kind: 'chord', s: 0, dur: 0, vel: 0, triad: triadOf(key, chord) });
      events.push({ t: barT + human(), kind: 'bass', s: low - 12, dur: left, vel: soft(0.45 + 0.15 * e) });
      if (st.texture === 'pad') for (const s of v.slice(1, 4)) events.push({ t: barT, kind: 'pad', s, dur: left, vel: 0.35 + 0.2 * e });
    }
    const flow = e >= 0.45;                                        // eighth notes once the tune is under way
    const play = (pattern: number[], dt: number, accent: number) => pattern.forEach((k, i) =>
      events.push({ t: barT + i * dt * slow + human(), kind: 'piano', s: v[k], dur: ring(i * dt), vel: soft((i % accent === 0 ? 1.15 : 1) * vel) }));
    // one figure for the whole piece, so it becomes part of the tune: broken chords in eighths at these slow tempos
    if (st.texture === 'arp') play(flow ? [0, 1, 2, 3, 4, 3, 2, 1] : [0, 1, 2, 3], flow ? eighth : beat, flow ? 4 : 2);
    else if (st.texture === 'ostinato') play([0, 2, 1, 2], beat, 2);
    else if (st.texture === 'pad') { if (flow) play([0, 1, 2, 3], beat, 2); else if (first) play([0], beat, 1); }
    else {                                                         // block chords: rolled on one, then on three, then a light pulse
      v.slice(0, 4).forEach((s, i) => events.push({ t: barT + i * 0.035 + human(), kind: 'piano', s, dur: left, vel: soft(vel) }));
      if (flow) v.slice(1, 4).forEach((s, i) => events.push({ t: barT + beat * 2 * slow + i * 0.035 + human(), kind: 'piano', s, dur: ring(beat * 2), vel: soft(vel * 0.8) }));
    }
  };
  const sing = (t0: number, p: Phrase, bar0: number, lift: number, vel: number, octaves: boolean) => {
    let prev = NaN, prev2 = NaN;
    for (const x of p) {
      const chord = chordAt(bar0 + Math.floor(x.on / 8)).map(c => c + key + 12);
      let s = home + step(st.scale, x.deg + lift);
      const c = nearestChordTone(s, chord);
      if (x.on % 4 === 0 && Math.abs(c - s) <= 2 && c !== prev) s = c;   // strong beats lean onto a chord tone close by
      if (s === prev && s === prev2) s = home + step(st.scale, x.deg + lift + (s > home + 7 ? -1 : 1));   // never the same note three times running
      prev2 = prev; prev = s;
      while (s > 31) s -= 12;                                     // nothing above G6
      const at = t0 + x.on * eighth + human(), dur = Math.max(x.len * eighth * 1.8, 0.6);
      events.push({ t: at, kind: 'piano', s, dur, vel: soft(vel) });
      if (octaves) events.push({ t: at + 0.01, kind: 'piano', s: s - 12, dur, vel: soft(vel * 0.55) });
    }
  };

  let t = 0, b = 0;
  for (const sec of form) {
    const tunes = sec.kind === 'more' || sec.kind === 'again' ? retell(R, main) : main;
    const lift = sec.kind === 'again' && R() < 0.3 ? 2 : 0;       // the last return, sometimes a little higher; the high point is fuller, not higher
    for (let i = 0; i < sec.bars; i++, b++) {
      const out = sec.kind === 'outro', slow = out ? 1 + 0.07 * i : 1;   // the outro slows toward the last chord
      const e = out ? sec.e - 0.05 * i : sec.e;
      const left = (st.barsPerChord - (b % st.barsPerChord)) * bar * slow;
      accompany(t, chordAt(b), b % st.barsPerChord === 0, e, slow, left);
      if (sec.kind !== 'intro' && !out && i % 2 === 0) {
        sing(t, tunes[(i / 2) % 4], b, lift, 0.62 + 0.25 * sec.e, sec.kind === 'more' || sec.kind === 'high');
        if (sec.kind === 'high' && i % 4 === 0) {                  // a bright note high above, at the top of the piece
          const c = chordAt(b + 1), s = key + 24 + c[1];
          events.push({ t: t + bar + human(), kind: 'piano', s: s > 31 ? s - 12 : s, dur: bar * 1.5, vel: soft(0.35) });
        }
      }
      t += bar * slow;
    }
  }
  // the last chord: the home chord, rolled slowly and left to ring
  const last = st.prog.find(c => c[0] === 0) ?? st.prog[0];
  events.push({ t, kind: 'chord', s: 0, dur: 0, vel: 0, triad: triadOf(key, last) });
  [last[0] - 12, last[0], last[2], last[1] + 12, (last[3] ?? last[0] + 12) + 12].forEach((s, i) =>
    events.push({ t: t + i * 0.09, kind: 'piano', s: key + s, dur: 5, vel: 0.4 - i * 0.03 }));
  for (const e of events) e.t = Math.max(0, e.t);
  events.sort((a, c) => a.t - c.t || Number(c.kind === 'chord') - Number(a.kind === 'chord'));   // a chord change before the notes on it
  return { style: st.name, key, bpm, length: t + 6, events };
}

/** The chord's root, third and fifth as the sound effects expect them: semitones from C with the root in 0..11. */
function triadOf(key: number, chord: number[]): [number, number, number] {
  const root = key + chord[0], shift = (((root % 12) + 12) % 12) - root;
  return [root + shift, key + chord[1] + shift, key + chord[2] + shift];
}

/** Seconds of quiet after a piece before the next one: room for the sea, but not so long the music seems gone. */
export const restAfter = (R: () => number): number => 20 + R() * 25;
