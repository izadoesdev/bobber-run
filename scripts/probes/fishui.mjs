// The fishing UI during one cast, bite and fight (run like fishfeel.mjs): layout shift (CLS), and which HUD elements appear, vanish or move.
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await p.addInitScript(() => { window.__shifts = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ v: +e.value.toFixed(4), who: (e.sources || []).map(s => s.node?.className || s.node?.nodeName).filter(Boolean).slice(0, 3) }); }).observe({ type: 'layout-shift', buffered: true }); });
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
await p.evaluate(() => { const { G, GAME, SPECIES, schoolsNear } = window.BR, b = G.boat; G.talk = null; G.mode = 'play'; G.story = { i: 99, base: {}, shown: true }; G.stats.caught = 5;
  const s = schoolsNear(b.x, b.y, 400).find(s => GAME.schoolActive(s) && SPECIES[s.sp].rod <= G.up.rod && !s.boss);
  Object.assign(b, { x: s.x + 28, y: s.y, px: s.x + 28, py: s.y, vx: 0, vy: 0, w: 0 }); });
await p.waitForTimeout(1500); await p.evaluate(() => { window.__shifts = []; });
const snap = () => p.evaluate(() => [...document.querySelectorAll('#ui *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 20 && r.height > 10 && getComputedStyle(e).visibility !== 'hidden' && e.children.length < 6; })
  .map(e => { const r = e.getBoundingClientRect(); return { k: (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) , x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }));
const frames = []; const phase = () => p.evaluate(() => window.BR.G.fish?.st ?? (window.BR.G.card ? 'card' : 'idle'));
await p.keyboard.press(' ');
for (let i = 0; i < 70; i++) {
  const st = await phase(); frames.push({ st, els: await snap() });
  if (st === 'bite') await p.keyboard.press(' ');
  if (st === 'reel') { await p.keyboard.down(' '); await p.waitForTimeout(120); await p.keyboard.up(' '); }
  await p.waitForTimeout(150);
}
// elements that come and go, and ones that move between frames
const seen = {}; frames.forEach((f, i) => f.els.forEach(e => { (seen[e.k] ||= { frames: 0, phases: new Set(), pos: new Set() }); seen[e.k].frames++; seen[e.k].phases.add(f.st); seen[e.k].pos.add(`${e.x},${e.y},${e.w}x${e.h}`); }));
const popping = Object.entries(seen).filter(([, v]) => v.frames < frames.length).map(([k, v]) => `${k} (${v.frames}/${frames.length} frames, in: ${[...v.phases].join('/')})`);
const moving = Object.entries(seen).filter(([, v]) => v.pos.size > 2).map(([k, v]) => `${k} (${v.pos.size} sizes/positions)`);
const shifts = await p.evaluate(() => window.__shifts);
console.log(JSON.stringify({ phases: [...new Set(frames.map(f => f.st))], cls: +shifts.reduce((a, s) => a + s.v, 0).toFixed(3), shiftCount: shifts.length, shiftSources: [...new Set(shifts.flatMap(s => s.who))].slice(0, 10), popping: popping.slice(0, 14), moving: moving.slice(0, 12) }, null, 1));
await b.close();
