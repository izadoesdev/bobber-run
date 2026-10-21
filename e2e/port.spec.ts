import { test, expect, sail, landFish, dockHome } from './fixtures';

// The harbour: tabs, selling, buying gear and a boat, all through the same rows the player taps.
const tab = (name: string) => `(() => { const { G, GAME } = window.BR; GAME.setTab(GAME.portTabs(G.menu.port).indexOf('${name}')); return GAME.portItems(G.menu.port); })()`;

test('Alderhaven has its tabs and buys your catch', async ({ page }) => {
  await sail(page);
  await landFish(page);
  await dockHome(page);
  const tabs = await page.evaluate(() => window.BR.GAME.portTabs(window.BR.G.menu.port));
  expect(tabs).toEqual(expect.arrayContaining(['MARKET', 'OUTFITTER', 'SHIPYARD', 'HARBOUR']));
  const before = await page.evaluate(() => window.BR.G.coins);
  await page.evaluate(() => { const { G } = window.BR; if (G.hold.length) { const { GAME } = window.BR; GAME.portItems(G.menu.port).find((i: { kind: string }) => i.kind === 'sell')?.act?.(); } });
  await expect.poll(() => page.evaluate(() => ({ hold: window.BR.G.hold.length, coins: window.BR.G.coins }))).toEqual({ hold: 0, coins: expect.any(Number) });
  expect(await page.evaluate(() => window.BR.G.coins)).toBeGreaterThanOrEqual(before);
});
test('the outfitter sells an upgrade and the shipyard a boat', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { window.BR.G.coins = 5000; });
  await dockHome(page);
  await page.evaluate(tab('OUTFITTER'));
  await page.evaluate(() => { const { G, GAME } = window.BR; GAME.portItems(G.menu.port).find((i: { key?: string }) => i.key === 'hold').act(); });
  expect(await page.evaluate(() => window.BR.G.up.hold)).toBe(1);
  await page.evaluate(tab('SHIPYARD'));
  await page.evaluate(() => { const { G, GAME } = window.BR; for (let k = 0; k < 2 && !G.owned.includes('skiff'); k++) GAME.portItems(G.menu.port).find((i: { boat?: { id: string }; paint?: unknown }) => i.boat?.id === 'skiff' && !i.paint)?.act(); });
  expect(await page.evaluate(() => window.BR.G.owned)).toContain('skiff');
});
