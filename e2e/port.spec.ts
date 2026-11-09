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
  await page.evaluate(() => { window.BR.G.boat.hp = 30; });                           // a battered rowboat
  await page.evaluate(() => { const { G, GAME } = window.BR; for (let k = 0; k < 2 && !G.owned.includes('skiff'); k++) GAME.portItems(G.menu.port).find((i: { boat?: { id: string }; paint?: unknown }) => i.boat?.id === 'skiff' && !i.paint)?.act(); });
  expect(await page.evaluate(() => window.BR.G.owned)).toContain('skiff');
  // a new boat comes off the slip sound; the old one waits as it was left
  expect(await page.evaluate(() => window.BR.G.boat.hp / window.BR.GAME.hpMax())).toBe(1);
  expect(await page.evaluate(() => window.BR.G.up.hold)).toBe(0);                 // fitted parts belong to the boat: the skiff comes bare
  await page.evaluate(() => { const { G, GAME } = window.BR; GAME.portItems(G.menu.port).find((i: { boat?: { id: string }; paint?: unknown }) => i.boat?.id === 'row' && !i.paint)?.act(); });
  expect(await page.evaluate(() => [window.BR.G.boatId, window.BR.G.boat.hp, window.BR.G.up.hold])).toEqual(['row', 30, 1]);
});
test('a port without a shipyard says so and marks the nearest one', async ({ page }) => {
  await sail(page);
  const yard = await page.evaluate(() => {
    const { G, GAME, homePort, poisNear } = window.BR, h = homePort();
    const ports = poisNear(h.x, h.y, 9000).filter((q: { type: string }) => q.type === 'port');
    for (const q of ports) G.found.add(q.id);
    const p = ports.find((q: { shipyard: boolean }) => !q.shipyard);
    GAME.placeAtPort(p); GAME.dock(p);
    GAME.setTab(GAME.portTabs(p).indexOf('SHIPYARD'));
    const row = GAME.portItems(p).find((r: { kind: string }) => r.kind === 'note');
    const d = (q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);
    const nearest = ports.filter((q: { shipyard: boolean; id: string }) => q.shipyard && q.id !== p.id).sort((a: { x: number; y: number }, b: { x: number; y: number }) => d(a) - d(b))[0];
    row.act();
    return { label: row.label, name: nearest.name, at: G.waypoint && Math.hypot(G.waypoint.x - nearest.dock.x, G.waypoint.y - nearest.dock.y), side: nearest.yardSide };
  });
  expect(yard.label).toBe(`Nearest shipyard: ${yard.name}`);
  expect(yard.at).toBe(0);
  expect([1, -1]).toContain(yard.side);                                         // shipyards build their floating dock beside the pier
  await expect(page.locator('.port .services')).toContainText(`No shipyard · nearest is ${yard.name}`);
  await expect(page.locator('.tab.none')).toHaveText(/Shipyard/);
});
