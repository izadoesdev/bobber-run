import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

async function fishingStage(page: Page, stage: 'cast' | 'wait' | 'bite' | 'reel'): Promise<void> {
  await sail(page);
  await page.evaluate(want => {
    const { G, GAME, SET, schoolsNear, sim } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.stats.caught = 3; G.god = true;
    SET.strike = 'normal'; SET.reelAssist = SET.reelToggle = false;
    const school = schoolsNear(G.boat.x, G.boat.y, 200).find(s => GAME.schoolActive(s) && GAME.canLand(s.sp) && !s.boss);
    if (!school) throw new Error('No catchable school');
    const dx = school.x + 24 - G.boat.x, dy = school.y - G.boat.y;
    G.cam.x += dx; G.cam.y += dy;
    Object.assign(G.boat, { x: school.x + 24, y: school.y, px: school.x + 24, py: school.y, vx: 0, vy: 0, w: 0 });
    sim(1 / 30); sim(1 / 30);
    GAME.tryCast(school);
    for (let i = 0; i < 900 && G.fish && G.fish.st !== want; i++) {
      if (want === 'reel' && G.fish.st === 'bite') G.pressed.add(' ');
      sim(1 / 30);
    }
    if (G.fish?.st !== want) throw new Error(`Did not reach ${want}`);
    // Keep a bite available while the real input event travels through the browser.
    if (want === 'bite') G.fish.win = [0.3, 30];
  }, stage);
}

const pausedLine = (page: Page) => page.evaluate(() => {
  const { G } = window.BR, f = G.fish;
  return { clock: G.clock, line: f && { id: f.s.id, stock: f.s.stock, stage: f.st, time: f.t, wait: f.wait,
    progress: f.prog, tension: f.tension, grace: f.grace, jump: f.jump }, hold: G.hold.length };
});

for (const stage of ['cast', 'wait', 'bite', 'reel'] as const) {
  test(`the menu pauses ${stage} fishing without losing the line @both`, async ({ page }, info) => {
    await fishingStage(page, stage);
    if (info.project.name === 'phone') {
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await expect(menu).not.toHaveClass(/\boff\b/);
      await menu.tap();
    } else await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
    const before = await pausedLine(page);
    expect(before.line?.stage).toBe(stage);
    const bounds = await page.locator('.pause-box').evaluate(e => {
      const r = e.getBoundingClientRect();
      return { inside: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, overflow: e.scrollWidth > e.clientWidth };
    });
    expect(bounds).toEqual({ inside: true, overflow: false });
    if (stage === 'reel') await page.screenshot({ path: test.info().outputPath('fishing-pause.png'), animations: 'disabled' });
    await page.evaluate(() => { for (let i = 0; i < 300; i++) window.BR.sim(1 / 30); });
    expect(await pausedLine(page)).toEqual(before);
    const resume = page.getByRole('button', { name: 'RESUME', exact: true });
    if (info.project.name === 'phone') await resume.tap();
    else await resume.click();
    await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
    expect(await page.evaluate(() => window.BR.G.fish?.s.id)).toBe(before.line?.id);
    const landed = await page.evaluate(() => {
      const { G, sim } = window.BR;
      for (let i = 0; i < 2700 && G.fish; i++) {
        if (G.fish.st === 'bite') G.pressed.add(' ');
        G.keys[' '] = G.fish.st === 'reel' && G.fish.tension < 0.55;
        sim(1 / 30);
      }
      G.keys[' '] = false;
      return { caught: G.stats.caught, hold: G.hold.length, card: !!G.card };
    });
    expect(landed).toEqual({ caught: 4, hold: 1, card: true });
  });
}

test('controller Start pauses and resumes a fight rather than activating a menu row', async ({ page }) => {
  await fishingStage(page, 'reel');
  const result = await page.evaluate(() => {
    const { G, sim } = window.BR, buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ buttons, axes: [0, 0] }] });
    buttons[9].pressed = true; sim(1 / 30);
    const paused = G.mode, line = G.fish, time = line?.t;
    for (let i = 0; i < 30; i++) sim(1 / 30);
    const held = G.mode, unchanged = G.fish === line && G.fish?.t === time;
    buttons[9].pressed = false; sim(1 / 30);
    G.pauseSel = 1;
    buttons[9].pressed = true; sim(1 / 30);
    buttons[9].pressed = false; sim(1 / 30);
    return { paused, held, unchanged, resumed: G.mode, sameLine: G.fish === line };
  });
  expect(result).toEqual({ paused: 'pause', held: 'pause', unchanged: true, resumed: 'play', sameLine: true });
});

test('fishing assists can be changed during a paused fight without losing it @both', async ({ page }, info) => {
  await fishingStage(page, 'reel');
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
  const before = await pausedLine(page);
  const settings = page.getByRole('button', { name: 'SETTINGS', exact: true });
  if (info.project.name === 'phone') await settings.tap(); else await settings.click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const easy = page.locator('.setrow').filter({ has: page.getByText('Easy reel', { exact: true }) });
  await easy.scrollIntoViewIfNeeded();
  if (info.project.name === 'phone') await easy.tap(); else await easy.click();
  await expect.poll(() => page.evaluate(() => window.BR.SET.reelAssist)).toBe(true);
  expect(await pausedLine(page)).toEqual(before);
  if (info.project.name === 'phone') await page.locator('.scroll .item').filter({ hasText: /^Back$/ }).tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
  const resume = page.getByRole('button', { name: 'RESUME', exact: true });
  if (info.project.name === 'phone') await resume.tap(); else await resume.click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  const landed = await page.evaluate(() => {
    const { G, sim } = window.BR;
    for (let i = 0; i < 2700 && G.fish; i++) sim(1 / 30);
    return { caught: G.stats.caught, hold: G.hold.length, stars: G.card?.stars };
  });
  expect(landed.caught).toBe(4); expect(landed.hold).toBe(1);
  expect(landed.stars).toBeLessThanOrEqual(2);
});

test('a fishing pause explains quitting and keeps the line when saving fails @both', async ({ page }, info) => {
  await fishingStage(page, 'reel');
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  else await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('pause');
  await expect(page.locator('.menu-box')).toContainText('Resume to finish this catch');
  const before = await pausedLine(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bobber-run-save-v3') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  const quit = page.getByRole('button', { name: 'SAVE & QUIT', exact: true });
  if (info.project.name === 'phone') await quit.tap(); else await quit.click();
  await expect(page.locator('.save-warning')).toBeVisible();
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('pause');
  expect(await pausedLine(page)).toEqual(before);
  await quit.scrollIntoViewIfNeeded();
  expect(await quit.evaluate(e => {
    const r = e.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === e;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath('fishing-save-failure.png'), animations: 'disabled' });
  await page.evaluate(() => (window as any).__restoreStorage());
  if (info.project.name === 'phone') await quit.tap(); else await quit.click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('title');
  expect(await page.evaluate(() => window.BR.G.fish)).toBeNull();
  const next = page.getByRole('button', { name: 'CONTINUE', exact: true });
  if (info.project.name === 'phone') await next.tap(); else await next.click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  expect(await page.evaluate(() => ({ caught: window.BR.G.stats.caught, hold: window.BR.G.hold.length, line: window.BR.G.fish })))
    .toEqual({ caught: 3, hold: 0, line: null });
});

async function blockedSpecies(page: Page, id: string): Promise<void> {
  await sail(page);
  await page.evaluate(id => {
    const { G, GAME, SPECIES, schoolsNear } = window.BR;
    GAME.newGame(); G.mode = 'journal';
    G.story = { i: 9, base: { ...G.stats }, shown: true };
    G.up.rod = 4; G.coins = 6000; G.projects = ['pier'];
    G.unlocked = ['reef', 'kelp', 'volcanic', 'mangrove', 'cold', 'warm', 'open'];
    const schools = schoolsNear(G.boat.x, G.boat.y, 900), target = schools.find(s => !s.boss);
    if (!target) throw new Error('No nearby school');
    for (const s of schools) G.log[SPECIES[s.sp].id] = { n: 1, best: 1, trophy: false };
    target.sp = SPECIES.findIndex(s => s.id === id);
    target.stock = target.max = 4; target.submergence = 0;
    target.scatterT = target.spooked = undefined;
    delete G.log[id];
  }, id);
}

test('the species guide explains the larger boat instead of sending the player searching @both', async ({ page }) => {
  await blockedSpecies(page, 'manta');
  const step = await page.evaluate(() => window.BR.guide());
  expect(step.text).toMatch(/Buy the Trawler.*shipyard/);
  expect(step.at).toBeTruthy();
});

test('the species guide uses an owned boat and updates without advancing time', async ({ page }) => {
  await blockedSpecies(page, 'manta');
  const steps = await page.evaluate(() => {
    const { G, guide } = window.BR;
    const buy = guide();
    G.owned.push('trawler'); G.coins = 0;
    const board = guide();
    G.fleet.trawler = { port: 'port:0,0', portName: 'Alderhaven', earned: 0 };
    const recall = guide();
    return { buy, board, recall };
  });
  expect(steps.buy.text).toMatch(/Buy the Trawler/);
  expect(steps.board.text).toMatch(/Sail the Trawler.*shipyard/);
  expect(steps.recall.text).toMatch(/Recall and sail the Trawler/);
});

test('the species guide respects the harbour project before suggesting a locked boat', async ({ page }) => {
  await blockedSpecies(page, 'manta');
  const step = await page.evaluate(() => {
    const { G, guide } = window.BR; G.projects = []; return guide();
  });
  expect(step.text).toMatch(/fish for the pier/);
  expect(step.text).not.toContain('Buy the Trawler');
});

test('the species guide recommends sails for engine-shy fish, not a larger engine', async ({ page }) => {
  await blockedSpecies(page, 'tuna');
  const step = await page.evaluate(() => {
    const { G, guide } = window.BR;
    G.boatId = 'trawler'; G.owned.push('trawler'); G.boat.hp = 360;
    G.projects.push('drydock'); G.coins = 20000;
    return guide();
  });
  expect(step.text).toMatch(/Buy the Schooner.*shipyard/);
});

test('the species guide explains Storm Keel requirements and prefers fitted boats already owned', async ({ page }) => {
  await blockedSpecies(page, 'stormeel');
  const steps = await page.evaluate(() => {
    const { G, WX, guide } = window.BR;
    WX.state = 'storm'; G.projects.push('drydock');
    const upgrade = guide();
    G.owned.push('drifter');
    const builtIn = guide();
    G.owned.push('launch'); G.owned.splice(G.owned.indexOf('drifter'), 1);
    G.boatUp.launch = { keel: 1 }; G.t += 0.3;
    const fitted = guide();
    return { upgrade, builtIn, fitted };
  });
  expect(steps.upgrade.text).toMatch(/Buy a better Storm Keel/);
  expect(steps.builtIn.text).toMatch(/Sail the Steam Drifter/);
  expect(steps.fitted.text).toMatch(/Sail the Motor Launch/);
});

test('the species guide changes from rod shopping to catching as soon as gear changes', async ({ page }) => {
  await blockedSpecies(page, 'cod');
  const steps = await page.evaluate(() => {
    const { G, guide } = window.BR;
    G.up.rod = 0;
    const upgrade = guide();
    G.up.rod = 1;
    return { upgrade, ready: guide() };
  });
  expect(steps.upgrade.text).toMatch(/Buy a level 2 rod/);
  expect(steps.ready.text).toBe('Catch a new species for your logbook');
});

test('the Old One guide sends a full hold to market before the lair @both', async ({ page }) => {
  await sail(page);
  const step = await page.evaluate(() => {
    const { G, GAME, guide } = window.BR;
    G.mode = 'journal'; G.story = { i: 14, base: { ...G.stats }, shown: true };
    G.up.rod = 4;
    G.hold = Array.from({ length: GAME.cap() }, () => ({ sp: 0, kg: 0.04, value: 3, trophy: false }));
    return guide();
  });
  expect(step.text).toMatch(/^Sell your \d+ fish at /);
});
