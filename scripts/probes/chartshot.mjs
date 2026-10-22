// Screenshots of the sea chart (both zooms), the minimap and the port route map, with a few places charted.
// Run: node scripts/probes/chartshot.mjs http://localhost:5173 /tmp/boatlab/shot
import { chromium } from '@playwright/test';
const out = process.argv[3] || '/tmp/boatlab/shot';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G, SET, poisNear } = window.BR; G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.toasts = [];
  for (const q of poisNear(G.boat.x, G.boat.y, 2200)) if (Math.random() < 0.7) G.found.add(q.id);
  G.waypoint = { x: G.boat.x + 500, y: G.boat.y + 260 }; SET.minimap = true; G.mode = 'play'; });
await p.waitForTimeout(1500);
await p.locator('.mini').screenshot({ path: `${out}-mini.png` });
for (const z of [1, 2]) {
  await p.evaluate(z => { const { G } = window.BR; G.map.x = G.map.y = 0; G.map.zoom = z; G.mode = 'map'; }, z);
  await p.waitForTimeout(2000);
  await p.screenshot({ path: `${out}-map${z}.png` });
}
await p.evaluate(() => { const { G } = window.BR; G.map.x = 0; G.map.y = -2600; G.map.zoom = 2; });
await p.waitForTimeout(2000); await p.screenshot({ path: `${out}-north.png` });
await p.evaluate(() => { const { G } = window.BR; G.map.x = 600; G.map.y = 2400; G.map.zoom = 2; });
await p.waitForTimeout(2000); await p.screenshot({ path: `${out}-south.png` });
console.log(JSON.stringify(errs));
await b.close();
