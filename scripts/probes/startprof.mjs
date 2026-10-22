import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(4000);   // warm the module cache
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await p.reload(); await p.waitForFunction(() => window.BR?.G, null, { timeout: 60000 }); await p.waitForTimeout(2500);
const { profile } = await cdp.send('Profiler.stop');
// total (inclusive) time per function, by walking samples up the tree
const byId = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map(), self = new Map(), dts = profile.timeDeltas;
profile.samples.forEach((s, i) => {
  const dt = dts[i] / 1000; let id = s; const seen = new Set();
  const n0 = byId.get(s), k0 = `${n0.callFrame.functionName || '(anon)'} ${n0.callFrame.url.split('/').pop().split('?')[0]}:${n0.callFrame.lineNumber + 1}`;
  self.set(k0, (self.get(k0) || 0) + dt);
  while (id) { const n = byId.get(id), k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`; if (!seen.has(k)) { incl.set(k, (incl.get(k) || 0) + dt); seen.add(k); } id = parent.get(id); }
});
const fmt = m => [...m].filter(([k]) => !/^\((idle|program|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0)}ms ${k}`);
console.log('INCLUSIVE\n' + fmt(incl).join('\n') + '\nSELF\n' + fmt(self).slice(0, 15).join('\n'));
await b.close();
