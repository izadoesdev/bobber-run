import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

async function quietSea(page: Page): Promise<void> {
  await sail(page);
  await page.evaluate(() => {
    const { G, LIFE, GAME } = window.BR;
    GAME.newGame();
    G.mode = 'play';
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.unlocked = ['reef', 'kelp', 'volcanic', 'mangrove', 'cold', 'warm', 'open'];
    G.boatId = 'flagship'; G.owned.push('flagship'); G.up.rod = 4; G.god = true;
    LIFE.whales = []; LIFE.giants = []; LIFE.pods = []; LIFE.swarms.clear();
    LIFE.nextWhale = LIFE.nextGiant = LIFE.nextPod = 1e6;
    Object.assign(G.boat, { x: 700, y: 700, px: 700, py: 700, vx: 0, vy: 0, w: 0 });
  });
}

async function jellyBesideBoat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { G, LIFE, sim } = window.BR, { x, y } = G.boat;
    const jelly = { x: x + 20, y, z: -3, ph: 0, col: [0.3, 0.95, 0.85], glow: 0, size: 1,
      hx: x + 20, hy: y, A: 0, w1: 0, w2: 0, s1: 0, rate: 1.5, bright: 1, day: true, px: 0, py: 0 };
    LIFE.swarms.set('test-jelly', { cx: x, cy: y, m: [jelly] });
    sim(1 / 30); sim(1 / 30);
  });
}

async function besideLighthouse(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { G, poisNear, hAt, sim } = window.BR;
    const light = poisNear(280, 280, 2400).find((p: any) => p.type === 'light');
    if (!light) throw new Error('No lighthouse');
    for (let d = 24; d <= 70; d += 6) for (let k = 0; k < 24; k++) {
      const x = light.x + Math.cos(k * Math.PI / 12) * d, y = light.y + Math.sin(k * Math.PI / 12) * d;
      if (hAt(x, y) > -0.12) continue;
      Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, w: 0 });
      sim(1 / 30);
      return light.name;
    }
    throw new Error('No reachable water at lighthouse');
  });
}

test('visible jellyfish can be cast for, reeled in and landed once @both', async ({ page }, info) => {
  await quietSea(page); await jellyBesideBoat(page);
  await expect.poll(() => page.evaluate(() => {
    const { G, SPECIES } = window.BR;
    return G.nearSchool && SPECIES[G.nearSchool.sp].id;
  })).toBe('jellyfish');
  await expect(page.locator('.creature-target')).toHaveCount(0);
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Cast', exact: true }).tap();
  else await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => !!window.BR.G.fish)).toBe(true);
  const landed = await page.evaluate(() => {
    const { G, sim, SEA, SPECIES } = window.BR, id = G.fish.s.id;
    let frames = 0;
    while (G.fish && frames++ < 1800) {
      G.keys[' '] = G.fish.st === 'reel' && G.fish.tension < 0.55;
      sim(1 / 30);
    }
    G.keys[' '] = false;
    return { caught: G.stats.caught, species: SPECIES[G.hold.at(-1)?.sp]?.id, stillHere: SEA.wildlifeStocks().some((s: any) => s.id === id), log: !!G.log.jellyfish, saved: JSON.parse(localStorage.getItem('bobber-run-save-v3')!).stats.caught };
  });
  expect(landed).toEqual({ caught: 1, species: 'jellyfish', stillHere: false, log: true, saved: 1 });
  await expect(page.locator('.card')).toContainText('Moon Jellyfish');
});

test('lighthouse supplies are useful, saved and cannot be collected twice @both', async ({ page }, info) => {
  await quietSea(page);
  const name = await besideLighthouse(page);
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Visit', exact: true }).tap();
  else await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await expect.poll(() => page.locator('.encounter-head img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const supplies = page.getByRole('button', { name: 'Keeper’s supplies', exact: true });
  await expect(supplies).toBeEnabled();
  const before = await page.evaluate(() => window.BR.G.bait.glow);
  if (info.project.name === 'phone') await supplies.tap();
  else await supplies.click();
  await expect(supplies).toBeDisabled();
  const state = await page.evaluate(() => {
    const { G, SEA } = window.BR;
    SEA.performEncounterAction(G.encounter.id, 'supplies');
    SEA.performEncounterAction(G.encounter.id, 'supplies');
    return { glow: G.bait.glow, visits: { ...G.visits }, saved: JSON.parse(localStorage.getItem('bobber-run-save-v3')!).visits };
  });
  expect(state.glow).toBe(before + 2);
  expect(state.saved).toEqual(state.visits);
  expect(Object.keys(state.visits)).toHaveLength(1);
  if (info.project.name === 'desktop') {
    await page.getByRole('button', { name: /Back to sea/ }).focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    expect(await page.evaluate(() => window.BR.G.mode)).toBe('encounter');
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.BR?.G.mode)).toBe('title');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
    await page.keyboard.press('e');
    await expect(supplies).toBeDisabled();
    expect(await page.evaluate(() => window.BR.G.bait.glow)).toBe(before + 2);
  }
});

test('Tab opens the hold while Q and touch cycle creatures independently @both', async ({ page }, info) => {
  await quietSea(page); await jellyBesideBoat(page);
  const initial = await page.evaluate(() => {
    const { G, LIFE, sim } = window.BR, first = LIFE.swarms.get('test-jelly').m[0];
    LIFE.swarms.get('test-jelly').m.push({ ...first, fishing: undefined, x: G.boat.x - 20, hx: G.boat.x - 20 });
    G.aim = first.fishing.id;
    sim(1 / 30); sim(1 / 30);
    return G.nearSchool.id;
  });
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Next fish', exact: true }).tap();
  else await page.keyboard.press('q');
  await expect.poll(() => page.evaluate(() => window.BR.G.nearSchool?.id)).not.toBe(initial);
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('ship');
});

test('every rendered wildlife kind has a one-stock catch and disappears when landed', async ({ page }) => {
  await quietSea(page); await jellyBesideBoat(page);
  const results = await page.evaluate(() => {
    const { G, GAME, LIFE, SEA, SPECIES, sim } = window.BR;
    SEA.summonSeaLife('whale'); SEA.summonSeaLife('dolphins');
    for (const kind of ['shadow', 'ray', 'squid', 'eel']) LIFE.giants.push({ x: G.boat.x + 24, y: G.boat.y, a: 0, a0: 0, z: -4, len: 24, kind, glow: 1, ph: 0, t: 7, dur: 500, v: 0, zt: -4, seed: 1 });
    sim(1 / 30);
    const chosen = new Map<string, any>();
    for (const stock of GAME.castTargets().filter((s: any) => s.wildlife)) chosen.set(SPECIES[stock.sp].id, stock);
    const out = [];
    for (const [species, stock] of chosen) {
      G.card = null; G.catchAnim = null; G.fish = null; G.mode = 'play';
      Object.assign(G.boat, { x: stock.x - 20, y: stock.y, px: stock.x - 20, py: stock.y, vx: 0, vy: 0, w: 0 });
      G.up.rod = 4;
      if (species === 'humpback') {
        G.up.rod = 0; GAME.tryCast(stock);
        if (G.fish) throw new Error('A starter rod hooked a whale');
        G.up.rod = 4; G.boatId = 'row'; GAME.tryCast(stock);
        if (G.fish) throw new Error('A rowboat hooked a whale');
        G.boatId = 'flagship';
      }
      GAME.tryCast(stock);
      if (!G.fish) throw new Error(`Could not cast for ${species}`);
      const sameActor = G.fish.s === stock;
      let frames = 0;
      while (G.fish && G.fish.st !== 'reel' && frames++ < 1000) {
        if (G.fish.st === 'bite') G.pressed.add(' ');
        sim(1 / 30);
      }
      if (!G.fish) throw new Error(`${species} disappeared on the line`);
      G.fish.prog = 1.1; G.fish.tension = 0.3;
      for (let k = 0; k < 20 && G.fish; k++) sim(1 / 30);
      out.push({ species, sameActor, removed: !SEA.wildlifeStocks().includes(stock), recorded: !!G.log[species], caught: G.hold.at(-1)?.sp === stock.sp });
      G.card = null; GAME.tryCast(stock);
      if (G.fish) throw new Error('A completed catch was hooked again');
    }
    return out;
  });
  expect(results.map(r => r.species).sort()).toEqual(['dolphin', 'gsquid', 'humpback', 'jellyfish', 'manta', 'ribboneel', 'sleepershark']);
  for (const result of results) expect(result).toEqual({ species: result.species, sameActor: true, removed: true, recorded: true, caught: true });
});

test('remote and stale controls cannot claim a sea prop; gathered props disappear', async ({ page }) => {
  await quietSea(page);
  const result = await page.evaluate(() => {
    const { G, SEA } = window.BR;
    const prop = SEA.seaPropsNear(300, 2300, 900, [], true).find((p: any) => ['log', 'weedMat', 'lilyPad'].includes(p.kind));
    if (!prop) throw new Error('No gatherable sea prop found');
    Object.assign(G.boat, { x: prop.x, y: prop.y, vx: 0, vy: 0 });
    const encounter = SEA.encountersNear().find((e: any) => e.kind === 'prop' && e.prop === prop.kind && e.x === prop.x && e.y === prop.y);
    if (!encounter) throw new Error('Visible prop is not interactable');
    SEA.openEncounter(encounter);
    G.boat.x += 1000;
    SEA.performEncounterAction(encounter.id, 'survey');
    const remoteClaimed = G.visits[encounter.id] !== undefined;
    G.boat.x -= 1000;
    SEA.performEncounterAction(encounter.id, 'survey');
    const removed = SEA.seaPropGathered(prop), visits = { ...G.visits }, shrimp = G.bait.shrimp, coins = G.coins;
    G.mode = 'play'; G.encounter = null;
    SEA.performEncounterAction(encounter.id, 'survey');
    SEA.openEncounter(encounter);
    SEA.performEncounterAction(encounter.id, 'survey');
    return { remoteClaimed, removed, visits, saved: JSON.parse(localStorage.getItem('bobber-run-save-v3')!).visits, unchanged: shrimp === G.bait.shrimp && coins === G.coins, absent: !SEA.encountersNear().some((e: any) => e.id === encounter.id) };
  });
  expect(result).toMatchObject({ remoteClaimed: false, removed: true, unchanged: true, absent: true });
  expect(result.saved).toEqual(result.visits);
});

test('all six ruins offer one-time surveys and local stories without accepting them', async ({ page }) => {
  await quietSea(page);
  const results = await page.evaluate(() => {
    const { G, SEA } = window.BR, out = [];
    for (const site of SEA.regionSites().filter((s: any) => s.kind === 'legend')) {
      Object.assign(G.boat, { ...SEA.nearestWater(site.x, site.y, -0.12), vx: 0, vy: 0 });
      const encounter = SEA.encountersNear().find((e: any) => e.id === site.id);
      if (!encounter) throw new Error(`No encounter at ${site.legend}`);
      G.mode = 'play'; SEA.openEncounter(encounter);
      const before = G.coins;
      SEA.performEncounterAction(encounter.id, 'survey'); SEA.performEncounterAction(encounter.id, 'survey');
      const survey = G.coins - before;
      SEA.performEncounterAction(encounter.id, 'stories');
      out.push({ survey, mode: G.mode, back: G.journalBack, accepted: Object.values(G.packs).some((p: any) => p.status === 'active') });
    }
    return out;
  });
  expect(results.length).toBe(6);
  for (const r of results) expect(r).toEqual({ survey: 70, mode: 'journal', back: 'encounter', accepted: false });
});

test('lighthouse directions, waiting, next-day supplies and journal return work', async ({ page }) => {
  await quietSea(page); await besideLighthouse(page); await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Mark nearby fishing grounds', exact: true }).click();
  expect(await page.evaluate(() => !!window.BR.G.waypoint)).toBe(true);
  const day = await page.evaluate(() => window.BR.GAME.dayNum());
  await page.getByRole('button', { name: 'Keeper’s supplies', exact: true }).click();
  await page.getByRole('button', { name: 'Wait until nightfall', exact: true }).click();
  expect(await page.evaluate(() => window.BR.GAME.isNight())).toBe(true);
  await page.getByRole('button', { name: 'Wait until morning', exact: true }).click();
  expect(await page.evaluate(() => window.BR.GAME.dayNum())).toBe(day + 1);
  await expect(page.getByRole('button', { name: 'Keeper’s supplies', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
  const village = await page.evaluate(() => {
    const { G, SEA } = window.BR, site = SEA.regionSites().find((s: any) => s.kind === 'village');
    Object.assign(G.boat, { ...SEA.nearestWater(site.x, site.y, -0.12), vx: 0, vy: 0 });
    const encounter = SEA.encountersNear().find((e: any) => e.id === site.id);
    SEA.openEncounter(encounter);
    return encounter.name;
  });
  await page.getByRole('button', { name: 'Read local stories', exact: true }).click();
  await page.getByRole('button', { name: 'Close journal' }).click();
  await expect(page.getByRole('dialog', { name: village })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('play');
});

test('gamepad R3 cycles creatures without opening the ship screen', async ({ page }) => {
  await quietSea(page); await jellyBesideBoat(page);
  const result = await page.evaluate(() => {
    const { G, LIFE, sim } = window.BR, first = LIFE.swarms.get('test-jelly').m[0];
    LIFE.swarms.get('test-jelly').m.push({ ...first, fishing: undefined, x: G.boat.x - 20, hx: G.boat.x - 20 });
    G.aim = first.fishing.id;
    sim(1 / 30); sim(1 / 30);
    const before = G.nearSchool.id;
    const buttons = Array.from({ length: 17 }, (_, index) => ({ pressed: index === 11 }));
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ buttons, axes: [0, 0] }] });
    sim(1 / 30);
    const after = G.nearSchool.id;
    buttons[11].pressed = false; sim(1 / 30);
    return { before, after, mode: G.mode, pad: G.pad };
  });
  expect(result.after).not.toBe(result.before);
  expect(result.mode).toBe('play'); expect(result.pad).toBe(true);
});
