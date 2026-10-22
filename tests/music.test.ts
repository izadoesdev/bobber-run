import { expect, test } from 'bun:test';
import { compose, restAfter, rng, STYLES } from '../src/music';

// The music is written fresh each time from a seed: the same seed is the same piece, other seeds are other pieces,
// and every piece stays quiet, in key and in a comfortable range.
const seeds = Array.from({ length: 60 }, (_, i) => 1000 + i * 7919);

test('a seed always writes the same piece, and different seeds write different ones', () => {
  expect(compose(42, false)).toEqual(compose(42, false));
  const melodies = new Set(seeds.map(s => compose(s, false).events.filter(e => e.kind === 'piano').map(e => `${e.s}@${e.t.toFixed(2)}`).join()));
  expect(melodies.size).toBe(seeds.length);
  const styles = new Set(seeds.map(s => compose(s, false).style)), keys = new Set(seeds.map(s => compose(s, false).key));
  expect(styles.size).toBeGreaterThanOrEqual(3); expect(keys.size).toBeGreaterThanOrEqual(4);
});
test('night plays the night styles, and the next piece is never the style just played', () => {
  const night = new Set(STYLES.filter(s => s.night).map(s => s.name));
  for (const s of seeds) {
    const p = compose(s, true);
    expect(night.has(p.style)).toBe(true);
    expect(compose(s + 1, true, p.style).style).not.toBe(p.style);
  }
});
test('every note is in the piece\'s key (its scale or its chords) and within the piano range used', () => {
  for (const s of seeds) for (const night of [false, true]) {
    const p = compose(s, night), st = STYLES.find(x => x.name === p.style)!;
    const allowed = new Set([...st.scale, ...st.prog.flat()].map(x => (((x + p.key) % 12) + 12) % 12));
    for (const e of p.events) {
      if (e.kind === 'chord') continue;
      expect(allowed.has(((e.s % 12) + 12) % 12)).toBe(true);
      expect(e.s).toBeGreaterThanOrEqual(-36); expect(e.s).toBeLessThanOrEqual(36);
      expect(e.vel).toBeGreaterThan(0); expect(e.vel).toBeLessThanOrEqual(1);
    }
  }
});
test('pieces run one to four minutes, stay sparse, start with an intro and end on a held chord', () => {
  for (const s of seeds) {
    const p = compose(s, s % 2 === 0), piano = p.events.filter(e => e.kind === 'piano');
    expect(p.length).toBeGreaterThan(60); expect(p.length).toBeLessThan(240);
    expect(piano.length / p.length).toBeLessThan(5);             // calm: a handful of notes a second at most
    expect(p.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t)).toBe(true);
    expect(p.events.at(-1)!.t).toBeLessThan(p.length);
    expect(p.events[0].kind).toBe('chord');                       // the sound effects know the harmony from the first note
    expect(piano.at(-1)!.dur).toBeGreaterThanOrEqual(4);          // the last chord rings out
  }
});
test('between pieces the sea gets half a minute to a minute and a half of quiet', () => {
  const R = rng(7);
  for (let i = 0; i < 200; i++) { const r = restAfter(R); expect(r).toBeGreaterThanOrEqual(30); expect(r).toBeLessThanOrEqual(80); }
});
