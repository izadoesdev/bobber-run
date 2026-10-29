import { test, expect, sail } from './fixtures';

const journal = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => { const { G } = window.BR; G.journalBack = 'play'; G.mode = 'journal'; });
  await expect(page.locator('.journal-list')).toBeVisible();
};

test('exploration offers optional stories quietly, and starting one is a deliberate keyboard action @both', async ({ page }) => {
  await sail(page);
  const state = await page.evaluate(() => {
    const { G, sim, speech } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true }; G.regionsSeen.push('volcanic');
    for (let i = 0; i < 180; i++) sim(1 / 30);
    return { mode: G.mode, speech: speech(), packs: G.packs };
  });
  expect(state).toEqual({ mode: 'play', speech: null, packs: {} });
  await expect(page.locator('.speech')).toHaveCount(0);
  await journal(page);
  await page.getByText('Available stories', { exact: false }).click();
  const row = page.locator('[data-story="ember-isles"]');
  await expect(row).toContainText('Warm water');
  await expect(row).toContainText('Goal');
  await expect(row).toContainText('Reward');
  await row.getByText('Read conversation', { exact: true }).click();
  await expect(row).toContainText('Oda');
  await expect(row.locator('.face img').first()).toHaveJSProperty('complete', true);
  expect(await row.locator('.face img').first().evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(10);
  const start = row.getByRole('button', { name: 'Start story', exact: true });
  await start.focus(); await start.press('Enter');
  await expect(row.getByRole('button', { name: 'Pause story' })).toBeVisible();
  expect(await page.evaluate(() => ({ mode: window.BR.G.mode, status: window.BR.G.packs['ember-isles'].status }))).toEqual({ mode: 'journal', status: 'active' });
  await page.screenshot({ path: test.info().outputPath('optional-stories.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close journal' }).click();
  await expect(page.locator('.speech')).toHaveCount(0);
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
});

test('pausing keeps progress, ignores catches, survives reload and resumes from the journal @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G } = window.BR; G.story = { i: 99, base: { ...G.stats }, shown: true }; G.regionsSeen.push('volcanic');
    G.packs['ember-isles'] = { i: 0, n: 2, started: true }; // pre-upgrade save, already in progress
  });
  await journal(page);
  const row = page.locator('[data-story="ember-isles"]');
  await expect(row).toContainText('2/3');
  await row.getByRole('button', { name: 'Pause story' }).click();
  await page.getByText('Paused stories', { exact: false }).click();
  await expect(row.getByRole('button', { name: 'Resume story' })).toBeVisible();
  const paused = await page.evaluate(() => {
    const { G, CONTENT, sim, homePort } = window.BR, h = homePort();
    let spot: { x: number; y: number } | null = null;
    find: for (let r = 600; r < 6000; r += 150) for (let a = 0; a < 6.28; a += 0.25) {
      const x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r;
      if (CONTENT.biomeAt(x, y) === 'volcanic') { spot = { x, y }; break find; }
    }
    if (!spot) throw new Error('no volcanic region');
    G.mode = 'play';
    for (let i = 0; i < 10; i++) { CONTENT.packCatch({ sp: 0, kg: 1, value: 5, trophy: false }, spot.x, spot.y); sim(1); }
    return G.packs['ember-isles'];
  });
  expect(paused).toMatchObject({ i: 0, n: 2, status: 'paused' });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  await journal(page);
  await page.getByText('Paused stories', { exact: false }).click();
  await expect(row).toContainText('2/3');
  await row.getByRole('button', { name: 'Resume story' }).click();
  await expect(row.getByRole('button', { name: 'Pause story' })).toBeVisible();
  expect(await page.evaluate(() => window.BR.G.packs['ember-isles'])).toMatchObject({ i: 0, n: 2, status: 'active' });
});

test('a legacy active story can sail from the journal, and arriving completes it once', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G } = window.BR; G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.packs['stone-circle'] = { i: 0, n: 0, started: true };
  });
  await journal(page);
  await page.locator('[data-story="stone-circle"] [data-track=story-sail]').click();
  const wp = await page.evaluate(() => { const { G, hAt } = window.BR, w = G.waypoint; return { mode: G.mode, x: w.x, y: w.y, h: hAt(w.x, w.y) }; });
  expect(wp.mode).toBe('play');
  expect(wp.h).toBeLessThan(0);
  const result = await page.evaluate(([x, y]) => {
    const { G, sim } = window.BR;
    G.boat.x = x; G.boat.y = y; G.boat.vx = G.boat.vy = 0;
    for (let i = 0; i < 10; i++) sim(0.2);
    return { i: G.packs['stone-circle'].i, coins: G.coins, mode: G.mode };
  }, [wp.x, wp.y]);
  expect(result.i).toBe(1);
  expect(result.mode).toBe('play');
  expect(await page.evaluate(() => { for (let i = 0; i < 10; i++) window.BR.sim(0.2); return window.BR.G.coins; })).toBe(result.coins);
});

test('main story updates do not interrupt exploring, and the dialogue can be dismissed @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, sim } = window.BR;
    for (let i = 0; i < 40; i++) sim(0.1); // notes wait for the welcome title to fade in game time
    G.story = { i: 1, base: { ...G.stats }, shown: false };
    sim(0.1); G.stats.sold++; sim(0.1);
  });
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
  await expect(page.locator('.speech')).toContainText('saved in Journal');
  await page.getByRole('button', { name: 'Dismiss story dialogue' }).click();
  await expect(page.locator('.speech')).toHaveCount(0);
  await journal(page);
  await page.getByText('Main story so far', { exact: true }).click();
  await expect(page.locator('.main-story-history')).toContainText('Spend your coins on bait');
  await page.evaluate(() => { window.BR.GAME.newGame(); window.BR.G.mode = 'play'; });
  expect(await page.evaluate(() => window.BR.speech())).toBeNull();
});
