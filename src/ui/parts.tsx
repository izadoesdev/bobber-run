// Shared UI primitives: icons, keycaps, bars, canvases, money, and the pointer-vs-keyboard selection model.
import type { ComponentChildren, HTMLAttributes, TargetedMouseEvent } from 'preact';
import { useRef, useEffect } from 'preact/hooks';
import { W, H, clamp } from '../config';
import { G } from '../game';
import { boundKey } from '../settings';
import { boatFrame, SHIPPED, NA, PLAIN, type Fit } from '../models';
import type { BoatId, WeatherState } from '../types';
import { icon, fishIcon } from './icons';

/** World position -> percent of the view, for things pinned over the canvas. */
export const viewPct = (x: number, y: number): [number, number] => [(x - G.cam.x) / W * 100, (y - G.cam.y) / H * 100];

/** Draws into a canvas sized to its CSS box at device resolution. */
export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => void;

type CanvasProps = { draw: DrawFn; cls?: string } & Omit<HTMLAttributes<HTMLCanvasElement>, 'class' | 'ref'>;
export function Canvas({ draw, cls, ...rest }: CanvasProps) {
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
  // redraws after every render: the UI re-renders each frame, so this animates
  useEffect(() => {
    const c = ref.current, r = box.current;
    if (!c || !r) return;
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
  if (b in ARROW) {
    return (
      <span class="key">
        <svg class="kglyph" viewBox="0 0 10 10"><path d="M5 1.5 8.8 8 1.2 8z" transform={`rotate(${ARROW[b]} 5 5)`} /></svg>
      </span>
    );
  }
  return <span class="key">{keyLabel(b)}</span>;
}

/** One or two keycaps followed by what they do. */
export const Hint = ({ k, k2, pad, children }: { k: string; k2?: string; pad?: string; children?: ComponentChildren }) => (
  <span class="hint"><Key k={k} pad={pad} />{k2 && !(G.pad && pad) && <Key k={k2} />}{children}</span>
);

// "[E] Dock at X" -> keycap + text
const PROMPT_KEYS: Record<string, [string, string]> = { SPACE: [' ', 'A'], E: ['e', 'X'] };
export const keyed = (s: string) => s.split(/(\[[^\]]+\])/).map(part => {
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
  if (url === undefined) {
    url = boatFrame(id, Math.floor(NA * 0.58), SHIPPED, PLAIN).img.toDataURL();
    thumbs.set(id, url);
  }
  return url;
}

/** Briefly true after buying the item with this id, for a flash on its row. */
export const flashing = (id: string | undefined) => !!G.bought && G.bought.id === id && G.t - G.bought.t < 0.9;

// ---------- selection: keyboard and pad vs mouse ----------
// Which device moved the cursor last. Keyboard and pad moves scroll the selection into view; only a mouse that
// actually moved selects by hovering, so a list scrolling under a resting cursor can't steal the selection.
let pointer = false;
addEventListener('keydown', () => { pointer = false; }, true);
let mx = -1, my = -1;
addEventListener('mousemove', e => {
  if (e.clientX === mx && e.clientY === my) return;
  mx = e.clientX;
  my = e.clientY;
  pointer = true;
}, true);
/** Wraps a hover handler so it only fires for a real mouse, not while a gamepad is driving. */
export const byPointer = (fn: () => void) => () => { if (pointer && !G.pad) fn(); };

// keeps the cursor row visible in scrolling lists when moved by keyboard or pad
function useScrollTo(sel: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel && ref.current && (!pointer || G.pad)) ref.current.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  return ref;
}

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
  const ref = useScrollTo(sel);
  return <div ref={ref} class={cls + (sel ? ' sel' : '')} onMouseMove={onEnter && byPointer(onEnter)} onClick={onClick}>{children}</div>;
}
