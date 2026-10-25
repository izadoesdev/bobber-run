// Click-to-sail with real physics: the autopilot brings big, slow-turning ships to the point asked for, including one
// that starts facing the wrong way in a tight spot (it must creep or back round, not pivot in place and give up).
import { expect, mock, test } from 'bun:test';

const AUDIO = [...(await Bun.file(new URL('../src/audio.ts', import.meta.url)).text()).matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map(m => m[1]);
mock.module('../src/audio', () => Object.fromEntries(AUDIO.map(n => [n, () => {}])));   // no Web Audio here
const { G } = await import('../src/game/state');
const { physicsStep, refreshSolids } = await import('../src/game/physics');
const { setCourse, steerCourse, courseTarget, dropCourse } = await import('../src/game/autopilot');
const { STEP } = await import('../src/config');

G.story = { i: 99, base: {}, shown: true } as typeof G.story;          // every region open
G.mode = 'play';

/** Sail from a to b for up to `secs`; how far from b the boat ends up. */
function sail(boat: typeof G.boatId, a: [number, number], b: [number, number], secs: number): number {
  G.boatId = boat; G.boat.hp = 1e9; G.keys = {};
  Object.assign(G.boat, { x: a[0], y: a[1], px: a[0], py: a[1], vx: 0, vy: 0, a: Math.atan2(b[1] - a[1], b[0] - a[0]), w: 0, helm: 0, thr: 0 });
  expect(setCourse(b[0], b[1])).toBe(true);
  for (let t = 0; t < secs && courseTarget(); t += 1 / 60) {
    G.t += 1 / 60;
    refreshSolids(); steerCourse();
    physicsStep(STEP); physicsStep(STEP);
  }
  dropCourse();
  return Math.hypot(G.boat.x - b[0], G.boat.y - b[1]);
}

test('big ships sail their routes all the way, even starting turned the wrong way', () => {
  const trips: [number, number, number, number][] = [[-425, -314, -1222, -685], [2629, -1937, 3716, -2226], [2302, 718, 1812, 931]];
  for (const boat of ['superyacht', 'schooner'] as const) for (const [ax, ay, bx, by] of trips) expect(sail(boat, [ax, ay], [bx, by], 160)).toBeLessThan(60);
}, 120_000);
