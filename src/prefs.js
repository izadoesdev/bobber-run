// Player preferences (no imports, so any module can read them). Persisted apart from the save game.
const KEY = 'bobber-run-settings';
export const SET = {
  music: 6, sfx: 8, amb: 8, quality: 'auto', pixel: 'chunky', tilt: true, bloom: true, shake: true,
  ui: 1, font: 'pixel', contrast: false, calm: false, captions: false,
  strike: 'normal', reelAssist: false, reelToggle: false, binds: {},
};
try { Object.assign(SET, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) { }
export function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(SET)); } catch (_) { } }
