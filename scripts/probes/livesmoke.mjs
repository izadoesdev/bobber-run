// A real browser on a deployed URL: reaches play, opens the chart, and reports page errors, CSP refusals, workers,
// network hosts and the piano samples fetched after a click. Run: node scripts/probes/livesmoke.mjs https://bobber.databuddy.cc/
import { chromium } from '@playwright/test';
const url = process.argv[2];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = [], hosts = {}, workers = []; let mp3 = 0;
p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
p.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
p.on('request', r => { const h = new URL(r.url()).host; hosts[h] = (hosts[h] || 0) + 1; if (r.url().endsWith('.mp3')) mp3++; });
p.on('websocket', ws => { hosts['ws:' + new URL(ws.url()).host] = 1; });
p.on('worker', w => workers.push(new URL(w.url()).pathname));
await p.goto(url); await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 60000 });
await p.mouse.click(640, 360); await p.waitForTimeout(8000);
const r = await p.evaluate(() => { const { G, NET } = window.BR; return { mode: G.mode, net: NET.status, authed: NET.authed, musicOn: G.musicOn }; });
await p.evaluate(() => { window.BR.G.mode = 'map'; }); await p.waitForTimeout(4000);
console.log(JSON.stringify(r), 'piano samples fetched:', mp3); console.log('workers', JSON.stringify(workers)); console.log('hosts', JSON.stringify(hosts)); console.log('errors', errs.length ? errs.join(' || ') : 'none');
await b.close();
