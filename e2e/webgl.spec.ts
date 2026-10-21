import { test, expect, sail } from './fixtures';

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
