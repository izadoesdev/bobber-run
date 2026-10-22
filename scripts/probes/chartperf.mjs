// Sea chart cost: CPU profile while the chart is open (zoom 1 and 2, panning), self time by function, frame times,
// and screenshots. Run: node scripts/probes/chartperf.mjs http://localhost:5173 [out-prefix]
import { chromium } from '@playwright/test';
const out = process.argv[3] || '/tmp/boatlab/chart';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G } = window.BR; G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.mode = 'play'; });
await p.waitForTimeout(800);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
const frames = () => p.evaluate(ms => new Promise(res => { const t = []; let last = performance.now(); const end = last + ms; const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, med: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), max: +t[t.length - 1].toFixed(1) }); } }; requestAnimationFrame(f); }), 2500);
const res = {};
async function phase(name, setup, pan) {
  await p.evaluate(setup);
  await cdp.send('Profiler.start');
  const fr = p.evaluate(ms => new Promise(res => { const t = []; let last = performance.now(); const end = last + ms; const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, med: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), max: +t[t.length - 1].toFixed(1) }); } }; requestAnimationFrame(f); }), 3000);
  if (pan) for (let i = 0; i < 30; i++) { await p.evaluate(i => { const m = window.BR.G.map; m.x += 60 * (m.zoom === 2 ? 2 : 1); m.y += 25; }, i); await p.waitForTimeout(90); }
  const f = await fr;
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), total = profile.samples.length;
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  for (const s of profile.samples) { const n = byId.get(s), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + 1); }
  const top = [...self].sort((a, b) => b[1] - a[1]).filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).slice(0, 12).map(([k, v]) => `${(v / total * 100).toFixed(1)}% ${k}`);
  const idle = ((self.get('(idle) :0') || 0) / total * 100).toFixed(0);
  res[name] = { frames: f, idlePct: idle, top };
  await p.screenshot({ path: `${out}-${name}.png` });
}
await phase('play', () => { window.BR.G.mode = 'play'; });
await phase('map1', () => { const { G } = window.BR; G.map.x = G.map.y = 0; G.map.zoom = 1; G.mode = 'map'; });
await phase('map1pan', () => {}, true);
await phase('map2', () => { const { G } = window.BR; G.map.x = G.map.y = 0; G.map.zoom = 2; G.mode = 'map'; });
await phase('map2pan', () => {}, true);
console.log(JSON.stringify({ res, errs }, null, 1));
await b.close();
