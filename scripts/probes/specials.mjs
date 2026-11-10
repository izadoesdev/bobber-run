// Boat specials: the speedboat's full throttle (its rooster tail) and the motor yacht's underwater lights at night.
// Run against a server with the window.BR hooks: node scripts/probes/specials.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/specials';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
await p.evaluate(() => {
  const { G, hAt, homePort } = window.BR, home = homePort();
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.god = true; G.stats.caught = Math.max(5, G.stats.caught);
  const open = (x, y) => { for (let dx = -400; dx <= 400; dx += 40) for (let dy = -400; dy <= 400; dy += 40) if (hAt(x + dx, y + dy) > -0.2) return false; return true; };
  search: for (let r = 900; r < 8000; r += 150) for (let k = 0; k < 24; k++) {
    const x = home.x + Math.cos(k / 24 * 6.28) * r, y = home.y + Math.sin(k / 24 * 6.28) * r;
    if (open(x, y)) { window.__sea = { x, y }; break search; }
  }
});
const put = (id, zoom) => p.evaluate(([id, zoom]) => {
  const { G, SET, apply } = window.BR, { x, y } = window.__sea;
  if (!G.owned.includes(id)) G.owned.push(id);
  G.boatId = id; SET.zoom = zoom; apply();
  Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: -0.5, hp: 1e6 });
}, [id, zoom]);
const shot = name => p.screenshot({ path: `${out}/${name}.png`, clip: { x: 200, y: 100, width: 700, height: 560 } });
// the speedboat, full ahead, then full throttle
await put('speedboat', 2);
await p.waitForTimeout(1500);
const tip = await p.evaluate(() => document.body.innerText.includes('open the throttles wide'));
await p.keyboard.down('ArrowUp'); await p.waitForTimeout(3000);
const plain = await p.evaluate(() => Math.hypot(window.BR.G.boat.vx, window.BR.G.boat.vy));
await p.keyboard.press('k'); await p.waitForTimeout(2500);
const fast = await p.evaluate(() => Math.hypot(window.BR.G.boat.vx, window.BR.G.boat.vy));
await p.screenshot({ path: `${out}/1-boost.png` });
const touchLabel = await p.evaluate(() => window.BR.G.prompt);
await p.keyboard.up('ArrowUp');
// the motor yacht at night
await put('motoryacht', 1.4);
await p.evaluate(() => { const { G } = window.BR, len = 480; G.clock = (Math.floor(G.clock / len) + 0.78) * len; });   // DAYLEN: night
await p.waitForTimeout(1500); await shot('2-yacht-night');
await put('flagship', 1.4); await p.waitForTimeout(1200); await shot('3-flagship-night');
console.log(JSON.stringify({ tip, plain, fast, touchLabel, errors: errs.length ? errs : 'none' }));
await b.close();
