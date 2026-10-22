import { test, expect, sail, landFish } from './fixtures';

// The first minute decides whether a visitor stays: no title screen, a school in reach, a catch that can't be lost.
test('a new visitor starts on the water beside a school, within seconds @both', async ({ page }) => {
  const t0 = Date.now();
  await sail(page);                                         // fails unless a biting school is within 200 units
  expect(Date.now() - t0).toBeLessThan(15_000);
});
test('the first catch always lands, and its card says what it is worth @both', async ({ page }) => {
  await sail(page);
  const r = await landFish(page);
  expect(r).toEqual({ caught: 1, card: true });
  await expect(page.locator('#ui')).toContainText('$');
});
test('the first minute has no words; Maren speaks after the first catch without stopping the boat @both', async ({ page }) => {
  await sail(page);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => ({ speech: !!document.querySelector('.speech'), objective: !!document.querySelector('.chip.objective'), mode: window.BR.G.mode })))
    .toEqual({ speech: false, objective: false, mode: 'play' });
  await landFish(page);
  await page.evaluate(() => { window.BR.G.card = null; for (let i = 0; i < 120; i++) window.BR.sim(1 / 30); });   // skip the card's long first look; step 4 s of game time, past the welcome title even on a slow CI machine
  await expect(page.locator('.speech')).toContainText('Maren', { timeout: 10_000 });
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');   // spoken while sailing: no conversation screen
});
