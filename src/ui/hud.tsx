// The sailing HUD, kept quiet: one slim status bar and one objective line top left, the minimap (with the wind and
// the day on its ring) top right, and the rest only when it matters: hull when damaged, bait by a school, contracts
// while you hold some, key hints until the first catches. The reel gauge, catch card and toasts sit at the bottom;
// what sits on the sea itself is in overlay.tsx.
import { clamp, money, dirTo } from '../config';
import { G, cap, hpMax, boatDef, isNight, dayNum, dayFrac, windAngle, sailEfficiency, lineMax } from '../game';
import { SPECIES, fmtKg } from '../econ';
import { WX } from '../weather';
import { SET } from '../settings';
import { sfx } from '../audio';
import { currentQuest, questProgress } from '../story';
import { guide, guideOn, stepLine, tip, whereText, type Step } from '../game/guide';
import type { CatchCard as CatchCardState, FishLine, Toast } from '../types';
import { drawChart, nearestUncharted } from './chart';
import { SeaLayer } from './overlay';
import { clearWaypoint, sailToWaypoint, tickWaypoint, waypointMetres } from '../waypoint';
import { courseTarget } from '../game/autopilot';
import { tickIslands } from '../islands';
import { Bar, Canvas, Fish, Hint, Icon, Key, WX_ICON, cap1, clockText, keyed, type DrawFn } from './parts';

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
      <div class="ring"><Canvas draw={draw} onClick={open} title="Open the sea chart (M)" data-track="minimap-open" /><span class="n">N</span>
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
  const f = c.fish, sp = SPECIES[f.sp], firstEver = G.stats.caught === 1 && !G.stats.sold;
  return (
    <div class={'card paper' + (firstEver ? ' first' : '')}>
      <Fish sp={f.sp} size="xl" />
      <div class="grow">
        <div class={'title' + (sp.legend ? ' gold' : '')}>{sp.name}</div>
        <div class="row">{fmtKg(f.kg)}{!firstEver && <span class="gold">{money(f.value)}</span>}</div>
        <div>
          {c.first && <span class="stamp bad">New species</span>}
          {c.record && <span class="stamp good">New best</span>}
          {f.trophy && <span class="stamp gold">Trophy</span>}
          {c.perfect && <span class="stamp sea">Perfect</span>}
          {f.gold && <span class="stamp gold">Golden</span>}
        </div>
        {c.bonus && <div class="small gold">{c.bonus}</div>}
        {firstEver && <div class="small">Your first catch! Worth <span class="gold">{money(f.value)}</span> at the market</div>}
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

// the catch card, captions, the reel or strike gauge and the fishing prompt; shown even with the interface hidden (H)
function Fishing() {
  const f = G.fish;
  return (
    <>
      {G.card && <CatchCard c={G.card} />}
      <div class="bottom-stack">
        <Captions />
        {f?.st === 'reel' && <Reel f={f} />}
        {f?.st === 'bite' && SET.strike !== 'auto' && <StrikeMeter f={f} />}
        {G.prompt && G.mode === 'play' && f && (
          <div class={'prompt panel' + (f.st === 'bite' || f.warn ? ' hot' : '')}>{keyed(G.prompt)}</div>
        )}
      </div>
    </>
  );
}
export function Hud() {
  tickIslands(); tickWaypoint();
  if (!SET.hud) return <div><Fishing /></div>;
  const quest = currentQuest(), step = guide(), pr = quest && questProgress(quest);
  // a waypoint the player set takes over the on-screen arrow from the guide
  const wp: Step | null = G.waypoint ? { text: 'Waypoint', at: G.waypoint, icon: 'map', near: 25 } : null;
  return (
    <div>
      <SeaLayer step={step} wp={wp} />
      <div class="hud-left">
        <Status />
        <Objective step={step} prog={pr && pr.want > 1 ? `${pr.have}/${pr.want}` : null} />
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
