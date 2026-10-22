// Click-to-sail, measured (run against the dev server: node scripts/probes/autosail.mjs; HARD=1 for trips whose straight
// line crosses land, N trips, SEED): each boat sails from open water to a spot 250-1500 units away with every region
// open. Per boat: arrivals, give-ups ("No clear way there"), timeouts, starts that don't move in 3 s, median seconds,
// path sailed against the planned route, steering reversals a minute, and hull lost. It needs Vite's dev modules
// (it imports the game's own autopilot module by the URL the game loaded it from).
import { chromium } from '@playwright/test';
const URL = process.env.URL || 'http://localhost:5173/', N = Number(process.env.N || 8), SEED = Number(process.env.SEED || 7), HARD = process.env.HARD === '1';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.goto(URL + '?offline', { timeout: 90000 }); await page.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 90000 });
const out = await page.evaluate(async ({ N, SEED, HARD }) => {
  const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('/src/game/autopilot.ts'));
  const AP = await import(url), { G, sim, homePort, hAt } = window.BR, b = G.boat, hp = homePort();
  let seed = SEED; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  G.story = { ...(G.story ?? { base: {}, shown: true }), i: 14 }; G.stats.caught = 50;
  const step = () => { G.talk = null; if (G.mode !== 'play') G.mode = 'play'; sim(1 / 30); };
  const open = (x, y, r) => { for (let a = 0; a < 6.28; a += 0.6) if (hAt(x + Math.cos(a) * r, y + Math.sin(a) * r) > -0.12) return false; return hAt(x, y) < -0.2; };
  // start spots and targets, the same for every boat
  const trips = [];
  for (let t = 0; trips.length < N && t < 4000; t++) {
    const a = rnd() * 6.28, d = 200 + rnd() * 900, sx = hp.x + Math.cos(a) * d, sy = hp.y + Math.sin(a) * d;
    if (!open(sx, sy, 60)) continue;
    const a2 = rnd() * 6.28, d2 = 250 + rnd() * 1250, tx = sx + Math.cos(a2) * d2, ty = sy + Math.sin(a2) * d2;
    if (!open(tx, ty, 40)) continue;
    let crosses = false; for (let k = 1; k < 60; k++) if (hAt(sx + (tx - sx) * k / 60, sy + (ty - sy) * k / 60) > -0.05) crosses = true;
    if (HARD !== crosses) continue;
    trips.push({ sx, sy, tx, ty, a0: rnd() * 6.28 });
  }
  const res = {};
  for (const boat of ['row', 'skiff', 'launch', 'trawler', 'schooner', 'flagship']) {
    G.boatId = boat; if (!G.owned.includes(boat)) G.owned.push(boat);
    const r = { flips: [], ok: 0, gaveUp: 0, timeout: 0, notSet: 0, secs: [], pathRatio: [], hpLost: 0, stuckStart: 0 };
    for (const t of trips) {
      b.hp = 2000; G.fish = null; G.toasts = [];
      Object.assign(b, { x: t.sx, y: t.sy, px: t.sx, py: t.sy, a: t.a0, pa: t.a0, vx: 0, vy: 0, w: 0, helm: 0, thr: 0 });
      for (let i = 0; i < 3; i++) step();
      if (!AP.setCourse(t.tx, t.ty)) { r.notSet++; continue; }
      const planned = [{ x: b.x, y: b.y }, ...AP.coursePath()]; let plen = 0; for (let i = 1; i < planned.length; i++) plen += Math.hypot(planned[i].x - planned[i - 1].x, planned[i].y - planned[i - 1].y);
      let s = 0, len = 0, px = b.x, py = b.y, moved3 = null, flips = 0, lastSteer = 0;
      for (; s < 30 * 240 && AP.courseTarget(); s++) { step(); const st = G.keys.ArrowRight ? 1 : G.keys.ArrowLeft ? -1 : 0; if (st && lastSteer && st !== lastSteer) flips++; if (st) lastSteer = st; len += Math.hypot(b.x - px, b.y - py); px = b.x; py = b.y; if (s === 90) moved3 = len; }
      const endD = Math.hypot(b.x - t.tx, b.y - t.ty);
      if (moved3 !== null && moved3 < 5) r.stuckStart++;
      r.hpLost += 2000 - b.hp;
      if (AP.courseTarget()) { r.timeout++; AP.dropCourse(); }
      else if (endD < 40) { r.ok++; r.secs.push(s / 30); r.pathRatio.push(len / Math.max(1, plen)); r.flips.push(flips / (s / 30 / 60)); }
      else r.gaveUp++;
    }
    const med = a => a.length ? +[...a].sort((p, q) => p - q)[a.length >> 1].toFixed(2) : null;
    res[boat] = { trips: trips.length, arrived: r.ok, gaveUp: r.gaveUp, timedOut: r.timeout, notSet: r.notSet, stuckAtStart: r.stuckStart, secMed: med(r.secs), pathVsPlan: med(r.pathRatio), steerFlipsPerMin: med(r.flips), hpLost: r.hpLost };
  }
  return res;
}, { N, SEED, HARD });
console.table(out); console.log('errors', JSON.stringify(errors));
await browser.close();
