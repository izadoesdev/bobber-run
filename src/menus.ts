import { G, hit, portMenuInput, shipInput, newGame, loadGame, wipeSave, saveGame, toast, hasSave } from './game';
import { SET, savePrefs } from './prefs';
import { SPECIES } from './econ';
import { ROWS, ACTIONS, applySettings, resetBinds } from './settings';
import { NET, sendEmote, EMOTES } from './net';
import { TITLE_ITEMS, PAUSE_ITEMS } from './ui/menus';
import { BOARDS } from './ui/leaders';
import { closeIsland } from './ui/island';
import { closeEncounter } from './game/encounters';
import { sfx } from './audio';
import { voyageStarted } from './telemetry';
import type { Mode } from './types';
import { cancelFishing, placeByStarterSchool } from './game/fishing';
import { SHARED } from './share';
import { dismissSpeech, speech, talkNext, voyage } from './story';
import { openChart, closeChart } from './game/chart';

type ListKey = 'titleSel' | 'pauseSel' | 'ctlSel' | 'emoteSel';
const up = () => hit('ArrowUp', 'w', 'W'), down = () => hit('ArrowDown', 's', 'S');
function nav(key: ListKey, n: number): void {
  if (up()) { G[key] = (G[key] + n - 1) % n; sfx('move'); }
  if (down()) { G[key] = (G[key] + 1) % n; sfx('move'); }
}
const go = (mode: Mode, sound: 'move' | 'select' = 'move') => { G.mode = mode; sfx(sound); };
const openSettings = (back: Mode, settings: boolean) => { G.back = back; G.setSel = 1; G.ctlSel = 0; G.mode = settings ? 'settings' : 'controls'; };
const startVoyage = () => {
  G.newConfirm = -1; wipeSave(); newGame(); placeByStarterSchool(SHARED?.at);   // a shared catch link starts you by its spot
  G.mode = 'play'; voyage.startedAt = G.t; voyageStarted('new');
};
const askNewVoyage = () => { if (hasSave()) G.newConfirm = 0; else startVoyage(); };

// the question has two answers side by side; keeping the save is picked first, and Escape keeps it too
function confirmNew(): void {
  if (hit('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'A', 'd', 'D', 'w', 'W', 's', 'S', 'Tab')) { G.newConfirm = 1 - G.newConfirm; sfx('move'); }
  if (hit('Escape', 'Backspace')) { G.newConfirm = -1; sfx('move'); return; }
  if (!hit(' ', 'Enter')) return;
  sfx('select');
  if (G.newConfirm === 1) startVoyage(); else G.newConfirm = -1;
}

// a first visit (no save) skips the title and starts on the water; the title is for coming back
let firstFrame = true;
function title(): void {
  if (firstFrame) { firstFrame = false; if (!hasSave()) { startVoyage(); return; } }
  if (G.newConfirm >= 0) return confirmNew();
  const items = TITLE_ITEMS(); nav('titleSel', items.length);
  if (hit('n', 'N')) { askNewVoyage(); sfx('select'); return; }
  if (!hit(' ', 'Enter')) return;
  const pick = items[Math.min(G.titleSel, items.length - 1)]; sfx('select');
  if (pick === 'CONTINUE') { loadGame(); G.mode = 'play'; voyageStarted('continue'); }
  else if (pick === 'ONLINE') { G.accountBack = 'title'; G.mode = 'account'; }
  else if (pick === 'NEW VOYAGE') askNewVoyage();
  else openSettings('title', pick === 'SETTINGS');
}
function pause(): void {
  nav('pauseSel', PAUSE_ITEMS.length);
  if (hit('Escape', 'Pause')) return go('play');
  if (!hit(' ', 'Enter')) return;
  const pick = PAUSE_ITEMS[G.pauseSel]; sfx('select');
  if (pick === 'RESUME') G.mode = 'play';
  else if (pick === 'SAVE & QUIT') {
    if (!saveGame()) return;
    cancelFishing();
    G.mode = 'title'; G.titleSel = 0;
  }
  else if (pick === 'JOURNAL') { G.journalBack = 'pause'; G.mode = 'journal'; }
  else if (pick === 'LEADERBOARD') { G.leadersBack = 'pause'; G.mode = 'leaders'; }
  else if (pick === 'ONLINE') { G.accountBack = 'pause'; G.mode = 'account'; }
  else openSettings('pause', pick === 'SETTINGS');
}
function settings(refit: () => void): void {
  const n = ROWS.length + 1;                           // every row plus Back; section headers are skipped
  const step = (d: number) => { let i = G.setSel || 1; do i = (i + d + n) % n; while (ROWS[i]?.head); G.setSel = i; sfx('move'); };
  if (!G.setSel || ROWS[G.setSel]?.head) G.setSel = 1;
  if (up()) step(-1);
  if (down()) step(1);
  const row = ROWS[G.setSel];
  const change = (d: number) => { if (row && 'change' in row) { row.change(d); applySettings(); refit(); sfx('move'); } };
  if (hit('ArrowLeft', 'a', 'A')) change(-1);
  if (hit('ArrowRight', 'd', 'D', ' ', 'Enter')) change(1);
  if (hit('Escape', 'Backspace') || (!row && hit(' ', 'Enter'))) go(G.back);
}
function controls(): void {                            // rows: each action, then Reset, then Back
  nav('ctlSel', ACTIONS.length + 2);
  const i = G.ctlSel;
  if (hit(' ', 'Enter')) {
    if (i < ACTIONS.length) { G.rebinding = ACTIONS[i].id; sfx('select'); }
    else if (i === ACTIONS.length) { resetBinds(); sfx('select'); }
    else go(G.back);
  }
  if (hit('Escape', 'Backspace')) go(G.back);
}
function emote(): void {
  nav('emoteSel', EMOTES.length);
  const digits = Math.min(9, EMOTES.length);
  let chosen = false;
  for (let i = 0; i < digits; i++) if (hit(String(i + 1))) { G.emoteSel = i; chosen = true; }
  if (chosen || hit(' ', 'Enter')) { sendEmote(G.emoteSel); G.myEmote = { i: G.emoteSel, t: G.t }; go('play', 'select'); }
  else if (hit('Escape', 'g')) go('play');
}
function logbook(): void {
  const n = SPECIES.length, step = (d: number) => { G.logSel = (G.logSel + d + n) % n; sfx('move'); };
  if (hit('ArrowLeft', 'a', 'A')) step(-1);
  if (hit('ArrowRight', 'd', 'D')) step(1);
  if (up()) step(-7);
  if (down()) step(7);
  if (hit('l', 'L', 'Escape')) go('play');
}
function sailing(): void {
  if (hit('Escape') && SET.hud && speech()) { dismissSpeech(); return; }
  if (hit('m', 'M')) openChart();
  else if (hit('l', 'L')) go('log');
  else if (hit('j')) { G.journalBack = 'play'; go('journal'); }
  else if (hit('g') && NET.authed) go('emote', 'select');
  else if (hit('Tab', 'i', 'I')) { G.shipSel = 0; go('ship'); }
  else if (hit('Escape', 'Pause')) { G.pauseSel = 0; go('pause'); }
  else if (hit('h', 'H')) toggleHud();
}
function toggleHud(): void {
  SET.hud = !SET.hud; savePrefs(); sfx('select');
  G.toasts = G.toasts.filter(t => !t.s.startsWith('Interface '));
  toast(SET.hud ? 'Interface shown' : 'Interface hidden. Press H to bring it back');
}

function documentGamepadInput(): void {
  if (!G.pad || !hit('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter')) return;
  const root = document.querySelector(G.mode === 'island' ? '.dialog.island' : G.mode === 'encounter' ? '.dialog.encounter' : '.screen');
  if (!root) return;
  const actions = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), summary, a[href]')].filter(e => e.getClientRects().length > 0);
  if (!actions.length) return;
  const i = actions.findIndex(e => e === document.activeElement);
  if (hit('ArrowDown', 'ArrowRight')) actions[(i + 1) % actions.length].focus();
  else if (hit('ArrowUp', 'ArrowLeft')) actions[i < 0 ? actions.length - 1 : (i + actions.length - 1) % actions.length].focus();
  else if (hit(' ', 'Enter')) { if (i < 0) actions[0].focus(); else actions[i].click(); }
}

function screenInput(dt: number, refit: () => void): void {
  switch (G.mode) {
    case 'title': return title();
    case 'pause': return pause();
    case 'settings': return settings(refit);
    case 'controls': return controls();
    case 'talk': if (hit(' ', 'Enter', 'e')) talkNext(); else if (hit('Escape')) talkNext(true); return;
    case 'emote': return emote();
    case 'account':                                   // a name must be picked first, unless the connection is gone
      if (hit('Escape') && !(G.needName && NET.authed)) { G.needName = false; go(G.accountBack); }
      return;
    case 'journal': if (hit('j', 'Escape')) go(G.journalBack); else documentGamepadInput(); return;
    case 'island': if (hit('Escape')) closeIsland(); else documentGamepadInput(); return;
    case 'encounter': if (hit('Escape')) closeEncounter(); else documentGamepadInput(); return;
    case 'leaders':
      if (hit('ArrowLeft', 'a', 'A')) { G.leaderTab = (G.leaderTab + BOARDS.length - 1) % BOARDS.length; sfx('move'); }
      if (hit('ArrowRight', 'd', 'D', 'Tab')) { G.leaderTab = (G.leaderTab + 1) % BOARDS.length; sfx('move'); }
      if (hit('Escape', 'Enter', ' ')) go(G.leadersBack);
      return;
    case 'finale': if (hit(' ', 'Enter', 'Escape')) go('play', 'select'); return;
    case 'port': return portMenuInput(dt);
    case 'map':
      if (hit('m', 'M', 'Escape')) { closeChart(); return; }
      if (hit('z', 'Z')) { G.map.zoom = G.map.zoom === 1 ? 2 : 1; sfx('move'); }
      if (hit('c', 'C')) { G.map.x = G.map.y = 0; sfx('move'); }
      return;
    case 'log': return logbook();
    case 'ship': shipInput(); if (hit('Tab', 'i', 'I', 'Escape')) go('play'); return;
    case 'play': return sailing();
    default: return;                                   // sunk, cheat (typed via input.ts)
  }
}
export function menuInput(dt: number, refit: () => void): void {
  const before = G.mode;
  screenInput(dt, refit);
  if (G.mode !== before) G.pressed.clear();
}
