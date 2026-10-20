// Pointer sailing and touch controls. Clicking or tapping the sea sets a course there (hold and drag to steer
// continuously), with a pin on the target. On touch screens on-screen buttons stand in for the keyboard: they hold
// and press the same default keys in G.keys / G.pressed, so every rule that reads keys works unchanged.
// Lives in its own layer over the stage, rendered once per animation frame.
import { render, type ComponentChildren } from 'preact';
import { W, H } from '../config';
import { G } from '../game';
import { courseTarget, dropCourse, setCourse } from '../game/autopilot';
import { stepZoom } from '../camera';
import { SET } from '../prefs';
import { NET } from '../net';
import { ONLINE } from '../online';
import { BOATS } from '../econ';
import { unlockAudio } from '../audio';
import { Icon, Fish, viewPct } from './parts';

// ---------- touch mode ----------
// On from the first touch (or a coarse primary pointer at load), off again as soon as a mouse is used.
let touch = matchMedia('(pointer: coarse)').matches;
function setTouch(on: boolean): void {
  if (on === touch) return;
  touch = on;
  document.documentElement.classList.toggle('touch', on);
}

// ---------- virtual keys ----------
function keyDown(k: string): void { unlockAudio(); G.pad = false; G.keys[k] = true; G.pressed.add(k); }
function keyUp(k: string): void { G.keys[k] = false; }

// ---------- sea pointer ----------
let canvas: HTMLCanvasElement | null = null;
/** The pointer steering right now (held on the sea), and where it is on screen. */
let steering: number | null = null, sx = 0, sy = 0;

/** HUD panels let clicks through to the canvas; a click on one is not a click on the sea. */
const HUD_SOLID = '#ui .panel, #ui .chip, #ui .mini, #ui .hints, #ui .card, #ui .caption, #ui .bubble, #ui .chat-panel, #ui .sailor-card, #ui .island-sign';
function overHud(x: number, y: number): boolean {
  for (const el of document.querySelectorAll(HUD_SOLID)) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}
function seaPoint(x: number, y: number): [number, number] {
  const r = canvas!.getBoundingClientRect();
  return [G.cam.x + (x - r.left) / r.width * W, G.cam.y + (y - r.top) / r.height * H];
}
// two fingers on the sea pinch the zoom, scaled like the wheel (a 1.25x spread is one zoom step)
const fingers = new Map<number, [number, number]>();
let pinchD = 0;
const spread = (): number => { const [a, b] = [...fingers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
function pinch(e: PointerEvent, phase: 'down' | 'move' | 'up'): boolean {
  if (e.pointerType !== 'touch') return false;
  if (phase === 'up') { fingers.delete(e.pointerId); pinchD = 0; return false; }
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size !== 2) return false;
  if (phase === 'down' || !pinchD) { pinchD = spread(); steering = null; dropCourse(); return true; }   // a second finger ends steering
  const d = spread(), k = Math.log(d / pinchD) / Math.log(1.25) * 100;
  if (Math.abs(k) > 6 && (G.mode === 'play' || G.mode === 'sunk')) { stepZoom(k > 0 ? 1 : -1, Math.abs(k)); pinchD = d; }
  return true;
}
// clicking or tapping another sailor's boat goes to the online layer (a card with Wave, Follow, Mute) instead of setting a course
let boatClick: ((uid: string) => void) | null = null;
/** Set (or clear) what a click on another sailor's boat does. */
export function onBoatClick(fn: ((uid: string) => void) | null): void { boatClick = fn; }
/** The sailor whose boat is under world point (x, y), within its hull plus a little slack for fingers. */
function sailorAt(x: number, y: number): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const s of ONLINE.sailors) {
    const L = BOATS.find(b => b.id === s.id)?.L ?? 14, d = Math.hypot(s.x - x, s.y - y);
    if (d < L * 0.6 + (touch ? 8 : 3) && d < bestD) { best = s.uid; bestD = d; }
  }
  return best;
}
function onSeaDown(e: PointerEvent): void {
  if (pinch(e, 'down')) return;
  if (e.button !== 0 || steering !== null || G.mode !== 'play' || overHud(e.clientX, e.clientY)) return;
  if (boatClick) { const uid = sailorAt(...seaPoint(e.clientX, e.clientY)); if (uid) { boatClick(uid); return; } }
  if (!setCourse(...seaPoint(e.clientX, e.clientY))) return;
  steering = e.pointerId; sx = e.clientX; sy = e.clientY;
  canvas!.setPointerCapture(e.pointerId);
}
function onSeaMove(e: PointerEvent): void { if (pinch(e, 'move')) return; if (e.pointerId === steering) { sx = e.clientX; sy = e.clientY; } }
function onSeaUp(e: PointerEvent): void { pinch(e, 'up'); if (e.pointerId === steering) steering = null; }

// ---------- the layer ----------
let layer: HTMLDivElement | null = null;
export function initTouch(): void {
  canvas = document.getElementById('screen') as HTMLCanvasElement | null;
  if (!canvas?.parentElement) return;
  document.documentElement.classList.toggle('touch', touch);
  addEventListener('pointerdown', e => setTouch(e.pointerType !== 'mouse'), { capture: true });
  canvas.addEventListener('pointerdown', onSeaDown);
  canvas.addEventListener('pointermove', onSeaMove);
  canvas.addEventListener('pointerup', onSeaUp);
  canvas.addEventListener('pointercancel', onSeaUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());   // a long press steers; it shouldn't open a menu
  layer = document.createElement('div');
  layer.id = 'touch';
  canvas.parentElement.appendChild(layer);
  requestAnimationFrame(frame);
}
let uiK = 0;
function frame(): void {
  requestAnimationFrame(frame);
  if (steering !== null && G.mode === 'play') setCourse(...seaPoint(sx, sy), true);   // a held finger keeps steering
  else steering = null;
  if (SET.ui !== uiK) { uiK = SET.ui; document.documentElement.style.setProperty('--ui-k', String(uiK)); }
  render(<Layer />, layer!);
}

function Layer() {
  const c = G.mode === 'play' ? courseTarget() : null;
  return (
    <>
      {c && <Pin x={c.x} y={c.y} />}
      {touch && <Controls />}
    </>
  );
}

/** The course target: a small buoy-ring on the water. */
function Pin({ x, y }: { x: number; y: number }) {
  const [left, top] = viewPct(x, y);
  return (
    <svg class={'course-pin' + (SET.calm ? '' : ' live')} viewBox="0 0 20 20" style={{ left: left + '%', top: top + '%' }} aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="#1b2a33" stroke-width="3.4" />
      <circle cx="10" cy="10" r="7" fill="none" stroke="#f0cf6a" stroke-width="1.8" />
      <circle cx="10" cy="10" r="2" fill="#f0cf6a" stroke="#1b2a33" stroke-width="1" />
    </svg>
  );
}

// ---------- buttons ----------
interface BtnProps { k: string; label: string; cls?: string; off?: boolean; badge?: number | undefined; children?: ComponentChildren }
/** Holds key k while pressed (so hold-to-reel works) and presses it once on touch-down. */
function Btn({ k, label, cls = '', off, badge, children }: BtnProps) {
  return (
    <button
      class={'tb ' + cls + (off ? ' off' : '') + (G.keys[k] ? ' down' : '')} aria-label={label}
      onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); keyDown(k); }}
      onPointerUp={() => keyUp(k)} onPointerCancel={() => keyUp(k)} onLostPointerCapture={() => keyUp(k)}
      onContextMenu={e => e.preventDefault()}
    >
      {children}<span class="tl">{label}</span>{badge !== undefined && <span class="tbadge">{badge}</span>}
    </button>
  );
}

/** Is the action on this key offered right now? The sea prompt names its key as a [KEY] token when it is. */
const offered = (key: string): boolean => !!G.prompt?.includes(`[${key}]`);
/** Space: whatever it does right now, named for the moment. */
function mainAction(): { label: string; icon: string; off: boolean } {
  const f = G.fish;
  if (G.card) return { label: 'OK', icon: 'star', off: false };
  if (!f) return { label: 'Cast', icon: 'rod', off: !offered('SPACE') };
  if (f.st === 'reel') return { label: SET.reelToggle && f.reeling ? 'Stop' : 'Reel', icon: 'reel', off: false };
  return { label: 'Strike', icon: 'rod', off: f.st !== 'bite' };
}
function useAction(): { label: string; icon: string } | null {
  if (G.fish) return null;
  if (G.nearPort) return { label: 'Dock', icon: 'anchor' };
  if (G.nearTreasure) return { label: 'Haul up', icon: 'map' };
  if (G.nearWreck) return { label: 'Salvage', icon: 'coin' };
  return null;
}
const MENU_GLYPH = <svg class="tglyph" viewBox="0 0 10 10"><path d="M1.5 2.5h7M1.5 5h7M1.5 7.5h7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>;
const CLOSE_GLYPH = <svg class="tglyph" viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>;

function Controls() {
  const m = G.mode;
  if (m === 'play') return <PlayControls />;
  if (m === 'map') return <div class="tcorner"><Btn k="z" label="Zoom"><span class="tglyph text">{G.map.zoom === 1 ? '+' : '-'}</span></Btn><Btn k="Escape" label="Close">{CLOSE_GLYPH}</Btn></div>;
  if (m === 'log' || m === 'ship' || m === 'journal' || m === 'emote') return <div class="tcorner"><Btn k="Escape" label="Close">{CLOSE_GLYPH}</Btn></div>;
  if (m === 'talk') return <div class="tcorner top"><Btn k="Escape" label="Skip">{CLOSE_GLYPH}</Btn></div>;
  return null;
}

function PlayControls() {
  const main = mainAction(), use = useAction(), bait = G.baitSel;
  return (
    <>
      <div class="tbar">
        <Btn k="Escape" label="Menu" off={!!G.fish}>{MENU_GLYPH}</Btn>
        <Btn k="m" label="Chart"><Icon k="map" /></Btn>
        <Btn k="Tab" label="Ship" badge={G.hold.length || undefined}><Icon k="hold" /></Btn>
        <Btn k="l" label="Log"><Fish sp={0} /></Btn>
        {(G.fish || G.nearSchool) && <>   {/* bait and chum only matter by a school */}
          <Btn k="b" label="Bait" badge={bait === 'none' ? undefined : G.bait[bait]}>{bait === 'none' ? <Icon k="shrimp" cls="sil" /> : <Icon k={bait} />}</Btn>
          <Btn k="c" label="Chum" off={!G.bait.chum} badge={G.bait.chum}><Icon k="chum" /></Btn>
        </>}
      </div>
      <div class="tact">
        {NET.authed && ONLINE.sailors.length > 0 && <Btn k="g" label="Greet"><span class="tglyph text">Hi</span></Btn>}
        {G.pet && !G.fish && <Btn k="p" label="Pet"><span class="cat-dot" /></Btn>}
        {use && <Btn k="e" label={use.label} cls="use" off={!offered('E')}><Icon k={use.icon} /></Btn>}
        <Btn k=" " label={main.label} cls="main" off={main.off}><Icon k={main.icon} /></Btn>
      </div>
    </>
  );
}
