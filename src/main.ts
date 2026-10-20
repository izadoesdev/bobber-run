// Entry: canvas sizing, the fixed-step simulation loop with render interpolation, and debug hooks.
import '../styles/base.css';
import '../styles/ui.css';
import { W, H, STEP, setView } from './config';
import * as GAME from './game';
import * as MODELS from './models';
import * as NETAPI from './net';
import { SPECIES } from './econ';
import { TUNE, G, physicsStep, update, updateCamera, refreshSolids, newGame, saveGame, toast } from './game';
import { initRender, render, R, prefetch, boatRenderState } from './gl/renderer';
import { initUI, drawUI } from './ui/index';
import { SET, applySettings } from './settings';
import { updateStory } from './story';
import { initNet, netTick, NET } from './net';
import { ONLINE } from './online';
import { renderOffline, SFX_NAMES } from './audio';
import { homePort, schoolsNear, poisNear, hAt, LAIR, BOSS } from './world';
import { updateLife, LIFE } from './life';
import { WX, setWeather } from './weather';
import { initInput, pollPad } from './input';
import { menuInput } from './menus';
import { screenScale, zoomLevel } from './camera';

const screen = document.getElementById('screen') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
initRender(screen); initUI(uiRoot); applySettings();
initNet(G, SPECIES.map(s => s.id), toast);
initInput();

// Fill the window: an integer screen scale S keeps the ship's view in sight (about 320x200 world
// units for the rowboat, more for bigger ships or when zoomed out), and the view grows to the
// window's shape so W*S x H*S just covers it (the stage crops the last few pixels).
let fittedZoom = 0;
function fit(): void {
  const dpr = window.devicePixelRatio || 1, iw = innerWidth * dpr, ih = innerHeight * dpr;
  const S = screenScale(iw, ih); fittedZoom = zoomLevel();
  setView(Math.ceil(iw / S), Math.ceil(ih / S));
  R.S = S; screen.width = W * S; screen.height = H * S;
  const cw = W * S / dpr, ch = H * S / dpr;
  screen.style.width = cw + 'px'; screen.style.height = ch + 'px';
  uiRoot.style.width = cw + 'px'; uiRoot.style.height = ch + 'px';
  uiRoot.style.fontSize = (Math.min(cw / 64, ch / 40) * SET.ui).toFixed(2) + 'px';
}
addEventListener('resize', fit); fit();

// ---------- the loop ----------
newGame(); G.mode = 'title';                           // the title screen shows the home harbour
let acc = 0, last = performance.now(), noRender = false;

function panChart(dt: number): void {
  const s = 220 * dt * G.map.zoom, k = G.keys;
  if (k.ArrowLeft || k.a) G.map.x -= s;
  if (k.ArrowRight || k.d) G.map.x += s;
  if (k.ArrowUp || k.w) G.map.y -= s;
  if (k.ArrowDown || k.s) G.map.y += s;
}
export function tick(dt: number): void {
  if (zoomLevel() !== fittedZoom) fit();               // a new ship or a zoom step changes the view
  pollPad();
  menuInput(dt, fit);
  let alpha = 1;
  if (G.mode === 'play') {                             // physics runs in fixed steps; rendering interpolates between them
    refreshSolids();
    acc += dt;
    while (acc >= STEP) { physicsStep(STEP); acc -= STEP; }
    alpha = acc / STEP;
  } else { acc = 0; const b = G.boat; b.px = b.x; b.py = b.y; b.pa = b.a; }
  if (G.mode === 'map') panChart(dt);
  update(dt);
  updateStory();
  netTick(dt);
  updateLife(dt);
  const bs = boatRenderState(alpha);
  if (G.mode === 'play' || G.mode === 'sunk' || G.mode === 'title') updateCamera(dt, bs.x, bs.y);   // menus freeze the view behind them
  G.pressed.clear();
  if (noRender) return;
  if (!SET.shake) { G.shakeX = 0; G.shakeY = 0; }
  render(alpha);
  drawUI();
  prefetch(3);
}
function frame(ts: number): void {
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
  tick(dt);
  requestAnimationFrame(frame);
}
addEventListener('beforeunload', () => { if (G.mode !== 'title' && !NET.skipUnloadSave) saveGame(); });

// debug and test hooks (the Playwright suites drive the game through these)
declare global { interface Window { BR: Record<string, unknown> } }
window.BR = {
  NET, NETAPI, ONLINE, render, SET, apply: () => { applySettings(); fit(); }, AUDIO: { renderOffline, SFX_NAMES },
  WX, setWeather, LIFE, LAIR, BOSS, MODELS, GAME, TUNE, G, tick, sim: (dt: number) => { noRender = true; tick(dt); noRender = false; },
  homePort, schoolsNear, poisNear, hAt, SPECIES, R,
};
requestAnimationFrame(frame);
