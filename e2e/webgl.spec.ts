import { test, expect, sail } from './fixtures';

test('a prolonged graphics reset freezes gameplay and removes its recovery control after restoration', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const gl = (document.getElementById('screen') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as any).__restoreGraphics = () => ext.restoreContext(); // getExtension returns null while the context is lost
    ext.loseContext();
  });
  await expect(page.locator('#gl-reset')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#gl-reset')).toHaveCSS('position', 'fixed');
  await expect(page.locator('#gl-paused')).toHaveCSS('position', 'fixed');
  const clock = await page.evaluate(() => window.BR.G.t);
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
  expect(await page.evaluate(() => window.BR.G.t)).toBe(clock);
  await page.evaluate(() => (window as any).__restoreGraphics());
  await expect(page.locator('#gl-reset')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.BR.G.t)).toBeGreaterThan(clock);
});

// A lost WebGL context (sleep, driver resets) must come back without errors and keep the game running.
test('the game survives losing and restoring the WebGL context', async ({ page }) => {
  await sail(page);
  const restored = await page.evaluate(async () => {
    const gl = (document.getElementById('screen') as HTMLCanvasElement).getContext('webgl2')!, ext = gl.getExtension('WEBGL_lose_context')!;
    ext.loseContext(); await new Promise(r => setTimeout(r, 500));
    ext.restoreContext(); await new Promise(r => setTimeout(r, 1500));
    return !gl.isContextLost();
  });
  expect(restored).toBe(true);
  expect(await page.evaluate(() => window.BR.G.mode)).toBe('play');
});
