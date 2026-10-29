import { clamp, smooth01 } from '../config';

export const DIVE_DOWN_SECONDS = 8, DIVE_UP_SECONDS = 6;

/** Runtime depth: 0 near the surface, 1 fully out of sight. Reversing a dive retains the current depth. */
export function advanceDive(depth: number, surfaced: boolean, seconds: number): number {
  const step = Math.max(0, seconds) / (surfaced ? DIVE_UP_SECONDS : DIVE_DOWN_SECONDS);
  return clamp(depth + (surfaced ? -step : step), 0, 1);
}

export function divePose(depth: number, rising: boolean): { z: number; scale: number; pitch: number } {
  const d = clamp(depth, 0, 1), eased = smooth01(d);
  return {
    z: -32 * eased,
    scale: (1 - 0.45 * eased) * (1 - smooth01((d - 0.65) / 0.35)),
    pitch: (rising ? 1 : -1) * Math.sin(Math.PI * d) * 0.38,
  };
}
