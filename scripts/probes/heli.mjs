// The superyacht's helicopter: parked on her pad, lifting off with the catch, and coming back in to land.
// Run against a server with the window.BR hooks: node scripts/probes/heli.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/heli';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const sea = await p.evaluate(() => {
  const { G, hAt, SET, apply, homePort } = window.BR, home = homePort();
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.god = true; G.stats.caught = Math.max(5, G.stats.caught);
  const open = (x, y) => { for (let dx = -200; dx <= 200; dx += 40) for (let dy = -200; dy <= 200; dy += 40) if (hAt(x + dx, y + dy) > -0.2) return false; return true; };
  let at = null;
  search: for (let r = 900; r < 6000; r += 150) for (let k = 0; k < 24; k++) {
    const x = home.x + Math.cos(k / 24 * 6.28) * r, y = home.y + Math.sin(k / 24 * 6.28) * r;
    if (open(x, y)) { at = { x, y }; break search; }
  }
  if (!G.owned.includes('superyacht')) G.owned.push('superyacht');
  G.boatId = 'superyacht'; SET.zoom = 1.6; apply();
  Object.assign(G.boat, { x: at.x, y: at.y, px: at.x, py: at.y, vx: 0, vy: 0, a: -0.5, hp: 1e6 });
  G.hold = Array.from({ length: 30 }, (_, i) => ({ sp: 1 + (i % 3), kg: 1, value: 20, trophy: false }));
  return { at, home: home.name };
});
await p.waitForTimeout(900);
const shot = async (name) => p.screenshot({ path: `${out}/${name}.png`, clip: { x: 250, y: 130, width: 600, height: 500 } });
await shot('1-parked');
const prompt = await p.evaluate(() => window.BR.G.prompt);
const coins0 = await p.evaluate(() => window.BR.G.coins);
await p.keyboard.press('k');
await p.waitForTimeout(1000); await shot('2-liftoff'); await p.waitForTimeout(1800); await shot('2b-away');
const flying = await p.evaluate(() => ({ f: window.BR.HELI.state.flight && { ...window.BR.HELI.state.flight, to: window.BR.HELI.state.flight.to.name }, hold: window.BR.G.hold.length, coins: window.BR.G.coins }));
await p.evaluate(() => { const f = window.BR.HELI.state.flight, b = window.BR.G.boat; Object.assign(f, { back: true, x: b.x + 120, y: b.y + 60, z: 30 }); });
await p.waitForTimeout(1200); await shot('3-landing');
await p.waitForTimeout(4000); await shot('4-landed');
const after = await p.evaluate(() => window.BR.HELI.state.flight);
console.log(JSON.stringify({ sea, prompt, coins0, flying, landed: after === null, errors: errs.length ? errs : 'none' }, null, 1));
await b.close();
