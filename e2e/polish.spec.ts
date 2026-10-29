import { test, expect, sail } from './fixtures';

test('repeating a notice does not crowd out a warning or extend its lifetime', async ({ page }) => {
  await sail(page);
  const result = await page.evaluate(() => {
    const { G, GAME } = window.BR; G.toasts = [];
    GAME.toast('Repair your hull', 'bad');
    GAME.toast('Nothing to collect');
    G.toasts[1].t = 1;
    for (let i = 0; i < 10; i++) GAME.toast('Nothing to collect');
    return G.toasts;
  });
  expect(result).toEqual([{ s: 'Repair your hull', kind: 'bad', t: 2.8 }, { s: 'Nothing to collect', kind: 'info', t: 1 }]);
});

test('Escape dismisses a story note without pausing, then pauses normally', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, sim } = window.BR;
    for (let i = 0; i < 40; i++) sim(0.1); // pass the welcome title in game time, independent of software-GPU frame rate
    G.story = { i: 1, base: { ...G.stats }, shown: false }; sim(0.1);
  });
  await expect(page.locator('.speech')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.speech')).toHaveCount(0);
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
});

test('Escape pauses when the welcome title hides a pending story note @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, sim } = window.BR;
    G.t = 0; G.story = { i: 1, base: { ...G.stats }, shown: false }; sim(0.1);
  });
  await expect(page.locator('.speech')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
});

test('gamepad users can focus and pause a story without being kicked out of the journal', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G } = window.BR; G.regionsSeen.push('volcanic'); G.packs['ember-isles'] = { i: 0, n: 1, started: true, status: 'active' };
    G.journalBack = 'play'; G.mode = 'journal';
  });
  await expect(page.locator('[data-story="ember-isles"]')).toBeVisible();
  await page.evaluate(() => {
    const { G, sim } = window.BR; G.pad = true;
    for (let i = 0; i < 3; i++) { G.pressed.add('ArrowDown'); sim(0.1); }
  });
  await expect(page.getByRole('button', { name: 'Pause story' })).toBeFocused();
  await page.evaluate(() => { const { G, sim } = window.BR; G.pad = true; G.pressed.add(' '); sim(0.1); });
  expect(await page.evaluate(() => ({ mode: window.BR.G.mode, status: window.BR.G.packs['ember-isles'].status }))).toEqual({ mode: 'journal', status: 'paused' });
});

test('a fresh voyage resets runtime flags, timers and stale surroundings', async ({ page }) => {
  await sail(page);
  const result = await page.evaluate(() => {
    const { G, GAME } = window.BR;
    Object.assign(G, { lairTold: true, throttle: 1, netT: 100, potT: 100, saveT: 14, sunkT: 3, prompt: 'Old prompt', nearWreck: { id: 'old' } });
    GAME.newGame();
    return { lairTold: G.lairTold, throttle: G.throttle, netT: G.netT, potT: G.potT, saveT: G.saveT, sunkT: G.sunkT, prompt: G.prompt, nearWreck: G.nearWreck };
  });
  expect(result).toEqual({ lairTold: false, throttle: 0, netT: 0, potT: 0, saveT: 0, sunkT: 0, prompt: null, nearWreck: null });
});

test('a failed save is visible, save and quit stays open, and retry clears the warning @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) { if (key === 'bobber-run-save-v3') throw new DOMException('Full', 'QuotaExceededError'); original.call(this, key, value); };
    const { G } = window.BR; G.mode = 'pause';
  });
  await page.getByRole('button', { name: 'SAVE & QUIT', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Progress is not being saved' })).toBeVisible();
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('pause');
  await page.screenshot({ path: test.info().outputPath('save-failure.png'), animations: 'disabled' });
  await page.evaluate(() => (window as any).__restoreStorage());
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.locator('.save-warning')).toHaveCount(0);
  expect(await page.evaluate(() => !!localStorage.getItem('bobber-run-save-v3'))).toBe(true);
});

test('malformed fish and out-of-range upgrades cannot break a returning voyage', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    window.BR.GAME.saveGame();
    const key = 'bobber-run-save-v3', data = JSON.parse(localStorage.getItem(key)!);
    const fish = { sp: 0, kg: 1, value: 10, trophy: false };
    data.hold = [fish, { ...fish, sp: -1 }, { ...fish, sp: 999 }]; data.up.rod = 999;
    localStorage.setItem(key, JSON.stringify(data));
    window.BR.G.mode = 'title'; // unloading must not overwrite the fixture
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode)).toBe('title');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => ({ hold: window.BR.G.hold.length, rod: window.BR.G.up.rod }))).toEqual({ hold: 1, rod: 4 });
  await page.keyboard.press('Tab');
  await expect(page.locator('.hold-grid')).toBeVisible();
});

test('journal notices do not cover reading with discoveries, but still surface warnings', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.toasts = []; G.mode = 'journal';
    GAME.toast('New landmark charted', 'good');
    GAME.toast('The hold is full', 'bad');
  });
  await expect(page.locator('.toasts')).toContainText('The hold is full');
  expect(await page.locator('.toasts .toast').allTextContents()).toEqual(['The hold is full']);
});

test('portrait story controls remain readable, tappable and inside their scrolling column @phone', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.regionsSeen.push('volcanic'); G.packs['ember-isles'] = { i: 0, n: 0, started: true, status: 'active' }; G.mode = 'journal'; });
  const button = page.getByRole('button', { name: 'Pause story' });
  await button.scrollIntoViewIfNeeded();
  const size = await button.evaluate(e => ({ font: parseFloat(getComputedStyle(e).fontSize), height: e.getBoundingClientRect().height }));
  expect(size.font).toBeGreaterThanOrEqual(12);
  expect(size.height).toBeGreaterThanOrEqual(44);
  expect(await page.locator('.journal-list').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await expect(page.locator('.detail')).toContainText('tap Cast');
  await expect(page.locator('#touch .tcorner')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('portrait-journal.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Close journal' }).click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
});
