import { test, expect, sail, landFish } from './fixtures';

// The catch card says what the market will pay (today's featured fish double, variants their multiplier), and a
// featured fish says why.
test("the catch card shows the market's value and marks today's featured fish", async ({ page }) => {
  // the card's clock is pinned (G.card.t = -60) while it's read: a second catch's card only lasts 3.2 s, less than a loaded CI frame budget
  await sail(page);
  await landFish(page);
  const want = await page.evaluate(() => { const { G, GAME } = window.BR; G.stats.caught = 2; G.card.t = -60; return '$' + Math.round(GAME.fishValue(G.card.fish)).toLocaleString('en-US'); });
  await expect(page.locator('.card')).toContainText(want);
  // the same fish, as one of today's featured species
  const featured = await page.evaluate(() => { const { G, GAME, SPECIES } = window.BR; G.card.t = -60; const base = { ...G.card.fish, variant: undefined };   // a variant (a tiny one sells x0.6) would hide the doubling
    for (let i = 0; i < SPECIES.length; i++) { const f = { ...base, sp: i }; if (!SPECIES[i].legend && GAME.fishValue(f) >= 1.9 * f.value) { G.card.fish = f; return i; } } return -1; });
  expect(featured).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.card')).toContainText('×2 today');
});
