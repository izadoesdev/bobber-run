import { test, expect, sail } from './fixtures';

// Shared catch links: /?catch=<species>&kg=<kg>&at=<x>,<y>&by=<name>. The visit points at the spot and says whose
// catch it was; whatever came in the URL is checked first, and the address bar is tidied afterwards.
test('a shared catch sets a waypoint, names the sailor and tidies the address @both', async ({ page }) => {
  await sail(page, '?offline&catch=perch&kg=1.4&at=2400,1800&by=Captain%20Kipper');
  await expect.poll(() => page.evaluate(() => window.BR.G.waypoint)).toEqual({ x: 2400, y: 1800 });
  await expect(page.locator('#ui')).toContainText('Captain Kipper landed a Perch of 1.4 kg');
  expect(new URL(page.url()).search).toBe('?offline');
});
test('a rude name in a share link is not shown', async ({ page }) => {
  await sail(page, '?offline&catch=perch&at=2400,1800&by=Sh1t%20Lord');
  await expect(page.locator('#ui')).toContainText('A sailor landed a Perch');
  await expect(page.locator('#ui')).not.toContainText('Sh1t');
});
test('a share link for a fish that does not exist is ignored', async ({ page }) => {
  await sail(page, '?offline&catch=kraken&at=2400,1800&by=Tester');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.BR.G.waypoint)).toBeNull();
});
