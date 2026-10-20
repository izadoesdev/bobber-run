// Player preferences (no imports, so any module can read them). Persisted apart from the save game.
const KEY = 'bobber-run-settings';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type PixelStyle = 'chunky' | 'crisp' | 'smooth';
export type FontStyle = 'pixel' | 'plain';
export type StrikeTiming = 'normal' | 'relaxed' | 'auto';

export interface Settings {
  /** volumes, 0..10 */
  music: number; sfx: number; amb: number;
  quality: Quality;
  pixel: PixelStyle;
  tilt: boolean; bloom: boolean; shake: boolean;
  /** interface scale */
  ui: number;
  font: FontStyle;
  contrast: boolean; calm: boolean; captions: boolean;
  strike: StrikeTiming;
  reelAssist: boolean; reelToggle: boolean;
  /** camera zoom chosen by the player; 1 = the default view for your ship */
  zoom: number;
  /** action id -> custom key */
  binds: Record<string, string>;
}

export const SET: Settings = {
  music: 6, sfx: 8, amb: 8, quality: 'auto', pixel: 'chunky', tilt: true, bloom: true, shake: true,
  ui: 1, font: 'pixel', contrast: false, calm: false, captions: false,
  strike: 'normal', reelAssist: false, reelToggle: false, zoom: 1, binds: {},
};
// storage may be unavailable (private mode) or hold junk; defaults stand in either case
try { Object.assign(SET, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { }
export function savePrefs(): void { try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch { } }
