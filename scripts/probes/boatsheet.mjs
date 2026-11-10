// Every boat in the shipyard up close on open water, stitched into one contact sheet for looking at the models.
// Run against a server with the window.BR hooks: node scripts/probes/boatsheet.mjs http://localhost:5173 [out-dir] [ids,comma,separated]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/boats', only = process.argv[4]?.split(',');
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
await p.evaluate(() => {
  const { G, hAt } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.god = true; G.stats.caught = Math.max(5, G.stats.caught);
  const open = (x, y) => { for (let dx = -300; dx <= 300; dx += 40) for (let dy = -200; dy <= 200; dy += 40) if (hAt(x + dx, y + dy) > -0.2) return false; return true; };
  search: for (let r = 1500; r < 8000; r += 200) for (let k = 0; k < 24; k++) {
    const x = 280 + Math.cos(k / 24 * 6.28) * r, y = 280 + Math.sin(k / 24 * 6.28) * r;
    if (open(x, y)) { window.__sea = { x, y }; break search; }
  }
});
const ids = await p.evaluate(() => Object.keys(window.BR.MODELS.BOAT_MODELS).map(id => [id, window.BR.MODELS.BOAT_MODELS[id].rad]));   // every boat, and its sprite radius
const shots = [];
for (const [id, L] of ids) {   // L: the sprite radius, to size the view
  if (only && !only.includes(id)) continue;
  await p.evaluate(([id, L]) => {
    const { G, SET, apply } = window.BR, { x, y } = window.__sea;
    if (!G.owned.includes(id)) G.owned.push(id);
    G.boatId = id; SET.zoom = Math.min(2, 110 / L); apply();
    Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: -0.5, hp: 1e6 });   // whole: no battle damage drawn
  }, [id, L]);
  await p.waitForTimeout(700);
  const file = `${out}/${id}.png`;
  await p.screenshot({ path: file, clip: { x: 330, y: 200, width: 440, height: 360 } });
  shots.push([id, file]);
}
// the contact sheet
const sheet = await b.newPage({ viewport: { width: 1800, height: 300 } });
await sheet.setContent(`<body style="margin:0;background:#123;display:grid;grid-template-columns:repeat(4,440px);gap:6px;padding:6px;font:14px sans-serif;color:#fff">${shots.map(([id, f]) =>
  `<figure style="margin:0;position:relative"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:440px;display:block"><figcaption style="position:absolute;left:6px;top:4px">${id}</figcaption></figure>`).join('')}</body>`);
await sheet.screenshot({ path: `${out}/sheet.png`, fullPage: true });
console.log('shots', shots.length, 'errors', errs.length ? errs : 'none');
await b.close();
