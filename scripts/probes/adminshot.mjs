// The admin panel (F9) on each tab, with a pretend admin profile and two pretend sailors.
// Run: node scripts/probes/adminshot.mjs http://localhost:5173
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G, NET, ONLINE } = window.BR; G.talk = null; G.mode = 'play'; NET.profile = { userId: 'u', name: 'Issa', admin: true };
  ONLINE.far = [{ uid: 'a', name: 'bird', x: -19611, y: -11884 }, { uid: 'b', name: 'Salty Gull', x: 900, y: 300 }]; });
await p.waitForTimeout(500); await p.keyboard.press('F9'); await p.waitForTimeout(600);
await p.screenshot({ path: '/tmp/boatlab/admin-sailors.png' });
for (const tab of ['Teleport', 'Fun']) { await p.click(`.admin-tabs button:has-text("${tab}")`); await p.waitForTimeout(400); await p.screenshot({ path: `/tmp/boatlab/admin-${tab.toLowerCase()}.png` }); }
await p.click('.admin-tabs button:has-text("Sailors")'); await p.click('.admin-row:has-text("bird") button:has-text("Go")'); await p.waitForTimeout(1500);
console.log(JSON.stringify({ errs, boat: await p.evaluate(() => [Math.round(window.BR.G.boat.x), Math.round(window.BR.G.boat.y), window.BR.G.unlocked]) }));
await p.screenshot({ path: '/tmp/boatlab/admin-after.png' });
await b.close();
