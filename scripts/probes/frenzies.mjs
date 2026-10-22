// How often feeding frenzies happen (run against the dev server: node scripts/probes/frenzies.mjs): an hour of play
// near home, simulated, in calm weather and in a storm, with and without the radio. Per run: frenzies started, the
// share of play time one is on, and when the first came.
import { chromium } from '@playwright/test';
const b = await chromium.launch(), p = await b.newPage();
await p.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());
await p.goto((process.argv[2] || 'http://localhost:5173/') + '?offline', { timeout: 90000 });
await p.waitForFunction(() => window.BR?.G?.mode === 'play', null, { timeout: 90000 });
const out = await p.evaluate(() => {
  const { G, sim, setWeather, WX } = window.BR, res = {};
  const t0 = G.t, nf0 = G.nextFrenzy - G.t;                          // the first frenzy's delay, as a new page load sets it
  for (const [name, storm, radio] of [['calm', false, 0], ['calm+radio', false, 1], ['storm', true, 0], ['storm+radio', true, 1]]) {
    G.up.radio = radio; G.frenzy = null; G.nextFrenzy = G.t + nf0;
    let starts = 0, on = 0, first = null, was = false;
    const start = G.t;
    for (let i = 0; i < 3600 * 5; i++) {                             // an hour at 5 steps a second
      if (storm) setWeather('storm'); else if (WX.state === 'storm') setWeather('clear');
      G.talk = null; if (G.mode !== 'play') G.mode = 'play'; G.fish = null;
      sim(0.2);
      const now = !!G.frenzy;
      if (now && !was) { starts++; first ??= Math.round(G.t - start); }
      if (now) on += 0.2;
      was = now;
    }
    res[name] = { perHour: starts, activeShare: Math.round(on / 36) + '%', firstAfterS: first };
  }
  return res;
});
console.table(out);
await b.close();
