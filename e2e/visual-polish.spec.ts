import { test, expect, sail, dockHome } from './fixtures';

test('harbour typography is local, smooth and switchable without losing the pixel option @both', async ({ page }, info) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.story = { i: 99, base: { ...G.stats }, shown: true }; });
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  else await page.keyboard.press('Escape');
  const settings = page.locator('.menu .item').filter({ hasText: /^Settings$/i });
  if (info.project.name === 'phone') await settings.tap();
  else await settings.click();
  const font = page.locator('.item').filter({ has: page.locator('span').getByText('Font', { exact: true }) });
  await expect(font).toContainText('Harbour');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('#ui').evaluate(e => getComputedStyle(e).fontFamily)).toContain('Nunito Sans');
  expect(await page.locator('h1').evaluate(e => getComputedStyle(e).fontFamily)).toContain('Fraunces');
  expect(await page.evaluate(() => document.fonts.check('600 16px Fraunces') && document.fonts.check('400 16px "Nunito Sans"'))).toBe(true);

  for (const [name, family] of [['Pixel', 'Pixelify'], ['Plain', 'system-ui'], ['Harbour', 'Nunito Sans']]) {
    await font.scrollIntoViewIfNeeded();
    const box = await font.boundingBox();
    const position = { x: box!.width - 15, y: box!.height / 2 };
    if (info.project.name === 'phone') await font.tap({ position });
    else await font.click({ position });
    await expect(font).toContainText(name);
    expect(await page.locator('#ui').evaluate(e => getComputedStyle(e).fontFamily)).toContain(family);
    if (info.project.name === 'phone') expect(await page.locator('#touch').evaluate(e => getComputedStyle(e).fontFamily)).toContain(family);
  }
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.BR?.SET.font)).toBe('harbour');
});

test('a saved pixel-font preference is still honoured', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('bobber-run-settings', JSON.stringify({ font: 'pixel' })));
  await sail(page);
  await expect(page.locator('#ui')).toHaveClass(/pixel/);
  expect(await page.locator('#ui').evaluate(e => getComputedStyle(e).fontFamily)).toContain('Pixelify');
});

test('every boat has a labelled, uncropped portrait, including the tallest rigs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await sail(page);
  const ids = await page.evaluate(() => Object.keys(window.BR.MODELS.BOAT_MODELS));
  for (const id of ids) {
    await page.evaluate(id => { const { G } = window.BR; G.boatId = id; G.mode = 'ship'; }, id);
    const portrait = page.locator(`.boat-portrait[data-boat="${id}"]`);
    await expect(portrait.getByRole('img', { name: /three-quarter view/ })).toBeVisible();
    await expect(portrait.locator('figcaption')).not.toBeEmpty();
    await expect.poll(() => portrait.locator('canvas').evaluate(canvas => {
      const ctx = canvas.getContext('2d')!, { width, height } = canvas;
      const { data } = ctx.getImageData(0, 0, width, height);
      let left = width, top = height, right = -1, bottom = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] < 128) continue;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      return left > 2 && top > 2 && right < width - 3 && bottom < height - 3 && right - left > width * 0.2;
    }), { message: `${id} portrait fits inside its canvas` }).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath('superyacht-portrait.png'), animations: 'disabled' });
});

test('the shipyard has legible thumbnails and a separate scrolling detail body @both', async ({ page }, info) => {
  await sail(page);
  await dockHome(page);
  await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.toasts = [];
    GAME.setTab(GAME.portTabs(G.menu.port).indexOf('SHIPYARD'));
  });
  const thumb = page.locator('.boat-thumb').first();
  await expect(thumb).toBeVisible();
  const bounds = await thumb.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(40);
  const footer = await page.locator('.d-foot').boundingBox(), body = await page.locator('.detail > .d-body').boundingBox();
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y);
  await expect(page.locator('.detail > .d-body')).toContainText('Quiet oars');
  if (info.project.name === 'desktop') await expect(page.locator('.boat-portrait')).toBeVisible();
  await page.screenshot({ path: info.outputPath('shipyard.png'), animations: 'disabled' });
});

test('portrait shipyard and journal keep their controls inside the viewport @phone', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await sail(page);
  await dockHome(page);
  await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.toasts = [];
    GAME.setTab(GAME.portTabs(G.menu.port).indexOf('SHIPYARD'));
  });
  await expect(page.getByRole('button', { name: /Leave port/i })).toBeVisible();
  expect(await page.locator('.screen').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await page.locator('.boat-portrait figcaption').evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12);
  await page.screenshot({ path: test.info().outputPath('portrait-shipyard.png'), animations: 'disabled' });
  const detail = page.locator('.detail > .d-body');
  await detail.scrollIntoViewIfNeeded();
  expect((await detail.boundingBox())!.height).toBeGreaterThan(60);
  await expect(detail).toContainText('Quiet oars');
  const action = page.getByRole('button', { name: /Sail this boat/i });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: test.info().outputPath('portrait-shipyard-detail.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Leave port/i }).tap();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.evaluate(() => { window.BR.G.regionsSeen.push('volcanic'); });
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'JOURNAL', exact: true }).tap();
  expect(await page.evaluate(() => { window.BR.tick(0); return window.BR.G.mode; })).toBe('journal');
  await expect(page.getByRole('button', { name: 'Close journal' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/touch/);
  await expect(page.locator('.detail')).toContainText('tap Cast');
  expect(await page.locator('.journal-list').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('portrait-harbour-journal.png'), animations: 'disabled' });
});
