// The chart zoomed out with the regions: names, borders, and closed ones hatched, for a new captain (story 0) and a
// mid-story one (story 7). Run: node scripts/probes/regionshot.mjs http://localhost:5173
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
for (const story of [0, 7]) {
  await p.evaluate(story => {
    const { G, sim } = window.BR, b0 = { x: G.boat.x, y: G.boat.y }; G.talk = null; G.story = { i: story, base: { ...G.stats }, shown: true }; G.mode = 'play';
    for (let y = -3200; y <= 3200; y += 400) for (let x = -3600; x <= 3600; x += 400) { G.boat.x = b0.x + x; G.boat.y = b0.y + y; sim(0.26); }
    Object.assign(G.boat, b0); G.boat.vx = G.boat.vy = 0; G.map.x = G.map.y = 0; G.map.zoom = 2; G.mode = 'map';
  }, story);
  await p.waitForTimeout(2500); await p.mouse.move(700, 380); await p.waitForTimeout(600); await p.screenshot({ path: `/tmp/boatlab/regions-s${story}.png` });
}
// the banner when a story step opens new waters
await p.evaluate(() => { const { G, sim } = window.BR; G.mode = 'play'; G.story.i = 2; sim(0.3); G.story.i = 3; sim(0.3); G.talk = null; G.mode = 'play'; });
await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/boatlab/regions-open.png' });
console.log(JSON.stringify(errs)); await b.close();
