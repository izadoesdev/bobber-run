import { test, expect, sail, landFish } from './fixtures';

// A catch worth showing off (here: a new species) offers Share on its card; without a share sheet it saves the
// picture and copies the link.
test('a new species offers Share, which saves a picture of the catch', async ({ page }) => {
  await sail(page);
  await landFish(page);
  const share = page.locator('.card .share');
  await expect(share).toBeVisible();
  const download = page.waitForEvent('download');
  await page.evaluate(() => { (navigator as { canShare?: unknown }).canShare = undefined; });   // as on a desktop browser with no share sheet
  await share.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^bobber-run-.+\.png$/);
  await expect(page.locator('.toast')).toContainText('Link copied and picture saved');
});
