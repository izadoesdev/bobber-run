// Keyboard and gamepad. Raw events become entries in G.keys (held) and G.pressed (this frame),
// translated through the player's key bindings. The cheat console and key rebinding take raw typing.
import { G } from './game';
import { remap, bind, toggleFullscreen } from './settings';
import { runCheat } from './cheats';
import { unlockAudio, sfx } from './audio';

/** Keys whose browser default (page scroll, focus change) the game suppresses. */
const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab']);
/** Letters are tracked in lower case, so Shift or Caps Lock between press and release can't leave a key held. */
const norm = (key: string) => (key.length === 1 ? key.toLowerCase() : key);
const releaseAll = () => { for (const k in G.keys) G.keys[k] = false; };
const isTyping = (t: EventTarget | null): t is HTMLElement => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

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
  if (BLOCKED.has(e.key)) e.preventDefault();
  if (G.mode === 'cheat') return cheatConsoleKey(e);
  if (isCheatKey(e) && (G.mode === 'play' || G.mode === 'port')) {
    e.preventDefault(); G.cheatBack = G.mode; G.mode = 'cheat'; G.cheatBuf = ''; G.cheatErr = false; sfx('select'); return;
  }
  if (G.rebinding) {                                   // the controls screen is waiting for a new key
    if (!e.repeat) { if (e.key !== 'Escape') bind(G.rebinding, e.key); G.rebinding = null; sfx('select'); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && remap(e.key) === e.key) { if (!e.repeat) toggleFullscreen(); return; }   // unless f is rebound
  const k = remap(norm(e.key));
  G.keys[k] = true;
  if (!e.repeat) G.pressed.add(k);
}

export function initInput(): void {
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', e => { const k = norm(e.key); G.keys[remap(k)] = false; G.keys[k] = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  addEventListener('blur', releaseAll);
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
    if (down && !padPrev[k]) { G.pressed.add(k); G.pad = true; unlockAudio(); }
    if (down !== !!padPrev[k]) G.keys[k] = down;
    padPrev[k] = down;
  }
}
