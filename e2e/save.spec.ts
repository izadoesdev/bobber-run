import { test, expect, sail } from './fixtures';

// Saves survive a reload, and a save from an older world keeps progress but drops what belonged to the old map.
test('coins and gear come back after a reload', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G, GAME } = window.BR; G.coins = 1234; G.up.rod = 2; GAME.saveGame(); });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.evaluate(() => { const { G } = window.BR; G.titleSel = 0; });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => ({ coins: window.BR.G.coins, rod: window.BR.G.up.rod }))).toEqual({ coins: 1234, rod: 2 });
});
test('a save from an older world keeps progress and starts at Alderhaven', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, GAME } = window.BR; G.coins = 777; GAME.saveGame();
    const key = 'bobber-run-save-v3', d = JSON.parse(localStorage.getItem(key)!);
    Object.assign(d, { world: 1, waypoint: { x: 5000, y: 5000 }, salvaged: ['wreck:1,1'] });
    localStorage.setItem(key, JSON.stringify(d));
    localStorage.setItem = () => { };                     // or the save on pagehide writes the live game back over it
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  const s = await page.evaluate(() => { const { G, homePort } = window.BR, h = homePort(); return { coins: G.coins, waypoint: G.waypoint, salvaged: [...G.salvaged], nearHome: Math.hypot(G.boat.x - h.x, G.boat.y - h.y) < 400 }; });
  expect(s).toEqual({ coins: 777, waypoint: null, salvaged: [], nearHome: true });
  await expect(page.locator('#ui')).toContainText('The coast has changed while you were away');
});
