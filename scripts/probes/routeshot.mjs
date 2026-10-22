// A waypoint round an island: the dots on the sea and the line on the chart, for eyeballing the route's shape.
// Run: node scripts/probes/routeshot.mjs http://localhost:5173
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G, homePort } = window.BR, h = homePort(); G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.mode = 'play';
  Object.assign(G.boat, { x: h.dock.x, y: h.dock.y, vx: 0, vy: 0 }); G.waypoint = { x: h.x - 60, y: h.y - 420 }; });
await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/boatlab/route-sea.png' });
await p.evaluate(() => { const { G } = window.BR; G.map.x = 0; G.map.y = -200; G.map.zoom = 1; G.mode = 'map'; });
await p.waitForTimeout(1500); await p.screenshot({ path: '/tmp/boatlab/route-chart.png' });
console.log(JSON.stringify(errs)); await b.close();
