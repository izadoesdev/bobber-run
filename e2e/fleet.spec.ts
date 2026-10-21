import { test, expect, sail } from './fixtures';

// Away rewards: the fleet keeps fishing while the game is closed, up to its usual hold cap, and says so on return.
test('the fleet earns while you are away, up to its cap, and tells you on return', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR, h = homePort();
    G.owned = ['row', 'skiff']; G.fleet = { skiff: { port: h.id, portName: h.name, earned: 0 } }; GAME.saveGame();
    const key = 'bobber-run-save-v3', d = JSON.parse(localStorage.getItem(key)!);
    d.savedAt = Date.now() - 30 * 60_000;                       // closed half an hour ago
    localStorage.setItem(key, JSON.stringify(d));
    G.mode = 'title';                                            // so leaving the page doesn't save over it
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => Math.floor(window.BR.G.fleet.skiff.earned))).toBe(180);   // 18 a minute, 10 minutes' hold
  await expect(page.locator('#ui')).toContainText('Your fleet brought in $180 while you were away');
});
test('a quick reload earns nothing extra', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G, GAME, homePort } = window.BR, h = homePort(); G.owned = ['row', 'skiff']; G.fleet = { skiff: { port: h.id, portName: h.name, earned: 0 } }; GAME.saveGame(); });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => Math.floor(window.BR.G.fleet.skiff.earned))).toBe(0);
});
