export interface SpriteBounds { x: number; y: number; width: number; height: number }

export function opaqueBounds({ data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>): SpriteBounds {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function fitSprite(bounds: SpriteBounds, width: number, height: number): { x: number; y: number; scale: number } {
  const available = Math.min(width * 0.78 / bounds.width, height * 0.76 / bounds.height);
  const scale = available >= 1 ? Math.floor(available) : available;
  return {
    x: Math.round((width - bounds.width * scale) / 2 - bounds.x * scale),
    y: Math.round((height - bounds.height * scale) / 2 - bounds.y * scale),
    scale,
  };
}
