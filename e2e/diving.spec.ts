import { test, expect, sail, dockHome } from './fixtures';

// The depth is simulation state, so these checks advance game time rather than waiting on wall-clock frames.
test('schools descend gradually, retain their fish, and rise before becoming catchable again @both', async ({ page }) => {
  await sail(page);
  const result = await page.evaluate(() => {
    const { G, GAME, SPECIES, schoolsNear, sim } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true };
    G.god = true; G.nextFrenzy = 1e6;
    const school = schoolsNear(280, 280, 1200).find((s: any) => s.stock > 0 && !s.boss && !s.spooked && SPECIES[s.sp].time === 'any' && SPECIES[s.sp].weather === 'any');
    if (!school) throw new Error('No ordinary surfaced school');
    G.cam.x += school.x - G.boat.x; G.cam.y += school.y - G.boat.y;
    Object.assign(G.boat, { x: school.x, y: school.y, px: school.x, py: school.y, vx: 0, vy: 0, w: 0 });
    G.keys = {}; G.pressed.clear();
    sim(1 / 30);
    school.submergence = 0;
    const stock = school.stock, species = school.sp, generation = school.generation;
    const sample = () => ({ depth: school.submergence, stock: school.stock, species: school.sp,
      generation: school.generation, swimming: school.swim.length, target: GAME.castTargets().includes(school) });
    const advance = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 30); i++) sim(1 / 30); return sample(); };
    school.spooked = 1e12;
    const one = advance(1), four = advance(3), eight = advance(4.1);
    school.spooked = undefined;
    const earlyRise = advance(1), surfaced = advance(5.1);
    return { stock, species, generation, one, four, eight, earlyRise, surfaced };
  });
  expect(result.one.depth).toBeCloseTo(0.125, 5);
  expect(result.four.depth).toBeCloseTo(0.5, 5);
  expect(result.eight.depth).toBe(1);
  expect(result.earlyRise.depth).toBeGreaterThan(0.8);
  expect(result.earlyRise.target).toBe(false);
  expect(result.surfaced.depth).toBe(0);
  expect(result.surfaced.target).toBe(true);
  for (const sample of [result.one, result.four, result.eight, result.earlyRise, result.surfaced]) {
    expect(sample).toMatchObject({ stock: result.stock, species: result.species, generation: result.generation });
    expect(sample.swimming).toBeGreaterThan(0);
  }
});

test('removed boats are absent from the shipyard and old saves retain the rest of the voyage @both', async ({ page }) => {
  await sail(page);
  const loaded = await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.coins = 12345;
    GAME.saveGame();
    const key = 'bobber-run-save-v3', saved = JSON.parse(localStorage.getItem(key)!);
    saved.boatId = 'context';
    saved.owned = ['row', 'skiff', 'databuddy', 'context'];
    saved.fleet = { context: { port: 'port:0,0', portName: 'Alderhaven', earned: 10 } };
    localStorage.setItem(key, JSON.stringify(saved));
    GAME.loadGame();
    // Snapshot the migration before the injected Skiff can earn its normal purchase milestone on the next frame.
    return { boat: G.boatId, owned: G.owned, fleet: G.fleet, coins: G.coins };
  });
  expect(loaded).toEqual({ boat: 'row', owned: ['row', 'skiff'], fleet: {}, coins: 12345 });
  await dockHome(page);
  await page.evaluate(() => {
    const { G, GAME } = window.BR;
    GAME.setTab(GAME.portTabs(G.menu.port).indexOf('SHIPYARD'));
  });
  await expect(page.locator('.list.well')).toContainText('Motor Launch');
  await expect(page.locator('.list.well')).not.toContainText('databuddy.cc');
  await expect(page.locator('.list.well')).not.toContainText('context.dev');
  await expect(page.locator('.boat-portrait[data-boat="context"], .boat-portrait[data-boat="databuddy"]')).toHaveCount(0);
});
