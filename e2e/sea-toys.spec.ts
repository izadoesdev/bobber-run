import { test, expect, sail } from './fixtures';

test('admin sea toys are gated, genuinely summon sea life and keep sandbox saves off records', async ({ page }) => {
  await sail(page);
  await page.keyboard.press('F9');
  await expect(page.locator('.admin')).toHaveCount(0);
  await page.evaluate(() => {
    const { G, NET, LIFE } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    NET.profile = { admin: true, name: 'Test captain' };
    Object.assign(G.boat, { x: 700, y: 700, vx: 0, vy: 0 });
    LIFE.whales = []; LIFE.pods = []; LIFE.swarms.clear();
    LIFE.nextWhale = LIFE.nextGiant = LIFE.nextPod = 1e6;
  });
  await page.keyboard.press('F9');
  await page.locator('.admin-tabs').getByRole('button', { name: 'Fun', exact: true }).click();
  await expect(page.locator('.admin')).toContainText('no world records');
  await page.getByRole('button', { name: /Call a humpback/ }).click();
  await expect.poll(() => page.evaluate(() => window.BR.LIFE.whales.length)).toBe(1);
  await page.getByRole('button', { name: /Dolphin parade/ }).click();
  await expect.poll(() => page.evaluate(() => window.BR.LIFE.pods[0]?.m.length)).toBe(3);
  await page.getByRole('button', { name: /Jellyfish lantern party/ }).click();
  await expect.poll(() => page.evaluate(() => window.BR.LIFE.swarms.get('jelly-party')?.m.length ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.BR.GAME.isNight())).toBe(true);
  const before = await page.evaluate(() => window.BR.G.bait.shrimp);
  await page.getByLabel('Secret code').fill('dontpanic');
  await page.getByLabel('Secret code').press('Enter');
  expect(await page.evaluate(() => window.BR.G.bait.shrimp)).toBe(before + 42);
  expect(await page.evaluate(() => window.BR.G.cheated)).toBe(true);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bobber-run-save-v3')!).cheated)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('captains-sandbox.png') });
  await page.getByRole('button', { name: 'Close admin panel' }).click();
  await expect(page.locator('.admin')).toHaveCount(0);
});
