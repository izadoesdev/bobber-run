import { expect, test } from 'bun:test';
import { fitSprite, opaqueBounds } from '../src/ui/sprite';

const image = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) });

test('sprite bounds ignore transparent padding but include every visible edge', () => {
  const pixels = image(100, 120);
  pixels.data[(35 * pixels.width + 22) * 4 + 3] = 255;
  pixels.data[(78 * pixels.width + 60) * 4 + 3] = 1;
  expect(opaqueBounds(pixels)).toEqual({ x: 22, y: 35, width: 39, height: 44 });
});

test('empty sprites have safe nonzero bounds', () => {
  expect(opaqueBounds(image(4, 4))).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});

test('portraits fit and center wide hulls, tall rigs and oversized sprites', () => {
  for (const [width, height] of [[400, 180], [200, 240], [60, 40]]) {
    for (const bounds of [
      { x: 20, y: 60, width: 35, height: 15 },
      { x: 60, y: 12, width: 80, height: 140 },
      { x: 0, y: 0, width: 400, height: 300 },
    ]) {
      const { x, y, scale } = fitSprite(bounds, width, height);
      const left = x + bounds.x * scale, top = y + bounds.y * scale;
      expect(scale).toBeGreaterThan(0);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + bounds.width * scale).toBeLessThanOrEqual(width);
      expect(top + bounds.height * scale).toBeLessThanOrEqual(height);
      expect(Math.abs(left + bounds.width * scale / 2 - width / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(top + bounds.height * scale / 2 - height / 2)).toBeLessThanOrEqual(0.5);
      if (scale >= 1) expect(Number.isInteger(scale)).toBe(true);
    }
  }
});
