import { test, expect, sail, landFish } from './fixtures';

// The first minute decides whether a visitor stays: no title screen, a school in reach, a catch that can't be lost.
test('a new visitor starts on the water beside a school, within seconds @both', async ({ page }) => {
  const t0 = Date.now();
  await sail(page);                                         // fails unless a biting school is within 200 units
  // a guard against a startup that hangs, not a speed test: this machine and CI's run several browsers on software
  // rendering at once (scripts/probes/startup.mjs measures real load time)
  expect(Date.now() - t0).toBeLessThan(30_000);
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
  // step game time past the welcome title and the catch animation (however slowly CI paints), skip the card's long
  // first look, then a second more for Maren's line to start
  const who = await page.evaluate(() => { for (let i = 0; i < 120; i++) window.BR.sim(1 / 30); window.BR.G.card = null; for (let i = 0; i < 30; i++) window.BR.sim(1 / 30); return window.BR.speech()?.name; });
  expect(who).toBe('Maren');
  // the strip shows on the next painted frame, which on CI's software-rendered phone can take many seconds
  await expect(page.locator('.speech')).toContainText('Maren', { timeout: 30_000 });
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');   // spoken while sailing: no conversation screen
});
