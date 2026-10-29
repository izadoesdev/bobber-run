import { G } from './state';
import { sfx } from '../audio';
import type { Point } from '../types';

type ChartBack = 'play' | 'log' | 'journal';

export function openChart(at: Point = G.boat, back: ChartBack = 'play'): void {
  Object.assign(G.map, { x: at.x - G.boat.x, y: at.y - G.boat.y, back, zoneSp: null });
  G.mode = 'map';
  sfx('move');
}

export function closeChart(): void {
  const back = G.map.back ?? 'play';
  G.map.back = 'play';
  G.mode = back;
  sfx('move');
}
