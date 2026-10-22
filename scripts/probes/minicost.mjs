// Sailing cost with the minimap off and on, on a phone at 4x CPU throttle: frame times and main-thread idle.
// Run: node scripts/probes/minicost.mjs http://localhost:5173
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(4000);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
for (const on of [false, true]) {
  await p.evaluate(on => { const { G, SET } = window.BR; G.talk = null; G.mode = 'play'; SET.minimap = on; G.keys.ArrowUp = true; }, on);
  await p.waitForTimeout(1500);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  const fr = await p.evaluate(ms => new Promise(res => { const t = []; let last = performance.now(); const end = last + ms; const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ med: +t[t.length >> 1].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1) }); } }; requestAnimationFrame(f); }), 4000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map(n => [n.id, n])); let idle = 0; for (const s of profile.samples) if (byId.get(s).callFrame.functionName === '(idle)') idle++;
  console.log('minimap', on, JSON.stringify(fr), 'idle', (idle / profile.samples.length * 100).toFixed(0) + '%');
}
await b.close();
