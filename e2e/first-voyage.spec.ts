import { test, expect, sail } from './fixtures';
import type { Locator, Page } from '@playwright/test';

async function activate(button: Locator, phone: boolean): Promise<void> {
  if (phone) await button.tap(); else await button.click();
}

async function firstCatch(page: Page): Promise<void> {
  await sail(page);
  const landed = await page.evaluate(() => {
    const { G, GAME, sim } = window.BR;
    const school = GAME.castTargets().find(s => GAME.canLand(s.sp) && !s.boss);
    if (!school) throw new Error('No starter school in casting range');
    GAME.tryCast(school);
    for (let i = 0; i < 2700 && G.fish; i++) {
      if (G.fish.st === 'bite') G.pressed.add(' ');
      G.keys[' '] = G.fish.st === 'reel' && G.fish.tension < 0.55;
      sim(1 / 30);
    }
    G.keys[' '] = false;
    return { caught: G.stats.caught, hold: G.hold.length, card: !!G.card };
  });
  expect(landed).toEqual({ caught: 1, hold: 1, card: true });
}

async function firstSale(page: Page): Promise<{ coins: number }> {
  await firstCatch(page);
  return page.evaluate(() => {
    const { G, GAME, homePort, sim } = window.BR;
    for (let i = 0; i < 120; i++) sim(1 / 30);
    G.card = null; sim(1 / 30);
    GAME.placeAtPort(homePort()); GAME.dock(homePort());
    sim(1 / 30); // Settle the existing sale milestone before measuring spending.
    return { coins: G.coins };
  });
}

test('a real first catch leads from a lasting sale receipt to an optional Hold upgrade @both', async ({ page }, info) => {
  const phone = info.project.name === 'phone';
  const sale = await firstSale(page);
  await expect(page.locator('.detail')).toContainText('Sold 1 fish for');
  // Let transient feedback expire while staying in port: the receipt is not another timed toast.
  await page.evaluate(() => { for (let i = 0; i < 120; i++) window.BR.sim(1 / 30); });
  await expect(page.locator('.sale-receipt')).toContainText('Sold 1 fish for');
  await expect(page.locator('.detail')).not.toContainText('Nothing in the hold yet');
  await expect(page.locator('.detail')).toContainText('4 fish to 6 fish');
  await expect(page.locator('.toasts')).not.toContainText('Sold 1 fish');
  await page.screenshot({ path: info.outputPath('first-sale.png'), animations: 'disabled' });
  const browse = page.getByRole('button', { name: /^View Hold upgrade/ });
  if (phone) await browse.tap(); else await page.keyboard.press('Enter');
  await expect(page.locator('.detail h2')).toHaveText('Hold');
  expect(await page.evaluate(() => ({ coins: window.BR.G.coins, level: window.BR.G.up.hold })))
    .toEqual({ coins: sale.coins, level: 0 });
  await expect(page.locator('.detail')).toContainText('4 fish');
  await expect(page.locator('.detail')).toContainText('6 fish');
  await page.screenshot({ path: info.outputPath('first-upgrade.png'), animations: 'disabled' });
  const buy = page.getByRole('button', { name: /^Buy(?: Space)?$/ });
  await expect(buy).toBeEnabled();
  if (phone) await buy.tap(); else await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => ({ level: window.BR.G.up.hold, coins: window.BR.G.coins, capacity: window.BR.GAME.cap(), count: window.BR.G.stats.upgrades })))
    .toEqual({ level: 1, coins: sale.coins - 50 + 20, capacity: 6, count: 1 }); // Existing first-upgrade milestone pays $20.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bobber-run-save-v3')!).coins)).toBe(sale.coins - 50);
  await page.reload();
  await activate(page.getByRole('button', { name: 'CONTINUE', exact: true }), phone);
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => ({ hold: window.BR.G.up.hold, coins: window.BR.G.coins, caught: window.BR.G.stats.caught, sold: window.BR.G.stats.sold })))
    .toEqual({ hold: 1, coins: sale.coins - 50 + 20, caught: 1, sold: 1 });
});

test('the first catch presentation does not compete with objective or shortcut tips @both', async ({ page }) => {
  await firstCatch(page);
  await expect(page.locator('.card.first')).toBeVisible();
  await expect(page.locator('.chip.objective')).toHaveCount(0);
  await expect(page.locator('.hints')).toHaveCount(0);
  await page.evaluate(() => { window.BR.G.card = null; window.BR.tick(0); });
  await expect(page.locator('.chip.objective')).toBeVisible();
});

test('an existing hull tip and incidental discoveries stay out of a fishing fight @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, sim } = window.BR;
    G.stats.caught = 1; G.boat.hp = 50; G.story = { i: 99, base: { ...G.stats }, shown: true };
    sim(1 / 30);
  });
  await expect(page.locator('.hud-left')).toContainText('Rocks scrape your hull');
  await page.evaluate(() => {
    const { G, GAME } = window.BR;
    const school = GAME.castTargets().find(s => GAME.canLand(s.sp));
    if (!school) throw new Error('No starter school');
    GAME.tryCast(school);
    GAME.toast('A distant discovery', 'info', 'sailing');
    GAME.toast('Important line warning', 'bad');
  });
  await expect.poll(() => page.evaluate(() => !!window.BR.G.fish)).toBe(true);
  await expect(page.locator('.hud-left')).not.toContainText('Rocks scrape your hull');
  await expect(page.locator('.chip.objective')).toHaveCount(0);
  await expect(page.locator('.toasts')).not.toContainText('A distant discovery');
  await expect(page.locator('.toasts')).toContainText('Important line warning');
});

test('browsing the suggested Hold does not buy it or bypass insufficient funds @both', async ({ page }, info) => {
  await sail(page);
  const coins = await page.evaluate(() => {
    const { G, GAME, homePort, sim } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.stats.sold = 1; G.coins = 0;
    G.hold = [{ sp: 0, kg: 0.1, value: 1, trophy: false }];
    GAME.placeAtPort(homePort()); GAME.dock(homePort());
    sim(1 / 30);
    G.coins = 0;
    GAME.portItems(G.menu.port).find(i => i.kind === 'sell')?.act();
    return G.coins;
  });
  expect(coins).toBeLessThan(50);
  await activate(page.getByRole('button', { name: /^View Hold upgrade/ }), info.project.name === 'phone');
  await expect(page.locator('.detail h2')).toHaveText('Hold');
  await expect(page.getByRole('button', { name: /^Buy(?: Space)?$/ })).toBeDisabled();
  expect(await page.evaluate(() => ({ coins: window.BR.G.coins, level: window.BR.G.up.hold }))).toEqual({ coins, level: 0 });
});

test('partial sales keep their receipt and reserved fish; redocking clears old receipts @both', async ({ page }) => {
  await sail(page);
  const sale = await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR, p = homePort();
    G.stats.sold = 1; G.stats.upgrades = 1;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.active = [{ id: 'first-voyage-contract', from: p.id, to: 'port:1,1', toName: 'Elsewhere', sp: 0, n: 1, reward: 30 }];
    G.hold = [{ sp: 0, kg: 0.1, value: 3, trophy: false }, { sp: 1, kg: 0.1, value: 4, trophy: false }];
    GAME.placeAtPort(p); GAME.dock(p);
    const before = G.coins;
    GAME.portItems(p).find(i => i.kind === 'sell')?.act();
    return { value: G.coins - before, hold: G.hold.map(f => f.sp), sold: G.stats.sold };
  });
  expect(sale).toMatchObject({ hold: [0], sold: 2 });
  await expect(page.locator('.sale-receipt')).toHaveText(`Sold 1 fish for $${sale.value}`);
  await expect(page.getByRole('button', { name: /^View Hold upgrade/ })).toHaveCount(0);
  await page.evaluate(() => { const { GAME, homePort } = window.BR; GAME.leavePort(); GAME.dock(homePort()); });
  await expect(page.locator('.sale-receipt')).toHaveCount(0);
  expect(await page.evaluate(() => window.BR.G.hold.map(f => f.sp))).toEqual([0]);
});

test('controller A browses the first upgrade before a second press buys it', async ({ page }) => {
  const sale = await firstSale(page);
  const result = await page.evaluate(() => {
    const { G, sim } = window.BR, buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ buttons, axes: [0, 0] }] });
    buttons[0].pressed = true; sim(1 / 30);
    for (let i = 0; i < 30; i++) sim(1 / 30);
    const browsed = { tab: G.menu.tab, level: G.up.hold, coins: G.coins };
    buttons[0].pressed = false; sim(1 / 30);
    buttons[0].pressed = true; sim(1 / 30);
    buttons[0].pressed = false; sim(1 / 30);
    return { browsed, bought: { level: G.up.hold, coins: G.coins } };
  });
  expect(result).toEqual({ browsed: { tab: 1, level: 0, coins: sale.coins }, bought: { level: 1, coins: sale.coins - 50 + 20 } });
});

test('ferry travel and a new voyage clear the previous port sale', async ({ page }) => {
  await firstSale(page);
  const result = await page.evaluate(() => {
    const { G, GAME, homePort, poisNear } = window.BR, home = homePort();
    const destination = poisNear(home.x, home.y, 2400).find(p => p.type === 'port' && p.id !== home.id);
    if (!destination) throw new Error('No ferry destination');
    G.found.add(destination.id); G.coins = 10000;
    const stale = GAME.portItems(home).find(i => i.kind === 'sale');
    GAME.setTab(GAME.portTabs(home).indexOf('FERRY'));
    GAME.portItems(home).find(i => i.kind === 'ferry').act();
    const ferry = { arrived: G.menu.port.id !== home.id, sale: G.menu.sale ?? null };
    stale.act();
    const staleDenied = G.menu.tab === 0 && G.menu.port.id !== home.id;
    GAME.newGame();
    return { ferry, staleDenied, fresh: { port: G.menu.port, sale: G.menu.sale ?? null } };
  });
  expect(result).toEqual({ ferry: { arrived: true, sale: null }, staleDenied: true, fresh: { port: null, sale: null } });
});

test('speed upgrade help correctly describes boat-fitted parts', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { GAME, homePort } = window.BR; GAME.dock(homePort()); GAME.setTab(1); });
  await expect(page.locator('.detail')).toContainText('Speed upgrades stay with this boat');
  await expect(page.locator('.detail')).not.toContainText('carry over to every boat');
});

test('desktop and landscape phone leave reading space at 150% scale @both', async ({ page }, info) => {
  await firstSale(page);
  await page.evaluate(() => { window.BR.SET.ui = 1.5; window.BR.apply(); });
  const readable = () => page.locator('.detail > .d-body').evaluate(e => {
    const style = getComputedStyle(e), receipt = e.querySelector('.sale-receipt, .checklist .row');
    if (!receipt) return false;
    const body = e.getBoundingClientRect(), text = receipt.getBoundingClientRect();
    return e.clientHeight >= parseFloat(style.fontSize) * 3 && text.top >= body.top && text.bottom <= body.bottom;
  });
  await expect.poll(readable).toBe(true);
  await page.screenshot({ path: test.info().outputPath('landscape-large-first-sale.png'), animations: 'disabled' });
  await activate(page.getByRole('button', { name: /^View Hold upgrade/ }), info.project.name === 'phone');
  await expect(page.locator('.detail h2')).toHaveText('Hold');
  await expect.poll(readable).toBe(true);
  await page.screenshot({ path: test.info().outputPath('landscape-large-first-upgrade.png'), animations: 'disabled' });
});

test('the first-sale action stays reachable on a portrait phone at 150% scale @phone', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await firstSale(page);
  await page.evaluate(() => {
    window.BR.SET.ui = 1.5; window.BR.apply();
    window.BR.G.toasts = [{ s: 'The harbourmaster gives you $21 for the trip', kind: 'good', t: 60 }];
  });
  await expect(page.locator('.toast')).toHaveCount(1);
  expect(await page.locator('.toast').evaluate(e => {
    const r = e.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && e.scrollWidth <= e.clientWidth;
  }), 'dockside receipts fit the portrait viewport').toBe(true);
  const browse = page.getByRole('button', { name: /^View Hold upgrade/ });
  await browse.scrollIntoViewIfNeeded();
  expect(await browse.evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === e; })).toBe(true);
  expect(await page.locator('.detail').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('portrait-first-sale.png'), animations: 'disabled' });
  await browse.tap();
  await expect(page.locator('.detail h2')).toHaveText('Hold');
});
