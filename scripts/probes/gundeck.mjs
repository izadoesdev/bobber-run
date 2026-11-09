// The gun deck along the bottom of the screen in a fight (a galleon abeam, a rail bearing), the notes behind its ?, and
// a click on Guns firing. Screenshots to out-dir.
// Run against a server with the window.BR hooks: node scripts/probes/gundeck.mjs http://localhost:5173 [out-dir] [boat]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/boatlab/deck', boat = process.argv[4] || 'dreadnought';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
await p.evaluate(boat => {
  const { G, hAt } = window.BR;
  G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.stats.caught = Math.max(5, G.stats.caught);
  G.owned.push(boat); G.boatId = boat; G.ammo.chain = 6;
  const open = (x, y) => { for (let dx = -400; dx <= 400; dx += 40) for (let dy = -300; dy <= 300; dy += 40) if (hAt(x + dx, y + dy) > -0.2) return false; return true; };
  search: for (let r = 1500; r < 8000; r += 200) for (let k = 0; k < 24; k++) {
    const x = 280 + Math.cos(k / 24 * 6.28) * r, y = 280 + Math.sin(k / 24 * 6.28) * r;
    if (open(x, y)) { Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: -0.5 }); break search; }
  }
  setInterval(() => { G.boat.hp = 1e6; }, 50);
}, boat);
await p.waitForTimeout(1200);
console.log('gun deck out of a fight:', await p.locator('.gundeck').count());
await p.evaluate(() => {
  const { G, PIRATES } = window.BR, a = G.boat.a + Math.PI / 2, s = PIRATES.spawnPirate('galleon', G.boat.x + Math.cos(a) * 160, G.boat.y + Math.sin(a) * 160, 'warship', 'engage');
  setInterval(() => Object.assign(s, { x: G.boat.x + Math.cos(a) * 160, y: G.boat.y + Math.sin(a) * 160, vx: 0, vy: 0, a: G.boat.a }), 16);
  PIRATES.state.me.rails = [6, 0];
});
await p.waitForTimeout(900);
console.log('deck:', (await p.locator('.gundeck .gun').allInnerTexts()).map(t => t.split('\n').filter(Boolean).slice(0, 3).join(' ')).join(' | '));
await p.screenshot({ path: `${out}/2-fight.png` });
console.log('on top of the deck:', await p.evaluate(() => [...document.querySelectorAll('.gundeck .gun')].map(g => { const r = g.getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + 8); return g.contains(e) ? 'deck' : e?.className; }).join(',')));
await p.locator('.gun-help').click();
await p.screenshot({ path: `${out}/3-notes.png` });
await p.locator('.gun-help').click();
await p.locator('.gundeck .gun').first().click();
console.log('clicked Guns: rails', JSON.stringify(await p.evaluate(() => window.BR.PIRATES.state.me.rails.map(r => +r.toFixed(1)))));
console.log('errors', errs.length ? errs : 'none');
await b.close();
