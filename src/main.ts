// Entry: canvas sizing, the fixed-step simulation loop with render interpolation, and debug hooks.
import '../styles/base.css';
import '../styles/ui.css';
import { W, H, STEP, setView } from './config';
import * as GAME from './game';
import { guide } from './game/guide';
import * as MODELS from './models';
import * as NETAPI from './net';
import { SPECIES } from './econ';
import { TUNE, G, physicsStep, update, updateCamera, refreshSolids, newGame, saveGame, savedSpot, toast } from './game';
import { initRender, render, R, prefetch, boatRenderState, tilesAround, graphicsReady } from './gl/renderer';
import { warmTiles } from './tilepool';
import { tickIslands, REALM, ISLANDS } from './islands';
import { openIsland } from './ui/island';
import { initUI, drawUI } from './ui/index';
import { SET, applySettings } from './settings';
import { updateStory, speech } from './story';
import { initNet, netTick, NET } from './net';
import { ONLINE } from './online';
import { renderOffline, renderMusicOffline, SFX_NAMES } from './audio';
import { homePort, schoolsNear, poisNear, hAt, LAIR, BOSS, trimWorld, worldCaches, regionSites, nearestWater } from './world';
import { encountersNear, performEncounterAction, openEncounter, seaPropGathered } from './game/encounters';
import { seaPropsNear } from './seaprops';
import { wildlifeStocks } from './game/wildlife';
import { updateLife, LIFE, summonSeaLife } from './life';
import { WX, setWeather } from './weather';
import { initInput, pollPad } from './input';
import { menuInput } from './menus';
import { initAnalytics, trackFailure } from './analytics';
import { initTelemetry, watchGame } from './telemetry';
import { forceName } from './ui/menus';
import { applySharedCatch, tickVisit } from './share';
import { tickPacks, packJournal, packCatch } from './content/engine';
import { tickExplore } from './game/explore';
import { biomeAt } from './biome';
import { zoneStats } from './ui/chart';
import { baseScale, targetScale, easeScale, shipZoom } from './camera';

// dev builds with ?stats: GPU and CPU time per frame (stats-gl), to find what makes laptops run hot. Never in production.
let perf: { begin(): void; end(): void; update(): void } | null = null;
if (import.meta.env.DEV && new URLSearchParams(location.search).has('stats'))
  void import('stats-gl').then(async ({ default: Stats }) => { const s = new Stats({ trackGPU: true }); await s.init(document.getElementById('screen')); document.body.appendChild(s.dom); perf = s; });
let netFailed = false;                                // reported once: a network error must not flood analytics
const screen = document.getElementById('screen') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
initAnalytics();
initRender(screen); initUI(uiRoot); applySettings();
initNet(G, SPECIES.map(s => s.id), toast);
initInput();
initTelemetry();

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
let acc = 0, last = performance.now(), noRender = false, trimT = 0, frozenKey = '';
const settingsKey = (): string => Object.values(SET).join();

function panChart(dt: number): void {
  const s = 220 * dt * G.map.zoom, k = G.keys;
  if (k.ArrowLeft || k.a) G.map.x -= s;
  if (k.ArrowRight || k.d) G.map.x += s;
  if (k.ArrowUp || k.w) G.map.y -= s;
  if (k.ArrowDown || k.s) G.map.y += s;
}
export function tick(dt: number): void {
  if (!graphicsReady()) {
    acc = 0;
    frozenKey = '';
    G.keys = {};
    G.pressed.clear();
    return;
  }
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
  try { netTick(dt); } catch { if (!netFailed) { netFailed = true; trackFailure('net_tick'); } }   // a bad network message must never stop the frame
  watchGame(dt);
  forceName();
  applySharedCatch();
  tickVisit();
  tickIslands(dt);
  tickPacks(dt);
  if (G.mode === 'play') tickExplore(dt);
  updateLife(dt);
  const bs = boatRenderState(alpha);
  if (G.mode === 'play' || G.mode === 'sunk' || G.mode === 'title') updateCamera(dt, bs.x, bs.y);   // menus freeze the view behind them
  G.pressed.clear();
  if (G.mode === 'play' && (trimT -= dt) <= 0) { trimT = 2; trimWorld(G.cam.x + W / 2, G.cam.y + H / 2, Math.max(W, H)); }   // forget the sea far behind (not while the chart looks far afield)
  if (noRender) return;
  if (!SET.shake) { G.shakeX = 0; G.shakeY = 0; }
  // the menus freeze the view behind them: draw it once, then again only if the window or a setting changes
  const live = G.mode === 'play' || G.mode === 'sunk' || G.mode === 'title' || G.mode === 'emote';
  const sceneKey = live ? '' : `${G.mode}|${innerWidth}x${innerHeight}|${settingsKey()}`;
  if (live || sceneKey !== frozenKey) { perf?.begin(); render(alpha); perf?.end(); }
  frozenKey = sceneKey;
  drawUI();
  perf?.update();
  prefetch(3);
}
// Frame pacing: 120 Hz screens would otherwise draw twice as often as anyone can see, which is what makes laptops run
// hot. Sailing draws at most 60 frames a second; menus, the port, the title and a boat lying still draw 30. Everything
// moves by elapsed time, so the pace only changes how often the picture updates.
let lastFrame = 0, stillFor = 0;
// a visible window without focus (another app in front) needs only a slow trickle of frames
function frameBudgetMs(): number {
  if (!document.hasFocus()) return 1000 / 15;
  if (G.mode !== 'play' && G.mode !== 'sunk') return 1000 / 30;
  const b = G.boat, moving = G.fish || G.throttle || Math.hypot(b.vx, b.vy) > 2 || Math.abs(b.w) > 0.05 || ONLINE.sailors.length;
  return moving || stillFor < 2 ? 1000 / 60 : 1000 / 30;
}
function frame(ts: number): void {
  requestAnimationFrame(frame);
  if (ts - lastFrame < frameBudgetMs() - 2) return;     // 2 ms of slack keeps a 60 Hz screen at its full 60
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts; lastFrame = ts;
  const b = G.boat;
  stillFor = Math.hypot(b.vx, b.vy) > 2 || G.throttle || G.fish ? 0 : stillFor + dt;
  tick(dt);
}
addEventListener('beforeunload', () => { if (G.mode !== 'title') saveGame(); });

// debug and test hooks: the e2e suite (e2e/) drives the game through these
declare global { interface Window { BR: Record<string, unknown> } }
window.BR = {
  NET, NETAPI, ONLINE, render, SET, apply: () => { applySettings(); fit(); }, AUDIO: { renderOffline, renderMusicOffline, SFX_NAMES },
  WX, setWeather, LIFE, LAIR, BOSS, MODELS, GAME, TUNE, G, guide, tick, sim: (dt: number) => { noRender = true; tick(dt); noRender = false; },
  homePort, schoolsNear, poisNear, hAt, SPECIES, R, worldCaches, speech, CONTENT: { packJournal, packCatch, biomeAt }, ZONES: zoneStats,
  REALM, ISLANDS, openIsland,
  SEA: { encountersNear, performEncounterAction, openEncounter, seaPropGathered, seaPropsNear, regionSites, nearestWater, wildlifeStocks, summonSeaLife },
};
// the first frame needs the sea round the harbour: the tile workers build it in parallel while the page settles,
// rather than the first frame building it all on the main thread (two seconds on a phone); a saved boat's sea next,
// for Continue
const home = tilesAround(G.cam.x + W / 2, G.cam.y + H / 2), spot = savedSpot();
void warmTiles([...home, ...(spot ? tilesAround(spot.x, spot.y) : [])], home.length, 4000).then(() => requestAnimationFrame(frame));
