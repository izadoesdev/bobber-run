import { test, expect, sail } from './fixtures';

// Story packs: one opens when its unlock is met, its people speak in the sailing speech strip (the boat keeps
// sailing), and the journal lists it with its current quest.
test('a story pack opens, speaks while you sail, and shows in the journal', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.talk = null; G.story = { i: 99, base: { ...G.stats }, shown: true }; G.regionsSeen.push('volcanic'); });
  await expect(page.locator('.speech')).toContainText('Oda', { timeout: 15_000 });
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.evaluate(() => { const { G } = window.BR; G.journalBack = 'play'; G.mode = 'journal'; });
  await expect(page.locator('.journal-list')).toContainText('The Ember Isles');
  await expect(page.locator('.journal-list')).toContainText('Warm water');
});
