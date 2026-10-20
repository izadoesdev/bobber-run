// The sailing HUD, kept quiet: one slim status bar and one objective line top left, the minimap (with the wind and
// the day on its ring) top right, and the rest only when it matters: hull when damaged, bait by a school, contracts
// while you hold some, key hints until the first catches. The reel gauge, catch card, toasts and sailor tags sit over
// the sea; schools carry no labels, since the cast prompt names the fish and why it won't bite.
import type { JSX } from 'preact';
import { clamp, money, dirTo } from '../config';
import {
  G, cap, hpMax, boatDef, isNight, dayNum, dayFrac, windAngle, sailEfficiency, schoolActive,
  lineMax,
} from '../game';
import { SPECIES, fmtKg } from '../econ';
import { schoolsNear } from '../world';
import { WX } from '../weather';
import { SET } from '../settings';
import { EMOTES } from '../net';
import { ONLINE } from '../online';
import { currentQuest, questProgress } from '../story';
import { guide, guideOn, markerTarget, tip, whereText, type Step } from '../game/guide';
import type { CatchCard as CatchCardState, FishLine, Toast } from '../types';
import { drawChart, nearestUncharted } from './chart';
import { IslandSigns } from './island';
import { clearWaypoint, sailToWaypoint, tickWaypoint, waypointRoute } from '../waypoint';
import { courseTarget, coursePath } from '../game/autopilot';
import { BIOME_NAME, biomeAt, type BiomeId } from '../biome';
import { tickIslands } from '../islands';
import { Bar, Canvas, Fish, Hint, Icon, Key, WX_ICON, cap1, clockText, keyed, viewPct, type DrawFn } from './parts';

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

function Status() {
  const b = G.boat, cp = cap(), k = clamp(b.hp / hpMax(), 0, 1), bait = G.baitSel, full = G.hold.length >= cp;
  const fishing = !!G.fish || !!G.nearSchool;               // bait and chum only matter by a school
  return (
    <div class="hud-bar chip">
      <span class="seg"><Icon k="coin" size="s" /><span class="coins">{money(G.coinsShown)}</span>
        {G.floaters.map((f, i) => <span key={i} class={'floater ' + f.kind}>{f.s}</span>)}</span>
      <span class={'seg' + (full ? ' bad' : '')} title="Fish in your hold"><Icon k="hold" size="s" />{G.hold.length}/{cp}{G.hold.some(f => f.gold) && <span class="gold"> ★</span>}</span>
      {k < 1 && <span class="seg" title="Hull"><Icon k="hull" size="s" /><span class="mini-bar"><Bar k={k} tone={k > 0.5 ? '' : k > 0.25 ? 'warn' : 'bad'} /></span></span>}
      {fishing && <span class="seg small" title="Bait (B to switch)"><Icon k={bait === 'none' ? 'rod' : bait} size="s" />{bait === 'none' ? 'No bait' : `×${G.bait[bait] || 0}`}<Key k="b" pad="RB" /></span>}
      {fishing && (G.bait.chum || 0) > 0 && <span class="seg small" title="Chum (C)"><Icon k="chum" size="s" />{G.bait.chum}<Key k="c" /></span>}
    </div>
  );
}


function Minimap({ step }: { step: Step }) {
  const un = G.up.sextant > 0 ? nearestUncharted() : null, target = guideOn() ? step.at : null;
  const draw: DrawFn = (ctx, w, h, dpr) => {
    const b = G.boat;
    drawChart(ctx, w, h, b.x, b.y, 300 / w, { dpr, budget: 4, target, round: true, waypoint: G.waypoint });
    if (!un) return;
    // an arrow on the rim pointing at the nearest uncharted landmark
    const a = Math.atan2(un.p.y - b.y, un.p.x - b.x), r = w / 2 - 5 * dpr;
    ctx.save();
    ctx.translate(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.fillStyle = '#e07a62';
    ctx.strokeStyle = '#1b2a33';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(5 * dpr, 0);
    ctx.lineTo(-4 * dpr, -4 * dpr);
    ctx.lineTo(-4 * dpr, 4 * dpr);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };
  const night = isNight(), c = dayFrac();
  const sail = boatDef().prop === 'SAIL', eff = sail ? sailEfficiency() : 0;
  const wxIcon = WX.state === 'clear' && night ? 'moon' : WX_ICON[WX.state];
  const part = night ? ', night' : c > 0.55 ? ', dusk' : '';
  return (
    <div class="mini">
      <div class="ring"><Canvas draw={draw} /><span class="n">N</span>
        <div class={'wind' + (sail ? '' : ' quiet')} title={`${windWord()}${sail ? `, sails at ${Math.round(eff * 100)}%` : ''}`}>
          <WindVane sail={sail} eff={eff} />
          {sail && <span class={'pct ' + (eff > 0.9 ? 'good' : eff > 0.6 ? '' : 'bad')}>{Math.round(eff * 100)}%</span>}
        </div>
        <span class="day"><Icon k={wxIcon} size="s" />Day {dayNum()}{part}</span>
      </div>
      {G.up.radio >= 2 && <div class="chip muted forecast"><Icon k="radio" size="s" />{cap1(WX.upcoming)} in {clockText(WX.next)}</div>}
    </div>
  );
}

// the wind relative to your boat (bow up), Valheim-style: an arrow blowing across the dial, longer and with more
// streaks the stronger it blows. For sails the rim shows how well you're using it; oars and engines get a quiet version.
const windWord = (): string => WX.wind < 0.1 ? 'Light breeze' : WX.wind < 0.35 ? 'Breeze' : WX.wind < 0.7 ? 'Fresh wind' : 'Gale';
function WindVane({ sail, eff }: { sail: boolean; eff: number }) {
  const rel = windAngle() - G.boat.a, k = 0.35 + 0.65 * WX.wind, len = 7 + 6 * k;
  const rim = !sail ? '#8a949c' : eff > 0.9 ? '#9ad98f' : eff > 0.6 ? '#f2d36b' : '#ef8a72';
  return (
    <svg class="vane" viewBox="-20 -20 40 40" aria-label={`Wind ${windWord().toLowerCase()}${sail ? `, sails at ${Math.round(eff * 100)}%` : ''}`}>
      <circle r="17" fill="#1b2a33" fill-opacity="0.55" stroke={rim} stroke-width={sail ? 2.6 : 1.4} />
      <path d="M0 -8 L3 -3 L3 6 L0 8 L-3 6 L-3 -3 Z" fill="#d6c38c" stroke="#2a1f17" stroke-width="0.8" />
      <g transform={`rotate(${rel * 180 / Math.PI})`}>
        {[-5, 5].slice(0, WX.wind > 0.35 ? 2 : 0).map(o => <line x1={o} y1={len - 2} x2={o} y2={-len + 6} stroke="#e6efec" stroke-opacity="0.45" stroke-width="1" />)}
        <line x1="0" y1={len} x2="0" y2={-len + 2} stroke="#f6eedc" stroke-width="1.8" stroke-linecap="round" />
        <path d={`M0 ${-len - 2} L4 ${-len + 4} L-4 ${-len + 4} Z`} fill="#f6eedc" />
      </g>
    </svg>
  );
}

// line tension: colour plus position, tick marks, a pattern and a word, so it reads without colour
function Reel({ f }: { f: FishLine }) {
  const sp = SPECIES[f.s.sp], lm = lineMax(), t = clamp(f.tension / lm, 0, 1), prog = clamp(f.prog, 0, 1);
  const warn = f.warn || f.jump || f.jumpWarn;
  const [word, tone] = t > 0.8 ? ['Danger', 'bad'] : t > 0.55 ? ['Strain', 'warn'] : ['Safe', 'good'];
  return (
    <div class={'reel panel' + (warn ? ' alert' : '')}>
      <div class="row">
        <Fish sp={f.s.sp} /><span class="title">{sp.name}</span>
        {f.gold && <span class="gold"><Icon k="star" size="s" />Golden</span>}
        {f.perfect && f.t < 2.5 && !f.gold && <span class="gold">Perfect strike</span>}
        <span class="grow" />
        {warn ? <Icon k="warn" size="s" /> : SET.reelToggle && <span class="muted small">{f.reelOn ? 'Reeling' : 'Paused'}</span>}
      </div>
      <div class="meter">
        <span class="caps">Line</span>
        <div class={'gauge ' + tone}>
          <div class="zone" style={{ width: (1 - 0.8 / lm) * 100 + '%' }} />
          <i style={{ width: t * 100 + '%' }} />
          <b style={{ left: '55%' }} /><b style={{ left: '80%' }} />
        </div>
        <span class={'state ' + tone}>{word}</span>
      </div>
      <div class="meter">
        <span class="caps">Catch</span>
        <div class="gauge gold"><i style={{ width: prog * 100 + '%' }} /></div>
        <span class="state">{Math.round(prog * 100)}%</span>
      </div>
    </div>
  );
}

function CatchCard({ c }: { c: CatchCardState }) {
  const f = c.fish, sp = SPECIES[f.sp];
  return (
    <div class="card paper">
      <Fish sp={f.sp} size="xl" />
      <div class="grow">
        <div class={'title' + (sp.legend ? ' gold' : '')}>{sp.name}</div>
        <div class="row">{fmtKg(f.kg)}<span class="gold">{money(f.value)}</span></div>
        <div>
          {c.first && <span class="stamp bad">New species</span>}
          {c.record && <span class="stamp good">New best</span>}
          {f.trophy && <span class="stamp gold">Trophy</span>}
          {c.perfect && <span class="stamp sea">Perfect</span>}
          {f.gold && <span class="stamp gold">Golden</span>}
        </div>
        {c.bonus && <div class="small gold">{c.bonus}</div>}
      </div>
    </div>
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


// the objective on screen: a small bobbing pennant over it when it's in clear view, otherwise an arrow circling
// the boat that points to it, with the distance. Both keep clear of the HUD panels.
const TARGET_COL = '#f0cf6a';
let uiBox: DOMRect | null = null, panels: DOMRect[] = [], em = 16, measuredAt = -1e9;
function measure(): DOMRect | null {
  const now = performance.now();
  if (now - measuredAt > 400 || !uiBox) {
    measuredAt = now;
    const root = document.getElementById('ui');
    uiBox = root?.getBoundingClientRect() ?? null;
    em = root ? parseFloat(getComputedStyle(root).fontSize) || 16 : 16;
    panels = root ? [...root.querySelectorAll('.hud-left, .mini, .hints, .chat, .toast')].map(e => e.getBoundingClientRect()) : [];
    panels.push(...[...document.querySelectorAll('#touch .tbar, #touch .tact')].map(e => e.getBoundingClientRect()));   // touch buttons
  }
  return uiBox;
}
const covered = (x: number, y: number, pad: number): boolean =>
  panels.some(r => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
function Marker({ step, force }: { step: Step; force?: boolean }) {
  const p = force ? (G.fish || G.card || G.mode !== 'play' ? null : step.at ?? null) : markerTarget(step), box = p && measure();
  if (!p || !box) return null;
  const toPx = (wx: number, wy: number): [number, number] => {
    const [x, y] = viewPct(wx, wy);
    return [box.left + x / 100 * box.width, box.top + y / 100 * box.height];
  };
  const [tx, ty] = toPx(p.x, p.y);
  const pct = (x: number, y: number) => ({ left: (x - box.left) / box.width * 100 + '%', top: (y - box.top) / box.height * 100 + '%' });
  if (tx > box.left + 2 * em && tx < box.right - 2 * em && ty > box.top + 3 * em && ty < box.bottom - 2 * em && !covered(tx, ty - 1.6 * em, em)) {
    if (force) return null;                         // a waypoint in view has its buoy
    const bob = SET.calm ? 0 : Math.sin(G.t * 3) * 0.3;
    return (
      <div key="guide-on" aria-hidden="true" style={{ position: 'absolute', ...pct(tx, ty), transform: `translate(-50%, ${-130 - bob * 40}%)`, pointerEvents: 'none', filter: 'drop-shadow(0 0.12em 0 #000a)' }}>
        <svg viewBox="0 0 16 16" width="1.5em" height="1.5em" style={{ display: 'block' }}>
          <path d="M2.5 3 L13.5 3 L8 12.5 Z" fill={TARGET_COL} stroke="#1b2a33" stroke-width="1.5" stroke-linejoin="round" />
        </svg>
      </div>
    );
  }
  // off screen (or under a panel): an arrow on a ring around the boat, pointing the way
  const [bx, by] = toPx(G.boat.x, G.boat.y), a = Math.atan2(ty - by, tx - bx);
  let R = Math.min(box.width, box.height) * 0.3;
  while (R > 4 * em && covered(bx + Math.cos(a) * R, by + Math.sin(a) * R, 1.5 * em)) R -= em;   // pulled in past a panel
  return (
    <div key="guide-off" aria-hidden="true" style={{ position: 'absolute', ...pct(bx + Math.cos(a) * R, by + Math.sin(a) * R), transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
      <svg viewBox="0 0 16 16" width="1.6em" height="1.6em" style={{ display: 'block', transform: `rotate(${a}rad)`, filter: 'drop-shadow(0 0.12em 0 #000a)' }}>
        <path d="M14.5 8 L2.5 2.5 L5.5 8 L2.5 13.5 Z" fill={TARGET_COL} stroke="#1b2a33" stroke-width="1.4" stroke-linejoin="round" />
      </svg>
    </div>
  );
}

// the name of a region as you sail into it, once, like an area title; it waits until you've stayed a few seconds
// so a wiggle along a border doesn't flash it
let region: BiomeId | null = null, entering: BiomeId | null = null, enterT = 0, titleT = -99, checkT = -1;
function RegionTitle() {
  if (G.t - checkT > 0.5) {
    checkT = G.t;
    const here = biomeAt(G.boat.x, G.boat.y);
    if (region === null) region = here;                          // where you start is never announced
    else if (here === region) entering = null;
    else if (here !== entering) { entering = here; enterT = G.t; }
    else if (G.t - enterT > 3) { region = here; entering = null; titleT = G.t; }
  }
  const age = G.t - titleT;
  if (age > 4.5 || !region || G.mode !== 'play') return null;
  return <div class={'region-title' + (age > 3.6 ? ' out' : '')} aria-live="polite">{BIOME_NAME[region]}</div>;
}

// the waypoint: how far by the route and which way it lies, a Sail button that lets the autopilot take the route,
// and a clear button
function WaypointChip() {
  const w = G.waypoint!, b = G.boat, route = waypointRoute();
  let d = 0, ax = b.x, ay = b.y;
  for (const p of route.length ? route : [w]) { d += Math.hypot(p.x - ax, p.y - ay); ax = p.x; ay = p.y; }
  const sailing = courseTarget(), there = !!sailing && Math.hypot(sailing.x - w.x, sailing.y - w.y) < 30;
  return (
    <div class="chip waypoint small">
      <Icon k="map" size="s" /><span class="gold">{Math.max(1, Math.round(d / 10))} m</span><span class="muted">{dirTo(b.x, b.y, w.x, w.y)}</span>
      {there ? <span class="muted">sailing</span> : <button data-track="waypoint-sail" class="go" onClick={sailToWaypoint}>Sail</button>}
      <button data-track="waypoint-clear" class="x" aria-label="Clear waypoint" onClick={clearWaypoint}>×</button>
    </div>
  );
}

// the way to the waypoint (or to where the boat is sailing itself) as a trail of dots on the sea, rippling toward
// the end, with a buoy there; the route already goes round islands, so the dots never cross land
const DOT_GAP = 13, MAX_DOTS = 80;
function RouteDots() {
  const path = G.waypoint ? waypointRoute() : coursePath();
  if (!path.length || G.mode !== 'play' || G.fish) return null;
  const dots: JSX.Element[] = [], inView = (x: number, y: number) => x > -2 && x < 102 && y > -2 && y < 102;
  let ax = G.boat.x, ay = G.boat.y, t0 = DOT_GAP * 1.5, n = 0;     // the first dot a little ahead of the bow
  for (const p of path) {
    const dx = p.x - ax, dy = p.y - ay, len = Math.hypot(dx, dy);
    let t = t0;
    for (; t < len && n < MAX_DOTS; t += DOT_GAP, n++) {
      const [x, y] = viewPct(ax + dx * t / len, ay + dy * t / len);
      if (inView(x, y)) dots.push(<i key={n} style={{ left: x + '%', top: y + '%', animationDelay: -n * 0.11 + 's' }} />);
    }
    t0 = t - len; ax = p.x; ay = p.y;
  }
  const end = G.waypoint, [ex, ey] = end ? viewPct(end.x, end.y) : [-9, -9];
  return (
    <div class="route" aria-hidden="true">
      {dots}
      {end && inView(ex, ey) && (
        <svg class="buoy" viewBox="0 0 16 24" style={{ left: ex + '%', top: ey + '%' }}>
          <path d="M8 1 V9" stroke="#2a1f17" stroke-width="1.2" />
          <path d="M8.6 1.5 L14 3.6 L8.6 5.7 Z" fill="#f0cf6a" stroke="#2a1f17" stroke-width="0.8" stroke-linejoin="round" />
          <path d="M4 9 H12 L13 16 Q8 18.5 3 16 Z" fill="#e05a45" stroke="#2a1f17" stroke-width="1" stroke-linejoin="round" />
          <path d="M3.6 12.2 H12.4" stroke="#fff6dc" stroke-width="1.6" />
          <ellipse cx="8" cy="18.5" rx="6.5" ry="1.6" fill="#e6efec" fill-opacity="0.35" />
        </svg>
      )}
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
function StrikeMeter({ f }: { f: FishLine }) {
  const [perfect, total] = f.win ?? [0.3, 1], perfectNow = f.t < perfect;
  return (
    <div class="reel panel" style={{ width: '17em' }}>
      <div class="meter">
        <span class={'caps' + (perfectNow ? ' gold' : '')}>{perfectNow ? 'Perfect' : 'Strike'}</span>
        <div class={'gauge ' + (perfectNow ? 'gold' : 'good')}>
          <i style={{ width: clamp(1 - f.t / total, 0, 1) * 100 + '%' }} />
          <b style={{ left: (1 - perfect / total) * 100 + '%' }} />
        </div>
      </div>
    </div>
  );
}

// chat lines over boats: each sailor's latest filtered message (uid 'me' is ours), shown for 6 s, then fading
const CHAT_MS = 6500, CHAT_MAX = 120;
function ChatBubble({ text, at, x, y, mine }: { text: string; at: number; x: number; y: number; mine?: boolean }) {
  const age = Date.now() - at, fade = Math.min(1, Math.max(0, (CHAT_MS - age) / 500));
  return (
    <div class={'bubble say' + (mine ? ' mine' : '')} style={{ left: x + '%', top: y + '%', opacity: fade }}>
      {text.length > CHAT_MAX ? text.slice(0, CHAT_MAX - 1) + '…' : text}
    </div>
  );
}
// the species of nearby schools as a small fish, no words (spyglass 2), other sailors' name tags and greetings,
// and your own greeting
function worldLabels(): JSX.Element[] {
  const labels: JSX.Element[] = [];
  if (G.up.spyglass >= 2 && !G.fish) for (const s of schoolsNear(G.boat.x, G.boat.y, 120)) {
    if (!schoolActive(s) || s.boss) continue;
    const [x, y] = viewPct(s.x, s.y - 6);
    if (x > 4 && x < 96 && y > 30 && y < 92) {
      labels.push(<div class="label-world bare" style={{ left: x + '%', top: y + '%' }} title={SPECIES[s.sp].name}><Fish sp={s.sp} size="s" /></div>);
    }
  }
  // other sailors: a name tag, plus a speech bubble for a few seconds after they greet or chat (the newer wins)
  const now = Date.now(), fresh = (at: number) => now - at < 4500, said = SET.chat === 'off' ? new Map<string, { text: string; at: number }>() : ONLINE.chat;
  for (const s of ONLINE.sailors) {
    const [x, y] = viewPct(s.x, s.y - 22);
    if (x < 2 || x > 98 || y < 6 || y > 96) continue;
    labels.push(<div class="label-world chip sailor" key={'n' + s.uid} style={{ left: x + '%', top: y + '%' }}>{s.name}</div>);
    const line = said.get(s.uid), talking = line && now - line.at < CHAT_MS && (s.emote == null || line.at > s.emoteAt);
    if (talking) labels.push(<ChatBubble key={'c' + s.uid} text={line.text} at={line.at} x={x} y={y - 6.5} />);
    else if (s.emote != null && fresh(s.emoteAt)) {
      labels.push(<div class="bubble" key={'b' + s.uid} style={{ left: x + '%', top: y - 5 + '%' }}>{EMOTES[s.emote]}</div>);
    }
  }
  const mine = said.get('me'), [mx, my] = viewPct(G.boat.x, G.boat.y - 24);
  const emoteAt = G.myEmote ? now - (G.t - G.myEmote.t) * 1000 : -Infinity;   // game time to wall-clock time
  if (mine && now - mine.at < CHAT_MS && mine.at > emoteAt) {
    labels.push(<ChatBubble key="me-chat" text={mine.text} at={mine.at} x={mx} y={my} mine />);
  } else if (G.myEmote && G.t - G.myEmote.t < 4.5) {
    labels.push(<div class="bubble mine" key="me" style={{ left: mx + '%', top: my + '%' }}>{EMOTES[G.myEmote.i]}</div>);
  }
  return labels;
}

// the catch card, captions, the reel or strike gauge and the prompt. `quiet` (interface hidden with H) keeps only
// the prompts a catch needs; toasts stay above everything either way
function Fishing({ quiet }: { quiet?: boolean }) {
  const f = G.fish;
  return (
    <>
      {G.card && <CatchCard c={G.card} />}
      <div class="bottom-stack">
        <Captions />
        {f?.st === 'reel' && <Reel f={f} />}
        {f?.st === 'bite' && SET.strike !== 'auto' && <StrikeMeter f={f} />}
        {G.prompt && G.mode === 'play' && (f || !quiet) && (
          <div class={'prompt panel' + (f?.st === 'bite' || f?.warn ? ' hot' : '')}>{keyed(G.prompt)}</div>
        )}
      </div>
    </>
  );
}
export function Hud() {
  tickIslands(); tickWaypoint();
  if (!SET.hud) return <div><Fishing quiet /></div>;
  const quest = currentQuest(), step = guide();
  // a waypoint the player set takes over the on-screen arrow from the guide
  const wp: Step | null = G.waypoint ? { text: 'Waypoint', at: G.waypoint, icon: 'map', near: 25 } : null;
  return (
    <div>
      <RouteDots />
      <RegionTitle />
      {worldLabels()}
      <IslandSigns />
      <Marker step={wp ?? step} force={!!wp} />
      <div class="hud-left">
        <Status />
        <button data-track="objective" class="chip objective" onClick={() => { G.journalBack = 'play'; G.mode = 'journal'; }} title="Open the journal (J)">
          <NextLine step={step} prog={(() => { const pr = quest && questProgress(quest); return pr && pr.want > 1 ? `${pr.have}/${pr.want}` : null; })()} />
        </button>
        {wp && <WaypointChip />}
        {G.active.length > 0 && (
          <div class="chip contracts small">
            {G.active.map(c => { const n = Math.min(G.hold.filter(f => f.sp === c.sp).length, c.n);
              return <span class={n >= c.n ? 'good' : ''}><Fish sp={c.sp} size="s" />{n}/{c.n}</span>; })}
          </div>
        )}
        <Tip />
      </div>
      <Minimap step={step} />
      <Fishing />
      {G.stats.caught < 2 && !G.fish && <div class="hints">
        <Hint k="Tab" pad="View">Ship</Hint><Hint k="m" pad="Y">Chart</Hint><Hint k="l" pad="LB">Log</Hint>
        <Hint k="Escape" pad="Start">Menu</Hint>{G.pet && <Hint k="p">Pet</Hint>}
      </div>}
    </div>
  );
}
