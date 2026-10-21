// The sailing HUD, kept quiet: one slim status bar and one objective line top left, the minimap (with the wind and
// the day on its ring) top right, and the rest only when it matters: hull when damaged, bait by a school, contracts
// while you hold some, key hints until the first catches. The reel gauge, catch card and toasts sit at the bottom;
// what sits on the sea itself is in overlay.tsx.
import { clamp, money, dirTo } from '../config';
import { G, cap, hpMax, boatDef, isNight, dayNum, dayFrac, windAngle, sailEfficiency, lineMax } from '../game';
import { SPECIES, fmtKg } from '../econ';
import { WX } from '../weather';
import { SET } from '../settings';
import { savePrefs } from '../prefs';
import { sfx } from '../audio';
import { currentQuest, questProgress } from '../story';
import { guide, guideOn, stepLine, tip, whereText, type Step } from '../game/guide';
import type { CatchCard as CatchCardState, FishLine, Point, Toast } from '../types';
import { drawChart, nearestUncharted } from './chart';
import { SeaLayer } from './overlay';
import { ShareButton, ShareChip } from './share';
import { clearWaypoint, sailToWaypoint, tickWaypoint, waypointMetres } from '../waypoint';
import { courseTarget } from '../game/autopilot';
import { SPOOL } from '../game/fishing';
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

// hull, bait and chum stay in the bar and fold away when they don't matter, so showing one slides the bar open
// instead of jumping everything after it; bait and chum linger a moment after a school, so sailing past doesn't flicker them
let fishSeen = -99;
function Status() {
  const b = G.boat, cp = cap(), k = clamp(b.hp / hpMax(), 0, 1), bait = G.baitSel, full = G.hold.length >= cp, chum = G.bait.chum || 0;
  if (G.fish || G.nearSchool) fishSeen = G.t;
  const fishing = G.t - fishSeen < 2;
  const opt = (on: boolean, cls = '') => ({ class: `seg opt ${cls}` + (on ? '' : ' off'), 'aria-hidden': !on });
  return (
    <div class="hud-bar chip">
      <span class="seg"><Icon k="coin" size="s" /><span class="coins">{money(G.coinsShown)}</span>
        {G.floaters.map((f, i) => <span key={i} class={'floater ' + f.kind}>{f.s}</span>)}</span>
      <span class={'seg' + (full ? ' bad' : '')} title="Fish in your hold"><Icon k="hold" size="s" />{G.hold.length}/{cp}{G.hold.some(f => f.gold) && <span class="gold"> ★</span>}</span>
      <span {...opt(k < 1)} title="Hull"><Icon k="hull" size="s" /><span class="mini-bar"><Bar k={k} tone={k > 0.5 ? '' : k > 0.25 ? 'warn' : 'bad'} /></span></span>
      <span {...opt(fishing, 'small')} title="Bait (B to switch)"><Icon k={bait === 'none' ? 'rod' : bait} size="s" />{bait === 'none' ? 'No bait' : `×${G.bait[bait] || 0}`}<Key k="b" pad="RB" /></span>
      <span {...opt(fishing && chum > 0, 'small')} title="Chum (C)"><Icon k="chum" size="s" />{chum}<Key k="c" /></span>
    </div>
  );
}

// the minimap redraws when the boat has moved a minimap pixel or turned a little, and ten times a second for what
// animates on it (schools, sailors, the frenzy star); every frame it cost as much CPU as the rest of the UI
const miniKey = (): string => { const b = G.boat; return `${Math.round(b.x / 2.2)},${Math.round(b.y / 2.2)},${Math.round(b.a * 20)},${Math.floor(G.t * 10)},${G.waypoint?.x},${G.waypoint?.y}`; };
/**
 * The compass, the default dial: north up, your heading, and on the rim a gold chevron toward the next step, the
 * white diamond of your waypoint and (with the sextant) a grey square toward the nearest uncharted place, the same
 * marks as the chart. The minimap setting swaps in the map.
 */
function CompassFace({ target, un, onClick }: { target: Point | null; un: Point | null; onClick: () => void }) {
  const b = G.boat, at = (p: Point) => `rotate(${Math.atan2(p.y - b.y, p.x - b.x) * 180 / Math.PI})`, far = (p: Point) => Math.hypot(p.x - b.x, p.y - b.y) > 20;
  return (
    <svg class="compass" viewBox="-50 -50 100 100" role="img" aria-label="Compass: open the sea chart (M)" onClick={onClick} data-track="compass-open">
      <circle r="47" fill="#1b2a33" fill-opacity="0.78" />
      {Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8, r0 = i % 4 ? 42 : 37; return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * 46} y2={Math.sin(a) * 46} stroke="#f0d27a" stroke-opacity={i % 4 ? 0.35 : 0.8} stroke-width={i % 4 ? 1 : 2} />; })}
      {([['E', 30, 0], ['S', 0, 30], ['W', -30, 0]] as const).map(([l, x, y]) => <text key={l} x={x} y={y} class="cpt">{l}</text>)}
      <g transform={`rotate(${b.a * 180 / Math.PI})`}><path d="M18 0 L-10 -7 L-5 0 L-10 7 Z" fill="#ff9a6b" stroke="#1b2a33" stroke-width="2" stroke-linejoin="round" /></g>
      {un && <g transform={at(un)}><rect x="37" y="-3.5" width="7" height="7" fill="#b8c0c6" stroke="#1b2a33" stroke-width="1.5" /></g>}
      {G.waypoint && far(G.waypoint) && <g transform={at(G.waypoint)}><path d="M41 -5.5 L46.5 0 L41 5.5 L35.5 0 Z" fill="#e6efec" stroke="#1b2a33" stroke-width="1.5" /></g>}
      {target && far(target) && <g transform={at(target)}><path d="M48 0 L36 -8 L39 0 L36 8 Z" fill="#f0cf6a" stroke="#1b2a33" stroke-width="1.8" stroke-linejoin="round" /></g>}
    </svg>
  );
}
/** The dial top right: the compass, or the minimap if the player chose it; both open the chart. */
function Minimap({ step }: { step: Step }) {
  const un = G.up.sextant > 0 ? nearestUncharted() : null, target = guideOn() ? step.at ?? null : null;
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
      <div class="ring">
        {SET.minimap ? <Canvas draw={draw} when={miniKey} onClick={open} title="Open the sea chart (M)" data-track="minimap-open" /> : <CompassFace target={target} un={un?.p ?? null} onClick={open} />}
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
  const surge = (f.cue ?? 0) > 0, warn = surge || f.warn || f.jump || f.jumpWarn;   // the surge telegraph flashes before the pull
  const [word, tone] = t > 0.8 ? ['Danger', 'bad'] : t > 0.55 ? ['Strain', 'warn'] : ['Safe', 'good'];
  return (
    <div class={'reel panel' + (warn ? ' alert' : '') + (surge ? ' surge' : '') + (f.stars === 3 ? ' q3' : '')}>
      <div class="row">
        <Fish sp={f.s.sp} /><span class="title">{sp.name}</span>
        {f.stars && <span class="stars" title={`${f.stars} of 3 stars`}>{'★'.repeat(f.stars)}<span class="off">{'★'.repeat(3 - f.stars)}</span></span>}
        {f.gold && <span class="gold"><Icon k="star" size="s" />Golden</span>}
        {f.back && <span class="gold">Got away on day {f.back.day}</span>}
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
      {f.tow && <Spool tow={f.tow} />}
      <div class="meter">
        <span class="caps">Catch</span>
        <div class="gauge gold"><i style={{ width: prog * 100 + '%' }} /></div>
        <span class="state">{Math.round(prog * 100)}%</span>
      </div>
    </div>
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
        {c.back && <div class="small gold">The one that got away! It broke your line on day {c.back.day}{c.back.lost > 1 ? `, ${c.back.lost} times,` : ''} and still has your hook</div>}
        {c.bonus && <div class="small gold">{c.bonus}</div>}
        {firstEver && <div class="small">Your first catch! Worth <span class="gold">{money(f.value)}</span> at the market</div>}
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
// a towing fish takes line off the reel; when the spool runs out the strain goes on the line
function Spool({ tow }: { tow: NonNullable<FishLine['tow']> }) {
  const out = clamp(tow.len / SPOOL, 0, 1), tone = out > 0.85 ? 'bad' : out > 0.6 ? 'warn' : 'good';
  return (
    <div class="meter">
      <span class="caps">Spool</span>
      <div class={'gauge ' + tone}><i style={{ width: (1 - out) * 100 + '%' }} /></div>
      <span class={'state ' + tone}>{out > 0.85 ? 'Empty' : 'Towing'}</span>
    </div>
  );
}

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
