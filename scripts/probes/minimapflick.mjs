// The minimap while sailing: grabs its canvas every animation frame for 3 s, and reports how often it changes, how
// much from one frame to the next (big jumps read as flicker), and saves a strip of frames.
// Run: node scripts/probes/minimapflick.mjs http://localhost:5173 [out]
import { chromium } from '@playwright/test';
const out = process.argv[3] || '/tmp/boatlab/mini';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G, SET } = window.BR; G.talk = null; G.story = { i: 99, base: {}, shown: true }; SET.minimap = true; G.mode = 'play'; G.waypoint = { x: G.boat.x + 400, y: G.boat.y - 300 }; });
await p.waitForTimeout(1500);
await p.keyboard.down('ArrowUp');
const r = await p.evaluate(() => new Promise(res => {
  const c = document.querySelector('.mini canvas'), frames = [], diffs = [], strip = [];
  let prev = null, n = 0;
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d', { willReadFrequently: true });
  const f = () => {
    x.clearRect(0, 0, g.width, g.height); x.drawImage(c, 0, 0);
    const d = x.getImageData(0, 0, g.width, g.height).data;
    if (prev) { let s = 0, ch = 0; for (let i = 0; i < d.length; i += 16) { const v = Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]); s += v; if (v > 60) ch++; } diffs.push([Math.round(s / (d.length / 16)), ch]); }
    if (n % 6 === 0 && strip.length < 8) strip.push(g.toDataURL());
    prev = d; n++;
    if (n < 180) requestAnimationFrame(f); else res({ n, diffs, strip });
  };
  requestAnimationFrame(f);
}));
await p.keyboard.up('ArrowUp');
const same = r.diffs.filter(d => d[0] === 0).length, big = r.diffs.filter(d => d[1] > 400).length;
console.log(JSON.stringify({ frames: r.n, unchangedFrames: same, bigJumps: big, diffs: r.diffs.slice(0, 60).map(d => d.join(':')).join(' '), errs }));
const fs = await import('node:fs');
r.strip.forEach((u, i) => fs.writeFileSync(`${out}-${i}.png`, Buffer.from(u.split(',')[1], 'base64')));
await b.close();
