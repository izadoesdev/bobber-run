// What sets boats apart besides the superyacht's helicopter (heli.test.ts): the special on the K key (the speedboat's
// full throttle, a spinnaker on every sail, the rowboat's sprint, the research vessel's ping, a horn on the rest), the
// catamaran's turn of speed in a blow, the schooner's reach, the racing yacht's pointing, and the flagship at the head
// of the fleet.
import { expect, mock, test } from 'bun:test';

const AUDIO = [...(await Bun.file(new URL('../src/audio.ts', import.meta.url)).text()).matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map(m => m[1]);
mock.module('../src/audio', () => Object.fromEntries(AUDIO.map(n => [n, () => {}])));   // no Web Audio here
const { G } = await import('../src/game/state');
const { physicsStep, refreshSolids } = await import('../src/game/physics');
const { BURST, SPECIAL, useSpecial, stepSpecial, resetSpecial } = await import('../src/game/special');
const { STEP } = await import('../src/config');

G.story = { i: 99, base: {}, shown: true } as typeof G.story;          // every region open
G.mode = 'play';
const A = [1094, 86], B = [2694, 86];                                  // a straight run of open water, east

/** Full ahead from a standstill for `secs` on heading `a`, pressing K first if `boost`; how far she got along it. */
function run(boat: typeof G.boatId, secs: number, boost: boolean, a = Math.atan2(B[1] - A[1], B[0] - A[0])): number {
  G.boatId = boat; G.boat.hp = 1e9; G.fish = null; G.keys = { ArrowUp: true }; resetSpecial();
  Object.assign(G.boat, { x: A[0], y: A[1], px: A[0], py: A[1], vx: 0, vy: 0, a, w: 0, helm: 0, thr: 0 });
  if (boost) useSpecial();
  for (let t = 0; t < secs; t += 1 / 60) { G.t += 1 / 60; refreshSolids(); stepSpecial(1 / 60); physicsStep(STEP); physicsStep(STEP); }
  G.keys = {};
  return (G.boat.x - A[0]) * Math.cos(a) + (G.boat.y - A[1]) * Math.sin(a);
}

test('the speedboat\'s full throttle carries her much further for its few seconds, then the engines must cool', () => {
  const plain = run('speedboat', BURST.boost.time, false), fast = run('speedboat', BURST.boost.time, true);
  expect(fast).toBeGreaterThan(plain * 1.3);
  expect(SPECIAL.boostT).toBe(0);
  expect(SPECIAL.cool).toBeGreaterThan(0);
  useSpecial();                                                          // still cooling: nothing
  expect(SPECIAL.boostT).toBe(0);
  stepSpecial(BURST.boost.cool);
  useSpecial();
  expect(SPECIAL.boostT).toBe(BURST.boost.time);
});

test('other engines only have a horn: it calls the dolphins over now and then, but drives her no faster', async () => {
  const { LIFE } = await import('../src/life');
  LIFE.pods = []; LIFE.nextPod = 80;
  expect(run('launch', 3, true)).toBeCloseTo(run('launch', 3, false), 0);
  expect(SPECIAL.boostT).toBe(0);
  resetSpecial(); useSpecial();
  expect(LIFE.nextPod).toBeLessThan(5);                                  // dolphins come to see what's calling
  LIFE.nextPod = 80; stepSpecial(5); useSpecial();
  expect(LIFE.nextPod).toBe(80);                                         // but not every time she sounds it
});

test('the rowboat\'s crew can pull hard for a few seconds, then need their breath back', () => {
  const plain = run('row', BURST.sprint.time, false), fast = run('row', BURST.sprint.time, true);
  expect(fast).toBeGreaterThan(plain * 1.25);
  expect(SPECIAL.cool).toBeGreaterThan(0);
});

test('a spinnaker drives a sail hard before the wind, holds her back close-hauled, and blows out in a gale', async () => {
  const { WX } = await import('../src/weather'), { windAngle } = await import('../src/game/rules'), { wrapAngle } = await import('../src/config'), { SPIN } = await import('../src/game/rules');
  const ahead = Math.atan2(B[1] - A[1], B[0] - A[0]), windAt = (off: number) => { for (G.clock = 0; Math.abs(wrapAngle(windAngle() - ahead - off)) > 0.05 && G.clock < 1e6; G.clock += 5); };
  WX.wind = 0.2;
  windAt(0);                                                             // dead before the wind
  expect(run('skiff', 8, true)).toBeGreaterThan(run('skiff', 8, false) * 1.2);
  windAt(2.5);                                                           // close-hauled: it collapses and flogs
  expect(run('skiff', 8, true)).toBeLessThan(run('skiff', 8, false) * 0.95);
  windAt(0); WX.wind = 1;
  run('skiff', SPIN.hoist + SPIN.blowS + 1, true);
  expect(SPECIAL.spinUp).toBe(false);                                    // blown out
  expect(SPECIAL.cool).toBeGreaterThan(0);
  useSpecial();
  expect(SPECIAL.spinUp).toBe(false);                                    // and the crew are still bending on a new one
  WX.wind = 0;
});

test('the research vessel\'s ping charts every school round her for a while', async () => {
  const { pingShown, PING } = await import('../src/game/special');
  resetSpecial();
  G.boatId = 'trawler'; useSpecial();
  expect(pingShown()).toBeNull();
  G.boatId = 'research'; resetSpecial(); useSpecial();
  expect(pingShown()?.r).toBe(PING.r);
  stepSpecial(PING.show + 0.1);
  expect(pingShown()).toBeNull();
});

test('a catamaran flies in a storm: wind drives her far harder than other sails', async () => {
  const { WX } = await import('../src/weather'), { windAngle } = await import('../src/game/rules'), { wrapAngle } = await import('../src/config');
  const ahead = Math.atan2(B[1] - A[1], B[0] - A[0]);
  for (G.clock = 0; Math.abs(wrapAngle(windAngle() - ahead - Math.PI / 2)) > 0.05; G.clock += 5);   // the wind on her beam: a storm's gusts push her sideways, not on
  const gain = (boat: typeof G.boatId): number => { WX.wind = 0; const calm = run(boat, 6, false); WX.wind = 1; const storm = run(boat, 6, false); WX.wind = 0; return storm / calm; };
  const cat = gain('catamaran'), skiff = gain('skiff');
  expect(cat).toBeGreaterThan(skiff * 1.15);
});

test('a schooner is the fastest sail with the wind on her beam, and her rig is hers alone: pirates sail as before', async () => {
  const { windAngle } = await import('../src/game/rules'), { wrapAngle } = await import('../src/config'), { KINDS, windFactor } = await import('../src/game/pirates');
  const ahead = Math.atan2(B[1] - A[1], B[0] - A[0]);
  for (G.clock = 0; Math.abs(wrapAngle(windAngle() - ahead - Math.PI / 2)) > 0.05; G.clock += 5);
  expect(run('schooner', 8, false)).toBeGreaterThan(run('yacht', 8, false));
  const factors = (boat: typeof G.boatId) => { G.boatId = boat; return Object.keys(KINDS).map(k => windFactor(k as keyof typeof KINDS, ahead)); };
  expect(factors('schooner')).toEqual(factors('row'));
});

test('the flagship leads the fleet: boats fishing for you bring in half as much again while you sail her', async () => {
  const { updateFleet } = await import('../src/game/port/fleet'), { FLEET_PER_MIN } = await import('../src/econ');
  const minute = (boat: typeof G.boatId): number => { G.boatId = boat; G.mode = 'play'; G.fleet = { trawler: { port: 'p', portName: 'P', earned: 0 } }; updateFleet(60); return G.fleet.trawler.earned; };
  expect(minute('schooner')).toBeCloseTo(FLEET_PER_MIN.trawler, 5);
  expect(minute('flagship')).toBeCloseTo(Math.round(FLEET_PER_MIN.trawler * 1.5), 5);
  G.fleet = {};
});

test('a racing yacht or a cutter keeps her speed close-hauled, where other sails slow', async () => {
  const { windAngle } = await import('../src/game/rules'), { wrapAngle } = await import('../src/config');
  const ahead = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const windAt = (off: number) => { for (G.clock = 0; Math.abs(wrapAngle(windAngle() - ahead - off)) > 0.05 && G.clock < 1e6; G.clock += 5); };   // her heading `off` the wind's eye
  const keeps = (boat: typeof G.boatId): number => { windAt(Math.PI / 2); const beam = run(boat, 8, false); windAt(2.2); return run(boat, 8, false) / beam; };
  for (const boat of ['yacht', 'cutter'] as const) expect(keeps(boat)).toBeGreaterThan(keeps('skiff') * 1.2);
});
