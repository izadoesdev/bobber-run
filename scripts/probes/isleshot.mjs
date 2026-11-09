// Islands on the chart: hover each island near home and record what the popup says, then screenshot the chart.
// node scripts/probes/isleshot.mjs http://localhost:4871 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/islelab';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const info = await p.evaluate(() => {
  const { G, homePort, poisNear, NET } = window.BR, h = homePort();
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null;
  for (const q of poisNear(h.x, h.y, 4000)) G.found.add(q.id);
  return { on: NET.on };
});
console.log(JSON.stringify(info, null, 1));
await p.evaluate(() => { const { G } = window.BR; G.mode = 'map'; });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/chart.png` });
await b.close();
