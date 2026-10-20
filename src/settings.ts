// Settings screen model, key bindings, and applying preferences to audio, renderer and UI.
import { setVolumes } from './audio';
import { stepZoom } from './camera';
import { R } from './gl/renderer';
import { SET, savePrefs, type Quality, type Settings } from './prefs';
export { SET };

const QUALITIES: Quality[] = ['auto', 'high', 'medium', 'low'];
const UI_SIZES = [0.85, 1, 1.15, 1.3, 1.5];

export function applySettings(): void {
  setVolumes({ music: SET.music / 10, sfx: SET.sfx / 10, amb: SET.amb / 10 });
  R.quality = SET.quality;
  R.fx.tilt = SET.tilt ? 1 : 0;
  R.fx.bloom = SET.bloom ? 1 : 0;
  R.fx.horizon = SET.horizon ? 1 : 0;
  const ui = document.getElementById('ui');
  if (ui) {
    ui.classList.toggle('hc', SET.contrast);
    ui.classList.toggle('calm', SET.calm);
    ui.classList.toggle('plain', SET.font === 'plain');
  }
  savePrefs();
}
export function toggleFullscreen(): void {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => { });
}

// ---------- settings rows ----------
/** A section title; the cursor skips it. */
export interface SettingHead { head: string; label?: undefined; help?: undefined }
export interface SettingRow {
  head?: undefined;
  label: string;
  type?: 'slider';
  /** current value: 0..10 for sliders, a display name otherwise */
  get(): string | number;
  /** step the value left (-1) or right (+1) */
  change(d: number): void;
  help?: string;
}
export type SettingEntry = SettingHead | SettingRow;

type KeysWith<V> = { [K in keyof Settings]: Settings[K] extends V ? K : never }[keyof Settings];
type Control = Omit<SettingRow, 'label' | 'head' | 'help'>;

const cycle = <T,>(list: T[], v: T, d: number): T => list[(list.indexOf(v) + d + list.length) % list.length];
const slider = (k: 'music' | 'sfx' | 'amb'): Control => ({
  type: 'slider',
  get: () => SET[k],
  change: d => { SET[k] = Math.max(0, Math.min(10, SET[k] + d)); },
});
const toggle = (k: KeysWith<boolean>, on = 'On', off = 'Off'): Control => ({
  get: () => SET[k] ? on : off,
  change: () => { SET[k] = !SET[k]; },
});
const pick = <K extends keyof Settings>(k: K, list: Settings[K][], names: string[]): Control => ({
  get: () => names[list.indexOf(SET[k])] ?? names[0],
  change: d => { SET[k] = cycle(list, SET[k], d); },
});

export const ROWS: SettingEntry[] = [
  { head: 'Sound' },
  { label: 'Music', ...slider('music') },
  { label: 'Effects', ...slider('sfx') },
  { label: 'Ambience', ...slider('amb') },
  { label: 'Sound captions', ...toggle('captions'), help: 'Shows a short caption for sounds that carry information, like a bite or thunder.' },
  { head: 'Display' },
  { label: 'Fullscreen', get: () => document.fullscreenElement ? 'On' : 'Off', change: toggleFullscreen, help: 'Press F at any time to switch.' },
  { label: 'Pixel style', ...pick('pixel', ['chunky', 'crisp', 'smooth'], ['Chunky', 'Crisp', 'Smooth']), help: 'Chunky: big, blocky pixels. Crisp: smaller, sharper pixels. Smooth: the full screen resolution.' },
  { label: 'Graphics', ...pick('quality', QUALITIES, ['Auto', 'High', 'Medium', 'Low']), help: 'Only used with the Smooth pixel style. Auto lowers the resolution if the game runs slowly.' },
  { label: 'Edge blur', ...toggle('tilt'), help: 'Blurs the top and bottom of the screen, so the sea looks like a tiny model.' },
  { label: 'Glow', ...toggle('bloom'), help: 'A soft glow around lights and bright water.' },
  { label: 'Horizon haze', ...toggle('horizon'), help: 'The far edge of the sea fades into haze, glowing toward the sun.' },
  { label: 'Screen shake', ...toggle('shake') },
  { label: 'Reduce flashing', ...toggle('calm'), help: 'Dims lightning and stops pulsing, shaking and bobbing interface animations.' },
  { label: 'High contrast', ...toggle('contrast'), help: 'Solid panels, brighter text and stronger outlines.' },
  { label: 'Interface size', ...pick('ui', UI_SIZES, ['85%', '100%', '115%', '130%', '150%']) },
  { label: 'Sea zoom', get: () => `${Math.round(SET.zoom * 100)}%`, change: d => { stepZoom(d > 0 ? 1 : -1); }, help: 'How much of the sea you can see. Bigger ships already see further. While sailing you can also use the mouse wheel, or the - and + keys.' },
  { label: 'Font', ...pick('font', ['pixel', 'plain'], ['Pixel', 'Plain']), help: 'Plain uses a smooth system font that is easier to read.' },
  { label: 'Interface while sailing', ...toggle('hud', 'Shown', 'Hidden'), help: 'Press H while sailing to hide the status panel, minimap, quest and hints, for screenshots or calm sailing. Messages and the fishing bars still show.' },
  { label: 'Objective marker', ...toggle('guide'), help: 'Shows where to go next: an arrow on screen and a marker on the minimap and chart.' },
  { head: 'Fishing' },
  { label: 'Strike timing', ...pick('strike', ['normal', 'relaxed', 'auto'], ['Normal', 'Relaxed', 'Automatic']), help: 'Relaxed gives you more time to strike. Automatic sets the hook for you.' },
  { label: 'Reel assist', ...toggle('reelAssist'), help: 'Fish pull less hard, and you stop reeling by yourself while a fish jumps.' },
  { label: 'Reeling', ...pick('reelToggle', [false, true], ['Hold button', 'Press to toggle']), help: 'Press to toggle: tap once to start reeling and again to stop. Hold button: reel while you hold it.' },
];

// ---------- key bindings ----------
// Each action has a default key. A custom binding translates the new key into the default one,
// so the rest of the game only ever checks the defaults.
export interface Action { id: string; label: string; key: string }
export const ACTIONS: Action[] = [
  { id: 'up', label: 'Go forward', key: 'ArrowUp' }, { id: 'down', label: 'Go back', key: 'ArrowDown' },
  { id: 'left', label: 'Steer left', key: 'ArrowLeft' }, { id: 'right', label: 'Steer right', key: 'ArrowRight' },
  { id: 'cast', label: 'Cast, strike and reel', key: ' ' }, { id: 'use', label: 'Dock, salvage, haul up treasure', key: 'e' },
  { id: 'bait', label: 'Switch bait', key: 'b' }, { id: 'chum', label: 'Throw chum', key: 'c' }, { id: 'pet', label: 'Pet the cat', key: 'p' },
  { id: 'ship', label: 'Ship and hold', key: 'Tab' }, { id: 'chart', label: 'Sea chart', key: 'm' }, { id: 'log', label: 'Logbook', key: 'l' },
  { id: 'hud', label: 'Hide or show the interface', key: 'h' },
];
const sameKey = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Translate a pressed key into the default key of the action bound to it. */
export function remap(key: string): string {
  for (const a of ACTIONS) {
    const bound = SET.binds[a.id];
    if (bound && sameKey(bound, key)) return a.key;
  }
  return key;
}
/** Bind `key` to action `id`, taking it away from any other action; binding the default clears the custom key. */
export function bind(id: string, key: string): void {
  for (const k in SET.binds) if (sameKey(SET.binds[k], key)) delete SET.binds[k];
  const a = ACTIONS.find(q => q.id === id);
  if (a && !sameKey(a.key, key)) SET.binds[id] = key;
  else delete SET.binds[id];
  savePrefs();
}
export function resetBinds(): void { SET.binds = {}; savePrefs(); }
/** The key a player should press for a default key, for prompts and hints. */
export function boundKey(key: string): string {
  const a = ACTIONS.find(q => sameKey(q.key, String(key)));
  return (a && SET.binds[a.id]) || key;
}
