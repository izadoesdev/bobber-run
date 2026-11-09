// Port screens and harbours as a player sees them: every tab at home (desktop and phone), and a shipyard harbour beside
// one without, from the water. node scripts/probes/portshot.mjs http://localhost:4871 [out-dir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const url = process.argv[2] || 'http://localhost:5173', out = process.argv[3] || '/tmp/portlab';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errs = [];
async function page(w, h) {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 600 })).newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
  await p.goto(url + '?offline'); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
  await p.evaluate(() => {
    const { G } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null; G.coins = 4000; G.stats.caught = 30; G.stats.sold = 5;
    G.hold = [{ sp: 0, kg: 1, value: 8, trophy: false }, { sp: 1, kg: 2, value: 14, trophy: false }, { sp: 1, kg: 2, value: 14, trophy: false }];
  });
  return p;
}
const p = await page(1280, 800);
const ports = await p.evaluate(() => {
  const { poisNear, homePort, G } = window.BR, h = homePort();
  const all = poisNear(h.x, h.y, 9000).filter(q => q.type === 'port').sort((a, c) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(c.x - h.x, c.y - h.y));
  for (const q of all) G.found.add(q.id);
  return all.slice(0, 8).map(q => ({ id: q.id, name: q.name, yard: q.shipyard }));
});
console.log(JSON.stringify(ports));
async function shootTabs(p, tag, port) {
  await p.evaluate(id => { const { G, GAME, homePort, poisNear } = window.BR, h = homePort(); const q = id ? poisNear(h.x, h.y, 9000).find(x => x.id === id) : h; GAME.placeAtPort(q); GAME.dock(q); G.toasts && (G.toasts.length = 0); }, port ?? null);
  await p.waitForTimeout(500);
  const n = await p.evaluate(() => window.BR.GAME.portTabs(window.BR.G.menu.port).length);
  for (let i = 0; i < n; i++) {
    await p.evaluate(i => window.BR.GAME.setTab(i), i);
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${tag}-tab${i}.png` });
  }
}
await shootTabs(p, 'home');
const plain = ports.find(q => !q.yard), yard = ports.find(q => q.yard && q.id !== ports[0].id);
if (plain) await shootTabs(p, 'plain', plain.id);
// from the water, near each harbour, then the chart round home
for (const [tag, q] of [['sea-plain', plain], ['sea-yard', yard], ['sea-home', null]]) {
  await p.evaluate(id => {
    const { G, GAME, homePort, poisNear, SET, apply } = window.BR, h = homePort(); const q = id ? poisNear(h.x, h.y, 9000).find(x => x.id === id) : h;
    GAME.placeAtPort(q); G.menu.port = q; GAME.leavePort(); SET.zoom = 1.6; apply();
    G.boat.x = q.dock.x + Math.cos(q.ang) * 40; G.boat.y = q.dock.y + Math.sin(q.ang) * 40; G.boat.vx = G.boat.vy = 0; G.boat.a = q.ang + Math.PI;
  }, q?.id ?? null);
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${out}/${tag}.png` });
}
await p.evaluate(() => { const { G } = window.BR; G.mode = 'map'; G.map.zoom = 1; G.map.x = 0; G.map.y = 0; });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/chart.png` });
await p.evaluate(() => { window.BR.G.mode = 'play'; });
const ph = await page(390, 844);
await shootTabs(ph, 'phone');
console.log('errors', errs.length ? errs : 'none');
await b.close();
