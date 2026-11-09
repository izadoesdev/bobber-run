// Sailing into new sea, measured in a real browser: the boat is carried along a fixed course at cruising speed (the
// same course every run, so the world builds the same tiles, props and schools), while the page records frame
// intervals, long tasks and a CPU profile. Main-thread busy = share of profile samples not idle. Run against a
// production build: node scripts/probes/sailbench.mjs http://localhost:4980 [desktop|phone] [seconds]
// (phone: 390x844 at 3x with the CPU throttled 4x).
import { chromium } from '@playwright/test';
const url = process.argv[2], kind = process.argv[3] || 'desktop', secs = Number(process.argv[4] || 12);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext(kind === 'phone'
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
const errors = []; p.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await p.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: 'longtask' }); });
await p.goto(url + '?offline');
await p.waitForFunction(() => window.BR?.G && (window.BR.G.mode === 'play' || window.BR.G.mode === 'title'), null, { timeout: 60000 });
await p.evaluate(() => { const { G } = window.BR; G.talk = null; G.story = { i: 99, base: { ...G.stats }, shown: true }; G.mode = 'play'; });
await p.waitForTimeout(2500);                                     // the harbour's tiles and the first frames settle
if (kind === 'phone') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.evaluate(() => { window.__lt = []; });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
const fr = await p.evaluate(ms => new Promise((res, rej) => {
  // a course out of the harbour: east, then north-east, then north, at 150 world units a second
  const { G, homePort } = window.BR, hp = homePort(), legs = [[1, 0], [0.7, -0.7], [0, -1]], speed = 150;
  const t = []; let last = performance.now(); const start = last, end = last + ms;
  const f = now => { try { step(now); } catch (e) { rej(String(e)); } };
  const step = now => {
    const s = Math.max(0, now - start) / 1000, leg = Math.min(2, Math.floor(s / (ms / 3000))), b = G.boat;
    let x = hp.x + 60, y = hp.y + 60;
    for (let k = 0; k <= leg; k++) { const d = Math.min(s, (k + 1) * ms / 3000) - k * ms / 3000; if (d > 0) { x += legs[k][0] * speed * d; y += legs[k][1] * speed * d; } }
    Object.assign(b, { x, y, vx: legs[leg][0] * speed, vy: legs[leg][1] * speed, a: Math.atan2(legs[leg][1], legs[leg][0]), hp: 1e6 });
    G.talk = null; G.fish = null; if (G.mode !== 'play') G.mode = 'play';
    if (now > start) t.push(now - last);
    last = now;
    if (now < end) requestAnimationFrame(f);
    else { t.sort((a, c) => a - c); const q = k => +t[Math.min(t.length - 1, Math.floor(t.length * k))].toFixed(1); res({ n: t.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over33: t.filter(v => v > 33.4).length, over50: t.filter(v => v > 50).length }); }
  };
  requestAnimationFrame(f);
}), secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const lt = await p.evaluate(() => window.__lt);
const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
let idle = 0;
for (const s of profile.samples) {
  const n = byId.get(s), name = n.callFrame.functionName;
  if (name === '(idle)' || name === '(program)') { idle += name === '(idle)' ? 1 : 0; if (name === '(idle)') continue; }
  const k = `${name || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
  self.set(k, (self.get(k) || 0) + 1);
}
const tot = profile.samples.length, top = [...self].sort((a, c) => c[1] - a[1]).slice(0, Number(process.env.TOP || 15)).map(([k, v]) => `${(v / tot * 100).toFixed(1)}% ${k}`);
console.log(JSON.stringify({ kind, secs, frames: fr, busy: +((1 - idle / tot) * 100).toFixed(1), longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, c) => a + c, 0)), worstTask: Math.round(Math.max(0, ...lt)), errors, top }, null, 1));
await b.close();
