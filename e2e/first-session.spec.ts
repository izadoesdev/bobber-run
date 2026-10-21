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
