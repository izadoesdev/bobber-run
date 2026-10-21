import { test, expect, sail } from './fixtures';

// Shared catch links: /?catch=<species>&kg=<kg>&at=<x>,<y>&by=<name>. The visit points at the spot and says whose
// catch it was; whatever came in the URL is checked first, and the address bar is tidied afterwards.
test('a shared catch sets a waypoint, names the sailor and tidies the address @both', async ({ page }) => {
  await sail(page, '?offline&catch=perch&kg=1.4&at=2400,1800&by=Captain%20Kipper');
  await expect.poll(() => page.evaluate(() => window.BR.G.waypoint)).toEqual({ x: 2400, y: 1800 });
  await expect(page.locator('#ui')).toContainText('Captain Kipper landed a Perch of 1.4 kg');
  expect(new URL(page.url()).search).toBe('?offline');
});
test('a rude name in a share link is not shown', async ({ page }) => {
  await sail(page, '?offline&catch=perch&at=2400,1800&by=Sh1t%20Lord');
  await expect(page.locator('#ui')).toContainText('A sailor landed a Perch');
  await expect(page.locator('#ui')).not.toContainText('Sh1t');
});
test('a share link for a fish that does not exist is ignored', async ({ page }) => {
  await sail(page, '?offline&catch=kraken&at=2400,1800&by=Tester');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.BR.G.waypoint)).toBeNull();
});
test('a first-time visitor from a share link starts out by the shared spot', async ({ page }) => {
  // find open water well away from Alderhaven, then arrive there through a link as someone with no save
  await sail(page);
  const spot = await page.evaluate(() => {
    const { hAt, homePort } = window.BR, h = homePort();
    for (let r = 1400; r < 3000; r += 100) for (let a = 0; a < 6.28; a += 0.4) { const x = Math.round(h.x + Math.cos(a) * r), y = Math.round(h.y + Math.sin(a) * r); if (hAt(x, y) < -0.3) return { x, y }; }
    return null;
  });
  expect(spot).not.toBeNull();
  await page.evaluate(() => { localStorage.clear(); window.BR.G.mode = 'title'; });   // no save, and leaving doesn't write one
  await page.goto(`/?offline&catch=mackerel&at=${spot!.x},${spot!.y}&by=Tester`);
  await expect.poll(() => page.evaluate(() => window.BR?.G?.mode), { timeout: 30_000 }).toBe('play');
  const where = await page.evaluate(([x, y]) => { const { G, homePort } = window.BR, h = homePort(); return { toSpot: Math.hypot(G.boat.x - x, G.boat.y - y), toHome: Math.hypot(G.boat.x - h.x, G.boat.y - h.y) }; }, [spot!.x, spot!.y]);
  expect(where.toSpot).toBeLessThan(800);
  expect(where.toHome).toBeGreaterThan(600);
});
test('a share link pointing at land puts the waypoint on the nearest water', async ({ page }) => {
  await sail(page, '?offline&catch=perch&at=900,-300&by=Tester');
  const w = await page.evaluate(() => { const { G, hAt } = window.BR; return G.waypoint && { h: hAt(G.waypoint.x, G.waypoint.y) }; });
  expect(w).not.toBeNull();
  expect(w!.h).toBeLessThan(-0.05);                 // water, not forest
});
