// Screenshots of a pirate encounter as it unfolds: a sail shadowing you under no colours, the hail under her black flag
// (and the prompt line), the red flag of no quarter in a fight, and the inn's word on the quay.
// Run against a server with the window.BR hooks: node scripts/probes/parley.mjs http://127.0.0.1:5173 [out-dir]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:5173', out = process.argv[3] || '/tmp/boatlab/parley';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const cove = await p.evaluate(() => {
  const { G, poisNear, hAt } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.up.cannon = 3; G.stats.caught = Math.max(1, G.stats.caught);
  for (let r = 2500; r < 9000; r += 300) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2;
    for (const c of [...poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 400)]) {   // a copy: poisNear reuses its array
      if (c.type !== 'cove' || poisNear(c.x, c.y, 800).some(q => q.type === 'port' && Math.hypot(q.x - c.x, q.y - c.y) < 550)) continue;
      if (![200, 300].every(d => hAt(c.anchor.x + Math.cos(c.ang) * d, c.anchor.y + Math.sin(c.ang) * d) < -0.15)) continue;
      for (const o of poisNear(c.x, c.y, 3000)) if (o.type === 'cove') G.raids[o.id] = Math.floor(G.clock / 480) + 1;
      return { ax: c.anchor.x, ay: c.anchor.y, ang: c.ang };
    }
  }
  return null;
});
const shot = async name => { await p.screenshot({ path: `${out}/${name}.png` }); };
const frames = (n, still = true) => p.evaluate(([n, still]) => new Promise(res => { let i = 0; const f = () => { const { G } = window.BR; G.boat.hp = 9999; if (still) Object.assign(G.boat, { vx: 0, vy: 0 }); else Object.assign(G.boat, { vx: Math.cos(G.boat.a) * 30, vy: Math.sin(G.boat.a) * 30 }); if (++i < n) requestAnimationFrame(f); else res(); }; f(); }), [n, still]);
await p.evaluate(c => {
  const { G, PIRATES } = window.BR, x = c.ax + Math.cos(c.ang) * 300, y = c.ay + Math.sin(c.ang) * 300;
  Object.assign(G.boat, { x, y, px: x, py: y, a: c.ang + Math.PI / 2, vx: 0, vy: 0 }); G.cam.x = x - 160; G.cam.y = y - 100;
  const s = PIRATES.spawnPirate('brig', x + 120, y - 50, 'gunner', 'shadow'); s.merciless = false;
}, cove);
await p.evaluate(() => { const { SET, apply } = window.BR; SET.zoom = 0.7; apply(); });
await frames(240); await shot('1-shadow');
await p.evaluate(() => { const s = window.BR.PIRATES.state.ships[0]; s.mood = 'hail'; s.parley = 0; s.t = 0; });
for (let i = 0; i < 30 && !(await p.evaluate(() => window.BR.PIRATES.state.ships[0].parley > 0)); i++) await frames(30);
await p.evaluate(() => { const { SET, apply } = window.BR; SET.zoom = 0.5; apply(); });
await frames(40); await shot('2-hail');
console.log('hail prompt', await p.evaluate(() => window.BR.G.prompt));
for (let i = 0; i < 60 && !(await p.evaluate(() => ['chase', 'engage'].includes(window.BR.PIRATES.state.ships[0].mood))); i++) await frames(30, false);
await frames(90, false); await shot('3-no-quarter');
console.log('prompt', await p.evaluate(() => window.BR.G.prompt));
console.log('moods', await p.evaluate(() => window.BR.PIRATES.state.ships.map(s => `${s.kind}:${s.mood}:${s.parley.toFixed(1)}`).join(' ')));
console.log('errors', errs.length ? errs : 'none');
await b.close();
