// Screenshots of a pirate fight with every weapon: broadside arcs, a pirate running her guns out, impact rings, mortar
// shells and their marks, kegs astern, fire shot, damage numbers. Run against the dev server (window.BR hooks):
// node scripts/probes/combat.mjs http://127.0.0.1:5173 [out-dir]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:5173', out = process.argv[3] || '/tmp/boatlab/combat';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const ok = await p.evaluate(() => {
  const { G, poisNear, hAt, PIRATES } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.boatId = 'schooner'; G.owned.push('schooner');
  Object.assign(G.up, { cannon: 3, swivel: 2, mortar: 2, kegs: 2, ram: 1 }); G.ammo = { chain: 10, grape: 10, fire: 10 };
  for (let r = 2500; r < 9000; r += 400) for (let k = 0, n = Math.ceil(r / 350); k < n; k++) {
    const a = k / n * Math.PI * 2;
    for (const c of poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 500)) {
      if (c.type !== 'cove' || poisNear(c.x, c.y, 800).some(q => q.type === 'port' && Math.hypot(q.x - c.x, q.y - c.y) < 800)) continue;
      const d = [320, 260, 200].find(d => hAt(c.anchor.x + Math.cos(c.ang) * d, c.anchor.y + Math.sin(c.ang) * d) < -0.15);
      if (!d) continue;
      const x = c.anchor.x + Math.cos(c.ang) * d, y = c.anchor.y + Math.sin(c.ang) * d;
      for (const o of poisNear(c.x, c.y, 3000)) if (o.type === 'cove') G.raids[o.id] = Math.floor(G.clock / 480) + 1;
      Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: c.ang + Math.PI / 2 });
      G.cam.x = x - 200; G.cam.y = y - 125;
      PIRATES.state.ships.length = 0;                     // a fight with just this one ship
      PIRATES.spawnPirate('brig', x + Math.cos(c.ang) * 170, y + Math.sin(c.ang) * 170, 'gunner');
      PIRATES.spawnPirate('sloop', x - Math.cos(c.ang) * 150, y - Math.sin(c.ang) * 150, 'raider');
      PIRATES.spawnPirate('ketch', x + Math.cos(c.ang + 1.6) * 240, y + Math.sin(c.ang + 1.6) * 240, 'bomber');
      return true;
    }
  }
  return false;
});
console.log('arena', ok);
const fight = (ms, shot) => p.evaluate(([ms, shot]) => new Promise(res => {
  const { G, PIRATES } = window.BR, end = performance.now() + ms;
  if (shot) PIRATES.state.me.shot = shot;
  const f = () => {
    G.boat.hp = Math.max(G.boat.hp, 400);
    const t = PIRATES.state.ships.filter(s => s.mood !== 'sinking' && s.mood !== 'struck' && s.mood !== 'surrender').sort((a, b) => Math.hypot(a.x - G.boat.x, a.y - G.boat.y) - Math.hypot(b.x - G.boat.x, b.y - G.boat.y))[0];
    if (t) G.boat.a += Math.max(-0.02, Math.min(0.02, Math.atan2(Math.sin(Math.atan2(t.y - G.boat.y, t.x - G.boat.x) - Math.PI / 2 - G.boat.a), Math.cos(Math.atan2(t.y - G.boat.y, t.x - G.boat.x) - Math.PI / 2 - G.boat.a))));
    G.keys.ArrowUp = true;
    if (PIRATES.cannonTarget()) PIRATES.fireBroadside();
    if (Math.random() < 0.01) PIRATES.fireMortar();
    if (Math.random() < 0.004) PIRATES.dropKeg();
    if (performance.now() < end) requestAnimationFrame(f); else { G.keys.ArrowUp = false; res(PIRATES.state.ships.map(s => `${s.kind}/${s.role}:${s.mood}:${Math.round(s.hp)}`)); }
  };
  f();
}), [ms, shot]);
console.log('1', (await fight(3500, 'round')).join(' ')); await p.screenshot({ path: `${out}/1-engage.png` });
console.log('2', (await fight(3000, 'chain')).join(' ')); await p.screenshot({ path: `${out}/2-chain.png` });
console.log('3', (await fight(3000, 'fire')).join(' ')); await p.screenshot({ path: `${out}/3-fire.png` });
console.log('4', (await fight(5000, 'grape')).join(' ')); await p.screenshot({ path: `${out}/4-later.png` });
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
