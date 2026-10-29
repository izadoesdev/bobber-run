import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

async function openJournal(page: Page, from: 'play' | 'pause' = 'play'): Promise<void> {
  await page.evaluate(from => {
    const { G, GAME } = window.BR;
    G.story = { i: 1, base: { ...G.stats }, shown: true };
    G.hold = [{ sp: 0, kg: 1, value: 10, trophy: false }];
    G.journalBack = from;
    G.mode = 'journal';
    G.waypoint = { x: G.boat.x + 350, y: G.boat.y + 100 };
    GAME.saveGame();
  }, from);
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
}

async function activate(page: Page, selector: string): Promise<void> {
  const action = page.locator(selector);
  if (test.info().project.name === 'phone') await action.tap();
  else await action.click();
}

test('a returning captain can inspect the saved voyage without loading or changing it @both', async ({ page }) => {
  await sail(page);
  const saved = await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.boatId = 'launch'; G.owned = ['row', 'launch'];
    G.clock = 480 * 7 + 60;
    G.stats.caught = 18;
    G.log = { mackerel: { n: 10, best: 1 }, perch: { n: 8, best: 1 } };
    G.packs['ember-isles'] = { i: 0, n: 2, started: true, status: 'paused' };
    GAME.saveGame();
    G.mode = 'title';
    return localStorage.getItem('bobber-run-save-v3');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'CONTINUE', exact: true })).toBeVisible();
  await expect(page.locator('.tagline')).toContainText('Day 8');
  await expect(page.locator('.tagline')).toContainText('Motor Launch');
  await expect(page.locator('.tagline')).toContainText('2 species logged');
  expect(await page.evaluate(() => localStorage.getItem('bobber-run-save-v3'))).toBe(saved);
  await page.getByRole('button', { name: 'CONTINUE', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => ({ boat: window.BR.G.boatId, story: window.BR.G.packs['ember-isles'] })))
    .toEqual({ boat: 'launch', story: { i: 0, n: 2, started: true, status: 'paused' } });
});

test('a new voyage clears the old chart view and fish filter @both', async ({ page }) => {
  await sail(page);
  const map = await page.evaluate(() => {
    const { G, GAME } = window.BR;
    Object.assign(G.map, { x: 1000, y: -900, zoom: 2, zoneSp: 3, back: 'journal' });
    GAME.newGame();
    return G.map;
  });
  expect(map).toMatchObject({ x: 0, y: 0, zoom: 1 });
  expect(map.zoneSp ?? null).toBeNull();
  expect(map.back ?? 'play').toBe('play');
});

test('closing a fish chart returns to the same logbook entry, while an ordinary chart returns to sailing @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, SPECIES } = window.BR;
    G.log.mackerel = { n: 1, best: 1, at: [[G.boat.x + 50, G.boat.y + 70]] };
    G.logSel = SPECIES.findIndex(s => s.id === 'mackerel'); G.mode = 'log';
  });
  await activate(page, '[data-track=fish-show-on-chart]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('log');
  expect(await page.evaluate(() => window.BR.SPECIES[window.BR.G.logSel].id)).toBe('mackerel');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
});

test('a fresh voyage does not reuse cached catch locations with the same species and spot count @both', async ({ page }) => {
  await sail(page);
  const origin = await page.evaluate(() => {
    const { G, SPECIES } = window.BR;
    G.logSel = SPECIES.findIndex(s => s.id === 'mackerel');
    G.log.mackerel = { n: 1, best: 1, at: [[G.boat.x + 50, G.boat.y + 70]] };
    G.mode = 'log';
    return { x: G.boat.x, y: G.boat.y };
  });
  await activate(page, '[data-track=fish-show-on-chart]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  const target = await page.evaluate(origin => {
    const { G, GAME, SPECIES } = window.BR;
    GAME.newGame();
    Object.assign(G.boat, { x: origin.x, y: origin.y, vx: 0, vy: 0 });
    const target = { x: origin.x - 180, y: origin.y - 80 };
    G.log.mackerel = { n: 1, best: 1, at: [[target.x, target.y]] };
    G.logSel = SPECIES.findIndex(s => s.id === 'mackerel'); G.mode = 'log';
    return target;
  }, origin);
  await activate(page, '[data-track=fish-show-on-chart]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  expect(await page.evaluate(() => { const { G } = window.BR; return { x: G.boat.x + G.map.x, y: G.boat.y + G.map.y }; })).toEqual(target);
});

test('the journal charts the current next step without spending, replacing a waypoint or resuming a paused voyage @both', async ({ page }) => {
  await sail(page);
  await openJournal(page, 'pause');
  const before = await page.evaluate(() => {
    const { G, guide } = window.BR;
    return { target: guide().at, waypoint: G.waypoint, clock: G.clock, coins: G.coins, save: localStorage.getItem('bobber-run-save-v3') };
  });
  expect(before.target).toBeTruthy();
  await activate(page, '[data-track=journal-show-on-chart]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  const viewing = await page.evaluate(() => {
    const { G } = window.BR;
    return { x: G.boat.x + G.map.x, y: G.boat.y + G.map.y, zone: G.map.zoneSp ?? null,
      waypoint: G.waypoint, clock: G.clock, coins: G.coins, save: localStorage.getItem('bobber-run-save-v3') };
  });
  expect(viewing).toEqual({ ...before.target, zone: null, waypoint: before.waypoint, clock: before.clock, coins: before.coins, save: before.save });
  await activate(page, '[data-track=chart-close]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('journal');
  await activate(page, '[data-track=journal-close]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
  expect(await page.evaluate(() => window.BR.G.clock)).toBe(before.clock);
});

test('a next step without a location does not offer an invented chart destination @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, schoolsNear } = window.BR;
    G.story = { i: 0, base: { ...G.stats }, shown: true };
    for (const school of schoolsNear(G.boat.x, G.boat.y, 700)) school.stock = 0;
    G.t += 1;
    G.journalBack = 'play'; G.mode = 'journal';
  });
  await expect(page.locator('.journal-next')).toContainText('Look for ripples');
  await expect(page.locator('[data-track=journal-show-on-chart]')).toHaveCount(0);
});

test('the title refreshes a changed save and handles unreadable metadata without writing over it @both', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G, GAME } = window.BR; GAME.saveGame(); G.mode = 'title'; });
  await expect(page.locator('.tagline')).toContainText('Day 1');
  const changed = await page.evaluate(() => {
    const key = 'bobber-run-save-v3', saved = JSON.parse(localStorage.getItem(key)!);
    saved.clock = 480 * 4; saved.boatId = 'skiff';
    const raw = JSON.stringify(saved); localStorage.setItem(key, raw); return raw;
  });
  await expect(page.locator('.tagline')).toContainText('Day 5');
  await expect(page.locator('.tagline')).toContainText('Skiff');
  expect(await page.evaluate(() => localStorage.getItem('bobber-run-save-v3'))).toBe(changed);
  await page.evaluate(() => localStorage.setItem('bobber-run-save-v3', '{unreadable'));
  await expect(page.locator('.tagline')).toHaveText('Fish, sell, upgrade, and sail further');
  expect(await page.evaluate(() => localStorage.getItem('bobber-run-save-v3'))).toBe('{unreadable');
});

test('deliberately viewing a journal location clears a fish filter but respects hidden objective markers @both', async ({ page }) => {
  await sail(page);
  await openJournal(page);
  await page.evaluate(() => { window.BR.SET.guide = false; window.BR.G.map.zoneSp = 3; });
  await activate(page, '[data-track=journal-show-on-chart]');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
  expect(await page.evaluate(() => ({ guide: window.BR.SET.guide, zone: window.BR.G.map.zoneSp }))).toEqual({ guide: false, zone: null });
  await expect(page.locator('.chart-chips .zone-on')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('journal');
});

test('the chart Back button supports native Tab and Enter without sailing shortcuts', async ({ page }) => {
  await sail(page);
  await openJournal(page, 'pause');
  await activate(page, '[data-track=journal-show-on-chart]');
  await expect(page.getByRole('button', { name: /Back to journal/ })).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    if (await page.locator('[data-track=chart-close]').evaluate(e => e === document.activeElement)) break;
  }
  await expect(page.locator('[data-track=chart-close]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.BR.G.journalBack)).toBe('pause');
});

test('simulated controller A inspects a journal destination and B retraces the paused context', async ({ page }) => {
  await sail(page);
  await openJournal(page, 'pause');
  const focused = await page.evaluate(() => {
    const { G, sim } = window.BR;
    for (let i = 0; i < 16; i++) {
      G.pad = true; G.pressed.add('ArrowDown'); sim(1 / 30);
      if ((document.activeElement as HTMLElement)?.dataset.track === 'journal-show-on-chart') return true;
    }
    return false;
  });
  expect(focused).toBe(true);
  await page.evaluate(() => { const { G, sim } = window.BR; G.pad = true; G.pressed.add(' '); sim(1 / 30); });
  await expect(page.getByRole('button', { name: /Back to journal/ })).toBeVisible();
  await page.evaluate(() => { const { G, sim } = window.BR; G.pad = true; G.pressed.add('Escape'); sim(1 / 30); });
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
  await page.evaluate(() => { const { G, sim } = window.BR; G.pad = true; G.pressed.add('Escape'); sim(1 / 30); });
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
});

for (const layout of ['landscape', 'portrait'] as const) {
  test(`the returning title and journal action fit at 150% UI scale on ${layout} @both`, async ({ page }) => {
    await sail(page);
    if (layout === 'portrait') await page.setViewportSize({ width: 393, height: 851 });
    await page.evaluate(() => {
      const { G, GAME, SET, apply } = window.BR;
      SET.ui = 1.5; apply();
      G.boatId = 'launch'; G.owned = ['row', 'launch']; GAME.saveGame(); G.mode = 'title';
    });
    const title = page.locator('.title-screen');
    const continueButton = page.getByRole('button', { name: 'CONTINUE', exact: true });
    await continueButton.scrollIntoViewIfNeeded();
    expect(await continueButton.evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await expect(title).toHaveCount(1);
    expect(await title.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    const summary = page.locator('.tagline');
    await summary.scrollIntoViewIfNeeded();
    expect(await summary.evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth;
    })).toBe(true);
    await activate(page, '[data-track=menu-CONTINUE]');
    await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
    await openJournal(page);
    const action = page.locator('[data-track=journal-show-on-chart]');
    await expect(action).toBeVisible();
    if (layout === 'landscape') {
      expect(await page.locator('.journal-next').evaluate(e => {
        const r = e.getBoundingClientRect(), parent = e.closest('.detail')!.getBoundingClientRect();
        return r.height >= parseFloat(getComputedStyle(e).fontSize) * 3 && r.top >= parent.top && r.bottom <= parent.bottom;
      })).toBe(true);
    }
    await action.scrollIntoViewIfNeeded();
    expect(await action.evaluate(e => {
      const r = e.getBoundingClientRect();
      return r.height >= 44 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    const step = page.locator('.journal-next p');
    await step.scrollIntoViewIfNeeded();
    expect(await step.evaluate(e => {
      const r = e.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(e);
      return r.height >= parseFloat(getComputedStyle(e).fontSize) && [...range.getClientRects()].every(t => t.left >= 0 && t.right <= innerWidth && t.top >= 0 && t.bottom <= innerHeight);
    })).toBe(true);
    await activate(page, '[data-track=journal-show-on-chart]');
    await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
    await activate(page, '[data-track=chart-close]');
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
    await expect.poll(() => page.locator('.screen').evaluate(e => getComputedStyle(e).opacity)).toBe('1');
    await page.locator('.journal-next').scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`returning-${layout}-journal.png`), animations: 'disabled' });
  });
}
