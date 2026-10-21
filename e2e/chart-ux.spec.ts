import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

// The sea chart's UX: the tip by the pointer says what's there and what a click does; a port click puts the waypoint
// on its dock, a click on the waypoint clears it, islands open their card; C and the buttons recentre and zoom; the
// legend only lists what's drawn; the minimap opens the chart; on touch a tap sets the waypoint at once.
async function openChart(page: Page): Promise<void> {
  await sail(page);
  await page.evaluate(() => { const { G, homePort } = window.BR; G.found.add(homePort().id); G.waypoint = null; G.talk = null; G.story = { i: 99, base: {}, shown: true }; });
  await page.locator('.mini canvas').click();
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('map');
}
/** Where world point (x, y) is on screen, by the chart's own projection. */
async function onChart(page: Page, x: number, y: number): Promise<[number, number]> {
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  return page.evaluate(([x, y, bx, by, bw, bh]) => {
    const { G } = window.BR, base = G.map.zoom === 1 ? 2.2 : 4.6;
    return [bx + bw / 2 + (x - (G.boat.x + G.map.x)) / base, by + bh / 2 + (y - (G.boat.y + G.map.y)) / base] as [number, number];
  }, [x, y, box.x, box.y, box.width, box.height]);
}
const tip = (page: Page) => page.evaluate(() => document.querySelector('.chart-tip')?.textContent ?? '');

test('clicking the minimap opens the chart; a port names itself and a click puts the waypoint on its dock', async ({ page }) => {
  await openChart(page);
  const hp = await page.evaluate(() => { const h = window.BR.homePort(); return { x: h.x, y: h.y, dx: h.dock.x, dy: h.dock.y, name: h.name }; });
  const [x, y] = await onChart(page, hp.x, hp.y);
  await page.mouse.move(x, y);
  await expect.poll(() => tip(page)).toContain(hp.name);
  expect(await tip(page)).toMatch(/sail here/i);
  await page.mouse.click(x, y);
  const wp = await page.evaluate(() => window.BR.G.waypoint);
  expect(Math.hypot(wp.x - hp.dx, wp.y - hp.dy)).toBeLessThan(1);
  await expect(page.locator('.chart-chips .chip.waypoint [data-track=chart-waypoint-sail]')).toBeVisible();
  // the waypoint itself offers to clear, and a click does
  const [wx, wy] = await onChart(page, wp.x, wp.y);
  await page.mouse.move(wx + 1, wy);
  await expect.poll(() => tip(page)).toMatch(/clear/i);
  await page.mouse.click(wx + 1, wy);
  await expect.poll(() => page.evaluate(() => window.BR.G.waypoint)).toBeNull();
});

test('dragging pans without a waypoint; C and the buttons recentre and zoom; the legend follows what is drawn', async ({ page }) => {
  await openChart(page);
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
  await expect.poll(() => tip(page)).toMatch(/waypoint/i);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => ({ wp: window.BR.G.waypoint, moved: window.BR.G.map.x !== 0 || window.BR.G.map.y !== 0 }))).toEqual({ wp: null, moved: true });
  await expect(page.locator('[data-track=chart-recentre]')).toBeVisible();
  await page.keyboard.press('c');
  await expect.poll(() => page.evaluate(() => window.BR.G.map.x === 0 && window.BR.G.map.y === 0)).toBe(true);
  await page.click('[data-track=chart-zoom-out]');
  await expect.poll(() => page.evaluate(() => window.BR.G.map.zoom)).toBe(2);
  await page.click('[data-track=chart-zoom-in]');
  await expect.poll(() => page.evaluate(() => window.BR.G.map.zoom)).toBe(1);
  const legend = () => page.evaluate(() => [...document.querySelectorAll('.legend span')].map(s => s.textContent!.trim()));
  await expect.poll(legend).toEqual(expect.arrayContaining(['You', 'Port']));
  expect(await legend()).not.toContain('Treasure');
  await page.evaluate(() => { const { G } = window.BR; G.maps.push({ x: G.boat.x + 60, y: G.boat.y + 40 }); });
  await expect.poll(legend).toContain('Treasure');
});

test('an island on the chart opens its card, and its waypoint brings you back to the chart', async ({ page }) => {
  await openChart(page);
  // the nearest island to the boat that isn't Alderhaven, found through the chart's own hit test
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  let opened = false;
  for (const [fx, fy] of [[0.25, 0.3], [0.75, 0.3], [0.25, 0.75], [0.75, 0.75], [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(100);
    if (!/view|buy/i.test(await tip(page))) continue;
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    opened = true; break;
  }
  expect(opened, 'an island within the chart').toBe(true);
  await expect.poll(() => page.evaluate(() => window.BR.G.mode)).toBe('island');
  await page.click('[data-track=island-waypoint]');
  await expect.poll(() => page.evaluate(() => ({ mode: window.BR.G.mode, wp: !!window.BR.G.waypoint }))).toEqual({ mode: 'map', wp: true });
});

test('@phone a tap on the chart sets the waypoint there, and the chip gives its distance', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => { const { G } = window.BR; G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.waypoint = { x: G.boat.x + 200, y: G.boat.y + 120 }; G.mode = 'map'; });
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await expect.poll(() => page.evaluate(() => window.BR.G.waypoint.x < window.BR.G.boat.x)).toBe(true);
  const m = await page.evaluate(() => { const { G } = window.BR, w = G.waypoint; return Math.max(1, Math.round(Math.hypot(w.x - G.boat.x, w.y - G.boat.y) / 10)); });
  await expect(page.locator('.chart-chips .chip.waypoint')).toContainText(`${m} m`);
});

test("a fish's waters on the chart are built once, even zoomed all the way out", async ({ page }) => {
  test.setTimeout(120_000);                                          // CI renders on 2 CPU cores at a few frames a second
  await sail(page);
  await page.evaluate(() => {
    const { G, SPECIES } = window.BR; G.talk = null; G.story = { i: 99, base: {}, shown: true }; G.zones.mackerel = true;
    G.map.x = G.map.y = 0; G.map.zoom = 2; G.map.zoneSp = SPECIES.findIndex((s: { id: string }) => s.id === 'mackerel'); G.mode = 'map';
  });
  // the chunks get built, then building stops: an endless rebuild (tiles on screen evicting each other) never stops
  const built = () => page.evaluate(() => window.BR.ZONES.built as number);
  let last = -1;
  await expect.poll(async () => { const n = await built(); const still = n > 0 && n === last; last = n; return still; }, { timeout: 90_000, intervals: [3000] }).toBe(true);
  await page.waitForTimeout(4000);
  expect(await built()).toBe(last);
});
