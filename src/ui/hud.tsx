// The sailing HUD, kept quiet: one slim status bar and one objective line top left, the minimap (with the wind and
// the day on its ring) top right, and the rest only when it matters: hull when damaged, bait by a school, contracts
// while you hold some, key hints until the first catches. The reel gauge, catch card and toasts sit at the bottom;
// what sits on the sea itself is in overlay.tsx.
import type { JSX } from 'preact';
import { clamp, money, dirTo, W, H } from '../config';
import { G, cap, hpMax, boatDef, isNight, dayNum, dayFrac, windAngle, sailEfficiency, lineMax, fishValue } from '../game';
import { SPECIES, fmtKg } from '../econ';
import { VARIANTS, type VariantId } from '../species';
import { featuredToday } from '../today';
import { WX } from '../weather';
import { SET } from '../settings';
import { savePrefs } from '../prefs';
import { sfx } from '../audio';
import { currentQuest, questProgress } from '../story';
import { guide, guideOn, stepLine, tip, whereText, type Step } from '../game/guide';
import type { CatchCard as CatchCardState, FishLine, Point, Toast } from '../types';
import { drawChart, nearestUncharted, terrainCache } from './chart';
import { fishIcon } from './icons';
import { SeaLayer } from './overlay';
import { ShareButton, ShareChip } from './share';
import { clearWaypoint, sailToWaypoint, tickWaypoint, waypointMetres } from '../waypoint';
import { courseTarget } from '../game/autopilot';
import { SPOOL } from '../game/fishing';
import { Bar, BaitTag, Canvas, Fish, Hint, Icon, Key, WX_ICON, cap1, clockText, keyed, type DrawFn } from './parts';

// stable keys so a toast keeps its element (and its fade) as older ones leave
const toastIds = new WeakMap<Toast, number>();
let toastN = 0;
const TOAST_ICON: Partial<Record<Toast['kind'], string>> = { good: 'star', bad: 'warn' };

/** At most the two newest; `low` tucks them lower, outside the sailing view. */
export function Toasts({ low }: { low: boolean }) {
  const shown = G.toasts.slice(-2);
  return (
    <div class={'toasts' + (low ? ' low' : '')} role="status" aria-live="polite">
      {shown.map(t => {
        if (!toastIds.has(t)) toastIds.set(t, ++toastN);
        const ic = TOAST_ICON[t.kind];
        return (
          <div key={toastIds.get(t)} class={`toast chip ${t.kind}` + (t.t < 0.4 ? ' fade' : '')}>
            {ic && <Icon k={ic} size="s" />}<span>{t.s}</span>
          </div>
        );
      })}
    </div>
  );
}

function Captions() {
  return G.captions.length > 0 && <div class="captions">{G.captions.map(c => <div class="caption">[{c.s}]</div>)}</div>;
}

// The status bar never changes shape: coins, hold and hull, always. Bait and chum belong to fishing, so they show
// with the cast prompt by a school and on the fishing dial, not here.
function Status() {
  const b = G.boat, cp = cap(), k = clamp(b.hp / hpMax(), 0, 1), full = G.hold.length >= cp;
  return (
    <div class="hud-bar chip">
      <span class="seg"><Icon k="coin" size="s" /><span class="coins num">{money(G.coinsShown)}</span>
        {G.floaters.map((f, i) => <span key={i} class={'floater ' + f.kind}>{f.s}</span>)}</span>
      <span class={'seg' + (full ? ' bad' : '')} title="Fish in your hold"><Icon k="hold" size="s" /><span class="num hold">{G.hold.length}/{cp}</span>{G.hold.some(f => f.gold) && <span class="gold">★</span>}</span>
      <span class="seg" title="Hull"><Icon k="hull" size="s" /><span class="mini-bar"><Bar k={k} tone={k > 0.5 ? '' : k > 0.25 ? 'warn' : 'bad'} /></span></span>
    </div>
  );
}

// the minimap redraws whenever the boat has moved a tenth of a world unit or the clock a frame's worth (it used to step
// at 10 Hz, which read as stutter: the whole map jumped a few pixels at a time), and when the waypoint moves
const miniKey = (): string => { const b = G.boat; return `${Math.round(b.x * 10)},${Math.round(b.y * 10)},${Math.round(b.a * 100)},${Math.floor(G.t * 30)},${G.waypoint?.x},${G.waypoint?.y}`; };
/**
 * The compass, the default dial: north up, your heading, and on the rim a gold chevron toward the next step, the
 * white diamond of your waypoint and (with the sextant) a grey square toward the nearest uncharted place, the same
 * marks as the chart. The minimap setting swaps in the map.
 */
function CompassFace({ target, un, onClick }: { target: Point | null; un: Point | null; onClick: () => void }) {
  // the face is drawn once; the heading and each rim mark are their own layer turned by CSS (see .compass .turn), so
  // a turning boat only moves layers (it redrew the compass, ring and shadow included, every degree it turned)
  const deg = (a: number) => `${Math.round(a * 180 / Math.PI)}deg`;
  const b = G.boat, at = (p: Point) => deg(Math.atan2(p.y - b.y, p.x - b.x)), far = (p: Point) => Math.hypot(p.x - b.x, p.y - b.y) > 20;
  const turn = (a: string, mark: JSX.Element) => <svg class="turn" viewBox="-50 -50 100 100" style={{ rotate: a }}>{mark}</svg>;
  return (
    <div class="compass" role="img" aria-label="Compass: open the sea chart (M)" onClick={onClick} data-track="compass-open">
      <svg viewBox="-50 -50 100 100">
        <circle r="47" fill="#1b2a33" fill-opacity="0.78" />
        {Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, r0 = i % 4 ? 42 : 37; return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * 46} y2={Math.sin(a) * 46} stroke="#f0d27a" stroke-opacity={i % 4 ? 0.35 : 0.8} stroke-width={i % 4 ? 1 : 2} />; })}
        {([['E', 30, 0], ['S', 0, 30], ['W', -30, 0]] as const).map(([l, x, y]) => <text key={l} x={x} y={y} class="cpt">{l}</text>)}
      </svg>
      {turn(deg(b.a), <path d="M18 0 L-10 -7 L-5 0 L-10 7 Z" fill="#ff9a6b" stroke="#1b2a33" stroke-width="2" stroke-linejoin="round" />)}
      {un && turn(at(un), <rect x="37" y="-3.5" width="7" height="7" fill="#b8c0c6" stroke="#1b2a33" stroke-width="1.5" />)}
      {G.waypoint && far(G.waypoint) && turn(at(G.waypoint), <path d="M41 -5.5 L46.5 0 L41 5.5 L35.5 0 Z" fill="#e6efec" stroke="#1b2a33" stroke-width="1.5" />)}
      {target && far(target) && turn(at(target), <path d="M48 0 L36 -8 L39 0 L36 8 Z" fill="#f0cf6a" stroke="#1b2a33" stroke-width="1.8" stroke-linejoin="round" />)}
    </div>
  );
}
/**
 * World units across the minimap: three times the sea in view (it was a fixed 300, less than the view itself), so it
 * shows what's past the screen's edge at any ship or zoom.
 */
const miniSpan = (): number => clamp(Math.max(W, H) * 3, 1000, 4200);
const miniTerrain = terrainCache();
/** The dial top right: the compass, or the minimap if the player chose it; both open the chart. */
function Minimap({ step }: { step: Step }) {
  const un = G.up.sextant > 0 ? nearestUncharted() : null, target = guideOn() ? step.at ?? null : null;
  const draw: DrawFn = (ctx, w, h, dpr) => {
    const b = G.boat;
    drawChart(ctx, w, h, b.x, b.y, miniSpan() / w, { dpr, budget: 4, target, round: true, waypoint: G.waypoint, keep: miniTerrain });
    if (!un) return;
    // the nearest uncharted landmark: a grey square on the rim, like uncharted marks on the chart (arrows mean where you're headed)
    const a = Math.atan2(un.p.y - b.y, un.p.x - b.x), r = w / 2 - 5 * dpr, s = 3 * dpr;
    const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
    ctx.fillStyle = '#1b2a33'; ctx.fillRect(x - s - dpr, y - s - dpr, 2 * (s + dpr), 2 * (s + dpr));
    ctx.fillStyle = '#b8c0c6'; ctx.fillRect(x - s, y - s, 2 * s, 2 * s);
  };
  const open = () => { if (G.mode !== 'play') return; G.map.x = G.map.y = 0; G.mode = 'map'; sfx('move'); };
  const night = isNight(), c = dayFrac();
  const sail = boatDef().prop === 'SAIL', eff = sail ? sailEfficiency() : 0;
  const wxIcon = WX.state === 'clear' && night ? 'moon' : WX_ICON[WX.state];
  const part = night ? ', night' : c > 0.55 ? ', dusk' : '';   // the icon already shows it; the words go in the tooltip so the label never grows into the wind dial
  return (
    <div class="mini">
      <div class="ring">
        {SET.minimap ? <Canvas draw={draw} when={miniKey} live onClick={open} title="Open the sea chart (M)" data-track="minimap-open" /> : <CompassFace target={target} un={un?.p ?? null} onClick={open} />}
        <span class="n">N</span>
        <div class={'wind' + (sail ? '' : ' quiet')} title={`${windWord()}${sail ? `, sails at ${Math.round(eff * 100)}%` : ''}`}>
          <WindVane sail={sail} eff={eff} />
          {sail && <span class={'pct ' + (eff > 0.9 ? 'good' : eff > 0.6 ? '' : 'bad')}>{Math.round(eff * 100)}%</span>}
        </div>
        <span class="day" title={`Day ${dayNum()}${part}`}><Icon k={wxIcon} size="s" />Day {dayNum()}</span>
      </div>
      {G.up.radio >= 2 && <div class="chip muted forecast"><Icon k="radio" size="s" />{cap1(WX.upcoming)} in {clockText(WX.next)}</div>}
    </div>
  );
}

// the wind relative to your boat (bow up), Valheim-style: an arrow blowing across the dial, longer and with more
// streaks the stronger it blows. For sails the rim shows how well you're using it; oars and engines get a quiet version.
const windWord = (): string => WX.wind < 0.1 ? 'Light breeze' : WX.wind < 0.35 ? 'Breeze' : WX.wind < 0.7 ? 'Fresh wind' : 'Gale';
function WindVane({ sail, eff }: { sail: boolean; eff: number }) {
  // in whole degrees and quarter units: the wind eases forever, and every hair it moved redrew the vane each frame
  const rel = Math.round((windAngle() - G.boat.a) * 180 / Math.PI), len = Math.round((7 + 6 * (0.35 + 0.65 * WX.wind)) * 4) / 4;
  const rim = !sail ? '#8a949c' : eff > 0.9 ? '#9ad98f' : eff > 0.6 ? '#f2d36b' : '#ef8a72';
  return (
    <div class="vane" role="img" aria-label={`Wind ${windWord().toLowerCase()}${sail ? `, sails at ${Math.round(eff * 100)}%` : ''}`}>
      <svg viewBox="-20 -20 40 40">
        <circle r="17" fill="#1b2a33" fill-opacity="0.55" stroke={rim} stroke-width={sail ? 2.6 : 1.4} />
        <path d="M0 -8 L3 -3 L3 6 L0 8 L-3 6 L-3 -3 Z" fill="#d6c38c" stroke="#2a1f17" stroke-width="0.8" />
      </svg>
      <svg class="turn" viewBox="-20 -20 40 40" style={{ rotate: `${rel}deg` }}>
        {[-5, 5].slice(0, WX.wind > 0.35 ? 2 : 0).map(o => <line x1={o} y1={len - 2} x2={o} y2={-len + 6} stroke="#e6efec" stroke-opacity="0.45" stroke-width="1" />)}
        <line x1="0" y1={len} x2="0" y2={-len + 2} stroke="#f6eedc" stroke-width="1.8" stroke-linecap="round" />
        <path d={`M0 ${-len - 2} L4 ${-len + 4} L-4 ${-len + 4} Z`} fill="#f6eedc" />
      </svg>
    </div>
  );
}

// line tension: colour plus position, tick marks, a pattern and a word, so it reads without colour
// The fishing dial: a brass ship's instrument at the bottom, the same size from cast to landing, faded out when you
// aren't fishing. In a fight its needle reads the strain on the line over green, amber and a painted red; the outer
// rim fills gold as the fish comes in (red while it takes line back). At the bite the dial becomes the strike
// window: a sweep running down, brightest while a strike would be perfect. A plaque under the needle names the fish
// and the key; hints and warnings float above, so nothing in the dial changes size.
const R0 = 62, R1 = 76, RP = 84;                             // zone band inner/outer radius, progress ring radius
const ang = (v: number) => Math.PI * (1 - clamp(v, 0, 1));    // 0 at the left end of the dial, 1 at the right
const pt = (r: number, v: number) => `${(r * Math.cos(ang(v))).toFixed(2)} ${(-r * Math.sin(ang(v))).toFixed(2)}`;
/** An annular slice of the dial from value a to b between radii r0 and r1. */
const band = (a: number, b: number, r0 = R0, r1 = R1) => b <= a ? '' : `M${pt(r1, a)} A${r1} ${r1} 0 0 1 ${pt(r1, b)} L${pt(r0, b)} A${r0} ${r0} 0 0 0 ${pt(r0, a)} Z`;
const ring = (a: number, b: number, r: number) => b <= a ? '' : `M${pt(r, a)} A${r} ${r} 0 0 1 ${pt(r, b)}`;
let lastFish: FishLine | null = null;
function FishPanel() {
  const live: FishLine | null = G.fish && G.mode === 'play' ? G.fish : null;
  if (live) lastFish = live;
  const f = live ?? lastFish;                                // as it fades out, the dial keeps showing the last fight
  if (!f) return null;
  const sp = SPECIES[f.s.sp], lm = lineMax(), reel = f.st === 'reel', bite = f.st === 'bite', surge = reel && (f.cue ?? 0) > 0;
  const warn = reel && (surge || f.warn || f.jump || f.jumpWarn), red = clamp(f.redAt ?? 0.8 / lm, 0.56, 0.99);   // new captains get a later red
  const grace = reel && (f.grace ?? 0) > 0;                  // the first moments after the hook: the strain can't pass the amber
  let needle = 0, icon: JSX.Element = <Icon k="rod" size="s" />, title: string = f.st === 'cast' ? 'Casting…' : 'Waiting…', right: JSX.Element | null = null;
  let face: JSX.Element;
  if (bite) {
    const [perfect, total] = f.win ?? [0.3, 1], left = SET.strike === 'auto' ? 1 : clamp(1 - f.t / total, 0, 1), cut = 1 - perfect / total, now = f.t < perfect;
    needle = left; icon = <Icon k="warn" size="s" />; title = 'Bite!';
    right = <><Key k=" " pad="A" /><span class={now ? 'gold' : 'good'}>{now ? 'Perfect' : 'Strike'}</span></>;
    face = <>
      <path class="trk" d={band(0, 1)} />
      <path class="sweep" d={band(0, Math.min(left, cut))} /><path class="sweep perfect" d={band(cut, left)} />
      <path class="tick big" d={`M${pt(R0 - 4, cut)} L${pt(R1 + 3, cut)}`} />
    </>;
  } else if (reel) {
    const t = clamp(f.tension / lm, 0, 1), prog = clamp(f.prog, 0, 1);
    needle = t; icon = <Fish sp={f.s.sp} />; title = sp.name + (f.kg ? ` ~${fmtKg(f.kg)}` : '');
    const spool = f.tow ? clamp(1 - f.tow.len / SPOOL, 0, 1) : null;
    right = warn ? <span class="bad">{f.jump || f.jumpWarn ? 'Jump!' : 'Surge!'}</span> : spool != null ? <span class={spool < 0.15 ? 'bad' : 'muted'}>Spool {Math.round(spool * 100)}%</span>
      : f.stars ? <span class="stars" title={`${f.stars} of 3 stars`}>{'★'.repeat(f.stars)}<span class="off">{'★'.repeat(3 - f.stars)}</span></span> : null;
    face = <>
      <path class="z safe" d={band(0, 0.55)} /><path class="z strain" d={band(0.55, red)} /><path class="z danger" d={band(red, 1)} />
      <path class="prog-bg" d={ring(0, 1, RP)} /><path class={'prog' + (f.taking ? ' taking' : '')} d={ring(0, Math.max(0.001, prog), RP)} />
      {/* the fish itself rides the rim as it comes in, so the catch ring never reads as another strain zone */}
      <g transform={`translate(${pt(RP, prog).replace(' ', ',')})`}><circle class={'prog-head' + (f.taking ? ' taking' : '')} r="8.5" /><image href={fishIcon(f.s.sp)} x="-7" y="-7" width="14" height="14" /></g>
    </>;
  } else {
    right = f.fakeT != null && G.t - f.fakeT < 0.7 ? <span class="bad">Not yet</span> : <BaitTag />;   // a fake-out dip costs time; otherwise the bait on the hook
    face = <path class="trk" d={band(0, 1)} />;
  }
  const tip = live && G.prompt;
  return (
    <>
      <div class={'fishtip' + (tip ? '' : ' off') + (live && (bite || warn) ? ' hot' : '')} aria-live="polite"><span>{tip ? keyed(tip) : ''}</span></div>
      <div class={'fishdial' + (live ? '' : ' off') + (warn ? ' alert' : '') + (surge ? ' surge' : '') + (bite ? ' bite' : '') + (grace ? ' grace' : '') + (reel && f.stars === 3 ? ' q3' : '')} aria-hidden={!live}>
        <svg viewBox="-96 -96 192 104" class="dial">
          <path class="bezel" d={band(0, 1, 80, 95)} />
          <path class="face" d={`M-79 0 A79 79 0 0 1 79 0 Z`} />
          {face}
          {Array.from({ length: 11 }, (_, k) => <path key={k} class={'tick' + (k % 5 ? '' : ' big')} d={`M${pt(R0 - (k % 5 ? 5 : 8), k / 10)} L${pt(R0 - 1, k / 10)}`} />)}
          <g class="needle" style={{ transform: `rotate(${(needle * 180 - 90).toFixed(1)}deg)` }}>
            <path d="M-2.6 0 L0 -70 L2.6 0 Z" /><circle class="hook" cy="-70" r="2.4" />
          </g>
          <circle class="hub" r="8" /><circle class="hub-in" r="3.2" />
        </svg>
        <div class="plaque"><span class="ic">{icon}</span><span class="title">{title}</span><span class="grow" /><span class="right">{right}</span></div>
      </div>
    </>
  );
}

// After a line snaps (the fish was on and the line at breaking strain), offer Easy reel once, unless it's on
const OFFER_KEY = 'bobber-easy-reel-offered';
let reeling: FishLine | null = null, easyOffer = false;
function EasyReelOffer() {
  if (G.fish?.st === 'reel') reeling = G.fish;
  else if (reeling) {
    let asked = true;
    try { asked = !!localStorage.getItem(OFFER_KEY); } catch { }
    if (!G.fish && !G.card && reeling.tension >= lineMax() * 0.97 && !SET.reelAssist && !asked) {
      easyOffer = true;
      try { localStorage.setItem(OFFER_KEY, '1'); } catch { }
    }
    reeling = null;
  }
  if (!easyOffer || G.fish || SET.reelAssist) return null;
  return (
    <div class="chip easy-offer" role="status">
      <Icon k="reel" size="s" /><span>Line snapped. Easy reel winds by itself and never snaps</span>
      <button data-track="easy-reel-on" class="go" onClick={() => { SET.reelAssist = true; savePrefs(); easyOffer = false; }}>Turn on</button>
      <button data-track="easy-reel-no" class="x" aria-label="No thanks" onClick={() => { easyOffer = false; }}>×</button>
    </div>
  );
}

function CatchCard({ c }: { c: CatchCardState }) {
  const f = c.fish, sp = SPECIES[f.sp], firstEver = G.stats.caught === 1 && !G.stats.sold;
  const worth = money(fishValue(f)), vr = f.variant ? VARIANTS[f.variant as VariantId]?.name : null;   // what the market pays: today's featured x2 and the variant included
  return (
    <div class={'card paper' + (firstEver ? ' first' : '')}>
      <Fish sp={f.sp} size="xl" />
      <div class="grow">
        <div class={'title' + (sp.legend ? ' gold' : '')}>{vr && <span class="gold">{vr} </span>}{sp.name}{c.stars && <span class="stars" title={`${c.stars} of 3 stars`}> {'★'.repeat(c.stars)}<span class="off">{'★'.repeat(3 - c.stars)}</span></span>}</div>
        <div class="row">{fmtKg(f.kg)}{!firstEver && <span class="gold">{worth}</span>}</div>
        <div>
          {c.first && <span class="stamp bad">New species</span>}
          {c.record && <span class="stamp good">New best</span>}
          {f.trophy && <span class="stamp gold">Trophy</span>}
          {c.perfect && <span class="stamp sea">Perfect</span>}
          {f.gold && <span class="stamp gold">Golden</span>}
          {featuredToday(f.sp) && <span class="stamp good" title="Today's featured fish sell for double">×2 today</span>}
        </div>
        {c.back && <div class="small gold">The one that got away! It broke your line on day {c.back.day}{c.back.lost > 1 ? `, ${c.back.lost} times,` : ''} and still has your hook</div>}
        {c.bonus && <div class="small gold">{c.bonus}</div>}
        {firstEver && <div class="small">Your first catch! Worth about <span class="gold">{worth}</span> at the market</div>}
        <ShareButton c={c} />
      </div>
    </div>
  );
}

// past the opening quests the objective folds to its icon and distance; it opens for a few seconds when it
// changes, and on hover, and the journal (J) always has it in full
let shownText = '', changedAt = -99;
function Objective({ step, prog }: { step: Step; prog?: string | null }) {
  if (step.text !== shownText) { shownText = step.text; changedAt = G.t; }
  const open = (G.story?.i ?? 0) < 2 || G.t - changedAt < 8, w = whereText(step);
  return (
    <button data-track="objective" class={'chip objective' + (open ? '' : ' folded')} onClick={() => { G.journalBack = 'play'; G.mode = 'journal'; }}
      title="Open the journal (J)" aria-label={stepLine(step)}>
      <span class="obj-full"><NextLine step={step} prog={prog} /></span>
      <span class="obj-short row"><Icon k={step.icon} size="s" />{w ? <span class="gold">{w.split(' ').slice(0, 2).join(' ')}</span> : prog}</span>
    </button>
  );
}
function NextLine({ step, prog }: { step: Step; prog?: string | null }) {
  const w = whereText(step);
  return (
    <div class="row">
      <Icon k={step.icon} size="s" />
      <span>{step.text}{w && <>, <span class="gold" style={{ whiteSpace: 'nowrap' }}>{w}</span></>}{prog && <span class="muted"> ({prog})</span>}</span>
    </div>
  );
}

// the waypoint: how far by the route and which way it lies, a Sail button that lets the autopilot take the route,
// and a clear button
function WaypointChip() {
  const w = G.waypoint!, b = G.boat;
  const sailing = courseTarget(), there = !!sailing && Math.hypot(sailing.x - w.x, sailing.y - w.y) < 30;
  return (
    <div class="chip waypoint small">
      <i class="wp-glyph" /><span class="gold">{waypointMetres()} m</span><span class="muted">{dirTo(b.x, b.y, w.x, w.y)}</span>
      {there ? <span class="muted">sailing</span> : <button data-track="waypoint-sail" class="go" onClick={sailToWaypoint}>Sail</button>}
      <button data-track="waypoint-clear" class="x" aria-label="Clear waypoint" onClick={clearWaypoint}>×</button>
    </div>
  );
}

// a gentle first-session tip, once each
function Tip() {
  const t = tip();
  if (!t) return null;
  return (
    <div class="chip" role="status" style={{ fontSize: '0.85em', maxWidth: '22em', whiteSpace: 'normal', borderColor: 'rgba(143,184,216,0.7)', opacity: t.fade ? 0 : 1, transition: 'opacity 0.6s' }}>
      <Icon k="map" size="s" /><span>{keyed(t.text)}</span>
    </div>
  );
}

// the strike window as a draining bar: the gold stretch at the start is a perfect strike
// the catch card, captions and the fishing panel; shown even with the interface hidden (H)
function Fishing() {
  return (
    <>
      {G.card && <CatchCard c={G.card} />}
      <div class="captions-stack"><Captions /></div>
      <FishPanel />
    </>
  );
}
export function Hud() {
  tickWaypoint();
  if (!SET.hud) return <div><Fishing /></div>;
  const quest = currentQuest(), step = guide(), pr = quest && questProgress(quest);
  // a waypoint the player set takes over the on-screen arrow from the guide
  const wp: Step | null = G.waypoint ? { text: 'Waypoint', at: G.waypoint, icon: 'map', near: 25 } : null;
  return (
    <div>
      <SeaLayer step={step} wp={wp} />
      <div class="hud-left">
        <Status />
        {G.stats.caught > 0 && <Objective step={step} prog={pr && pr.want > 1 ? `${pr.have}/${pr.want}` : null} />}
        {wp && <WaypointChip />}
        {G.active.length > 0 && (
          <div class="chip contracts small">
            {G.active.map(c => { const n = Math.min(G.hold.filter(f => f.sp === c.sp).length, c.n);
              return <span class={n >= c.n ? 'good' : ''}><Fish sp={c.sp} size="s" />{n}/{c.n}</span>; })}
          </div>
        )}
        <Tip />
        <ShareChip />
        <EasyReelOffer />
      </div>
      <Minimap step={step} />
      <Fishing />
      {G.stats.caught === 1 && !G.fish && <div class="hints">
        <Hint k="Tab" pad="View">Ship</Hint><Hint k="m" pad="Y">Chart</Hint><Hint k="l" pad="LB">Log</Hint>
        <Hint k="Escape" pad="Start">Menu</Hint>{G.pet && <Hint k="p">Pet</Hint>}
      </div>}
    </div>
  );
}
