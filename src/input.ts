// Keyboard and gamepad. Raw events become entries in G.keys (held) and G.pressed (this frame),
// translated through the player's key bindings. The cheat console and key rebinding take raw typing.
import { G, saveGame } from './game';
import { remap, bind, toggleFullscreen } from './settings';
import { runCheat } from './cheats';
import { unlockAudio, suspendAudio, sfx } from './audio';
import { stepZoom } from './camera';
import { toast } from './game';
import { dropCourse } from './game/autopilot';
import { initTouch } from './ui/touch';

/** Keys whose browser default (page scroll, focus change) the game suppresses. */
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab']);
/** Steering keys (after rebinding) and Escape take the helm back from a clicked course. */
const TAKES_HELM = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'Escape']);
/** Letters are tracked in lower case, so Shift or Caps Lock between press and release can't leave a key held. */
const norm = (key: string) => (key.length === 1 ? key.toLowerCase() : key);
const releaseAll = () => { for (const k in G.keys) G.keys[k] = false; };
const isTyping = (t: EventTarget | null): t is HTMLElement => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

/** Cheats exist only in development builds (or when a build opts in with VITE_ENABLE_CHEATS=1); the live game has none. */
export const CHEATS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_CHEATS === '1';
/** The key left of 1 (` or ~ on most layouts, § or a dead key on others), or F2. */
const isCheatKey = (e: KeyboardEvent) => e.key === '`' || e.key === '~' || e.key === 'F2' || e.code === 'Backquote';

function cheatConsoleKey(e: KeyboardEvent): void {
  e.preventDefault();
  if (e.key === 'Escape' || isCheatKey(e)) { G.mode = G.cheatBack; sfx('move'); return; }
  if (e.key === 'Enter') {
    G.mode = G.cheatBack;
    if (runCheat(G.cheatBuf)) G.cheatBuf = '';
    else { G.mode = 'cheat'; G.cheatErr = true; }
    return;
  }
  if (e.key === 'Backspace') { G.cheatBuf = G.cheatBuf.slice(0, -1); return; }
  if (e.key.length === 1 && G.cheatBuf.length < 24) { G.cheatBuf += e.key.toLowerCase(); G.cheatErr = false; }
}

function onKeyDown(e: KeyboardEvent): void {
  if (isTyping(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }   // a form field has the keyboard
  unlockAudio(); G.pad = false;
  if (BLOCKED.has(e.key) && !(e.key === 'Tab' && G.mode === 'account')) e.preventDefault();   // Tab moves between the account form's fields
  if (G.mode === 'cheat') return cheatConsoleKey(e);
  if (CHEATS_ENABLED && isCheatKey(e) && (G.mode === 'play' || G.mode === 'port')) {
    e.preventDefault(); G.cheatBack = G.mode; G.mode = 'cheat'; G.cheatBuf = ''; G.cheatErr = false; sfx('select'); return;
  }
  if (G.rebinding) {                                   // the controls screen is waiting for a new key
    if (!e.repeat) { if (e.key !== 'Escape') bind(G.rebinding, e.key); G.rebinding = null; sfx('select'); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && remap(e.key) === e.key) { if (!e.repeat) toggleFullscreen(); return; }   // unless f is rebound
  if (canZoom() && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_')) { if (!e.repeat) zoom(e.key === '-' || e.key === '_' ? -1 : 1); return; }
  const k = remap(norm(e.key));
  if (TAKES_HELM.has(k)) dropCourse();
  G.keys[k] = true;
  if (!e.repeat) G.pressed.add(k);
}

/** Zoom the sea view: mouse wheel or - and + (=) while sailing. A wheel event zooms by its scroll distance in pixels. */
let zoomSfxAt = -1e9;
function zoom(dir: 1 | -1, wheelPx = 0): void {
  const z = stepZoom(dir, wheelPx), now = performance.now(), quiet = now - zoomSfxAt < 180;   // a trackpad sends dozens of events a second
  if (!quiet) zoomSfxAt = now;
  if (z === null) { if (!quiet) sfx('deny'); return; }
  if (!quiet) sfx('move');
  G.toasts = G.toasts.filter(t => !t.s.startsWith('Zoom '));          // one zoom notice, updated in place
  toast(`Zoom ${Math.round(z * 100)}%`);
}
const canZoom = () => G.mode === 'play' || G.mode === 'sunk';

export function initInput(): void {
  addEventListener('wheel', e => { if (!canZoom() || (e.target instanceof Element && e.target.closest('.screen, .dialog, .panel'))) return; zoom(e.deltaY < 0 ? 1 : -1, Math.abs(e.deltaY) * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1)); }, { passive: true });
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', e => { const k = norm(e.key); G.keys[remap(k)] = false; G.keys[k] = false; });
  // browsers only allow sound after a user gesture: a click or tap counts, not just a key
  addEventListener('pointerdown', () => unlockAudio(), { capture: true });
  addEventListener('touchend', () => unlockAudio(), { capture: true });   // iOS only counts the end of a tap as a gesture
  // save when the tab is hidden or closed (beforeunload alone is unreliable, especially on mobile), and pause sound meanwhile
  const saveNow = () => { if (G.mode !== 'title') saveGame(); };
  document.addEventListener('visibilitychange', () => { suspendAudio(document.hidden); if (document.hidden) { releaseAll(); saveNow(); } });
  addEventListener('pagehide', saveNow);
  addEventListener('blur', releaseAll);
  initTouch();
}

// ---------- gamepad ----------
// stick/d-pad steer, A cast/confirm, B back, X dock, Y chart, LB log, RB bait, triggers row;
// in port the shoulder buttons switch tabs instead
const padPrev: Record<string, boolean> = {};
export function pollPad(): void {
  const gp = navigator.getGamepads?.()[0]; if (!gp) return;
  const btn = (i: number) => !!gp.buttons[i]?.pressed, ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0, port = G.mode === 'port';
  const state: Record<string, boolean> = {
    ArrowLeft: ax < -0.4 || btn(14), ArrowRight: ax > 0.4 || btn(15), ArrowUp: ay < -0.4 || btn(12) || btn(7), ArrowDown: ay > 0.4 || btn(13) || btn(6),
    ' ': btn(0), Escape: btn(1), e: !port && btn(2), m: btn(3), l: !port && btn(4), b: !port && btn(5),
    PageUp: port && btn(4), PageDown: port && btn(5), Tab: btn(8), Enter: btn(9),
  };
  for (const [k, down] of Object.entries(state)) {
    if (down && !padPrev[k]) { G.pressed.add(k); G.pad = true; unlockAudio(); if (TAKES_HELM.has(k)) dropCourse(); }
    if (down !== !!padPrev[k]) G.keys[k] = down;
    padPrev[k] = down;
  }
}
