// The K-key specials: a spinnaker on every sail (set before the wind, flogging close-hauled, blowing out in a gale),
// the research vessel's ping on the chart, and a steamer's horn.
// Run against a server with the window.BR hooks: node scripts/probes/kspecials.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/kspecials';
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
// off: the heading's angle from where the wind blows to (0 = dead before it)
const put = (id, zoom, off = 0) => p.evaluate(([id, zoom, off]) => {
  const { G, SET, apply, SPECIAL } = window.BR, { x, y } = window.__sea;
  if (!G.owned.includes(id)) G.owned.push(id);
  G.boatId = id; SET.zoom = zoom; apply();
  Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: SPECIAL.windAngle() + off, hp: 1e6 });
}, [id, zoom, off]);
const state = () => p.evaluate(() => ({ spin: window.BR.SPECIAL.rig.spin, up: window.BR.SPECIAL.state.spinUp, cool: window.BR.SPECIAL.state.cool, prompt: window.BR.G.prompt, speed: Math.hypot(window.BR.G.boat.vx, window.BR.G.boat.vy) }));
const shot = name => p.screenshot({ path: `${out}/${name}.png`, clip: { x: 200, y: 80, width: 700, height: 600 } });
const res = {};
for (const id of ['skiff', 'boatdev', 'catamaran', 'schooner', 'yacht', 'cutter']) {
  await put(id, id === 'schooner' || id === 'yacht' ? 1.6 : 2.2, 0.5);
  await p.waitForTimeout(400);
  await p.keyboard.press('k'); await p.waitForTimeout(1800);
  res[id] = await state();
  await shot(`spin-${id}`);
  await p.keyboard.press('k'); await p.waitForTimeout(800);
}
// close-hauled with it set: it flogs, and the prompt says to douse it
await put('yacht', 1.6, 0); await p.keyboard.press('k'); await p.waitForTimeout(1500);
await p.evaluate(() => { window.BR.G.boat.a = window.BR.SPECIAL.windAngle() + 2.6; });
await p.waitForTimeout(400); res.flog = await state(); await shot('spin-flog');
await p.keyboard.press('k'); await p.waitForTimeout(800);
// a gale: it strains, then blows out
await put('skiff', 2.2, 0.3); await p.evaluate(() => window.BR.setWeather('storm'));
await p.keyboard.press('k'); await p.waitForTimeout(9800);
res.gale = await state(); await shot('spin-blown');
await p.evaluate(() => window.BR.setWeather('clear'));
// the research vessel's ping, on the chart
await put('research', 1.6); await p.waitForTimeout(500);
await p.keyboard.press('k'); await p.waitForTimeout(450); await shot('ping-water');
await p.waitForTimeout(1500);
res.pingToast = await p.evaluate(() => [...document.querySelectorAll('.toast, [class*=toast]')].map(e => e.textContent).join(' | '));
await p.keyboard.press('m'); await p.waitForTimeout(1200); await p.screenshot({ path: `${out}/ping-chart.png` });
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
// a steamer's horn
await put('drifter', 1.6); await p.waitForTimeout(500);
await p.keyboard.press('k'); await p.waitForTimeout(450); await shot('horn-drifter');
console.log(JSON.stringify({ ...res, errors: errs.length ? errs : 'none' }, null, 1));
await b.close();
