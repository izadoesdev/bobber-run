import { test, expect, sail } from './fixtures';

// Story packs: one opens when its unlock is met, its people speak in the sailing speech strip (the boat keeps
// sailing), and the journal lists it with its current quest.
test('a story pack opens, speaks while you sail, and shows in the journal', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.talk = null; G.story = { i: 99, base: { ...G.stats }, shown: true }; G.regionsSeen.push('volcanic'); });
  await expect(page.locator('.speech')).toContainText('Oda', { timeout: 15_000 });
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.evaluate(() => { const { G } = window.BR; G.journalBack = 'play'; G.mode = 'journal'; });
  await expect(page.locator('.journal-list')).toContainText('The Ember Isles', { timeout: 15_000 });   // a screen switch waits for the next frame
  await expect(page.locator('.journal-list')).toContainText('Warm water');
});

// A quest that sends you to a place: the journal's Sail there sets a waypoint on water beside it and sails, and
// arriving there completes it.
test('a story place can be sailed to from the journal, and arriving there completes the quest', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G } = window.BR; G.talk = null; G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.packs['stone-circle'] = { i: 0, n: 0, started: true }; G.journalBack = 'play'; G.mode = 'journal';
  });
  const row = page.locator('.journal-list .item', { hasText: 'The Stone Circle' });
  await row.locator('[data-track=story-sail]').click({ timeout: 15_000 });
  const wp = await page.evaluate(() => { const { G, hAt } = window.BR, w = G.waypoint; return { mode: G.mode, x: w.x, y: w.y, h: hAt(w.x, w.y) }; });
  expect(wp.mode).toBe('play');
  expect(wp.h).toBeLessThan(0);                                       // on water, though the stones stand on land
  await expect.poll(() => page.evaluate(([x, y]) => {
    const { G, sim } = window.BR; G.boat.x = x; G.boat.y = y; G.boat.vx = G.boat.vy = 0; sim(0.5);
    return G.packs['stone-circle'].i;
  }, [wp.x, wp.y]), { timeout: 15_000 }).toBe(1);
});
