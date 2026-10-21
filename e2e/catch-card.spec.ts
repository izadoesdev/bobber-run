import { test, expect, sail, landFish } from './fixtures';

// The catch card says what the market will pay (today's featured fish double, variants their multiplier), and a
// featured fish says why.
test("the catch card shows the market's value and marks today's featured fish", async ({ page }) => {
  await sail(page);
  await landFish(page);
  const want = await page.evaluate(() => { const { G, GAME } = window.BR; G.stats.caught = 2; return '$' + Math.round(GAME.fishValue(G.card.fish)).toLocaleString('en-US'); });
  await expect(page.locator('.card')).toContainText(want);
  // the same fish, as one of today's featured species
  const featured = await page.evaluate(() => { const { G, GAME, SPECIES } = window.BR; for (let i = 0; i < SPECIES.length; i++) { G.card.fish = { ...G.card.fish, sp: i }; if (GAME.fishValue(G.card.fish) >= 2 * G.card.fish.value * 0.99 && !SPECIES[i].legend) return i; } return -1; });
  expect(featured).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.card')).toContainText('×2 today');
});
