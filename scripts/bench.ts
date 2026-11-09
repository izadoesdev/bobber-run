// CPU microbenchmarks for the pure world pipeline: what a tile worker, the chart worker and sailing into new sea
// cost per unit of work, without a browser. Every round samples fresh sea (far from the last), so caches start cold
// the way they do when you sail somewhere new. Run: bun scripts/bench.ts [filter] [--json]
import { heightAt, tileHeights, getTile, poisNear, schoolsNear, claimableNear, TS } from '../src/world';
import { sampleTile, N, NC, BANDS } from '../src/ui/chartsample';
import { seaPropsNear } from '../src/seaprops';
import { compose } from '../src/music';

/** run does `n` units of work in fresh sea and returns n; setup (untimed) prepares that sea. */
interface Case { name: string; unit: string; setup?: (round: number) => void; run: (round: number) => number }
let sink = 0;                                  // results land here so no work is optimised away
// each round starts this far from the last, in world units: past every cache's reach
const FAR = 40_000;
const origin = (round: number) => ({ x: 280 + (round % 7) * FAR, y: 280 + Math.floor(round / 7) * FAR });

const H = new Uint16Array(N * N), C = new Uint8Array(NC * BANDS * NC * 4);
const CASES: Case[] = [
  { name: 'heightAt', unit: '1k samples', run: r => {
    const o = origin(r);
    for (let i = 0; i < 4000; i++) sink += heightAt(o.x + (i % 64) * 7.3, o.y + Math.floor(i / 64) * 7.3);
    return 4;
  } },
  { name: 'tileHeights', unit: 'tile', run: r => {
    const o = origin(r), tx = Math.floor(o.x / TS), ty = Math.floor(o.y / TS);
    for (let k = 0; k < 4; k++) tileHeights(tx + (k & 1), ty + (k >> 1));
    return 4;
  } },
  { name: 'chart tile l0', unit: 'tile', run: r => {
    const o = origin(r), tx = Math.floor(o.x / 128), ty = Math.floor(o.y / 128);
    for (let k = 0; k < 4; k++) sampleTile(0, tx + k, ty, H, C);
    return 4;
  } },
  { name: 'chart tile l3', unit: 'tile', run: r => {
    const o = origin(r), tx = Math.floor(o.x / 1024), ty = Math.floor(o.y / 1024);
    for (let k = 0; k < 2; k++) sampleTile(3, tx + k, ty, H, C);
    return 2;
  } },
  { name: 'seaProps', unit: 'tile',
    setup: r => { const o = origin(r); for (let k = -1; k < 5; k++) for (let j = -1; j < 2; j++) getTile(Math.floor(o.x / TS) + k, Math.floor(o.y / TS) + j); },
    run: r => { const o = origin(r); sink += seaPropsNear(o.x + 2 * TS, o.y + TS / 2, TS * 1.5, [], true).length; return 4; } },
  { name: 'sail 1k units', unit: '1k units', run: r => {
    // what sailing into new sea asks of the world each step: landmarks, schools and islands round the boat
    const o = origin(r);
    for (let d = 0; d < 1000; d += 20) { poisNear(o.x + d, o.y, 900); schoolsNear(o.x + d, o.y, 600); claimableNear(o.x + d, o.y, 1500); }
    return 1;
  } },
  { name: 'compose music', unit: 'piece', run: r => { compose(1000 + r, r % 2 === 1); return 1; } },
];

const filter = process.argv.slice(2).find(a => !a.startsWith('--')), json = process.argv.includes('--json');
const ROUNDS = 12, WARM = 2;
const out: Record<string, { median: number; min: number; unit: string }> = {};
let round = 0;
for (const c of CASES) {
  if (filter && !c.name.includes(filter)) continue;
  const per: number[] = [];
  for (let i = 0; i < WARM + ROUNDS; i++) {
    c.setup?.(round);
    const t0 = performance.now(), n = c.run(round++), ms = performance.now() - t0;
    if (i >= WARM) per.push(ms / n);
  }
  per.sort((a, b) => a - b);
  out[c.name] = { median: per[per.length >> 1], min: per[0], unit: c.unit };
}
if (json) console.log(JSON.stringify(out));
else if (sink === Infinity) console.log('');
else for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(16)} ${v.median.toFixed(3).padStart(9)} ms/${v.unit}  (min ${v.min.toFixed(3)})`);
