import { test, expect, sail } from './fixtures';

// The market's own rules: the harbour buys your very first catch on the spot, and this week's running fish sell for
// a quarter more.
test('the first dock with fish sells them on the spot; later docks leave selling to you', async ({ page }) => {
  await sail(page);
  const first = await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR; G.talk = null; G.stats.sold = 0;
    G.hold = [{ sp: 0, kg: 0.1, value: 3, trophy: false }, { sp: 1, kg: 0.1, value: 4, trophy: false }];
    const c0 = G.coins; GAME.dock(homePort());
    return { hold: G.hold.length, sold: G.stats.sold, gain: G.coins - c0 };
  });
  expect(first).toMatchObject({ hold: 0, sold: 1 });
  expect(first.gain).toBeGreaterThan(0);
  const later = await page.evaluate(() => { const { G, GAME, homePort } = window.BR; G.mode = 'play'; G.hold = [{ sp: 0, kg: 0.1, value: 3, trophy: false }]; GAME.dock(homePort()); return G.hold.length; });
  expect(later).toBe(1);
});

test("this week's running fish sell for a quarter more, the rest at the port's own price", async ({ page }) => {
  await sail(page);
  const ratios = await page.evaluate(() => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(); G.sat = {};
    return SPECIES.map((_: unknown, i: number) => Math.round(GAME.priceAt(hp, i) / hp.mult[i] * 100) / 100);
  });
  const running = ratios.filter((r: number) => r === 1.25).length;
  expect(running).toBeGreaterThan(0);
  expect(running + ratios.filter((r: number) => r === 1).length).toBe(ratios.length);
});
