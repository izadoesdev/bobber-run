// The music: short, quiet piano pieces with silence between them, in the manner of calm game soundtracks (soft piano,
// slow extended chords, a few notes and a lot of space). Every piece is written fresh from a seed: a style (texture,
// mode, tempo, progression), a key, a two-bar motif and the variations it goes through, so no two plays are alike.
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
  name: string; night: boolean; day: boolean;
  bpm: number; texture: Texture;
  /** eighths (2) or quarters (1) for broken-chord textures */
  arpRate: 1 | 2;
  /** the scale melodies are drawn from, semitones above the key */
  scale: number[];
  /** chords as semitones above the key, root first, then third and fifth, then colour tones */
  prog: number[][];
  barsPerChord: 1 | 2;
  /** notes in a motif, low..high */
  density: [number, number];
}
const IONIAN = [0, 2, 4, 5, 7, 9, 11], LYDIAN = [0, 2, 4, 6, 7, 9, 11], PENTA = [0, 2, 4, 7, 9];
const DORIAN = [0, 2, 3, 5, 7, 9, 10], AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
export const STYLES: Style[] = [
  { name: 'Tide', day: true, night: false, bpm: 72, texture: 'arp', arpRate: 2, scale: IONIAN, barsPerChord: 2, density: [3, 5],
    prog: [[0, 4, 7, 14], [4, 7, 11, 14], [5, 9, 12, 16], [5, 8, 12, 14]] },              // I add9, iii7, IVmaj7, iv6 (borrowed)
  { name: 'Lantern', day: true, night: true, bpm: 60, texture: 'pad', arpRate: 1, scale: LYDIAN, barsPerChord: 2, density: [2, 4],
    prog: [[0, 4, 7, 14], [2, 6, 9, 13], [0, 4, 7, 11], [9, 12, 16, 23]] },               // I add9, II, Imaj7, vi add9
  { name: 'Driftwood', day: true, night: true, bpm: 66, texture: 'ostinato', arpRate: 1, scale: IONIAN, barsPerChord: 1, density: [3, 5],
    prog: [[5, 9, 12, 16], [0, 4, 7, 14], [5, 9, 12, 16], [9, 12, 16, 19]] },             // IVmaj7, I add9, IVmaj7, vi7
  { name: 'Gull', day: true, night: false, bpm: 84, texture: 'block', arpRate: 2, scale: PENTA, barsPerChord: 1, density: [4, 6],
    prog: [[0, 4, 7, 14], [7, 11, 14, 21], [9, 12, 16, 19], [5, 9, 12, 14]] },            // I add9, V add9, vi7, IV add9
  { name: 'Hollow', day: false, night: true, bpm: 58, texture: 'pad', arpRate: 1, scale: DORIAN, barsPerChord: 2, density: [2, 4],
    prog: [[0, 3, 7, 10, 14], [5, 9, 12, 14], [8, 12, 15, 19], [10, 14, 17, 24]] },      // i9, IV add9, bVImaj7, bVII add9
  { name: 'Glass', day: false, night: true, bpm: 64, texture: 'arp', arpRate: 1, scale: AEOLIAN, barsPerChord: 2, density: [2, 4],
    prog: [[0, 3, 7, 14], [8, 12, 15, 19], [3, 7, 10, 17], [10, 14, 17, 19]] },           // i add9, bVImaj7, bIII add9, bVII6
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

// a motif: notes on an eighth-note grid over two bars, pitched as scale steps from the key
interface MotifNote { on: number; len: number; deg: number }
const PHRASE = 16;                                                // eighths in a two-bar phrase

function makeMotif(R: () => number, [lo, hi]: [number, number], start: number): MotifNote[] {
  const n = lo + Math.floor(R() * (hi - lo + 1)), ons = new Set<number>([R() < 0.7 ? 0 : 2]);
  while (ons.size < n) ons.add(Math.floor(R() * 13));
  const sorted = [...ons].sort((a, b) => a - b);
  let deg = start;
  return sorted.map((on, i) => {
    if (i > 0) {                                                  // mostly steps, now and then a leap; rising, then falling back
      const up = i < sorted.length / 2 ? 0.65 : 0.35, leap = R() < 0.2 ? 2 : 1;
      deg += (R() < up ? 1 : -1) * (R() < 0.15 ? 0 : leap);
    }
    const len = (i + 1 < sorted.length ? sorted[i + 1] : PHRASE) - on;
    return { on, len, deg };
  });
}
/** One of the small changes a motif goes through each time it comes back. */
function vary(m: MotifNote[], R: () => number): MotifNote[] {
  const v = m.map(x => ({ ...x })), last = v.length - 1;
  switch (Math.floor(R() * 5)) {
    case 0: v[last].deg += R() < 0.5 ? 1 : -2; if (last > 0) v[last - 1].deg += R() < 0.5 ? 1 : -1; break;   // a new ending
    case 1: { const k = R() < 0.5 ? 1 : -1; for (const x of v) x.deg += k; break; }                        // the same shape a step away
    case 2: {                                                                                                // one note early or late
      const i = 1 + Math.floor(R() * Math.max(1, last)), x = v[i];
      if (x && x.len > 1 && v[i - 1].len > 1) { const d = R() < 0.5 ? -1 : 1; x.on += d; x.len -= d; v[i - 1].len += d; }
      break;
    }
    case 3: return v.slice(0, Math.max(2, Math.ceil(v.length / 2))).map((x, i, a) => i === a.length - 1 ? { ...x, len: PHRASE - x.on } : x);   // just the start, then space
    case 4: {                                                                                                // a passing note fills a gap
      const i = v.findIndex((x, k) => k < last && Math.abs(v[k + 1].deg - x.deg) === 2 && x.len >= 2);   // a scale step between them
      if (i >= 0) { const x = v[i], half = Math.floor(x.len / 2); v.splice(i + 1, 0, { on: x.on + half, len: x.len - half, deg: (x.deg + v[i + 1].deg) / 2 }); x.len = half; }
      break;
    }
  }
  return v;
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
export function compose(seed: number, night: boolean, avoid?: string): Piece {
  const R = rng(seed), styles = STYLES.filter(s => (night ? s.night : s.day) && s.name !== avoid);
  const st = styles[Math.floor(R() * styles.length)], key = KEYS[Math.floor(R() * KEYS.length)];
  const bpm = st.bpm + Math.round((R() - 0.5) * 10), beat = 60 / bpm, bar = beat * 4, eighth = beat / 2;
  // now and then a chord gives way to a neighbour, or the progression starts elsewhere
  let prog = st.prog.map(c => [...c]);
  if (R() < 0.4) { const k = 1 + Math.floor(R() * (prog.length - 1)); prog = [...prog.slice(k), ...prog.slice(0, k)]; }
  if (R() < 0.3) { const i = 1 + Math.floor(R() * (prog.length - 1)); prog[i] = [...prog[(i + 2) % prog.length]]; }
  const cycleBars = prog.length * st.barsPerChord, events: MusicEvent[] = [];
  const human = () => (R() - 0.5) * 0.024, soft = (v: number) => v * (0.85 + R() * 0.3);
  const chordAt = (b: number) => prog[Math.floor(b / st.barsPerChord) % prog.length];
  const melodyBase = key + 12, lower = st.texture === 'pad' ? 0 : -2;   // around C5, two scale steps lower over busier textures

  // the form: intro, A, B, A again, outro; long cycles get a shorter intro, and a long piece may skip B or the return
  type Section = { kind: 'intro' | 'A' | 'B' | 'A2' | 'outro'; bars: number };
  const body = Math.max(cycleBars, 8);                              // a short progression goes round twice in a section
  const form: Section[] = [{ kind: 'intro', bars: cycleBars > 8 ? 4 : cycleBars }, { kind: 'A', bars: body }];
  if (R() < 0.8) form.push({ kind: 'B', bars: body });
  if (R() < 0.75 || form.length < 3) form.push({ kind: 'A2', bars: body });
  form.push({ kind: 'outro', bars: Math.min(4, cycleBars) });

  const startDeg = st.scale.indexOf(prog[0][2] % 12) >= 0 ? st.scale.indexOf(prog[0][2] % 12) : 2;
  const motif = makeMotif(R, st.density, startDeg), motifB = makeMotif(R, [Math.max(2, st.density[0] - 1), st.density[1] - 1], startDeg + (R() < 0.5 ? 2 : -1));
  let t = 0, b = 0;                                                 // seconds and bars from the start

  const accompany = (barT: number, chord: number[], first: boolean, vel: number, slow: number, left: number) => {
    // `left`: seconds until the chord changes; with the pedal down, every note rings until then
    const pc = (((key + chord[0]) % 12) + 12) % 12, low = pc <= 4 ? pc - 12 : pc - 24;   // the root between F2 and E3
    const voice = [low, low + (chord[2] - chord[0]), low + 12 + (chord[1] - chord[0]), low + 12 + ((chord[3] ?? chord[0] + 12) - chord[0])];
    if (first) {
      events.push({ t: barT, kind: 'chord', s: 0, dur: 0, vel: 0, triad: triadOf(key, chord) });
      events.push({ t: barT + human(), kind: 'bass', s: low - 12, dur: left, vel: soft(0.4 * vel) });
      if (st.texture === 'pad') for (const s of voice.slice(1)) events.push({ t: barT, kind: 'pad', s, dur: left, vel: 0.5 * vel });
    }
    if (st.texture === 'arp') {
      const pattern = st.arpRate === 2 ? [0, 1, 2, 3, 2, 1, 2, 1] : [0, 1, 2, 3];
      const dt = st.arpRate === 2 ? eighth * slow : beat * slow;
      pattern.forEach((k, i) => events.push({ t: barT + i * dt + human(), kind: 'piano', s: voice[k], dur: Math.max(dt, left - i * dt), vel: soft((i % (st.arpRate === 2 ? 4 : 2) === 0 ? 0.36 : 0.26) * vel) }));
    } else if (st.texture === 'block') {
      voice.forEach((s, i) => events.push({ t: barT + i * 0.04 + human(), kind: 'piano', s, dur: left, vel: soft(0.3 * vel) }));   // rolled
      if (R() < 0.45) voice.slice(1).forEach((s, i) => events.push({ t: barT + beat * 2 * slow + i * 0.04 + human(), kind: 'piano', s, dur: Math.max(beat, left - beat * 2 * slow), vel: soft(0.18 * vel) }));
    } else if (st.texture === 'ostinato') {
      [0, 1, 2, 1].forEach((k, i) => events.push({ t: barT + i * beat * slow + human(), kind: 'piano', s: voice[k], dur: Math.max(beat, left - i * beat * slow), vel: soft((i === 0 ? 0.32 : 0.22) * vel) }));
    } else if (first && R() < 0.6) {
      events.push({ t: barT + human(), kind: 'piano', s: voice[0], dur: left, vel: soft(0.26 * vel) });          // pads: now and then a low piano note
    }
  };
  const sing = (phraseT: number, m: MotifNote[], bar0: number, lift: number, vel: number, slow: number, octaves = false) => {
    for (const x of m) {
      const at = bar0 + Math.floor(x.on / 8), chord = chordAt(at).map(c => c + key + 12);
      // a passing note (a half step) sits between its two scale notes
      let s = melodyBase + step(st.scale, Math.round(x.deg) + lower + lift);   // `lift` moves the register in scale steps
      if (x.on % 4 === 0) s = nearestChordTone(s, chord);         // strong beats land on a chord tone
      while (s > 31) s -= 12;                                     // nothing above G6
      const at0 = phraseT + x.on * eighth * slow + human(), dur = Math.max(x.len * eighth * slow * 2.2, 1.2);
      events.push({ t: at0, kind: 'piano', s, dur, vel: soft(0.55 * vel) });
      if (octaves) events.push({ t: at0 + 0.012, kind: 'piano', s: s - 12, dur, vel: soft(0.32 * vel) });
    }
  };

  for (const sec of form) {
    const slowEnd = sec.kind === 'outro';
    let cur = motif;
    for (let i = 0; i < sec.bars; i++, b++) {
      // the outro slows toward the last chord, and every section breathes a little at its end
      const slow = slowEnd ? 1 + 0.06 * i : i === sec.bars - 1 ? 1.07 : 1;
      const vel = sec.kind === 'intro' ? 0.8 : sec.kind === 'B' ? 0.85 : sec.kind === 'outro' ? 0.75 - 0.1 * i : 1;
      const left = (st.barsPerChord - (b % st.barsPerChord) + (slowEnd ? 1 : 0)) * bar * slow;
      if (!(slowEnd && i % 2 === 1)) accompany(t, chordAt(b), b % st.barsPerChord === 0, vel, slow, left);
      if (i % 2 === 0 && i + 1 < sec.bars + (slowEnd ? 0 : 1)) {
        const phrase = i / 2;
        if (sec.kind === 'A' || sec.kind === 'A2') {
          // call and response: the motif, then a variation; a phrase is sometimes left out to leave room
          if (phrase > 0 && R() < 0.2) { /* space */ } else {
            if (phrase % 2 === 1 || sec.kind === 'A2') cur = vary(cur, R);
            else if (phrase > 0) cur = motif;
            sing(t, cur, b, sec.kind === 'A2' && R() < 0.35 ? st.scale.length : 0, 1, slow, sec.kind === 'A2' && R() < 0.5);   // the return, sometimes an octave up, sometimes in octaves
          }
        } else if (sec.kind === 'B' && R() < 0.75) {
          sing(t, phrase % 2 ? vary(motifB, R) : motifB, b, R() < 0.5 ? -3 : 0, 0.85, slow);
        }
      }
      t += bar * slow;
    }
  }
  // the last chord: the home chord, rolled slowly and left to ring
  const home = st.prog.find(c => c[0] === 0) ?? st.prog[0];        // the style's own home chord, even if a variant replaced it
  events.push({ t, kind: 'chord', s: 0, dur: 0, vel: 0, triad: triadOf(key, home) });
  [home[0] - 12, home[0], home[2], home[1] + 12, (home[3] ?? home[0] + 12) + 12].forEach((s, i) =>
    events.push({ t: t + i * 0.09, kind: 'piano', s: key + s, dur: 5, vel: 0.34 - i * 0.03 }));
  for (const e of events) e.t = Math.max(0, e.t);
  events.sort((a, c) => a.t - c.t || Number(c.kind === 'chord') - Number(a.kind === 'chord'));   // a chord change before the notes on it
  return { style: st.name, key, bpm, length: t + 6, events };
}

/** The chord's root, third and fifth as the sound effects expect them: semitones from C with the root in 0..11. */
function triadOf(key: number, chord: number[]): [number, number, number] {
  const root = key + chord[0], shift = (((root % 12) + 12) % 12) - root;
  return [root + shift, key + chord[1] + shift, key + chord[2] + shift];
}

/** Seconds of quiet after a piece before the next one, as calm soundtracks leave room for the sea. */
export const restAfter = (R: () => number): number => 30 + R() * 50;
