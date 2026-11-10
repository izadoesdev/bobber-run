// The pirate ships side by side, whole and battered, for looking at the models: node scripts/probes/shipsheet.mjs [url] [out]
import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://127.0.0.1:5173', out = process.argv[3] || '/tmp/boatlab/ships';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
const shot = async (name, damaged, zoom) => {
  await p.evaluate(([damaged, zoom]) => new Promise(res => {
    const { G, PIRATES, SET, apply, SEA, hAt } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.god = true;
    SET.zoom = zoom; apply();
    // open water: search out from home for a 500 x 300 patch of deep sea
    let cx = 0, cy = 0;
    search: for (let r = 900; r < 6000; r += 200) for (let k = 0; k < 24; k++) {
      const x = 280 + Math.cos(k / 24 * 6.28) * r, y = 280 + Math.sin(k / 24 * 6.28) * r;
      let ok = true;
      for (let dx = -260; dx <= 260 && ok; dx += 40) for (let dy = -160; dy <= 160 && ok; dy += 40) if (hAt(x + dx, y + dy) > -0.2) ok = false;
      if (ok) { cx = x; cy = y; break search; }
    }
    Object.assign(G.boat, { x: cx, y: cy + 50, px: cx, py: cy + 50, vx: 0, vy: 0, a: 0 });
    PIRATES.state.ships.length = 0;
    const kinds = ['sloop', 'ketch', 'brig', 'galleon', 'galley', 'fireship'], ships = kinds.map((k, i) => PIRATES.spawnPirate(k, cx - 250 + i * 100, cy - 20));
    ships.forEach((s, i) => { s.scheme = i % 5; s.flag = i % 4; if (damaged) { s.wounds.sails = 0.7; s.hp = s.max * 0.15; } });
    const hold = () => { ships.forEach((s, i) => Object.assign(s, { x: cx - 250 + i * 100, y: cy - 20, vx: 0, vy: 0, a: -0.5, want: -0.5, mood: damaged ? 'flee' : 'patrol', think: 9 })); };
    let n = 0; const f = () => { hold(); if (++n < 90) requestAnimationFrame(f); else res(); }; f();
  }), [damaged, zoom]);
  await p.screenshot({ path: `${out}/${name}.png` });
};
await shot('1-whole', false, 0.8);
await shot('2-battered', true, 0.8);
await shot('3-close', false, 0.45);
console.log('errors', JSON.stringify(errs.slice(0, 5)));
await b.close();
