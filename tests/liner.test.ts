// The ocean liner's passengers: docking at another harbour far enough off pays their fares, and nothing else does.
import { expect, mock, test } from 'bun:test';

const AUDIO = [...(await Bun.file(new URL('../src/audio.ts', import.meta.url)).text()).matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map(m => m[1]);
mock.module('../src/audio', () => Object.fromEntries(AUDIO.map(n => [n, () => {}])));   // no Web Audio here
const { G } = await import('../src/game/state');
const W = await import('../src/world');
const { dock, FARE_MIN } = await import('../src/game/port');
const { BOATS } = await import('../src/econ');
import type { Port } from '../src/types';

const ports: Port[] = [];
for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) for (const p of W.cellPois(i, j)) if (p.type === 'port') ports.push(p);
const home = W.homePort(), apart = (a: Port, b: Port) => Math.hypot(a.x - b.x, a.y - b.y);
const far = ports.find(p => apart(p, home) > FARE_MIN * 2)!;
// a harbour just along the coast, so the short-hop rule is always tested (dock looks the departure port up by id only)
const near: Port = { ...home, id: 'port:near-test', name: 'Nearby', x: home.x + FARE_MIN * 0.5 };

/** Coins gained docking at `to` after last leaving `from`, aboard `boat`. */
function voyage(boat: typeof G.boatId, from: Port, to: Port): number {
  Object.assign(G, { boatId: boat, lastPort: from.id, hold: [], active: [] });
  G.stats.sold = 1;
  const coins = G.coins;
  dock(to);
  return G.coins - coins;
}

test('the liner comes after the superyacht and carries the best prices and the biggest hold', () => {
  const ids = BOATS.map(b => b.id), liner = BOATS.find(b => b.id === 'liner')!, yacht = BOATS.find(b => b.id === 'superyacht')!;
  expect(ids.indexOf('liner')).toBe(ids.indexOf('superyacht') + 1);
  expect(liner.cost).toBeGreaterThan(yacht.cost);
  expect(liner.luxury!).toBeGreaterThan(yacht.luxury!);
  expect(Math.max(...BOATS.map(b => b.hold))).toBe(liner.hold);
});

test('a liner\'s passengers pay their fares at another harbour, more the further, but not for a short hop or aboard any other boat', () => {
  expect(far).toBeDefined();
  for (const p of [home, far, near]) voyage('row', p, p);       // a first call at each harbour brings its welcome gift: have it first
  const fare = voyage('liner', home, far);
  expect(fare).toBe(Math.round(apart(home, far) * BOATS.find(b => b.id === 'liner')!.fares!));
  expect(voyage('liner', far, far)).toBe(0);                          // back where you left: no voyage
  expect(voyage('liner', home, near)).toBe(0);                        // too short a hop
  expect(voyage('superyacht', home, far)).toBe(0);                    // no passengers aboard her
});
