import { test, expect, sail } from './fixtures';

// Phones: touch mode turns on, the on-screen buttons show, and a tap on the sea sets a course there.
test('touch mode, its buttons, and tap-to-sail @phone', async ({ page }) => {
  await sail(page);
  await expect(page.locator('html')).toHaveClass(/touch/);
  await expect(page.locator('#touch .tb').first()).toBeVisible();
  const box = (await page.locator('#screen').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.8, box.y + box.height * 0.3);
  await expect(page.locator('#touch .course-pin')).toHaveCount(1);
});
