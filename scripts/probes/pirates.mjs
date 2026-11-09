// Screenshots of the pirate content: a cove, a fight at sea, a buried treasure X, and the chart with coves and ships.
// Run against the dev server (it needs the window.BR hooks): node scripts/probes/pirates.mjs http://127.0.0.1:5173 [out-dir]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:5173', out = process.argv[3] || '/tmp/boatlab/pirates';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
// a cove with open water off its anchorage
const cove = await p.evaluate(() => {
  const { G, poisNear, hAt } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.up.cannon = 3; G.boatId = 'schooner'; G.owned.push('schooner');
  for (let r = 2500; r < 9000; r += 300) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    for (const c of poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 400)) if (c.type === 'cove' && !poisNear(c.x, c.y, 800).some(q => q.type === 'port' && Math.hypot(q.x - c.x, q.y - c.y) < 800)) return { x: c.x, y: c.y, ang: c.ang, ax: c.anchor.x, ay: c.anchor.y, name: c.name };
  }
  return null;
});
console.log('cove', JSON.stringify(cove));
const shot = async (name, ms = 1500) => { await p.waitForTimeout(ms); await p.screenshot({ path: `${out}/${name}.png` }); };
const place = (x, y, a) => p.evaluate(([x, y, a]) => { const { G } = window.BR; Object.assign(G.boat, { x, y, px: x, py: y, a, vx: 0, vy: 0 }); G.cam.x = x - 160; G.cam.y = y - 100; G.mode = 'play'; }, [x, y, a]);
// 1. the cove, its fleet riding at anchor (quiet: god mode keeps their shot off you)
await p.evaluate(() => { window.BR.SET.pirates = true; });
await place(cove.ax + Math.cos(cove.ang) * 40, cove.ay + Math.sin(cove.ang) * 40, cove.ang + Math.PI);
await p.evaluate(() => { window.BR.G.god = true; });
await shot('1-cove', 2500);
// 2. a fight: guns out, a brig and a sloop coming about
await p.evaluate(() => { const { G, PIRATES } = window.BR; G.god = false; G.boat.hp = 9999; PIRATES.spawnPirate('brig', G.boat.x + 140, G.boat.y - 60); PIRATES.spawnPirate('sloop', G.boat.x - 130, G.boat.y + 80); });
await place(cove.ax + Math.cos(cove.ang) * 320, cove.ay + Math.sin(cove.ang) * 320, cove.ang);
for (let i = 0; i < 6; i++) { await p.waitForTimeout(700); await p.evaluate(() => { const { G, PIRATES } = window.BR; G.boat.hp = 9999; if (PIRATES.cannonTarget()) PIRATES.fireBroadside(); }); }
await shot('2-fight', 300);
await p.evaluate(() => { const { SET, apply } = window.BR; SET.zoom = 0.55; apply(); }); await shot('2b-fight-close', 900);
await p.evaluate(() => { const { SET, apply } = window.BR; SET.zoom = 1; apply(); });
const fight = await p.evaluate(() => window.BR.PIRATES.state.ships.map(s => `${s.kind}:${s.mood}:${Math.round(s.hp)}/${s.max}`));
console.log('ships', fight.join(' '));
// 3. a buried X on a beach
const x = await p.evaluate(() => { const { G, PIRATES } = window.BR; const m = PIRATES.buriedMap(100, G.boat, 100, 1500); if (m) G.maps.push(m); return m; });
if (x) {
  const w = await p.evaluate(([x, y]) => { const { PIRATES } = window.BR; PIRATES.state.ships.length = 0; PIRATES.state.balls.length = 0; return window.BR.SEA.nearestWater(x, y, -0.1); }, [x.x, x.y]);
  await place(w.x, w.y, Math.atan2(x.y - w.y, x.x - w.x)); await shot('3-buried', 2000);
}
// 4. the chart
await p.keyboard.press('m'); await shot('4-chart', 2500); await p.keyboard.press('Escape');
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
