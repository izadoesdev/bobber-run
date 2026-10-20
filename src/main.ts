// Entry: canvas sizing, the fixed-step simulation loop with render interpolation, and debug hooks.
import '../styles/base.css';
import '../styles/ui.css';
import { W, H, STEP, setView } from './config';
import * as GAME from './game';
import { guide } from './game/guide';
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
import { homePort, schoolsNear, poisNear, hAt, LAIR, BOSS, trimWorld, worldCaches } from './world';
import { updateLife, LIFE } from './life';
import { WX, setWeather } from './weather';
import { initInput, pollPad } from './input';
import { menuInput } from './menus';
import { baseScale, targetScale, easeScale, shipZoom } from './camera';

const screen = document.getElementById('screen') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
initRender(screen); initUI(uiRoot); applySettings();
initNet(G, SPECIES.map(s => s.id), toast);
initInput();

// Fill the window: a whole-number screen scale S0 shows the ship's default view (about 320x200 world units for
// the rowboat, more for bigger ships), and the canvas grows to the window's shape so it just covers it (the stage
// crops the last few pixels). The canvas keeps that size; zooming changes the shown scale R.S, and with it how
// many world units (W x H) the view covers.
let fittedShip = 0;
function fit(glide = false): void {
  const dpr = window.devicePixelRatio || 1, iw = innerWidth * dpr, ih = innerHeight * dpr;
  const S0 = baseScale(iw, ih), cw = Math.ceil(iw / S0) * S0, ch = Math.ceil(ih / S0) * S0;
  fittedShip = shipZoom(); R.S0 = S0;
  if (screen.width !== cw || screen.height !== ch) { screen.width = cw; screen.height = ch; }   // (resizing clears the canvas)
  const cssW = cw / dpr + 'px', cssH = ch / dpr + 'px';
  screen.style.width = uiRoot.style.width = cssW; screen.style.height = uiRoot.style.height = cssH;
  uiRoot.style.fontSize = (Math.min(cw / dpr / 64, ch / dpr / 40) * SET.ui).toFixed(2) + 'px';
  if (!glide) R.S = targetScale(S0, cw, ch);            // a new ship glides out to its wider view; a resized window just fits
  zoomView(0);
}
addEventListener('resize', () => fit()); fit();
/** Ease the shown scale toward the zoom target, keeping the view centred as it grows or shrinks. */
function zoomView(dt: number): void {
  const S = easeScale(R.S, targetScale(R.S0, screen.width, screen.height), dt), w = screen.width / S, h = screen.height / S;
  if (w === W && h === H) return;
  G.cam.x += (W - w) / 2; G.cam.y += (H - h) / 2;
  R.S = S; setView(w, h);
}

// ---------- the loop ----------
newGame(); G.mode = 'title';                           // the title screen shows the home harbour
let acc = 0, last = performance.now(), noRender = false, trimT = 0;

function panChart(dt: number): void {
  const s = 220 * dt * G.map.zoom, k = G.keys;
  if (k.ArrowLeft || k.a) G.map.x -= s;
  if (k.ArrowRight || k.d) G.map.x += s;
  if (k.ArrowUp || k.w) G.map.y -= s;
  if (k.ArrowDown || k.s) G.map.y += s;
}
export function tick(dt: number): void {
  if (shipZoom() !== fittedShip) fit(true);             // a new ship has its own default view
  zoomView(dt);
  pollPad();
  menuInput(dt, () => fit());
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
  if (G.mode === 'play' && (trimT -= dt) <= 0) { trimT = 2; trimWorld(G.cam.x + W / 2, G.cam.y + H / 2, Math.max(W, H)); }   // forget the sea far behind (not while the chart looks far afield)
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
  WX, setWeather, LIFE, LAIR, BOSS, MODELS, GAME, TUNE, G, guide, tick, sim: (dt: number) => { noRender = true; tick(dt); noRender = false; },
  homePort, schoolsNear, poisNear, hAt, SPECIES, R, worldCaches,
};
requestAnimationFrame(frame);
