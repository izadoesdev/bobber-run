import { test, expect, sail } from './fixtures';
import type { Page } from '@playwright/test';

// Contracts and dock hands, driven through the market's own rows: contracts never ask for more than the hold carries,
// Sell all never gets stuck, offers refresh each day and lean to your rod, and delivering raises the dock hand's grade.
type Row = { kind: string; label?: string; sub?: string; right?: string; action?: string; ok: boolean; why?: string; act: () => void };

/** Moored at Alderhaven's market with the story out of the way. */
async function atMarket(page: Page): Promise<void> {
  await sail(page);
  await page.evaluate(() => { const { G, homePort } = window.BR; G.story = { i: 99, base: {}, shown: true }; G.talk = null; G.menu.port = homePort(); G.menu.tab = 0; G.mode = 'port'; });
}
/** A rowboat at home with `fish` perch aboard and one contract for `n` perch to `to` (home when omitted). */
const contract = (page: Page, n: number, fish: number, elsewhere = false) => page.evaluate(([n, fish, elsewhere]) => {
  const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(), sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch');
  const to = elsewhere ? [...G.found].find((id: string) => id.startsWith('port:') && id !== hp.id) ?? 'port:elsewhere' : hp.id;
  G.boatId = 'row'; G.up.hold = 0;
  G.hold = Array.from({ length: fish }, () => ({ sp, kg: 0.5, value: 7, trophy: false }));
  G.active = [{ id: 't1', from: hp.id, to, toName: 'X', sp, n, reward: 100 }];
  return GAME.portItems(hp).map((r: Row) => ({ kind: r.kind, action: r.action, ok: r.ok, why: r.why }));
}, [n, fish, elsewhere] as const);
/** Press the first row of `kind`, `times` times, and say how many fish are left aboard. */
const press = (page: Page, kind: string, times = 1) => page.evaluate(([kind, times]) => {
  const { G, GAME, homePort, sim } = window.BR;
  for (let i = 0; i < times; i++) { GAME.portItems(homePort()).find((r: Row) => r.kind === kind).act(); sim(1 / 60); }
  return G.hold.length;
}, [kind, times] as const);

test('a contract the hold cannot carry can be abandoned from its row, with two presses, and Sell all still sells', async ({ page }) => {
  await atMarket(page);
  const rows = await contract(page, 5, 4);
  expect(rows.find(r => r.kind === 'deliver')).toMatchObject({ action: 'Abandon', ok: true });
  expect(rows.find(r => r.kind === 'sell')?.ok).toBe(true);
  expect(await press(page, 'sell')).toBe(0);
  await contract(page, 5, 4);
  await press(page, 'deliver');
  expect(await page.evaluate(() => window.BR.G.active.length)).toBe(1);           // the first press only asks
  await press(page, 'deliver');
  expect(await page.evaluate(() => window.BR.G.active.length)).toBe(0);
});

test('a full hold kept back for a contract elsewhere sells on a second press', async ({ page }) => {
  await atMarket(page);
  const rows = await contract(page, 4, 4, true);
  expect(rows.find(r => r.kind === 'sell')).toMatchObject({ ok: true, why: expect.stringMatching(/twice/) });
  expect(await press(page, 'sell')).toBe(4);
  expect(await press(page, 'sell')).toBe(0);
});

test('offers fit the hold, greyed out when they would overfill it, and old saves clamp to it', async ({ page }) => {
  await atMarket(page);
  const most = await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR, hp = homePort(); G.boatId = 'row'; G.up.hold = 0; G.active = []; let most = 0;
    for (let i = 0; i < 300; i++) { G.offers = {}; GAME.portItems(hp); for (const o of G.offers[hp.id]) most = Math.max(most, o.n); }
    return most;
  });
  expect(most).toBeLessThanOrEqual(4);
  const take = await page.evaluate(() => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(), sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch'), day = GAME.dayNum();
    G.active = [{ id: 'a', from: hp.id, to: hp.id, toName: 'X', sp, n: 3, reward: 50 }];
    G.offers[hp.id] = [{ id: 'b', from: hp.id, to: hp.id, toName: 'X', sp, n: 2, reward: 50, day }, { id: 'c', from: hp.id, to: hp.id, toName: 'X', sp, n: 1, reward: 20, day }];
    return GAME.portItems(hp).filter((r: Row) => r.kind === 'take').map((r: Row) => r.ok);
  });
  expect(take).toEqual([false, true]);
  const n = await page.evaluate(() => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(), sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch');
    G.mode = 'play'; G.active = [{ id: 'old', from: hp.id, to: hp.id, toName: 'X', sp, n: 5, reward: 100 }];
    GAME.saveGame(); GAME.loadGame(); return G.active[0]?.n;
  });
  expect(n).toBe(4);
});

test('contracts pay far more with a big boat, refresh each day, and lean to your rod', async ({ page }) => {
  await atMarket(page);
  const ct = await page.evaluate(() => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort();
    G.up.rod = 3; G.active = [];
    const avg = () => { let t = 0, n = 0, tier = 0; for (let i = 0; i < 150; i++) { G.offers = {}; GAME.portItems(hp); for (const o of G.offers[hp.id]) { t += o.reward; n++; if (SPECIES[o.sp].rod === 3) tier++; } } return [t / n, tier / n]; };
    G.owned = ['row']; G.boatId = 'row'; const [row] = avg();
    G.owned = ['row', 'flagship']; G.boatId = 'flagship'; const [flag, tier] = avg();   // the Flagship's deck and keel land the big rod-3 fish
    G.offers = {}; GAME.portItems(hp); const first = G.offers[hp.id].map((o: { id: string }) => o.id).join();
    G.clock += GAME.DAYLEN * 1.01; GAME.portItems(hp); const next = G.offers[hp.id].map((o: { id: string }) => o.id).join();
    return { row, flag, tier, refreshed: first !== next };
  });
  expect(ct.flag).toBeGreaterThan(ct.row + 3000);
  expect(ct.tier).toBeGreaterThan(0.3);
  expect(ct.refreshed).toBe(true);
});

test('delivering raises the dock hand through grades II to V, each with its gift', async ({ page }) => {
  await atMarket(page);
  await page.evaluate(() => { const { G } = window.BR; G.up.rod = 2; G.up.hold = 4; G.owned = ['row', 'skiff', 'launch', 'trawler']; G.boatId = 'trawler'; G.up.quarter = 0; });
  const hand = await page.evaluate(() => { const r = window.BR.GAME.portItems(window.BR.homePort()).find((r: Row) => /dock hand/.test(r.label ?? '')); return [r.label, r.sub]; });
  expect(hand[0]).toMatch(/Grade I$/);
  expect(hand[1]).toMatch(/2 more deliveries here for Grade II/);
  const deliver = (n: number) => page.evaluate(n => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(), sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch');
    for (let i = 0; i < n; i++) {
      G.active = [{ id: 'd' + i, from: hp.id, to: hp.id, toName: 'X', sp, n: 1, reward: 100, day: GAME.dayNum() }];
      G.hold = [{ sp, kg: 0.5, value: 7, trophy: false }];
      GAME.portItems(hp).find((r: Row) => r.kind === 'deliver').act();
    }
    return { d: G.docks[hp.id], streak: G.streak, shrimp: G.bait.shrimp ?? 0, zones: Object.keys(G.zones).length, grade: GAME.dockGrade(hp.id) };
  }, n);
  const shrimp0 = await page.evaluate(() => window.BR.G.bait.shrimp ?? 0);
  expect(await deliver(2)).toMatchObject({ d: 2, streak: 2, shrimp: shrimp0 + 5, grade: 2 });          // Grade II: bait
  const g3 = await deliver(3);
  expect(g3).toMatchObject({ d: 5, streak: 5, grade: 3 });                                            // Grade III: a fish chart
  expect(g3.zones).toBeGreaterThanOrEqual(1);
  const pay = await page.evaluate(() => {
    const { G, GAME, SPECIES, homePort } = window.BR, hp = homePort(), sp = SPECIES.findIndex((s: { id: string }) => s.id === 'perch');
    G.active = [{ id: 'p', from: hp.id, to: hp.id, toName: 'X', sp, n: 1, reward: 1000, day: GAME.dayNum() }];
    return GAME.portItems(hp).find((r: Row) => r.kind === 'deliver').right;
  });
  expect(pay).toBe('+$1,450');                                                                        // Grade III +20%, streak 5 +25%
  const streak = await page.evaluate(() => { const { G, GAME, homePort } = window.BR; G.hold = []; const r = GAME.portItems(homePort()).find((r: Row) => r.kind === 'deliver'); r.act(); r.act(); return G.streak; });
  expect(streak).toBe(4);                                                                             // abandoning drops one step
  await deliver(4);
  const offers = await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR, hp = homePort(); let bulk = 0, n = 0;
    for (let i = 0; i < 40; i++) { G.offers = {}; GAME.portItems(hp); n = G.offers[hp.id].length; bulk += G.offers[hp.id].filter((o: { bulk?: boolean }) => o.bulk).length; }
    return { grade: GAME.dockGrade(hp.id), n, bulk };
  });
  expect(offers).toMatchObject({ grade: 4, n: 3 });                                                   // Grade IV: a third offer, big orders
  expect(offers.bulk).toBeGreaterThan(0);
  await deliver(5);
  const rep = await page.evaluate(() => {
    const { G, GAME, homePort } = window.BR, hp = homePort(); G.boat.hp = 10; G.coins = 0;
    const it = GAME.portItems(hp).find((r: Row) => r.kind === 'repair'), right = it.right; it.act();
    return { grade: GAME.dockGrade(hp.id), right, hp: G.boat.hp, coins: G.coins };
  });
  expect(rep).toMatchObject({ grade: 5, right: 'Free', coins: 0 });                                   // Grade V: free repairs
  expect(rep.hp).toBeGreaterThan(10);
});
