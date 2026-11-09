// The superyacht's helicopter: it flies the catch to the nearest charted harbour, sells it there, and has to get back
// aboard before it can go again. No other boat has one.
import { expect, mock, test } from 'bun:test';

const AUDIO = [...(await Bun.file(new URL('../src/audio.ts', import.meta.url)).text()).matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map(m => m[1]);
mock.module('../src/audio', () => Object.fromEntries(AUDIO.map(n => [n, () => {}])));   // no Web Audio here
const { G } = await import('../src/game/state');
const W = await import('../src/world');
const { HELI, HELI_STATE, flyCatch, heliPort, stepHeli } = await import('../src/game/heli');
import type { Fish } from '../src/types';

const fish = (value: number, sp = 1): Fish => ({ sp, kg: 1, value, trophy: false });
const home = W.homePort();
function atSea(boat: typeof G.boatId): void {
  Object.assign(G, { boatId: boat, mode: 'play', fish: null, active: [], hold: [fish(20), fish(30), fish(40), fish(50, 2)] });
  G.found = new Set([home.id]);
  Object.assign(G.boat, { x: home.x + 900, y: home.y + 300, vx: 0, vy: 0, a: 1 });
  HELI_STATE.flight = null;
}

test('the helicopter sells the catch at the nearest charted harbour, and must land again before it can fly once more', () => {
  atSea('superyacht');
  expect(heliPort().id).toBe(home.id);
  const coins = G.coins, sat = G.sat[home.id]?.[1] ?? 0;
  flyCatch();
  expect(G.hold).toHaveLength(0);
  expect(G.coins).toBeGreaterThan(coins);
  expect(G.sat[home.id][1]).toBe(sat + 3);                // sold at that market, which tires of the species like any sale
  expect(HELI_STATE.flight?.to.id).toBe(home.id);

  G.hold = [fish(60)];
  flyCatch();                                             // still aloft: nothing goes
  expect(G.hold).toHaveLength(1);

  const away = Math.hypot(G.boat.x - home.x, G.boat.y - home.y);
  let t = 0, reached = false;
  for (; HELI_STATE.flight && t < 120; t += 1 / 30) {
    stepHeli(1 / 30);
    if (HELI_STATE.flight && Math.hypot(HELI_STATE.flight.x - home.x, HELI_STATE.flight.y - home.y) < 40) reached = true;
  }
  expect(reached).toBe(true);
  expect(HELI_STATE.flight).toBeNull();
  expect(t).toBeGreaterThan(2 * away / HELI.speed * 0.9);  // there and back takes the flight
  expect(t).toBeLessThan(2 * away / HELI.speed + 6);

  flyCatch();                                             // back aboard: it goes again
  expect(G.hold).toHaveLength(0);
});

test('no other boat has a helicopter', () => {
  atSea('motoryacht');
  const coins = G.coins;
  flyCatch();
  expect(G.hold).toHaveLength(4);
  expect(G.coins).toBe(coins);
  expect(HELI_STATE.flight).toBeNull();
});
