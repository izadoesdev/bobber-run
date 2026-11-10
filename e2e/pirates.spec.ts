// Pirates in the real game: a fight at sea with your cannons, the loot hauled in, the cove on the chart; the touch
// Fire button; a hail answered by heaving to and paying tribute; the fight's HUD (edge pips, name and class, your
// guns, the lookout's calls); the gun deck and its notes; and a buried chest dug up with the use key. Each starts by a pirate cove well away from any harbour.
import { test, expect, sail, dockHome } from './fixtures';
import type { Page } from '@playwright/test';

/** Sail out to a pirate cove clear of harbours, every region open, its neighbours' fleets kept in port. */
async function atCove(page: Page): Promise<void> {
  await sail(page);
  const ok = await page.evaluate(() => {
    const { G, poisNear, hAt } = window.BR;
    G.story = { i: 99, base: { ...G.stats }, shown: true }; G.talk = null;
    for (let r = 2400; r < 9000; r += 500) for (let k = 0, n = Math.ceil(r / 350); k < n; k++) {
      const a = k / n * Math.PI * 2;
      for (const c of poisNear(280 + Math.cos(a) * r, 280 + Math.sin(a) * r, 500)) {
        if (c.type !== 'cove' || poisNear(c.x, c.y, 800).some((q: { type: string; x: number; y: number }) => q.type === 'port' && Math.hypot(q.x - c.x, q.y - c.y) < 800)) continue;
        const d = [300, 250, 200].find(d => hAt(c.anchor.x + Math.cos(c.ang) * d, c.anchor.y + Math.sin(c.ang) * d) < -0.15);
        if (!d) continue;
        const x = c.anchor.x + Math.cos(c.ang) * d, y = c.anchor.y + Math.sin(c.ang) * d;
        for (const o of poisNear(c.x, c.y, 3000)) if (o.type === 'cove') G.raids[o.id] = Math.floor(G.clock / 480) + 1;
        G.found.add(c.id);
        Object.assign(G.boat, { x, y, px: x, py: y, vx: 0, vy: 0, a: c.ang });
        G.cam.x = x - 160; G.cam.y = y - 100;
        return true;
      }
    }
    return false;
  });
  expect(ok).toBe(true);
}

test('your cannons sink a pirate ship, its loot is hauled in, and the chart marks the cove @both', async ({ page }) => {
  await atCove(page);
  const fight = await page.evaluate(() => {
    const { G, PIRATES, sim } = window.BR;
    G.up.cannon = 3;
    const p = PIRATES.spawnPirate('sloop', G.boat.x + 150, G.boat.y + 30, 'gunner');   // she keeps her distance: a raider sunk alongside drops her loot where it's picked up at once
    let hurt = false;
    for (let i = 0; i < 40 * 30 && p.mood !== 'sinking'; i++) {
      if (p.mood === 'surrender') PIRATES.boardPrize(p);
      if (p.mood === 'struck') break;
      G.boat.a = Math.atan2(p.y - G.boat.y, p.x - G.boat.x) - Math.PI / 2;   // bring her abeam
      if (PIRATES.cannonTarget()) PIRATES.fireBroadside();
      sim(1 / 30);
      if (G.boat.hp < 100) hurt = true;
      G.boat.hp = Math.max(G.boat.hp, 50);
    }
    return { sunk: p.mood === 'sinking' || p.mood === 'struck', pirates: G.stats.pirates, loot: PIRATES.state.loot.length + (p.mood === 'struck' ? 1 : 0), boarded: p.mood === 'struck', hurt };
  });
  expect(fight).toMatchObject({ sunk: true, pirates: 1, loot: 1 });
  if (!fight.boarded) {                                             // boarded, she leaves no loot afloat to haul
    const hauled = await page.evaluate(() => {
      const { G, PIRATES, sim } = window.BR, l = PIRATES.state.loot[0], coins = G.coins;
      Object.assign(G.boat, { x: l.x, y: l.y, px: l.x, py: l.y, vx: 0, vy: 0 });
      sim(1 / 30);
      return { gained: G.coins - coins, expected: l.coins, left: PIRATES.state.loot.length };
    });
    expect(hauled.gained).toBeGreaterThanOrEqual(hauled.expected);   // the loot, plus the goal for a first sinking
    expect(hauled.left).toBe(0);
  }
  await page.keyboard.press('m');                                    // either way, the chart marks the cove
  await expect(page.locator('body')).toContainText('Pirate cove');
});

test('with cannons fitted and a pirate about, the touch controls offer Fire, and it fires @phone', async ({ page }) => {
  await atCove(page);
  await page.evaluate(() => {
    const { G, PIRATES } = window.BR;
    G.up.cannon = 2;
    const p = PIRATES.spawnPirate('brig', G.boat.x + 120, G.boat.y);
    G.boat.a = Math.atan2(p.y - G.boat.y, p.x - G.boat.x) - Math.PI / 2;   // abeam, so the broadside bears
  });
  const fire = page.getByRole('button', { name: /^Fire$/ });
  await expect(fire).toBeVisible();
  await fire.tap();
  await expect.poll(() => page.evaluate(() => Math.max(...window.BR.PIRATES.state.me.rails))).toBeGreaterThan(0);
});

test('a ship hails you under the black flag, and heaving to pays her tribute', async ({ page }) => {
  await atCove(page);
  const hail = await page.evaluate(() => {
    const { G, PIRATES, sim } = window.BR;
    G.hold = [];
    const a = G.boat.a, p = PIRATES.spawnPirate('brig', G.boat.x - Math.cos(a) * 120, G.boat.y - Math.sin(a) * 120, 'gunner', 'hail');   // in the cove's open water
    p.merciless = false;
    for (let i = 0; i < 30 * 30 && p.parley <= 0; i++) { Object.assign(G.boat, { vx: 0, vy: 0 }); sim(1 / 30); }
    return p.parley > 0;
  });
  expect(hail).toBe(true);
  await expect(page.locator('body')).toContainText('hails you');
  const paid = await page.evaluate(() => {
    const { G, PIRATES, sim } = window.BR, coins = G.coins, p = PIRATES.state.ships.find(s => s.parley > 0)!;
    for (let i = 0; i < 30 * 30 && p.mood !== 'sated'; i++) { Object.assign(G.boat, { vx: 0, vy: 0 }); sim(1 / 30); }
    return { mood: p.mood, paid: coins - G.coins, hp: G.boat.hp };
  });
  expect(paid.mood).toBe('sated');
  expect(paid.paid).toBeGreaterThan(0);
});

test('a ship after you out of sight shows at the screen\'s edge; in a fight her class, your guns and the lookout\'s calls show', async ({ page }) => {
  await atCove(page);
  await page.evaluate(() => {
    const { G, PIRATES } = window.BR;
    G.up.cannon = 2;
    PIRATES.spawnPirate('brig', G.boat.x - Math.cos(G.boat.a) * 120 + 700, G.boat.y, 'gunner');
  });
  await expect(page.locator('.threat-pip')).toHaveCount(1);
  await page.evaluate(() => {
    const { G, PIRATES } = window.BR, p = PIRATES.state.ships[0];
    Object.assign(p, { x: G.boat.x - Math.cos(G.boat.a) * 120, y: G.boat.y - Math.sin(G.boat.a) * 120 });
  });
  await expect(page.locator('.threat-pip')).toHaveCount(0);
  await expect(page.locator('.label-world.pirate')).toContainText('brigantine');
  await expect(page.locator('.gundeck .gun').first()).toContainText('Guns');
  // the lookout calls her out as she works into position; step game time rather than wait on a slow renderer
  expect(await page.evaluate(() => {
    const { sim, PIRATES, G } = window.BR;
    for (let i = 0; i < 1800; i++) { sim(1 / 30); const c = PIRATES.state.call; if (c && G.t - c.t < 0.5) return true; }
    return false;
  }), 'a lookout call within a minute of game time').toBe(true);
  await expect(page.locator('.crew-call')).toBeVisible();
});

test('in a fight the gun deck shows each weapon with its key and reload, fires from a click, and explains them on request', async ({ page }) => {
  await atCove(page);
  await page.evaluate(() => { const { G } = window.BR; G.up.cannon = 1; G.up.mortar = 1; });
  await expect(page.locator('.gundeck')).toHaveCount(0);              // no fight, no gun deck
  await page.evaluate(() => {
    const { G, PIRATES, hAt } = window.BR, b = G.boat;
    const a = Array.from({ length: 16 }, (_, k) => k / 16 * Math.PI * 2).find(t => [20, 60, 100, 140].every(r => hAt(b.x + Math.cos(t) * r, b.y + Math.sin(t) * r) < -0.15))!;
    const at = () => ({ x: b.x + Math.cos(a) * 120, y: b.y + Math.sin(a) * 120 });
    b.a = a - Math.PI / 2;                                           // open water off her starboard side
    const p = PIRATES.spawnPirate('brig', at().x, at().y, 'gunner', 'engage');
    setInterval(() => Object.assign(p, at(), { vx: 0, vy: 0, a: G.boat.a }), 16);   // held on your starboard beam, open water between
  });
  const guns = page.locator('.gundeck .gun', { hasText: 'Guns' });
  await expect(guns).toContainText('Fire!');
  await expect(page.locator('.gundeck .gun', { hasText: 'Mortar' })).toBeVisible();
  await guns.click();
  await expect.poll(() => page.evaluate(() => window.BR.PIRATES.state.me.rails[1])).toBeGreaterThan(0);
  await expect(page.locator('.gun-notes')).toHaveCount(0);
  await page.locator('.gun-help').click();
  await expect(page.locator('.gun-notes')).toContainText('abeam');
});

test('the shipyard sells a fighting ship with her guns built in, with no cannon bought', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.coins = 5000; });
  await dockHome(page);
  await page.evaluate(() => { const { G, GAME } = window.BR; GAME.setTab(GAME.portTabs(G.menu.port).indexOf('SHIPYARD')); });
  await expect(page.locator('.list.well')).toContainText('Revenue Cutter');
  const armed = await page.evaluate(() => {
    const { G, GAME } = window.BR;
    G.owned.push('cutter'); G.boatId = 'cutter';
    return { cannon: GAME.gearLvl('cannon'), bought: G.up.cannon };
  });
  expect(armed).toEqual({ cannon: 1, bought: 0 });
});

test('a buried chest is dug up with the use key while the boat waits off the beach @both', async ({ page }) => {
  await atCove(page);
  const setup = await page.evaluate(() => {
    const { G, PIRATES, SEA, sim } = window.BR;
    const m = PIRATES.buriedMap(250, G.boat, 100, 2200);
    if (!m) return null;
    const w = SEA.nearestWater(m.x, m.y, -0.1);
    G.maps = [m];
    Object.assign(G.boat, { x: w.x, y: w.y, px: w.x, py: w.y, vx: 0, vy: 0 });
    G.cam.x = w.x - 160; G.cam.y = w.y - 100;
    sim(1 / 30);
    return { coins: G.coins, near: !!G.nearTreasure?.buried, id: m.id };
  });
  expect(setup?.near).toBe(true);
  await expect(page.locator('body')).toContainText('dig up the treasure');
  await page.keyboard.press('e');
  await expect.poll(() => page.evaluate(() => !!window.BR.G.dig)).toBe(true);
  const after = await page.evaluate(() => { const { G, sim } = window.BR; for (let i = 0; i < 4 * 30; i++) sim(1 / 30); return { coins: G.coins, maps: G.maps.map((m: { id: string }) => m.id), dug: G.stats.dug }; });
  expect(after.coins).toBeGreaterThanOrEqual(setup!.coins + 250);   // the chest, plus any goal it completes
  expect(after.maps).not.toContain(setup!.id);   // the dig can turn up an older map, but not this one again
  expect(after.dug).toBe(1);
});
