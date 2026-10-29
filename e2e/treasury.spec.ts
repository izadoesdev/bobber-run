import { test, expect, sail } from './fixtures';

async function ownHome(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const { G, REALM, GAME, homePort } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    REALM.islands = [{ key: '0,0', name: 'Quiet Island', price: 0, buildings: ['fishery'] }];
    G.realmRate = 60; G.treasury = 12.75;
    GAME.placeAtPort(homePort());
  });
}

test('lingering near an island banks income without payouts, floaters or treasury toasts', async ({ page }) => {
  await sail(page); await ownHome(page);
  const result = await page.evaluate(() => {
    const { G, sim } = window.BR;
    const before = { coins: G.coins, earned: G.earned, banked: G.treasury };
    G.toasts = []; G.floaters = [];
    for (let i = 0; i < 120; i++) sim(0.5);
    return { coins: G.coins - before.coins, earned: G.earned - before.earned, banked: G.treasury - before.banked,
      messages: G.toasts.filter((t: { s: string }) => /treasury/i.test(t.s)), floaters: G.floaters.length };
  });
  expect(result).toEqual({ coins: 0, earned: 0, banked: 60, messages: [], floaters: 0 });
});

test('collection is explicit, keeps fractions, pays once and saves immediately @both', async ({ page }) => {
  await sail(page); await ownHome(page);
  const before = await page.evaluate(() => {
    const { G, openIsland } = window.BR; G.treasury = 123.75; openIsland('0,0');
    return { coins: G.coins, earned: G.earned };
  });
  const collect = page.getByRole('button', { name: 'Collect treasury' });
  await expect(collect).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('island-treasury.png'), animations: 'disabled' });
  await collect.focus(); await collect.press('Enter');
  await expect(collect).toBeDisabled();
  const result = await page.evaluate(() => {
    const { G } = window.BR, saved = JSON.parse(localStorage.getItem('bobber-run-save-v3')!);
    return { coins: G.coins, earned: G.earned, treasury: G.treasury, saved: { coins: saved.coins, treasury: saved.treasury }, mode: G.mode };
  });
  expect(result).toEqual({ coins: before.coins + 123, earned: before.earned + 123, treasury: 0.75,
    saved: { coins: before.coins + 123, treasury: 0.75 }, mode: 'island' });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.BR.openIsland('0,0'));
  await expect(collect).toBeDisabled();
});

test('stale collection controls recheck distance and cannot pay twice before the next render', async ({ page }) => {
  await sail(page); await ownHome(page);
  await page.evaluate(() => { const { G, openIsland } = window.BR; G.treasury = 123.75; openIsland('0,0'); });
  await expect(page.getByRole('button', { name: 'Collect treasury' })).toBeEnabled();
  const result = await page.evaluate(() => {
    const { G } = window.BR, button = document.querySelector<HTMLButtonElement>('[data-track="island-collect"]')!;
    const before = G.coins, { x, y } = G.boat;
    G.boat.x = G.boat.y = 50_000; button.click();
    const remote = G.coins - before;
    Object.assign(G.boat, { x, y }); button.click(); button.click();
    return { remote, payout: G.coins - before, banked: G.treasury };
  });
  expect(result).toEqual({ remote: 0, payout: 123, banked: 0.75 });
});

test('island cards hide sailing discoveries but keep explicit collection feedback @both', async ({ page }) => {
  await sail(page); await ownHome(page);
  await page.evaluate(() => {
    const { G, GAME, openIsland } = window.BR;
    G.toasts = []; GAME.toast('A new lighthouse was charted', 'good', 'sailing'); openIsland('0,0');
  });
  await expect(page.getByRole('button', { name: 'Collect treasury' })).toBeEnabled();
  expect(await page.locator('.toasts .toast').allTextContents()).toEqual([]);
  await page.getByRole('button', { name: 'Collect treasury' }).click();
  await expect(page.locator('.toasts')).toContainText('Treasury collected');
});

test('a remote island card cannot collect, and menus do not accrue income', async ({ page }) => {
  await sail(page); await ownHome(page);
  await page.evaluate(() => { const { G, openIsland } = window.BR; G.boat.x = 50_000; G.boat.y = 50_000; openIsland('0,0'); });
  await expect(page.getByRole('button', { name: 'Collect treasury' })).toBeDisabled();
  await expect(page.locator('.isl-here')).toContainText('Sail near this island to collect');
  expect(await page.evaluate(() => {
    const { G, sim } = window.BR, before = G.treasury;
    for (let i = 0; i < 120; i++) sim(0.5);
    return G.treasury - before;
  })).toBe(0);
});
