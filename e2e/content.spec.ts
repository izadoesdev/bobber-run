import { test, expect, sail } from './fixtures';

// Available stories never count actions until accepted. Accepted chains count matching catches and pay once.
test('the Ember Isles pack opens in its region, counts catches there and moves to the next quest', async ({ page }) => {
  await sail(page);
  const spot = await page.evaluate(() => {
    const { CONTENT, hAt, homePort } = window.BR, h = homePort();
    for (let r = 600; r < 6000; r += 150) for (let a = 0; a < 6.28; a += 0.25) { const x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r; if (CONTENT.biomeAt(x, y) === 'volcanic' && hAt(x, y) < -0.2) return { x, y }; }
    return null;
  });
  expect(spot, 'some ember-isle water').not.toBeNull();
  await page.evaluate(({ x, y }) => {
    const { G, sim } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true }; // this test needs open waters, not the main-story border
    G.talk = null; Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0 });
    sim(1.1); // complete a discovery tick before reading the journal
  }, spot!);
  await expect.poll(() => page.evaluate(() => window.BR.CONTENT.packJournal().find((j: { pack: { id: string } }) => j.pack.id === 'ember-isles')?.want ?? 0), { timeout: 20_000 }).toBe(3);
  expect(await page.evaluate(() => window.BR.G.packs['ember-isles'])).toBeUndefined();
  await page.evaluate(() => { window.BR.G.packs['ember-isles'] = { i: 0, n: 0, started: true, status: 'active' }; });
  const coins = await page.evaluate(() => window.BR.G.coins);
  await page.evaluate(({ x, y }) => { const { CONTENT, G } = window.BR; for (let i = 0; i < 3; i++) CONTENT.packCatch({ sp: 0, kg: 1, value: 5, trophy: false }, x, y); G.talk = null; }, spot!);
  await expect.poll(() => page.evaluate(() => window.BR.G.coins), { timeout: 20_000 }).toBe(coins + 150);
  await expect.poll(() => page.evaluate(() => window.BR.CONTENT.packJournal().find((j: { pack: { id: string } }) => j.pack.id === 'ember-isles')?.quest?.id), { timeout: 20_000 }).toBe('vent-crabs');
});
test('catches outside the pack region do not count', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.regionsSeen.push('volcanic'); G.packs['ember-isles'] = { i: 0, n: 0, started: true, status: 'active' }; });
  const ember = () => page.evaluate(() => window.BR.CONTENT.packJournal().find((j: { pack: { id: string } }) => j.pack.id === 'ember-isles'));
  await expect.poll(async () => (await ember())?.want ?? 0, { timeout: 20_000 }).toBe(3);
  await page.evaluate(() => { const { CONTENT, homePort } = window.BR, h = homePort(); for (let i = 0; i < 5; i++) CONTENT.packCatch({ sp: 0, kg: 1, value: 5, trophy: false }, h.x + 80, h.y + 80); });
  expect((await ember())?.have).toBe(0);
});
