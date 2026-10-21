import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

// The fishing dial never jumps: casting, waiting, the bite and the fight change its contents, not its size or place.
const frames = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const box = (page: Page) => page.evaluate(() => { const r = document.querySelector('.fishdial')?.getBoundingClientRect(); return r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });

test('the fishing dial keeps one size and place from cast to fight @both', async ({ page }) => {
  await sail(page);
  // stop over a biting school and cast
  await page.evaluate(() => {
    const { G, GAME, SPECIES, schoolsNear, sim } = window.BR, b = G.boat;
    const s = schoolsNear(b.x, b.y, 900).find((s: { sp: number; boss?: boolean }) => GAME.schoolActive(s) && SPECIES[s.sp].rod <= G.up.rod && !s.boss);
    Object.assign(b, { x: s.x + 28, y: s.y, px: s.x + 28, py: s.y, vx: 0, vy: 0, w: 0 });
    G.talk = null; G.mode = 'play'; G.stats.caught = 3;
    for (let i = 0; i < 3; i++) sim(1 / 30);
    G.pressed.add(' '); sim(1 / 30);
  });
  const seen: Record<string, unknown> = {};
  for (const want of ['cast', 'wait', 'bite', 'reel']) {
    await page.evaluate(w => {
      const { G, sim } = window.BR;
      for (let t = 0; t < 30 * 30 && G.fish && G.fish.st !== w; t++) { if (w === 'reel' && G.fish.st === 'bite') G.pressed.add(' '); sim(1 / 30); }
    }, want);
    expect(await page.evaluate(() => window.BR.G.fish?.st)).toBe(want);
    await frames(page); await frames(page);
    seen[want] = await box(page);
  }
  expect(seen.cast).toBeTruthy();
  expect(seen.wait).toEqual(seen.cast);
  expect(seen.bite).toEqual(seen.cast);
  expect(seen.reel).toEqual(seen.cast);
});
