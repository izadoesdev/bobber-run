import { test, expect, sail, dockHome } from './fixtures';

// Earned paints are never sold: the shipyard says how to earn one, buying does nothing, and once earned it applies.
type Row = { kind: string; key?: string; sub?: string; right?: string; ok: boolean; why?: string; act: () => void };
test('earned paints show how to earn them, cannot be bought, and apply once earned', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.coins = 99_999; G.log = { perch: { n: 3, best: 1, trophy: false, vars: ['albino', 'golden'] } }; });
  await dockHome(page);
  const rows = () => page.evaluate(() => { const { G, GAME } = window.BR; GAME.setTab(GAME.portTabs(G.menu.port).indexOf('SHIPYARD')); return GAME.portItems(G.menu.port).filter((r: Row) => r.kind === 'paint').map((r: Row) => ({ key: r.key, sub: r.sub, right: r.right, ok: r.ok, why: r.why })); });
  const pearl = (await rows()).find(r => r.key === 'pearl')!;
  expect(pearl).toMatchObject({ right: 'Earn it', ok: false, why: expect.stringMatching(/variant/i), sub: expect.stringMatching(/2\/5$/) });   // how far along: 2 of 5 variants
  // measured around the press itself: a harbour gift or a discovery can pay out while docking
  const buy = await page.evaluate(() => { const { G, GAME } = window.BR, before = G.coins; GAME.portItems(G.menu.port).find((r: Row) => r.key === 'pearl').act(); return { spent: before - G.coins, owned: G.paints.includes('pearl') }; });
  expect(buy).toEqual({ spent: 0, owned: false });
  await page.evaluate(() => { const { G, GAME } = window.BR; G.paints.push('pearl'); GAME.portItems(G.menu.port).find((r: Row) => r.key === 'pearl').act(); });
  expect(await page.evaluate(() => window.BR.G.paint)).toBe('pearl');
});
