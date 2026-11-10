// Your warships up close, and each one's own way of fighting in a live fight: the cutter's bow chaser, the coast guard
// cutter's boarders taking a beaten pirate, the rocket gunboat's barrage, the dreadnought's turrets training round onto
// a beaten pirate on her quarter (who strikes to the salvo), the destroyer's torpedo angled in on a ship off her bow,
// the missile cruiser's missile homing on a ship astern, the carrier's jet flying out to bomb a ship far off and coming
// home. Prints what happened; screenshots to out-dir.
// Run against a server with the window.BR hooks: node scripts/probes/warsigs.mjs http://localhost:5173 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/sigs';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
// open water well clear of land, and a boat that won't sink
await p.evaluate(() => {
  const { G, hAt, SET } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.stats.caught = Math.max(5, G.stats.caught); SET.aids = true;
  G.owned.push('cutter', 'patrol', 'gunboat', 'dreadnought', 'destroyer', 'missile', 'carrier');
  const open = (x, y) => { for (let dx = -400; dx <= 400; dx += 40) for (let dy = -300; dy <= 300; dy += 40) if (hAt(x + dx, y + dy) > -0.2) return false; return true; };
  search: for (let r = 1500; r < 8000; r += 200) for (let k = 0; k < 24; k++) {
    const x = 280 + Math.cos(k / 24 * 6.28) * r, y = 280 + Math.sin(k / 24 * 6.28) * r;
    if (open(x, y)) { window.__sea = { x, y }; break search; }
  }
  window.__keep = setInterval(() => { G.boat.hp = 1e6; }, 50);
});
const place = (id, zoom) => p.evaluate(([id, zoom]) => {
  const { G, SET, apply, PIRATES } = window.BR, { x, y } = window.__sea;
  G.boatId = id; SET.zoom = zoom; apply();
  PIRATES.state.ships.length = 0; PIRATES.state.balls.length = 0; PIRATES.state.salvo.length = 0; PIRATES.state.me.taking = null;
  Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: -0.5 });
}, [id, zoom]);
for (const id of ['cutter', 'patrol', 'gunboat', 'dreadnought', 'destroyer', 'missile', 'carrier']) {
  await place(id, id === 'carrier' ? 1.2 : id === 'dreadnought' || id === 'missile' ? 1.5 : 2); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/close-${id}.png`, clip: { x: 300, y: 180, width: 500, height: 400 } });
}
// the cutter: a brig dead ahead, out of broadside reach but inside the chaser's
await place('cutter', 1);
const chase = await p.evaluate(() => {
  const { G, PIRATES } = window.BR, a = G.boat.a, s = PIRATES.spawnPirate('brig', G.boat.x + Math.cos(a) * 250, G.boat.y + Math.sin(a) * 250, 'gunner', 'engage');
  s.a = a;
  const before = PIRATES.state.balls.length;
  PIRATES.fireBroadside();
  return { balls: PIRATES.state.balls.length - before, chaser: +PIRATES.state.me.chaser.toFixed(1), rails: PIRATES.state.me.rails };
});
console.log('cutter chaser', JSON.stringify(chase));
await p.waitForTimeout(400); await p.screenshot({ path: `${out}/cutter-chaser.png` });
// the coast guard cutter: a beaten sloop lying alongside, still fighting
await place('patrol', 1);
const board = await p.evaluate(() => new Promise(res => {
  const { G, PIRATES } = window.BR, a = G.boat.a + Math.PI / 2, s = PIRATES.spawnPirate('sloop', G.boat.x + Math.cos(a) * 26, G.boat.y + Math.sin(a) * 26, 'gunner', 'engage');
  s.a = G.boat.a; s.hp = Math.round(s.max * 0.4);
  const hold = setInterval(() => { if (!PIRATES.state.me.taking) Object.assign(s, { x: G.boat.x + Math.cos(a) * 26, y: G.boat.y + Math.sin(a) * 26, vx: 0, vy: 0 }); }, 16);
  setTimeout(() => {
    const prompt = G.prompt, near = G.nearPrize?.id === s.id;
    PIRATES.boardPrize(s);
    clearInterval(hold);
    const t0 = performance.now(), seen = [];
    const tick = setInterval(() => {
      const c = PIRATES.state.call?.s; if (c && seen.at(-1) !== c) seen.push(c);
      if (s.mood === 'struck' || performance.now() - t0 > 20000) { clearInterval(tick); res({ near, prompt, mood: s.mood, secs: Math.round((performance.now() - t0) / 100) / 10, calls: seen, coins: G.coins }); }
    }, 50);
  }, 1200);
}));
console.log('patrol boarding', JSON.stringify(board));
// the rocket gunboat: a brig sailing across, 200 off: three rockets walked along her course
await place('gunboat', 1);
const barrage = await p.evaluate(() => {
  const { G, PIRATES } = window.BR, a = G.boat.a + Math.PI / 2, s = PIRATES.spawnPirate('brig', G.boat.x + Math.cos(a) * 200, G.boat.y + Math.sin(a) * 200, 'gunner', 'engage');
  Object.assign(s, { a: G.boat.a, vx: Math.cos(G.boat.a) * 20, vy: Math.sin(G.boat.a) * 20 });
  PIRATES.fireMortar();
  const shells = PIRATES.state.balls.filter(b => b.from === 'player' && b.splash);
  return { shells: shells.length, dmg: shells.map(b => Math.round(b.dmg)), spread: Math.round(Math.hypot(shells[0].lx - shells.at(-1).lx, shells[0].ly - shells.at(-1).ly)) };
});
console.log('gunboat barrage', JSON.stringify(barrage));
await p.waitForTimeout(700); await p.screenshot({ path: `${out}/bomb-barrage.png` });
// the dreadnought: a beaten sloop on her quarter; the turrets train round, fire one salvo, and she strikes
await place('dreadnought', 1);
const turret = await p.evaluate(() => new Promise(res => {
  const { G, PIRATES } = window.BR, a = G.boat.a + 2.4, s = PIRATES.spawnPirate('sloop', G.boat.x + Math.cos(a) * 180, G.boat.y + Math.sin(a) * 180, 'gunner', 'engage');
  s.hp = Math.round(s.max * 0.4); s.yields = true;
  const hold = setInterval(() => Object.assign(s, { x: G.boat.x + Math.cos(a) * 180, y: G.boat.y + Math.sin(a) * 180, vx: 0, vy: 0, a: G.boat.a }), 16);
  const t0 = performance.now(), seen = [];
  const tick = setInterval(() => {
    const me = PIRATES.state.me, c = PIRATES.state.call?.s;
    if (c && seen.at(-1) !== c) seen.push(c);
    if (me.turret <= 0) PIRATES.fireBroadside();
    if (me.turret > 0 || performance.now() - t0 > 8000) {
      clearInterval(tick); clearInterval(hold);
      res({ fired: me.turret > 0, secs: Math.round((performance.now() - t0) / 100) / 10, turretA: +me.turretA.toFixed(2), shells: PIRATES.state.salvo.length, mood: s.mood, calls: seen });
    }
  }, 50);
}));
console.log('dreadnought turrets', JSON.stringify(turret));
await p.waitForTimeout(450); await p.screenshot({ path: `${out}/dreadnought-salvo.png` });
// the destroyer: a brig lying 300 ahead, off the line of her bow; a torpedo angled to meet her
await place('destroyer', 1);
await p.waitForTimeout(300);                                         // a tick for her tubes to be loaded
const torp = await p.evaluate(() => new Promise(res => {
  const { G, PIRATES } = window.BR, a = G.boat.a, s = PIRATES.spawnPirate('brig', G.boat.x + Math.cos(a) * 300 - Math.cos(a + Math.PI / 2) * 60, G.boat.y + Math.sin(a) * 300 - Math.sin(a + Math.PI / 2) * 60, 'gunner', 'engage');
  const at = { x: s.x, y: s.y }, hp = s.hp, t0 = performance.now();
  const steer = setInterval(() => Object.assign(s, at, { vx: 0, vy: 0, a: a + Math.PI / 2, think: 1, dodge: null }), 16);   // lying to, off the line of her bow
  PIRATES.fireLauncher();
  const loaded = PIRATES.state.me.loaded;
  const tick = setInterval(() => {
    if (s.hp < hp || performance.now() - t0 > 9000) {
      clearInterval(tick); clearInterval(steer);
      res({ hit: s.hp < hp, dmg: hp - s.hp, secs: Math.round((performance.now() - t0) / 100) / 10, tubesLeft: loaded, running: PIRATES.state.torps.length, call: PIRATES.state.call?.s });
    }
  }, 30);
}));
console.log('destroyer torpedo', JSON.stringify(torp));
await p.screenshot({ path: `${out}/destroyer-torpedo.png` });
// the missile cruiser: a brig astern; the missile turns back onto her
await place('missile', 1);
await p.waitForTimeout(300);
const missile = await p.evaluate(() => new Promise(res => {
  const { G, PIRATES } = window.BR, a = G.boat.a + Math.PI, s = PIRATES.spawnPirate('brig', G.boat.x + Math.cos(a) * 350, G.boat.y + Math.sin(a) * 350, 'gunner', 'engage');
  const at = { x: s.x, y: s.y }, hp = s.hp, t0 = performance.now();
  const hold = setInterval(() => Object.assign(s, at, { vx: 0, vy: 0, think: 1 }), 16);
  PIRATES.fireLauncher();
  const tick = setInterval(() => {
    if (s.hp < hp || performance.now() - t0 > 8000) { clearInterval(tick); clearInterval(hold); res({ hit: s.hp < hp, dmg: hp - s.hp, secs: Math.round((performance.now() - t0) / 100) / 10, cellsLeft: PIRATES.state.me.loaded }); }
  }, 30);
}));
console.log('missile cruiser missile', JSON.stringify(missile));
// the carrier: a brig 70 m off, far past any gun; a jet flies out, bombs her, and comes home to land
await place('carrier', 0.7);
await p.waitForTimeout(300);
await p.evaluate(() => {
  const { G, PIRATES } = window.BR, a = G.boat.a + 1.2, s = PIRATES.spawnPirate('brig', G.boat.x + Math.cos(a) * 700, G.boat.y + Math.sin(a) * 700, 'gunner', 'engage');
  const at = { x: s.x, y: s.y };
  window.__air = { s, hp: s.hp, t0: performance.now(), seen: [] };
  window.__hold = setInterval(() => Object.assign(s, at, { vx: 0, vy: 0, think: 1 }), 16);
  PIRATES.fireLauncher();
});
await p.waitForTimeout(1500); await p.screenshot({ path: `${out}/carrier-launch.png` });
await p.waitForFunction(() => { const c = window.BR.PIRATES.state.call?.s, A = window.__air; if (c && A.seen.at(-1) !== c) A.seen.push(c); return A.s.hp < A.hp || performance.now() - A.t0 > 20000; }, null, { timeout: 25000, polling: 30 });
await p.evaluate(() => { const { G } = window.BR, s = window.__air.s; G.cam.x = s.x - 160; G.cam.y = s.y - 100; });
await p.screenshot({ path: `${out}/carrier-bombs.png` });
const air = await p.evaluate(() => new Promise(res => {
  const { PIRATES } = window.BR, A = window.__air;
  const tick = setInterval(() => {
    const c = PIRATES.state.call?.s; if (c && A.seen.at(-1) !== c) A.seen.push(c);
    if ((!PIRATES.state.planes.length && PIRATES.state.me.loaded === 3) || performance.now() - A.t0 > 60000) {
      clearInterval(tick); clearInterval(window.__hold);
      res({ dmg: A.hp - A.s.hp, mood: A.s.mood, secs: Math.round((performance.now() - A.t0) / 100) / 10, aloft: PIRATES.state.planes.length, onDeck: PIRATES.state.me.loaded, calls: A.seen });
    }
  }, 50);
}));
console.log('carrier air wing', JSON.stringify(air));
console.log('errors', errs.length ? errs : 'none');
await b.close();
