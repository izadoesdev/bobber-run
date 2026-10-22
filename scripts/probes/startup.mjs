// Startup and play cost on a phone-like budget: CPU throttled 4x (and optionally a 4G network), time until the game
// has a first frame and is playable, long tasks while loading, then a CPU profile of 6 s of sailing (self time by
// function) and frame times. Run against a production build: node scripts/probes/startup.mjs http://localhost:4980 [net]
import { chromium } from '@playwright/test';
const url = process.argv[2], net = process.argv[3] === 'net';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8 });
await p.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
const t0 = Date.now();
await p.goto(url + '?offline');
await p.waitForFunction(() => window.BR?.G && (window.BR.G.mode === 'play' || window.BR.G.mode === 'title'), null, { timeout: 60000 });
const ready = Date.now() - t0;
await p.waitForTimeout(3000);
const lt = await p.evaluate(() => window.__lt);
const nav = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp && Math.round(fcp.startTime) }; });
await p.evaluate(() => { const { G } = window.BR; G.talk = null; G.mode = 'play'; });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 300 }); await cdp.send('Profiler.start');
const fr = await p.evaluate(ms => new Promise(res => { const t = []; let last = performance.now(); const end = last + ms; const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, med: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), max: +t[t.length - 1].toFixed(1) }); } }; requestAnimationFrame(f); }), 6000);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
for (const s of profile.samples) { const n = byId.get(s), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + 1); }
const tot = profile.samples.length, top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => `${(v / tot * 100).toFixed(1)}% ${k}`);
console.log(JSON.stringify({ ready, nav, longTasks: lt.length, longest: lt.sort((a, b) => b[1] - a[1]).slice(0, 6), frames: fr, top }, null, 1));
await b.close();
