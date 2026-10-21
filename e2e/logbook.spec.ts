import { test, expect, sail } from './fixtures';

// The logbook lists every variant of a species you've logged: the ones caught by name, the rest as silhouettes.
test('the logbook shows caught variants by name and the rest as silhouettes', async ({ page }) => {
  await sail(page);
  await page.evaluate(() => {
    const { G, SPECIES } = window.BR, sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch');
    G.log.perch = { n: 3, best: 0.8, trophy: false, vars: ['albino'] }; G.logSel = sp; G.talk = null; G.mode = 'log';
  });
  const v = page.locator('.variants');
  await expect(v).toContainText('Albino');
  await expect(v).toContainText('1/7');
  expect(await v.locator('.var:not(.got)').count()).toBe(6);
});
