// Player preferences (no imports, so any module can read them). Persisted apart from the save game.
const KEY = 'bobber-run-settings';

export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type PixelStyle = 'chunky' | 'crisp' | 'smooth';

export interface Settings {
  /** volumes, 0..10 */
  music: number; sfx: number; amb: number;
  quality: Quality;
  pixel: PixelStyle;
  tilt: boolean; bloom: boolean; shake: boolean;
  /** interface scale */
  ui: number;
  font: 'pixel' | 'plain';
  contrast: boolean; calm: boolean; captions: boolean;
  /** the objective marker: an arrow on screen and a flag on the minimap and chart */
  guide: boolean;
  /** the sailing interface (status, minimap, quest, hints); H hides it for screenshots or calm sailing */
  hud: boolean;
  /** the dial top right shows a small map instead of the compass */
  minimap: boolean;
  /** chat: the log fades in at the bottom left, only bubbles over boats, or none at all */
  chat: 'show' | 'bubbles' | 'off';
  strike: 'normal' | 'relaxed' | 'auto';
  reelAssist: boolean; reelToggle: boolean;
  /** camera zoom chosen by the player; 1 = the default view for your ship */
  zoom: number;
  /** action id -> custom key */
  binds: Record<string, string>;
}

export const SET: Settings = {
  music: 6, sfx: 8, amb: 8, quality: 'auto', pixel: 'crisp', tilt: true, bloom: true, shake: true,
  ui: 1, font: 'pixel', contrast: false, calm: false, captions: false, guide: true, hud: true, minimap: false, chat: 'show',
  strike: 'normal', reelAssist: false, reelToggle: false, zoom: 1, binds: {},
};
// storage may be unavailable (private mode) or hold junk; defaults stand in either case
// First run: follow the system's reduced-motion preference until the player picks their own settings.
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
if (!saved && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) Object.assign(SET, { calm: true, shake: false, tilt: false });
try { Object.assign(SET, JSON.parse(saved || '{}')); } catch { }
// new players get the compass; captains who already sail keep the minimap they know, until they change it
try { if (!saved?.includes('"minimap"') && (localStorage.getItem('bobber-run-save-v3') || localStorage.getItem('bobber-run-save-v2'))) SET.minimap = true; } catch { }
export function savePrefs(): void { try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch { } }
