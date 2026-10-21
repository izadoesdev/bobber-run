// Shared setup: analytics never leaves the browser, and every test starts as a brand-new visitor (offline unless a
// test asks otherwise). Helpers run inside the page through the window.BR hooks (src/main.ts).
import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/(cdn|basket|api)\.databuddy\.cc/, r => r.abort());   // test runs are not players
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await use(page);
    expect(errors, 'page errors').toEqual([]);
  },
});
export { expect };

/**
 * Open the game as a new visitor and wait until it is sailing with a school biting in reach (a visitor with no save
 * skips the title screen; schools appear a moment after the boat does).
 */
export async function sail(page: Page, query = '?offline'): Promise<void> {
  await page.goto('/' + query);
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode), { timeout: 20_000 }).toBe('play');
  await expect.poll(() => page.evaluate(() => { const { G, GAME, schoolsNear } = window.BR, b = G.boat; return schoolsNear(b.x, b.y, 200).filter(GAME.schoolActive).length; }), { timeout: 15_000 }).toBeGreaterThan(0);
}
/** Cast at the nearest school that bites now and land the fish, holding the reel below the snapping point. */
export async function landFish(page: Page): Promise<{ caught: number; card: boolean }> {
  return page.evaluate(() => {
    const { G, GAME, SPECIES, schoolsNear, sim } = window.BR, b = G.boat;
    const s = schoolsNear(b.x, b.y, 900).find(s => GAME.schoolActive(s) && SPECIES[s.sp].rod <= G.up.rod && !s.boss);
    if (!s) throw new Error('no school in reach');
    Object.assign(b, { x: s.x + 28, y: s.y, px: s.x + 28, py: s.y, vx: 0, vy: 0, w: 0 });
    G.talk = null; G.mode = 'play';
    for (let i = 0; i < 3; i++) sim(1 / 30);
    G.pressed.add(' '); sim(1 / 30);
    for (let t = 0; t < 20 * 30 && G.fish && G.fish.st !== 'bite'; t++) sim(1 / 30);
    G.pressed.add(' '); sim(1 / 30);
    for (let t = 0; t < 60 * 30 && G.fish; t++) { G.keys[' '] = G.fish.tension < 0.6; sim(1 / 30); }
    G.keys[' '] = false;
    return { caught: G.stats.caught, card: !!G.card };
  });
}
/** Dock at Alderhaven. */
export async function dockHome(page: Page): Promise<void> {
  await page.evaluate(() => { const { G, GAME, homePort } = window.BR; G.talk = null; GAME.dock(homePort()); });
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('port');
}
