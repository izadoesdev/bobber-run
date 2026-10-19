// Entry: canvases, input, fixed-step loop with interpolation.
import { W, H, STEP } from './config.js';
import * as GAME from './game.js';
import * as MODELS from './models.js';
import { SPECIES } from './econ.js';
import { TUNE, G, physicsStep, update, updateCamera, refreshSolids, hit, portMenuInput, shipInput, newGame, loadGame, hasSave, wipeSave, saveGame } from './game.js';

import { initRender, render, R, prefetch, boatRenderState } from './gl/renderer.js';
import { initUI, drawUI, TITLE_ITEMS, PAUSE_ITEMS } from './ui/index.js';
import { SET, ROWS, ACTIONS, applySettings, remap, bind, resetBinds } from './settings.js';
import { unlockAudio, sfx, renderOffline, SFX_NAMES } from './audio.js';
import { homePort, schoolsNear, poisNear, hAt, LAIR, BOSS } from './world.js';
import { updateLife, LIFE } from './life.js';
import { WX, setWeather } from './weather.js';


const screen = document.getElementById('screen'), uiRoot = document.getElementById('ui');
initRender(screen); initUI(uiRoot); applySettings();

function fit() {
  const dpr = window.devicePixelRatio || 1;
  const S = Math.max(1, Math.floor(Math.min(innerWidth * dpr / W, innerHeight * dpr / H)));
  R.S = S; screen.width = W * S; screen.height = H * S;
  const cw = W * S / dpr, ch = H * S / dpr;
  screen.style.width = cw + 'px'; screen.style.height = ch + 'px';
  uiRoot.style.width = cw + 'px'; uiRoot.style.height = ch + 'px'; uiRoot.style.fontSize = (cw / 64 * SET.ui).toFixed(2) + 'px';
}
addEventListener('resize', fit); fit();

const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Tab']);
let fitLater = null;
addEventListener('keydown', e => {
  unlockAudio(); G.pad = false;
  if (BLOCK.has(e.key)) e.preventDefault();
  if (G.rebinding) {                                   // waiting for a new key on the controls screen
    if (!e.repeat) { if (e.key !== 'Escape') bind(G.rebinding, e.key); G.rebinding = null; sfx('select'); }
    return;
  }
  const k = remap(e.key);
  G.keys[k] = true;
  if (!e.repeat) G.pressed.add(k);
});
addEventListener('keyup', e => { G.keys[remap(e.key)] = false; G.keys[e.key] = false; });
addEventListener('blur', () => { for (const k in G.keys) G.keys[k] = false; });

// gamepad: stick/dpad steer, A cast/confirm, B back, X dock, Y chart, LB log, RB bait, triggers row
const padPrev = {};
function pollPad() {
  const gp = navigator.getGamepads?.()[0]; if (!gp) return;
  const b = i => !!gp.buttons[i]?.pressed, ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const port = G.mode === 'port';                    // in port the shoulder buttons switch tabs
  const map = { ArrowLeft: ax < -0.4 || b(14), ArrowRight: ax > 0.4 || b(15), ArrowUp: ay < -0.4 || b(12) || b(7), ArrowDown: ay > 0.4 || b(13) || b(6),
    ' ': b(0), Escape: b(1), e: !port && b(2), m: b(3), l: !port && b(4), b: !port && b(5), PageUp: port && b(4), PageDown: port && b(5), Tab: b(8), Enter: b(9) };
  for (const k in map) { const v = !!map[k]; if (v && !padPrev[k]) { G.pressed.add(k); G.pad = true; unlockAudio(); } if (v !== !!padPrev[k]) G.keys[k] = v; padPrev[k] = v; }
}
function modeInput(dt) {
  const before = G.mode;
  modeInput2(dt);
  if (G.mode !== before) G.pressed.clear();      // a press that changes screens shouldn't also act on the new one
}
function modeInput2(dt) {
  const nav = (key, n) => { if (hit('ArrowUp', 'w', 'W')) { G[key] = ((G[key] || 0) + n - 1) % n; sfx('move'); } if (hit('ArrowDown', 's', 'S')) { G[key] = ((G[key] || 0) + 1) % n; sfx('move'); } };
  if (G.mode === 'title') {
    const items = TITLE_ITEMS(); nav('titleSel', items.length);
    if (hit('n', 'N')) { wipeSave(); newGame(); G.mode = 'play'; sfx('select'); return; }
    if (hit(' ', 'Enter')) {
      const pick = items[Math.min(G.titleSel || 0, items.length - 1)]; sfx('select');
      if (pick === 'CONTINUE') { loadGame(); G.mode = 'play'; }
      else if (pick === 'NEW VOYAGE') { wipeSave(); newGame(); G.mode = 'play'; }
      else { G.back = 'title'; G.setSel = 1; G.ctlSel = 0; G.mode = pick === 'SETTINGS' ? 'settings' : 'controls'; }
    }
    return;
  }
  if (G.mode === 'pause') {
    nav('pauseSel', PAUSE_ITEMS.length);
    if (hit('Escape')) { G.mode = 'play'; sfx('move'); return; }
    if (hit(' ', 'Enter')) {
      const pick = PAUSE_ITEMS[G.pauseSel || 0]; sfx('select');
      if (pick === 'RESUME') G.mode = 'play';
      else if (pick === 'SAVE & QUIT') { saveGame(); G.mode = 'title'; G.titleSel = 0; }
      else { G.back = 'pause'; G.setSel = 1; G.ctlSel = 0; G.mode = pick === 'SETTINGS' ? 'settings' : 'controls'; }
    }
    return;
  }
  if (G.mode === 'settings') {
    const n = ROWS.length + 1, step = d => { let i = G.setSel || 1; do i = (i + d + n) % n; while (ROWS[i]?.head); G.setSel = i; sfx('move'); };
    if (!G.setSel || ROWS[G.setSel]?.head) G.setSel = 1;
    if (hit('ArrowUp', 'w', 'W')) step(-1); if (hit('ArrowDown', 's', 'S')) step(1);
    const row = ROWS[G.setSel];
    if (row && hit('ArrowLeft', 'a', 'A')) { row.change(-1); applySettings(); fit(); sfx('move'); }
    if (row && hit('ArrowRight', 'd', 'D', ' ', 'Enter')) { row.change(1); applySettings(); fit(); sfx('move'); }
    if (hit('Escape', 'Backspace') || (!row && hit(' ', 'Enter'))) { G.mode = G.back || 'title'; sfx('move'); }
    return;
  }
  if (G.mode === 'controls') {                        // rows: each action, then reset, then back
    nav('ctlSel', ACTIONS.length + 2); const i = G.ctlSel || 0;
    if (hit(' ', 'Enter')) {
      if (i < ACTIONS.length) { G.rebinding = ACTIONS[i].id; sfx('select'); }
      else if (i === ACTIONS.length) { resetBinds(); sfx('select'); }
      else { G.mode = G.back || 'title'; sfx('move'); }
    }
    if (hit('Escape', 'Backspace')) { G.mode = G.back || 'title'; sfx('move'); }
    return;
  }
  if (G.mode === 'port') return portMenuInput(dt);
  if (G.mode === 'map') {
    if (hit('m', 'M', 'Escape')) { G.mode = 'play'; sfx('move'); }
    if (hit('z', 'Z')) { G.map.zoom = G.map.zoom === 1 ? 2 : 1; sfx('move'); }
    return;
  }
  if (G.mode === 'log') {
    const n = SPECIES.length, s = G.logSel || 0, step = d => { G.logSel = (s + d + n) % n; sfx('move'); };
    if (hit('ArrowLeft', 'a', 'A')) step(-1); if (hit('ArrowRight', 'd', 'D')) step(1);
    if (hit('ArrowUp', 'w', 'W')) step(-7); if (hit('ArrowDown', 's', 'S')) step(7);
    if (hit('l', 'L', 'Escape')) { G.mode = 'play'; sfx('move'); } return;
  }
  if (G.mode === 'ship') { shipInput(); if (hit('Tab', 'i', 'I', 'Escape')) { G.mode = 'play'; sfx('move'); } return; }
  if (G.mode === 'play') {
    if (hit('m', 'M')) { G.mode = 'map'; G.map.x = G.map.y = 0; sfx('move'); }
    else if (hit('l', 'L')) { G.mode = 'log'; sfx('move'); }
    else if (hit('Tab', 'i', 'I')) { G.mode = 'ship'; G.shipSel = 0; sfx('move'); }
    else if (hit('Escape') && !G.fish) { G.mode = 'pause'; G.pauseSel = 0; sfx('move'); }
  }
}

// title screen: show the home harbour
newGame(); G.mode = 'title';
let acc = 0, last = performance.now();
let noRender = false;
export function tick(dt) {
  pollPad();
  modeInput(dt);
  let alpha = 1;
  if (G.mode === 'play') {
    refreshSolids();
    acc += dt;
    while (acc >= STEP) { physicsStep(STEP); acc -= STEP; }
    alpha = acc / STEP;
  } else { acc = 0; const b = G.boat; b.px = b.x; b.py = b.y; b.pa = b.a; }
  if (G.mode === 'map') { const s = 220 * dt * G.map.zoom; if (G.keys.ArrowLeft || G.keys.a) G.map.x -= s; if (G.keys.ArrowRight || G.keys.d) G.map.x += s; if (G.keys.ArrowUp || G.keys.w) G.map.y -= s; if (G.keys.ArrowDown || G.keys.s) G.map.y += s; }
  update(dt);
  updateLife(dt);
  const bs = boatRenderState(alpha);
  updateCamera(dt, bs.x, bs.y);
  G.pressed.clear();
  if (noRender) return;
  if (!SET.shake) { G.shakeX = 0; G.shakeY = 0; }
  render(alpha);
  drawUI();
  prefetch(3);
}
function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
  tick(dt);
  requestAnimationFrame(frame);
}
addEventListener('beforeunload', () => { if (G.mode !== 'title') saveGame(); });
window.BR = { SET, AUDIO: { renderOffline, SFX_NAMES }, WX, setWeather, LIFE, LAIR, BOSS, MODELS, GAME, TUNE, G, tick, sim: (dt) => { noRender = true; tick(dt); noRender = false; }, homePort, schoolsNear, poisNear, hAt, SPECIES, R };
requestAnimationFrame(frame);
