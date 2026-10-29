import { expect, test } from 'bun:test';
import { advanceDive, divePose, DIVE_DOWN_SECONDS, DIVE_UP_SECONDS } from '../src/game/diving';

test('a school takes eight seconds to sink, not an abrupt visibility switch', () => {
  expect(advanceDive(0, false, 0)).toBe(0);
  expect(advanceDive(0, false, 1)).toBeCloseTo(0.125);
  expect(advanceDive(0, false, 4)).toBe(0.5);
  expect(advanceDive(0, false, DIVE_DOWN_SECONDS)).toBe(1);
  expect(advanceDive(0, false, 1000)).toBe(1);
});

test('rising takes six seconds and reversing direction keeps the current depth', () => {
  expect(advanceDive(1, true, DIVE_UP_SECONDS)).toBe(0);
  const halfway = advanceDive(0, false, 4);
  expect(advanceDive(halfway, true, 0)).toBe(halfway);
  expect(advanceDive(halfway, true, 0.1)).toBeCloseTo(halfway - 0.1 / DIVE_UP_SECONDS);
  expect(advanceDive(halfway, false, 0)).toBe(halfway);
  expect(advanceDive(halfway, false, -10)).toBe(halfway);
});

test('descent and ascent advance at the same pace at different simulation frame rates', () => {
  for (const hz of [15, 30, 60, 120]) {
    let depth = 0;
    for (let i = 0; i < hz * 4; i++) depth = advanceDive(depth, false, 1 / hz);
    expect(depth).toBeCloseTo(0.5, 10);
    for (let i = 0; i < hz * 3; i++) depth = advanceDive(depth, true, 1 / hz);
    expect(depth).toBeCloseTo(0, 10);
  }
});

test('a diving fish pitches down and recedes to zero size only at full depth', () => {
  let previousZ = 0, previousScale = 1;
  for (let i = 0; i <= 100; i++) {
    const depth = i / 100, pose = divePose(depth, false);
    expect(pose.z).toBeLessThanOrEqual(previousZ);
    expect(pose.scale).toBeLessThanOrEqual(previousScale);
    expect(pose.pitch).toBeLessThanOrEqual(0);
    if (depth < 1) expect(pose.scale).toBeGreaterThan(0);
    previousZ = pose.z; previousScale = pose.scale;
  }
  expect(divePose(0, false)).toMatchObject({ z: -0, scale: 1 });
  expect(divePose(1, false)).toMatchObject({ z: -32, scale: 0 });
});

test('rising reverses the pitch without changing depth or apparent size', () => {
  const down = divePose(0.5, false), up = divePose(0.5, true);
  expect(up.z).toBe(down.z);
  expect(up.scale).toBe(down.scale);
  expect(up.pitch).toBe(-down.pitch);
  expect(divePose(-10, false)).toEqual(divePose(0, false));
  expect(divePose(10, true)).toEqual(divePose(1, true));
});
