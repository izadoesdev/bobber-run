import { test, expect, sail } from './fixtures';

// Regions open with the story: when a story step opens new ones, the captain hears about it once back at the helm,
// and sailing into a region gives its name and a line about it.
test('a story step that opens new waters says so, and a region names itself as you sail in', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, sim } = window.BR; G.talk = null; G.found = new Set([...G.found].slice(0, 1));   // nothing charted yet, so no quest completes
    G.story = { i: 2, base: { ...G.stats }, shown: true }; G.mode = 'play'; sim(0.3);
    G.story = { i: 3, base: { ...G.stats }, shown: true }; sim(0.3);
  });
  const title = page.locator('.region-title:not(.welcome)');
  await expect(title).toContainText('New waters open', { timeout: 15_000 });
  // into the next region east (open now): after a few seconds there, its name and a line about it come up
  await page.evaluate(() => { const { G } = window.BR; G.boat.x += 2000; G.boat.vx = G.boat.vy = 0; });
  await expect(title).not.toContainText('New waters', { timeout: 20_000 });
  await expect(title.locator('small')).not.toBeEmpty({ timeout: 15_000 });
});
