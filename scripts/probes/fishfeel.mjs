// How fishing feels, measured (run: bun run build && bunx vite preview --port 4870, then node scripts/probes/fishfeel.mjs http://localhost:4870/): schools in view, how full they are, wait for a bite, fight length, escapes, and how
// long it takes to find the next biting school. A scripted player sails near home and lands 25 fish.
import { chromium } from '@playwright/test';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await p.goto(process.argv[2] + '?offline'); await p.waitForTimeout(3500);
const r = await p.evaluate(() => {
  const { G, GAME, SPECIES, schoolsNear, sim } = window.BR, b = G.boat, step = n => { for (let i = 0; i < n; i++) sim(1 / 30); };
  G.talk = null; G.mode = 'play'; G.story = { i: 99, base: {}, shown: true };
  const out = { inView: [], stock: [], waitS: [], fightS: [], escaped: 0, missed: 0, hopS: [], species: {} };
  let t = 0;
  for (let n = 0; n < 40 && out.fightS.length < 25; n++) {
    const all = schoolsNear(b.x, b.y, 400);
    out.inView.push(all.filter(s => GAME.schoolActive(s)).length);
    const ok = all.filter(s => GAME.schoolActive(s) && SPECIES[s.sp].rod <= G.up.rod && !s.boss).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    if (!ok.length) { step(30 * 20); t += 20; out.hopS.push(20); continue; }
    const s = ok[0], d = Math.hypot(s.x - b.x, s.y - b.y); out.hopS.push(Math.round(d / 28)); out.stock.push(s.stock);
    Object.assign(b, { x: s.x + 28, y: s.y, px: s.x + 28, py: s.y, vx: 0, vy: 0, w: 0 }); step(3);
    G.pressed.add(' '); step(1); if (!G.fish) continue;
    let w = 0; while (G.fish && G.fish.st !== 'bite' && w < 30 * 40) { step(1); w++; }
    if (!G.fish) { out.missed++; continue; }
    out.waitS.push(+(w / 30).toFixed(1)); step(5); G.pressed.add(' '); step(1);
    let f = 0; const before = G.stats.caught; while (G.fish && f < 30 * 90) { G.keys[' '] = G.fish.tension < 0.6 && !(G.fish.cue || G.fish.jumpWarn); step(1); f++; } G.keys[' '] = false;
    if (G.stats.caught > before) { out.fightS.push(+(f / 30).toFixed(1)); const id = SPECIES[G.hold.at(-1)?.sp]?.id; out.species[id] = (out.species[id] || 0) + 1; } else out.escaped++;
    G.card = null; if (G.hold.length >= 3) G.hold.length = 0;
  }
  return out;
});
const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null, med = a => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
console.log(JSON.stringify({ catches: r.fightS.length, schoolsInView_avg: avg(r.inView), stockWhenArrived_avg: avg(r.stock), biteWait_s: { med: med(r.waitS), max: Math.max(...r.waitS) }, fight_s: { med: med(r.fightS), max: Math.max(...r.fightS) }, escaped: r.escaped, missedBites: r.missed, sailToNext_s_med: med(r.hopS), species: r.species }));
await b.close();
