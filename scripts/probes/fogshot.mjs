// The chart with the fog of war after a simulated voyage east of home, at both zooms. Run: node scripts/probes/fogshot.mjs http://localhost:5173
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => {
  const { G, homePort, sim } = window.BR, h = homePort(); G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.mode = 'play';
  // a voyage east, stepped through the game's own tick (which reveals the sea round the boat)
  for (let t = 0; t < 1; t += 0.01) { G.boat.x = h.x + t * 1400; G.boat.y = h.y + Math.sin(t * 6) * 300 + t * 500; sim(0.26); }
  G.boat.x = h.x + 1400; G.boat.y = h.y + 500;
  G.map.x = -500; G.map.y = -200; G.map.zoom = 2; G.mode = 'map';
});
await p.waitForTimeout(2000); await p.screenshot({ path: '/tmp/boatlab/fog-map2.png' });
await p.evaluate(() => { const { G } = window.BR; G.map.x = 0; G.map.y = 0; G.map.zoom = 1; });
await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/boatlab/fog-map1.png' });
console.log(JSON.stringify(errs)); await b.close();
