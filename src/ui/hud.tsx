// The sailing HUD: status panel, minimap and chips, the reel gauge, catch card, toasts and world labels.
import type { JSX } from 'preact';
import { W, H, clamp } from '../config';
import {
  G, cap, hpMax, boatDef, sonarLvl, isNight, dayNum, dayFrac, windAngle, sailEfficiency, schoolActive,
  lineMax, nextProject, needStatus, currentGoal,
} from '../game';
import { SPECIES, SUPPLIES, PROJECTS, fmtKg } from '../econ';
import { favBait } from '../species';
import { schoolInReach } from '../game/fishing';
import { schoolMood } from '../game/schools';
import { schoolsNear, cellPois } from '../world';
import { WX } from '../weather';
import { SET } from '../settings';
import { NET, EMOTES } from '../net';
import { ONLINE } from '../online';
import { currentQuest, questProgress } from '../story';
import type { CatchCard as CatchCardState, FishLine, Poi, School, Toast } from '../types';
import { drawChart, nearestUncharted } from './chart';
import { fishIcon } from './icons';
import { Bar, Canvas, Fish, Hint, Icon, Key, keyed, money, type DrawFn } from './parts';

// stable keys so a toast keeps its element (and its fade) as older ones leave
const toastIds = new WeakMap<Toast, number>();
let toastN = 0;
const TOAST_ICON: Partial<Record<Toast['kind'], string>> = { good: 'star', bad: 'warn' };

/** `low`: outside the sailing view, only the two newest, tucked lower. */
export function Toasts({ low }: { low: boolean }) {
  const shown = low ? G.toasts.slice(-2) : G.toasts;
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
  const b = G.boat, cp = cap(), k = clamp(b.hp / hpMax(), 0, 1), bait = G.baitSel;
  return (
    <div class="hud-status panel">
      <div class="row">
        <Icon k="coin" /><span class="coins">{money(G.coinsShown)}</span>
        {G.floaters.map((f, i) => <span key={i} class={'floater ' + f.kind}>{f.s}</span>)}
      </div>
      <div class="row gap-t">
        <Icon k="hold" size="s" /><span class="caps">Hold</span>
        <span class={'num' + (G.hold.length >= cp ? ' bad' : '')}>{G.hold.length}/{cp}</span>
      </div>
      {cp <= 18
        ? <div class="slots">{Array.from({ length: cp }, (_, i) => <div class="slot">{G.hold[i] && <img src={fishIcon(G.hold[i].sp)} alt="" />}</div>)}</div>
        : <div class="gap-t"><Bar k={G.hold.length / cp} tone="gold" /></div>}
      <div class="row gap-t">
        <Icon k="hull" size="s" /><span class="caps">Hull</span>
        <div class="grow"><Bar k={k} tone={k > 0.5 ? '' : k > 0.25 ? 'warn' : 'bad'} /></div>
        <span class="num">{Math.ceil(b.hp)}</span>
      </div>
      <div class="row gap-t small">
        <Icon k={bait === 'none' ? 'rod' : bait} size="s" />
        <span>{bait === 'none' ? 'No bait' : `${SUPPLIES[bait].name} ×${G.bait[bait] || 0}`}</span>
        <Key k="b" pad="RB" />
        <span class="grow" /><Icon k="chum" size="s" />{G.bait.chum || 0}<Key k="c" />
      </div>
    </div>
  );
}

// the nearest charted port, from the ids of everything found so far
function nearestKnownPort(): { p: Poi; d: number } | null {
  const b = G.boat;
  let best: Poi | null = null, bd = 1e9;
  for (const id of G.found) {
    const m = /^port:(-?\d+),(-?\d+)$/.exec(id);
    if (!m) continue;
    const p = cellPois(+m[1], +m[2]).find(q => q.id === id);
    if (!p) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { p: best, d: bd } : null;
}

const WX_CHIP_ICON = { storm: 'storm', rain: 'rain', cloudy: 'cloud' } as const;
const clockText = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

function Minimap() {
  const un = G.up.sextant > 0 ? nearestUncharted() : null;
  const draw: DrawFn = (ctx, w, h, dpr) => {
    const b = G.boat;
    drawChart(ctx, w, h, b.x, b.y, 300 / w, { dpr, budget: 4, sonar: sonarLvl() });
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
  const port = nearestKnownPort();
  const night = isNight(), c = dayFrac();
  const sail = boatDef().prop === 'SAIL', eff = sail ? sailEfficiency() : 0;
  const wxIcon = WX.state === 'clear' ? (night ? 'moon' : 'sun') : WX_CHIP_ICON[WX.state];
  const part = night ? ', night' : c > 0.55 ? ', dusk' : '';
  return (
    <div class="mini">
      <div class="ring"><Canvas draw={draw} /><span class="n">N</span></div>
      <div class="chips">
        {port && <div class="chip"><Icon k="anchor" size="s" />{port.p.name}<span class="gold">{Math.round(port.d / 10)} m</span></div>}
        <div class="chip"><Icon k={wxIcon} size="s" />Day {dayNum()}{part}{WX.state !== 'clear' ? `, ${WX.state}` : ''}</div>
        {sail && (
          <div class="chip">
            <Icon k="arrow" size="s" style={{ transform: `rotate(${windAngle()}rad)` }} />
            Wind <span class={eff > 0.9 ? 'good' : eff > 0.6 ? '' : 'bad'}>{Math.round(eff * 100)}%</span>
          </div>
        )}
        {G.up.radio >= 2 && (
          <div class="chip muted"><Icon k="radio" size="s" />{WX.upcoming[0].toUpperCase() + WX.upcoming.slice(1)} in {clockText(WX.next)}</div>
        )}
        {un && <div class="chip"><Icon k="sextant" size="s" />Uncharted <span class="gold">{Math.round(un.d / 10)} m</span></div>}
      </div>
    </div>
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
        {warn
          ? <span class="callout"><Icon k="warn" size="s" />{f.jump || f.jumpWarn ? 'It jumps. Let go!' : 'It runs. Ease off!'}</span>
          : SET.reelToggle && <span class="muted small">{f.reelOn ? 'Reeling' : 'Paused'}</span>}
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
          {c.record && <span class="stamp good">Record</span>}
          {f.trophy && <span class="stamp gold">Trophy</span>}
          {c.perfect && <span class="stamp sea">Perfect</span>}
          {f.gold && <span class="stamp gold">Golden</span>}
        </div>
        {c.bonus && <div class="small gold">{c.bonus}</div>}
      </div>
    </div>
  );
}

type Quest = NonNullable<ReturnType<typeof currentQuest>>;
// the story quest in progress, with its objective
function QuestChip({ q }: { q: Quest }) {
  const pr = questProgress(q);
  return (
    <div class="chip quest">
      <Icon k={q.by} size="s" /><span class="gold">{q.title}</span><span>{q.goal}</span>
      {pr && pr.want > 1 ? <span class="muted">{pr.have}/{pr.want}</span> : ''}
      <Key k="j" />
    </div>
  );
}

// the long goal once the story is done: the next Alderhaven project and how close you are
function HarbourChip() {
  const pr = nextProject();
  if (!pr || G.stats.caught < 1) return null;
  const st = needStatus(pr.need), done = PROJECTS.indexOf(pr);
  return (
    <div class="chip harbour">
      <Icon k="anchor" size="s" /><span class="muted">Alderhaven {done}/{PROJECTS.length}</span>{pr.name}
      <span class={st.have >= st.want ? 'good' : ''}>{st.have}/{st.want}</span>
      <span class={G.coins >= pr.cost ? 'good' : 'gold'}>{money(pr.cost)}</span>
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

// world position -> percent of the view, for labels pinned over the canvas
const viewPct = (x: number, y: number): [number, number] => [(x - G.cam.x) / W * 100, (y - G.cam.y) / H * 100];

const MOOD_NOTE = { biting: '', scattered: 'regrouping', empty: 'fished out' } as const;
// the school in reach: what it is ("?" until logged), its favourite bait, a golden fish, and why it won't bite
function SchoolTag({ s }: { s: School }) {
  const sp = SPECIES[s.sp], mood = schoolMood(s), fav = favBait(sp), [x, y] = viewPct(s.x, s.y - 9);
  if (x < 3 || x > 97 || y < 8 || y > 94) return null;
  const note = MOOD_NOTE[mood] || (sp.rod > G.up.rod ? `needs rod ${sp.rod + 1}` : '');
  return (
    <div class={'label-world chip row' + (sp.legend ? ' gold' : '')} key="school-tag" style={{ left: x + '%', top: y + '%', gap: '0.3em' }}>
      <Fish sp={s.sp} size="s" />
      <span>{sp.name}</span>
      {!G.log[sp.id] && <span class="gold" title="Not in your logbook yet">?</span>}
      {s.gold && mood !== 'empty' && <Icon k="star" size="s" />}
      <Icon k={fav} size="s" style={{ opacity: G.baitSel === fav ? 1 : 0.5 }} />
      {note && <span class="muted">{note}</span>}
    </div>
  );
}

// the tag for the school in reach, school names (spyglass 2), other sailors' name tags and greetings, and your own greeting
function worldLabels(): JSX.Element[] {
  const labels: JSX.Element[] = [];
  const tagged = G.fish ? (G.fish.st === 'reel' ? null : G.fish.s) : schoolInReach();
  if (tagged) labels.push(<SchoolTag s={tagged} />);
  if (G.up.spyglass >= 2) for (const s of schoolsNear(G.boat.x, G.boat.y, 120)) {
    if (!schoolActive(s) || s.boss || s === tagged) continue;
    const [x, y] = viewPct(s.x, s.y - 6);
    if (x > 4 && x < 96 && y > 30 && y < 92) {
      labels.push(<div class={'label-world chip' + (SPECIES[s.sp].legend ? ' gold' : '')} style={{ left: x + '%', top: y + '%' }}>{SPECIES[s.sp].name}</div>);
    }
  }
  // other sailors: a name tag, plus a speech bubble for a few seconds after they greet
  const fresh = (at: number) => Date.now() - at < 4500;
  for (const s of ONLINE.sailors) {
    const [x, y] = viewPct(s.x, s.y - 22);
    if (x < 2 || x > 98 || y < 6 || y > 96) continue;
    labels.push(<div class="label-world chip sailor" key={'n' + s.uid} style={{ left: x + '%', top: y + '%' }}>{s.name}</div>);
    if (s.emote != null && fresh(s.emoteAt)) {
      labels.push(<div class="bubble" key={'b' + s.uid} style={{ left: x + '%', top: y - 5 + '%' }}>{EMOTES[s.emote]}</div>);
    }
  }
  if (G.myEmote && G.t - G.myEmote.t < 4.5) {
    const [x, y] = viewPct(G.boat.x, G.boat.y - 24);
    labels.push(<div class="bubble mine" key="me" style={{ left: x + '%', top: y + '%' }}>{EMOTES[G.myEmote.i]}</div>);
  }
  return labels;
}

function netText(): string {
  if (NET.status === 'connecting') return 'Connecting';
  if (NET.status !== 'online') return 'Offline';
  const n = ONLINE.sailors.length;
  return n ? n + ' sailor' + (n > 1 ? 's' : '') + ' nearby' : 'Online';
}

export function Hud() {
  const gl = currentGoal(), quest = currentQuest();
  return (
    <div>
      {worldLabels()}
      <div class="hud-left">
        <Status />
        {!quest && (
          <div class="goal chip">
            <Icon k="star" size="s" />
            <span>{gl.text}{gl.prog ? <> <span class="muted">{gl.prog[0]}/{gl.prog[1]}</span></> : ''}</span>
            {gl.reward ? <span class="gold">{money(gl.reward)}</span> : ''}
          </div>
        )}
        {quest ? <QuestChip q={quest} /> : <HarbourChip />}
        {G.active.map(c => {
          const n = G.hold.filter(f => f.sp === c.sp).length;
          return (
            <div class="chip">
              <Fish sp={c.sp} size="s" />{c.n} {SPECIES[c.sp].name}<span class="muted">to {c.toName}</span>
              <span class={n >= c.n ? 'good' : ''}>{Math.min(n, c.n)}/{c.n}</span>
            </div>
          );
        })}
      </div>
      <Minimap />
      {NET.on && <div class="net-chip chip"><span class={'dot ' + NET.status} />{netText()}</div>}
      {G.card && <CatchCard c={G.card} />}
      <div class="bottom-stack">
        <Captions />
        {G.fish?.st === 'reel' && <Reel f={G.fish} />}
        {G.fish?.st === 'bite' && SET.strike !== 'auto' && <StrikeMeter f={G.fish} />}
        {G.prompt && G.mode === 'play' && (
          <div class={'prompt panel' + (G.fish?.st === 'bite' || G.fish?.warn ? ' hot' : '')}>{keyed(G.prompt)}</div>
        )}
      </div>
      <div class="hints">
        <Hint k="Tab" pad="View">Ship</Hint><Hint k="m" pad="Y">Chart</Hint><Hint k="l" pad="LB">Log</Hint>
        <Hint k="Escape" pad="Start">Menu</Hint>{G.pet && <Hint k="p">Pet {G.pet.name}</Hint>}
      </div>
    </div>
  );
}
