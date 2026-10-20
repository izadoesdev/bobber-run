// How much of the sea is in view. Bigger ships see further by default, and the player can zoom
// in or out on top of that. The screen scale stays a whole number of device pixels per world unit,
// so zoom moves in steps and pixel art stays crisp.
import { SET, savePrefs } from './prefs';
import { boatDef } from './game';

/** Zoom steps the player can pick (1 = the ship's default view). */
export const ZOOMS = [0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 2];
/** The rowboat (13.5 units long) sees about 320x200 world units; longer ships see proportionally more. */
const BASE_VIEW = { w: 320, h: 200 }, ROWBOAT_LENGTH = 13.5;
export const shipZoom = (): number => Math.sqrt(ROWBOAT_LENGTH / Math.max(ROWBOAT_LENGTH, boatDef().L));
export const zoomLevel = (): number => SET.zoom * shipZoom();

/** Integer device pixels per world unit for a window of iw x ih device pixels. */
export function screenScale(iw: number, ih: number): number {
  const z = zoomLevel();
  return Math.max(1, Math.round(Math.min(iw / (BASE_VIEW.w / z), ih / (BASE_VIEW.h / z))));
}
const deviceSize = () => { const dpr = window.devicePixelRatio || 1; return [innerWidth * dpr, innerHeight * dpr] as const; };
/**
 * Step the player's zoom in (+1) or out (-1) to the next level that actually changes the view
 * (on low-density screens neighbouring levels can round to the same whole-pixel scale).
 * Returns the new zoom, or null at the end of the range.
 */
export function stepZoom(dir: 1 | -1): number | null {
  const [iw, ih] = deviceSize(), before = screenScale(iw, ih), start = SET.zoom;
  let i = ZOOMS.findIndex(z => z >= start - 1e-6); if (i < 0) i = ZOOMS.length - 1;
  for (i += dir; i >= 0 && i < ZOOMS.length; i += dir) {
    SET.zoom = ZOOMS[i];
    if (screenScale(iw, ih) !== before) { savePrefs(); return SET.zoom; }
  }
  SET.zoom = start; return null;
}
