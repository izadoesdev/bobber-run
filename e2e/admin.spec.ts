import { test, expect, sail } from './fixtures';

// The admin panel: only an account the server calls an admin gets it (F9 or the chip); it finds the sailors the relay
// reports and jumps next to one, onto open water, with that region opened so rough water doesn't push the boat back.
test('only admins get the panel, and it finds a sailor and jumps to them', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { window.BR.G.talk = null; window.BR.G.mode = 'play'; });
  await page.keyboard.press('F9');
  await expect(page.locator('.admin')).toHaveCount(0);
  await expect(page.locator('.admin-chip-open')).toHaveCount(0);
  await page.evaluate(() => { const { NET, ONLINE } = window.BR; NET.profile = { ...(NET.profile ?? {}), userId: 'u', name: 'Admin', admin: true }; ONLINE.far = [{ uid: 'a', name: 'bird', x: -6000, y: -4000 }]; });
  await page.locator('.admin-chip-open').click({ timeout: 15_000 });
  await page.locator('.admin input').fill('bir');
  await page.locator('.admin-row', { hasText: 'bird' }).getByRole('button', { name: 'Go' }).click();
  const at = await page.evaluate(() => { const { G, hAt } = window.BR; return { d: Math.hypot(G.boat.x + 6000, G.boat.y + 4000), h: hAt(G.boat.x, G.boat.y), open: G.unlocked.length > 0, cheated: G.cheated }; });
  expect(at.d).toBeLessThan(450);
  expect(at.h).toBeLessThan(0);
  expect(at).toMatchObject({ open: true, cheated: false });     // moving about doesn't mark the save
});
