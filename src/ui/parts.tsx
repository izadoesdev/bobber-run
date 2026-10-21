// Shared UI primitives: icons, keycaps, bars, canvases, boat previews, and the pointer-vs-keyboard selection model.
import type { ComponentChildren, HTMLAttributes, TargetedMouseEvent } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { W, H, clamp } from '../config';
import { G, hpMax } from '../game';
import { boundKey } from '../settings';
import { boatFrame, SHIPPED, NA, PLAIN, type Fit } from '../models';
import type { BoatId, WeatherState } from '../types';
import { icon, fishIcon } from './icons';

/** World position -> percent of the view, for things pinned over the canvas. */
/** The bait on the hook and the chum aboard, with their keys: shown by a school before the cast and on the fishing dial. */
export function BaitTag() {
  const bait = G.baitSel, chum = G.bait.chum || 0;
  return (
    <span class="bait-tag">
      <span title="Bait (B to switch)"><Icon k={bait === 'none' ? 'rod' : bait} size="s" />{bait === 'none' ? 'No bait' : `×${G.bait[bait] || 0}`}<Key k="b" pad="RB" /></span>
      {chum > 0 && <span title="Chum (C)"><Icon k="chum" size="s" />{chum}<Key k="c" /></span>}
    </span>
  );
}
export const viewPct = (x: number, y: number): [number, number] => [(x - G.cam.x) / W * 100, (y - G.cam.y) / H * 100];
/**
 * How much of a label at view % (x, y) shows: all of it inside the box [x0, x1] x [y0, y1], fading out over `band` %
 * at its edges, so labels slide away as the view moves instead of blinking out at a hard line.
 */
export const edgeFade = (x: number, y: number, x0: number, x1: number, y0: number, y1: number, band = 5): number =>
  Math.max(0, Math.min(1, Math.min(x - x0, x1 - x, y - y0, y1 - y) / band));

/** Draws into a canvas sized to its CSS box at device resolution. */
export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => void;

/** `when`: a key for what the drawing shows; the canvas redraws only when it changes (absent: after every render). */
type CanvasProps = { draw: DrawFn; cls?: string; when?: () => unknown } & Omit<HTMLAttributes<HTMLCanvasElement>, 'class' | 'ref'>;
export function Canvas({ draw, cls, when, ...rest }: CanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // the CSS box, measured on mount and whenever it resizes, so the per-frame redraw never forces a layout
  const box = useRef<DOMRect | null>(null);
  useEffect(() => {
    const c = ref.current!, measure = () => { box.current = c.getBoundingClientRect(); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c, { box: 'border-box' });
    return () => ro.disconnect();
  }, []);
  // redraws after a render, unless `when` says nothing it shows has changed since the last draw
  const last = useRef<unknown>(undefined);
  useEffect(() => {
    const c = ref.current, r = box.current;
    if (!c || !r) return;
    if (when) { const k = when(); if (k === last.current) return; last.current = k; }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    draw(c.getContext('2d')!, w, h, dpr);
  });
  return <canvas ref={ref} class={cls} {...rest} />;
}

export type IconSize = '' | 's' | 'l' | 'xl';
interface IconProps { k?: string; src?: string; size?: IconSize; cls?: string }
export const Icon = ({ k = '', src, size = '', cls = '' }: IconProps) =>
  <img class={`icon ${size} ${cls}`} src={src || icon(k)} draggable={false} alt="" />;

export const Fish = ({ sp, size = '', cls = '' }: { sp: number; size?: IconSize; cls?: string }) =>
  <Icon src={fishIcon(sp)} size={size} cls={cls} />;

export type Tone = '' | 'gold' | 'warn' | 'bad';
export const Bar = ({ k, tone = '' }: { k: number; tone?: Tone }) =>
  <div class={'bar ' + tone}><i style={{ width: clamp(k, 0, 1) * 100 + '%' }} /></div>;

/** A labelled bar with its reading after it. */
export const Stat = ({ label, k, tone = '', children }: { label: string; k: number; tone?: Tone; children?: ComponentChildren }) =>
  <div class="stat"><span class="caps">{label}</span><Bar k={k} tone={tone} /><span class="num">{children}</span></div>;
export const HullStat = () => <Stat label="Hull" k={G.boat.hp / hpMax()}>{Math.max(0, Math.ceil(G.boat.hp))}/{hpMax()}</Stat>;

export const Pips = ({ n, of }: { n: number; of: number }) => (
  <div class="pips" title={`${n} of ${of}`}>
    {Array.from({ length: of }, (_, i) => <i class={i < n ? 'on' : ''} />)}
  </div>
);

export const cap1 = (s: string) => s[0].toUpperCase() + s.slice(1);
/** "3:07" for a count of seconds */
export const clockText = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
export const WX_ICON: Record<WeatherState, string> = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm' };

// ---------- keycaps ----------
const ARROW: Record<string, number> = { ArrowUp: 0, ArrowRight: 90, ArrowDown: 180, ArrowLeft: 270 };
const KEY_NAMES: Record<string, string> = {
  ' ': 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Back', PageUp: 'PgUp', PageDown: 'PgDn',
  Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt',
};
export const keyLabel = (k: string) => KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);

// a keycap for a default key, showing the player's own binding, or the gamepad button when a pad is in use
export function Key({ k, pad }: { k: string; pad?: string | undefined }) {
  if (G.pad && pad) return <span class="key pad">{pad}</span>;
  const b = boundKey(k);
  return <span class="key">{b in ARROW
    ? <svg class="kglyph" viewBox="0 0 10 10"><path d="M5 1.5 8.8 8 1.2 8z" transform={`rotate(${ARROW[b]} 5 5)`} /></svg>
    : keyLabel(b)}</span>;
}

/** One or two keycaps followed by what they do. */
export const Hint = ({ k, k2, pad, children }: { k: string; k2?: string; pad?: string; children?: ComponentChildren }) => (
  <span class="hint"><Key k={k} pad={pad} />{k2 && !(G.pad && pad) && <Key k={k2} />}{children}</span>
);

// prompt tokens -> [default key, pad button]: "[E] Dock at X" -> keycap + text
const PROMPT_KEYS: Record<string, [string, string]> = { SPACE: [' ', 'A'], E: ['e', 'X'] };
/**
 * On touch screens the controls are buttons, not keys: "[SPACE] Cast for Perch" reads "Cast for Perch", "Hold [SPACE]
 * to reel" reads "Hold the button to reel", and "press Space to cast" in dialogue reads "tap Cast".
 */
export function forTouch(s: string): string {
  if (typeof document === 'undefined' || !document.documentElement.classList.contains('touch')) return s;
  return s
    .replace(/press (?:\[SPACE\]|Space) to cast/gi, 'tap Cast').replace(/press (?:\[E\]|E) to dock/gi, 'tap Dock')
    .replace(/press (?:\[SPACE\]|Space) again/gi, 'tap again').replace(/press (?:\[\w+\]|Space|E)/gi, 'tap')
    .replace(/Hold \[SPACE\]/g, 'Hold the button').replace(/\s*\[[A-Z]+\]\s*/g, ' ').trim();
}
export const keyed = (s: string) => forTouch(s).split(/(\[[^\]]+\])/).map(part => {
  if (!part.startsWith('[')) return part;
  const name = part.slice(1, -1), [k, pad] = PROMPT_KEYS[name] || [name.toLowerCase()];
  return <Key k={k} pad={pad} />;
});

// ---------- boats ----------
/** An animated, turning boat for preview panels. */
export function boatPreview(id: BoatId, eq: Fit, speed = 6): DrawFn {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const f = boatFrame(id, Math.floor(G.t * speed) % NA, SHIPPED, eq);
    const sc = Math.max(1, Math.floor(Math.min(w / f.img.width, h / (f.img.height * 0.8)) * 0.95));
    const x = w / 2 - f.cx * sc, y = h * 0.66 - f.cy * sc;
    if (f.shadow) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(f.shadow, x + sc, y + 2 * sc, f.shadow.width * sc, f.shadow.height * sc);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(f.img, x, y, f.img.width * sc, f.img.height * sc);
  };
}

const thumbs = new Map<BoatId, string>();
/** A still, unpainted three-quarter view of a boat, cached as a data URL. */
export function boatThumb(id: BoatId): string {
  let url = thumbs.get(id);
  if (url === undefined) thumbs.set(id, url = boatFrame(id, Math.floor(NA * 0.58), SHIPPED, PLAIN).img.toDataURL());
  return url;
}

/** Briefly true after buying the item with this id, for a flash on its row. */
export const flashing = (id: string | undefined) => !!G.bought && G.bought.id === id && G.t - G.bought.t < 0.9;

// ---------- selection: keyboard and pad vs mouse ----------
// Which device moved the cursor last. Keyboard and pad moves scroll the selection into view; only a mouse that
// actually moved selects by hovering, so a list scrolling under a resting cursor can't steal the selection.
let pointer = false, mx = -1, my = -1;
addEventListener('keydown', () => { pointer = false; }, true);
addEventListener('mousemove', e => {
  if (e.clientX !== mx || e.clientY !== my) { mx = e.clientX; my = e.clientY; pointer = true; }
}, true);
/** Wraps a hover handler so it only fires for a real mouse, not while a gamepad is driving. */
export const byPointer = (fn: () => void) => () => { if (pointer && !G.pad) fn(); };

interface CellProps {
  sel: boolean;
  /** hovering with a real mouse selects it */
  onEnter?: () => void;
  onClick: (e: TargetedMouseEvent<HTMLDivElement>) => void;
  cls?: string;
  children?: ComponentChildren;
}
/** A list row or grid cell: click activates, keyboard selection scrolls it into view, and with onEnter hover selects. */
export function Cell({ sel, onEnter, onClick, children, cls = 'item setrow' }: CellProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel && ref.current && (!pointer || G.pad)) ref.current.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  return <div ref={ref} class={cls + (sel ? ' sel' : '')} onMouseMove={onEnter && byPointer(onEnter)} onClick={onClick}>{children}</div>;
}
