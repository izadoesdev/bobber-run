// Screenshots of the enemy fighting vessels: a galley laying her bow gun, a fire ship alight. (Your own warships and
// their ways of fighting: warsigs.mjs.)
// Run against a server with the window.BR hooks: node scripts/probes/warships.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/war';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
await p.evaluate(() => { const { G } = window.BR; G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.stats.caught = Math.max(1, G.stats.caught); G.owned.push('dreadnought'); });
// enemies near a cove
const ok = await p.evaluate(() => {
  const { G, poisNear, hAt } = window.BR;
  G.boatId = 'dreadnought';
  for (let r = 2500; r < 9000; r += 300) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    for (const c of [...poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 400)]) {
      if (c.type !== 'cove' || poisNear(c.x, c.y, 550).some(q => q.type === 'port')) continue;
      if (![200, 300, 400].every(d => hAt(c.anchor.x + Math.cos(c.ang) * d, c.anchor.y + Math.sin(c.ang) * d) < -0.15)) continue;
      for (const o of poisNear(c.x, c.y, 3000)) if (o.type === 'cove') G.raids[o.id] = Math.floor(G.clock / 480) + 1;
      const x = c.anchor.x + Math.cos(c.ang) * 300, y = c.anchor.y + Math.sin(c.ang) * 300;
      Object.assign(G.boat, { x, y, px: x, py: y, a: c.ang + Math.PI / 2, vx: 0, vy: 0 });
      window.__ang = c.ang;
      return true;
    }
  }
  return false;
});
if (!ok) throw new Error('no cove');
await p.evaluate(() => { const { G } = window.BR; clearInterval(window.__keep); window.__keep = setInterval(() => { G.boat.hp = 99999; }, 50); });
await p.evaluate(() => { const { G, PIRATES } = window.BR, a = G.boat.a; const s = PIRATES.spawnPirate('galley', G.boat.x + Math.cos(a) * 170, G.boat.y + Math.sin(a) * 170, 'chaser', 'engage'); s.a = a + Math.PI; });
await p.waitForFunction(() => window.BR.PIRATES.state.ships[0]?.bowAim > 0, null, { timeout: 20000 }).catch(() => console.log('no bow aim'));
await p.screenshot({ path: `${out}/galley.png` });
await p.evaluate(() => { const { G, PIRATES } = window.BR; PIRATES.state.ships.length = 0; G.boatId = 'skiff'; /* no swivel to sink her early */ const a = G.boat.a; const s = PIRATES.spawnPirate('fireship', G.boat.x + Math.cos(a) * 260, G.boat.y + Math.sin(a) * 260, 'fireship', 'engage'); s.a = a + Math.PI; });
await p.waitForFunction(() => window.BR.PIRATES.state.ships[0]?.lit > 1.2, null, { timeout: 45000 }).catch(() => console.log('not lit'));
await p.screenshot({ path: `${out}/fireship.png` });
console.log('errors', errs.length ? errs : 'none');
await b.close();
