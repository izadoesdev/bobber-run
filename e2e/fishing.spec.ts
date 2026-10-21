import { test, expect, sail } from './fixtures';

// The fight's promises: every surge is announced before it lands, easy reel lands a fish on its own without ever
// snapping (for at most two stars), and a golden school takes the bait without nibbling first.

/** In the page: hook a fish from the nearest school of the given kind, with a seasoned captain (no first-catch help). */
const hookFn = `(pick) => {
  const { G, GAME, SPECIES, schoolsNear, sim, homePort } = window.BR, hp = homePort(), b = G.boat;
  G.up.rod = 4; G.stats.caught = 50; G.boatId = 'trawler';
  window.step = () => { G.talk = null; G.mode = 'play'; sim(1 / 60); };
  const s = schoolsNear(hp.x, hp.y, 3500).find(q => GAME.schoolActive(q) && !q.boss && pick(SPECIES[q.sp], q));
  if (!s) throw new Error('no school of that kind');
  window.hook = () => {
    s.stock = s.max; Object.assign(b, { x: s.x + 30, y: s.y, px: s.x + 30, py: s.y, vx: 0, vy: 0, w: 0, a: Math.PI, helm: 0, thr: 0 });
    G.fish = null; G.card = null; G.hold = [];
    for (let i = 0; i < 3; i++) step();
    G.pressed.add(' '); step();
    let nibbles = 0, last;
    for (let t = 0; t < 2400 && G.fish && G.fish.st !== 'bite'; t++) { step(); if (G.fish?.teaseT !== undefined && G.fish.teaseT !== last) { nibbles++; last = G.fish.teaseT; } }
    G.pressed.add(' '); step();
    return { reeling: G.fish?.st === 'reel', nibbles };
  };
  return s.id;
}`;

test('every surge of a darting fish is announced about half a second before it lands', async ({ page }) => {
  await sail(page);
  await page.evaluate(`(${hookFn})((sp) => sp.fight === 'darter' && sp.diff > 0.4 && sp.deck === 0)`);
  const r = await page.evaluate(() => {
    const { G } = window.BR, w = window as any;
    if (!w.hook().reeling) return null;
    const f = G.fish, starts: number[] = [];
    let armed = (f.surge ?? 0) < 0.6, lastCue = 0, surges = 0, misses = 0;
    for (let t = 0; t < 40 * 60 && G.fish; t++) {
      G.keys[' '] = !f.warn && f.tension < 0.55; w.step();
      if ((f.cue ?? 0) > lastCue + 0.2) starts.push(G.t);                 // a new announcement
      lastCue = f.cue ?? 0;
      const surge = f.surge ?? 0;
      if (surge < 0.6) armed = true;
      if (surge > 0.9 && armed && t > 30) { armed = false; surges++; if (!starts.some(s => G.t - s > 0.3 && G.t - s < 0.7)) misses++; }
    }
    G.keys[' '] = false;
    return { surges, misses };
  });
  expect(r).not.toBeNull();
  expect(r!.surges).toBeGreaterThan(3);
  expect(r!.misses).toBe(0);
});

test('easy reel lands a fish with no input, never near snapping, for at most two stars', async ({ page }) => {
  await sail(page);
  await page.evaluate(`(${hookFn})((sp) => sp.diff > 0.6 && sp.deck === 0)`);
  const r = await page.evaluate(() => {
    const { G, SET } = window.BR, w = window as any;
    SET.reelAssist = true;
    if (!w.hook().reeling) return null;
    let maxT = 0;
    for (let t = 0; t < 150 * 60 && G.fish; t++) { w.step(); if (G.fish) maxT = Math.max(maxT, G.fish.tension); }
    return { landed: !!G.card, stars: G.card?.stars, maxT };
  });
  expect(r).toMatchObject({ landed: true });
  expect(r!.stars).toBeLessThanOrEqual(2);
  expect(r!.maxT).toBeLessThan(0.9);
});

test('a golden school bites without nibbling first', async ({ page }) => {
  await sail(page);
  const id = await page.evaluate(`(${hookFn})((sp) => sp.deck === 0 && sp.fight !== 'steady')`);
  const nibbles = await page.evaluate((id) => {
    const { G, schoolsNear, homePort } = window.BR, w = window as any, hp = homePort();
    schoolsNear(hp.x, hp.y, 3500).find((q: { id: string }) => q.id === id).gold = true;
    const n: number[] = [];
    for (let k = 0; k < 4; k++) { n.push(w.hook().nibbles); G.fish = null; }
    return n;
  }, id);
  expect(nibbles).toEqual([0, 0, 0, 0]);
});
