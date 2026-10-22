import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

// The sea chart's UX: the tip by the pointer says what's there and what a click does; a port click puts the waypoint
// on its dock, a click on the waypoint clears it, islands open their card; C and the buttons recentre and zoom; the
// legend only lists what's drawn; the minimap opens the chart; on touch a tap sets the waypoint at once.
async function openChart(page: Page): Promise<void> {
  await sail(page);
  await page.evaluate(() => { const { G, homePort } = window.BR; G.found.add(homePort().id); G.waypoint = null; G.talk = null; G.story = { i: 99, base: {}, shown: true }; });
  await page.locator('.mini :is(canvas, .compass)').click();
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
/**
 * Hover world point (x, y) until the tip matches: the point is re-projected and the pointer re-moved each try, since on
 * a slow runner the view can shift (the boat drifts) between measuring and moving, and a single hover can miss.
 */
async function hoverUntil(page: Page, x: number, y: number, want: RegExp): Promise<[number, number]> {
  let at: [number, number] = [0, 0];
  await expect.poll(async () => {
    at = await onChart(page, x, y);
    await page.mouse.move(at[0] + 3, at[1], { steps: 2 }); await page.mouse.move(at[0], at[1], { steps: 2 });
    return want.test(await tip(page));
  }, { timeout: 20_000, intervals: [400] }).toBe(true);
  return at;
}

test('clicking the minimap opens the chart; a port names itself and a click puts the waypoint on its dock', async ({ page }) => {
  await openChart(page);
  const hp = await page.evaluate(() => { const h = window.BR.homePort(); return { x: h.x, y: h.y, dx: h.dock.x, dy: h.dock.y, name: h.name }; });
  const [x, y] = await hoverUntil(page, hp.x, hp.y, new RegExp(hp.name));
  expect(await tip(page)).toMatch(/sail here/i);
  await page.mouse.click(x, y);
  const wp = await page.evaluate(() => window.BR.G.waypoint);
  expect(Math.hypot(wp.x - hp.dx, wp.y - hp.dy)).toBeLessThan(1);
  await expect(page.locator('.chart-chips .chip.waypoint [data-track=chart-waypoint-sail]')).toBeVisible();
  // the waypoint itself offers to clear, and a click does
  const [wx, wy] = await hoverUntil(page, wp.x, wp.y, /clear/i);
  await page.mouse.click(wx, wy);
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

test('the chart draws the land and sea themselves, not a flat fill', async ({ page }) => {
  await openChart(page);
  // a point of dry land and one of deep water near the boat, by the world's own heights
  const pts = await page.evaluate(() => {
    const { G, hAt } = window.BR; let land = null, sea = null;
    for (let r = 40; r < 600 && (!land || !sea); r += 20) for (let a = 0; a < 6.28; a += 0.2) {
      const x = G.boat.x + Math.cos(a) * r, y = G.boat.y + Math.sin(a) * r, h = hAt(x, y);
      if (!land && h > 0.3) land = { x, y }; if (!sea && h < -0.45) sea = { x, y };
    }
    return { land, sea };
  });
  expect(pts.land && pts.sea).toBeTruthy();
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  const rgb = async (p: { x: number; y: number }) => {
    const [cx, cy] = await onChart(page, p.x, p.y);
    return page.evaluate(([fx, fy]) => {
      const c = document.querySelector('.chartwrap canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [(cx - box.x) / box.width, (cy - box.y) / box.height]);
  };
  await expect.poll(async () => { const [l, s] = [await rgb(pts.land!), await rgb(pts.sea!)]; return s[2] > s[0] + 30 && Math.abs(l[0] - s[0]) + Math.abs(l[1] - s[1]) + Math.abs(l[2] - s[2]) > 60; }, { timeout: 15_000 }).toBe(true);
});
