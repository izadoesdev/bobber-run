// Screenshots of each ship's way of fighting, with the lookout's calls, the battle chip and edge pips: a sloop
// grappling alongside, a brawler squaring up to ram, a galleon double-shotting her guns, a bomb ketch ranging on you.
// Run against a server with the window.BR hooks: node scripts/probes/signatures.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/sig';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline');
await p.evaluate(() => window.BR.PIRATES.state.me.wounds.crew = 0); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const ok = await p.evaluate(() => {
  const { G, poisNear, hAt } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.up.cannon = 2; G.up.mortar = 1; G.stats.caught = Math.max(1, G.stats.caught);
  for (let r = 2500; r < 9000; r += 300) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    for (const c of [...poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 400)]) {
      if (c.type !== 'cove' || poisNear(c.x, c.y, 550).some(q => q.type === 'port')) continue;
      if (![200, 300].every(d => hAt(c.anchor.x + Math.cos(c.ang) * d, c.anchor.y + Math.sin(c.ang) * d) < -0.15)) continue;
      for (const o of poisNear(c.x, c.y, 3000)) if (o.type === 'cove') G.raids[o.id] = Math.floor(G.clock / 480) + 1;
      const x = c.anchor.x + Math.cos(c.ang) * 260, y = c.anchor.y + Math.sin(c.ang) * 260;
      window.__home = { x, y, a: c.ang + Math.PI / 2 };
      return true;
    }
  }
  return false;
});
if (!ok) throw new Error('no cove');
const reset = () => p.evaluate(() => { const { G, PIRATES } = window.BR, h = window.__home; PIRATES.state.ships.length = 0; PIRATES.state.balls.length = 0; PIRATES.state.call = null; Object.assign(G.boat, { x: h.x, y: h.y, px: h.x, py: h.y, a: h.a, vx: 0, vy: 0 }); G.hold = [{ sp: 0, kg: 1, value: 40, trophy: false }, { sp: 1, kg: 2, value: 90, trophy: false }]; G.mode = 'play'; });
const until = (cond, ms = 20000) => p.waitForFunction(cond, null, { timeout: ms, polling: 100 }).catch(() => console.log('timed out:', String(cond)));
const keep = () => p.evaluate(() => { const { G } = window.BR; clearInterval(window.__keep); window.__keep = setInterval(() => { G.boat.hp = 9999; }, 50); });
await keep();
const spawn = (kind, rel, d, role) => p.evaluate(([kind, rel, d, role]) => { const { G, PIRATES } = window.BR, a = G.boat.a + rel; const s = PIRATES.spawnPirate(kind, G.boat.x + Math.cos(a) * d, G.boat.y + Math.sin(a) * d, role, 'engage'); s.a = G.boat.a; }, [kind, rel, d, role]);
// 1. a sloop grappling alongside
await reset(); await p.evaluate(() => { window.BR.PIRATES.state.me.rails = [9, 9]; });   // both broadsides just fired: her chance
await spawn('sloop', -Math.PI / 2, 16, 'raider');   // seaward of you
await until(() => window.BR.PIRATES.state.ships[0]?.grapple > 1.2);
await p.screenshot({ path: `${out}/1-grapple.png` });
// 2. a brawler squaring up
await reset(); await spawn('brig', 0, 160, 'brawler'); await p.evaluate(() => { const s = window.BR.PIRATES.state.ships[0]; s.a = window.BR.G.boat.a + Math.PI; });
await until(() => window.BR.PIRATES.state.ships[0]?.charge?.phase === 'aim');
await p.waitForTimeout(400); await p.screenshot({ path: `${out}/2-ram.png` });
// 3. a galleon double-shotting
await reset(); await spawn('galleon', Math.PI / 2, 150, 'warship'); await p.evaluate(() => { const s = window.BR.PIRATES.state.ships[0]; s.heavyT = 0; s.reload = [0, 0]; });
await until(() => window.BR.PIRATES.state.ships[0]?.heavy);
await p.waitForTimeout(500); await p.screenshot({ path: `${out}/3-heavy.png` });
// 4. a ketch ranging, and a second ship off screen
await reset(); await spawn('ketch', Math.PI / 2, 230, 'bomber'); await spawn('brig', Math.PI, 650, 'gunner'); await p.evaluate(() => { window.BR.PIRATES.state.ships[0].mortarT = 0; });
await until(() => window.BR.PIRATES.state.balls.some(b => b.splash));
await p.waitForTimeout(900); await p.screenshot({ path: `${out}/4-ranging.png` });
console.log('call', await p.evaluate(() => window.BR.PIRATES.state.call?.s), 'errors', errs.length ? errs : 'none');
await b.close();
