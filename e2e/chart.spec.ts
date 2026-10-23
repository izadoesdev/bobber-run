import { test, expect, sail } from './fixtures';

// The sea chart and the waypoint: M opens it, a waypoint gets a water route, and arriving clears it.
test('the chart opens and closes with M', async ({ page }) => {
  await sail(page);
  // under heavy CPU load a synthetic key can miss a frame, so press again only while the mode hasn't changed
  const pressUntil = (mode: string) => expect(async () => {
    if (await page.evaluate(() => window.BR.G.mode) !== mode) await page.keyboard.press('m');
    await expect.poll(() => page.evaluate(() => window.BR.G.mode), { timeout: 3000 }).toBe(mode);
  }).toPass({ timeout: 30_000 });                                      // a starved CI renderer can take seconds per frame
  await pressUntil('map');
  await pressUntil('play');
});
test('sailing onto a waypoint clears it', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.waypoint = { x: G.boat.x + 200, y: G.boat.y }; });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.BR.G.waypoint)).not.toBeNull();       // still far away
  await page.evaluate(() => { const { G } = window.BR; Object.assign(G.boat, { x: G.waypoint.x, y: G.waypoint.y, px: G.waypoint.x, py: G.waypoint.y }); });
  await expect.poll(() => page.evaluate(() => window.BR.G.waypoint)).toBeNull();   // arrival is noticed on the next frames
});
