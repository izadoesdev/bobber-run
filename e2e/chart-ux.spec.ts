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
/** Waits until the page has painted `n` more frames: on a slow software renderer wall time says little about how far it got. */
const frames = (page: Page, n: number) => page.evaluate(n => new Promise<void>(res => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
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
  await page.evaluate(() => { const { G, sim } = window.BR, b = { x: G.boat.x, y: G.boat.y }; G.mode = 'play';   // see the sea round about first
    for (const [dx, dy] of [[-500, -300], [500, -300], [-500, 300], [500, 300], [0, 0]]) { G.boat.x = b.x + dx; G.boat.y = b.y + dy; sim(0.3); }
    G.mode = 'map'; });
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
  // the chunks get built, then building stops: an endless rebuild (tiles on screen evicting each other) never stops.
  // "Stopped" means no new builds over 40 painted frames, twice running, since a stalled renderer paints none at all
  const built = () => page.evaluate(() => window.BR.ZONES.built as number);
  let last = -1, still = 0;
  while (still < 2) {
    await frames(page, 40);
    const n = await built();
    still = n > 0 && n === last ? still + 1 : 0; last = n;
  }
  await frames(page, 60);
  expect(await built()).toBe(last);
});

test('the chart draws the land and sea themselves, not a flat fill', async ({ page }) => {
  test.setTimeout(90_000);
  await openChart(page);
  // a point of dry land and one of deep water near the boat, by the world's own heights
  const pts = await page.evaluate(() => {
    const { G, hAt } = window.BR; let land = null, sea = null;
    for (let r = 200; r < 1500 && (!land || !sea); r += 20) for (let a = 0; a < 6.28; a += 0.2) {   // clear of the boat's own mark
      const x = G.boat.x + Math.cos(a) * r, y = G.boat.y + Math.sin(a) * r, h = hAt(x, y);
      if (!land && h > 0.25) land = { x, y }; if (!sea && h < -0.45) sea = { x, y };
    }
    return { land, sea };
  });
  expect(pts.land && pts.sea).toBeTruthy();
  await page.evaluate(({ land, sea }) => { const { G, sim } = window.BR, b = { x: G.boat.x, y: G.boat.y }; G.mode = 'play';   // sail by both, so the fog lifts there
    for (const p of [land!, sea!]) { G.boat.x = p.x; G.boat.y = p.y; sim(0.3); }
    G.boat.x = b.x; G.boat.y = b.y; G.map.zoom = 2; G.mode = 'map'; }, pts);   // zoomed out, so both are on the chart
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  const rgb = async (p: { x: number; y: number }) => {
    const [cx, cy] = await onChart(page, p.x, p.y);
    return page.evaluate(([fx, fy]) => {
      const c = document.querySelector('.chartwrap canvas') as HTMLCanvasElement;
      // A region-name glyph can cross the exact sample pixel; the surrounding terrain is the subject here.
      const d = c.getContext('2d')!.getImageData(Math.round(fx * c.width) - 8, Math.round(fy * c.height) - 8, 17, 17).data;
      return [0, 1, 2].map(channel => Array.from({ length: 17 * 17 }, (_, i) => d[i * 4 + channel]).sort((a, b) => a - b)[144]);
    }, [(cx - box.x) / box.width, (cy - box.y) / box.height]);
  };
  // tiles are sampled by a worker and drawn as they arrive: give a slow runner painted frames and time to get there
  await expect.poll(async () => { await frames(page, 10); const [l, s] = [await rgb(pts.land!), await rgb(pts.sea!)]; return s[2] > s[0] + 30 && Math.abs(l[0] - s[0]) + Math.abs(l[1] - s[1]) + Math.abs(l[2] - s[2]) > 60; }, { timeout: 45_000 }).toBe(true);
});

test('sea you have not sailed stays blank on the chart until you have been there', async ({ page }) => {
  await openChart(page);
  const far = await page.evaluate(() => { const { G } = window.BR; return { x: G.boat.x + 900, y: G.boat.y + 300 }; });
  await page.evaluate(() => { window.BR.G.map.zoom = 2; });
  await hoverUntil(page, far.x, far.y, /unexplored/i);
  // sail there (stepped through the game's own tick), come back to the chart, and it's charted water now
  await page.evaluate(({ x, y }) => { const { G, sim } = window.BR; G.mode = 'play'; G.boat.x = x; G.boat.y = y; sim(0.3); sim(0.3); G.boat.x -= 900; G.boat.y -= 300; G.mode = 'map'; }, far);
  await hoverUntil(page, far.x, far.y, /^(?!.*unexplored)/i);
  expect(await page.evaluate(() => window.BR.G.explored.length)).toBeGreaterThan(0);
});

test('a region not open yet says on the chart what opens it, and opens with the story', async ({ page }) => {
  await openChart(page);
  await page.evaluate(() => { const { G } = window.BR; G.story = { i: 0, base: {}, shown: true }; G.unlocked = []; G.map.zoom = 2; });
  // east of home, out past Alderhaven Reach into the next region (one step out: it opens once the pier is mended)
  let at: { x: number; y: number } | null = null;
  for (const dx of [1800, 2200, 2600]) {
    const p = await page.evaluate(dx => ({ x: window.BR.G.boat.x + dx, y: window.BR.G.boat.y - 300 }), dx);
    const [x, y] = await onChart(page, p.x, p.y);
    await page.mouse.move(x + 3, y); await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    if (/closed/i.test(await tip(page))) { at = p; break; }
  }
  expect(at, 'a closed region east of home').not.toBeNull();
  expect(await tip(page)).toMatch(/opens after "mend the pier"/i);
  await page.evaluate(() => { window.BR.G.story = { i: 3, base: {}, shown: true }; });
  await hoverUntil(page, at!.x, at!.y, /^(?!.*closed)/i);
});

test('sea charted far from home shows on the chart too', async ({ page }) => {
  await openChart(page);
  // sail (stepped) 22,000 units out, past the first fog window, and look at the chart there
  const p = await page.evaluate(() => { const { G, sim } = window.BR; G.story = { i: 99, base: {}, shown: true }; G.mode = 'play';
    for (let i = 0; i < 6; i++) { G.boat.x = -20000 + i * 60; G.boat.y = -10000; sim(0.3); }
    G.map.x = G.map.y = 0; G.map.zoom = 1; G.mode = 'map'; return { x: G.boat.x + 180, y: G.boat.y }; });
  const box = (await page.locator('.chartwrap canvas').boundingBox())!;
  const [cx, cy] = await onChart(page, p.x, p.y);
  await expect.poll(() => page.evaluate(([fx, fy]) => {
    const c = document.querySelector('.chartwrap canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data;
    return d[2] > d[0] + 20;                                           // sea blue, not the fog's parchment
  }, [(cx - box.x) / box.width, (cy - box.y) / box.height]), { timeout: 15_000 }).toBe(true);
});

test('the minimap keeps its colours and charted sea after the chart was open, frame after frame as new sea is seen', async ({ page }) => {
  await openChart(page);
  await page.evaluate(() => { window.BR.SET.minimap = true; });
  await page.keyboard.press('m');                                  // back to sailing, the shared GPU canvas now chart-sized
  await expect.poll(() => page.evaluate(() => window.BR.G.mode === 'play' && !!document.querySelector('.mini canvas')), { timeout: 15_000 }).toBe(true);
  // out to open water well past home's charted sea, seen there (stepped through the game's tick), and its tiles drawn
  await page.evaluate(() => {
    const { G, hAt, sim } = window.BR, b = G.boat;
    let x = b.x + 3000;
    while (hAt(x, b.y) > -0.3) x += 40;
    Object.assign(b, { x, px: x, vx: 0, vy: 0 });
    sim(0.3); sim(0.3);
  });
  // round the boat on the minimap: the share of pixels showing the wrong texture (black, or the fog's red) and fog
  await page.evaluate(() => {
    (window as unknown as { miniRead: () => { wrong: number; paper: number } }).miniRead = () => {
      const c = document.querySelector('.mini canvas') as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data, r = (c.width / 2 - 4) * 0.3;
      let k = 0, wrong = 0, paper = 0;
      for (let y = 0; y < c.height; y += 6) for (let x = 0; x < c.width; x += 6) {
        if ((x - c.width / 2) ** 2 + (y - c.height / 2) ** 2 > r * r) continue;
        const o = (y * c.width + x) * 4, R = d[o], G = d[o + 1], B = d[o + 2]; k++;
        if (R + G + B < 120 || (R > 140 && G < 70 && B < 70)) wrong++;
        if (R > 200 && B < 200 && R - B > 25) paper++;
      }
      return { wrong: wrong / k, paper: paper / k };
    };
  });
  type Read = { wrong: number; paper: number };
  await expect.poll(() => page.evaluate(() => (window as unknown as { miniRead: () => Read }).miniRead().paper), { timeout: 20_000 }).toBeLessThan(0.2);
  // then sail on a little each frame, slower than the boat reveals sea round it, so every reveal uploads new fog
  // while the sea round the boat stays charted; every frame is read
  const worst = await page.evaluate(() => new Promise<Read>(done => {
    const { G } = window.BR, read = (window as unknown as { miniRead: () => Read }).miniRead;
    let n = 0, wrong = 0, paper = 0;
    const tick = () => {
      G.boat.x += 4; G.boat.px = G.boat.x;
      const f = read();
      wrong = Math.max(wrong, f.wrong); paper = Math.max(paper, f.paper);
      if (++n < 90) requestAnimationFrame(tick); else done({ wrong, paper });
    };
    requestAnimationFrame(tick);
  }));
  expect(worst.wrong, 'no frame shows the wrong texture (black or red)').toBeLessThan(0.2);
  expect(worst.paper, 'the sea round the boat is charted').toBeLessThan(0.2);   // the fog read from the wrong place showed 0.84
});
