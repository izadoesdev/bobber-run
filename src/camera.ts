// How much of the sea is in view: bigger ships see further, and the player zooms on top of that. The screen keeps
// one whole-number scale, so the canvas and render targets stay put; zooming changes the world units in view.
import { SET, savePrefs } from './prefs';
import { boatDef } from './game';

/** Zoom steps for the - and + keys (1 = the ship's default view); the wheel zooms anywhere in between. */
const ZOOMS = [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2];
const ZOOM_MIN = ZOOMS[0], ZOOM_MAX = ZOOMS[ZOOMS.length - 1];
/** The rowboat (13.5 units long) sees about 320x200 world units; longer ships see proportionally more. */
const BASE_VIEW = { w: 320, h: 200 }, ROWBOAT_LENGTH = 13.5;
/** However far out the player zooms, the view never spans more world units than this (keeps far zoom cheap). */
const MAX_VIEW = 1400;
export const shipZoom = (): number => Math.sqrt(ROWBOAT_LENGTH / Math.max(ROWBOAT_LENGTH, boatDef().L));

/** Whole device pixels per world unit at the ship's default view, for a window of iw x ih device pixels. */
export function baseScale(iw: number, ih: number): number {
  const z = shipZoom();
  return Math.max(1, Math.round(Math.min(iw / (BASE_VIEW.w / z), ih / (BASE_VIEW.h / z))));
}
/** Device pixels per world unit the view settles at: the base scale times the player's zoom, within the view cap. */
export function targetScale(base: number, cw: number, ch: number): number {
  return Math.max(base * clampZoom(SET.zoom), Math.max(cw, ch) / MAX_VIEW);
}
/** The smallest scale the view can reach for this window (the player's widest zoom, or the view cap). */
export const minScale = (base: number, cw: number, ch: number): number => Math.max(base * ZOOM_MIN, Math.max(cw, ch) / MAX_VIEW);
/** Ease the shown scale toward the target (in log space, so zooming in and out feel alike); exact once close. */
export function easeScale(cur: number, target: number, dt: number): number {
  const k = Math.log(target / cur);
  return Math.abs(k) < 0.002 ? target : cur * Math.exp(k * (1 - Math.exp(-12 * dt)));
}
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** One key step zooms by this factor; the wheel zooms the same per 100 pixels of scroll. */
const STEP = 1.25;

/**
 * Zoom in (+1) or out (-1): a key press steps to the next zoom level, a wheel event scales by its distance
 * (or pass `wheelDelta` pixels directly). Returns the new zoom, or null at the end of the range.
 */
export function stepZoom(dir: 1 | -1, wheelDelta = 0): number | null {
  const start = SET.zoom;
  let z: number;
  if (wheelDelta > 0) {
    z = clampZoom(start * STEP ** (dir * Math.min(3, wheelDelta / 100)));
    if ((start - 1) * (z - 1) < 0) z = 1;                         // stop at the ship's own view on the way through
  } else {
    z = (dir > 0 ? ZOOMS.find(v => v > start + 1e-6) : ZOOMS.filter(v => v < start - 1e-6).pop()) ?? start;
  }
  // nothing to do at either end of the range, or where the view cap already holds the view
  const dpr = window.devicePixelRatio || 1, cw = innerWidth * dpr, ch = innerHeight * dpr, base = baseScale(cw, ch);
  const before = targetScale(base, cw, ch);
  SET.zoom = z;
  if (z === start || targetScale(base, cw, ch) === before) { SET.zoom = start; return null; }
  savePrefs();
  return z;
}
