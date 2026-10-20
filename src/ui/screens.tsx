// Full-screen documents and panels: the sea chart, the logbook, the ship and hold, and the story journal.
import { clamp, money } from '../config';
import { G, logged, cap, hpMax, boatDef, equipment, fishValue, speedMul, deckLvl, deckBoat, ownedLvl, smallFry, releaseSmallFry, toggleHelper, SMALL_FRY, buyFishChart, fishChartPrice, chartable } from '../game';
import { track } from '../analytics';
import { isRunningNow } from '../tides';
import { SPECIES, UPGRADES, PAINTS, SUPPLIES, fmtKg } from '../econ';
import { homePort, claimableNear, heightAt } from '../world';
import { livesAt } from '../species';
import { setWaypoint, clearWaypoint } from '../waypoint';
import { openIsland } from './island';
import { NET } from '../net';
import { QUESTS, CHAPTERS, PEOPLE, currentQuest, questProgress, story } from '../story';
import { guide, guideOn, stepLine } from '../game/guide';
import type { UpgradeKey } from '../types';
import { drawChart, compassRose, zoneKnown } from './chart';
import { Bar, Canvas, Cell, Fish, Hint, Icon, Key, Pips, boatPreview, type DrawFn } from './parts';

// ---------- chart ----------
let drag: [number, number] | null = null, moved = 0;
// a click (not a drag) on the chart: an island opens its card; anywhere else sets the waypoint
function chartClick(e: PointerEvent, base: number): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = G.boat.x + G.map.x + (e.clientX - r.left - r.width / 2) * base, y = G.boat.y + G.map.y + (e.clientY - r.top - r.height / 2) * base;
  const isle = claimableNear(x, y, 10).find(c => Math.hypot(c.x - x, c.y - y) < c.R * 0.8);
  if (isle) openIsland(isle.key, 'map'); else setWaypoint(x, y);
}
export function Chart() {
  const m = G.map, base = m.zoom === 1 ? 2.2 : 4.6;           // world units per CSS pixel
  const step = guide(), target = guideOn() ? step.at : null;
  const draw: DrawFn = (ctx, w, h, dpr) => {
    drawChart(ctx, w, h, G.boat.x + m.x, G.boat.y + m.y, base / dpr, { dpr, labels: true, grid: true, budget: 10, sextant: G.up.sextant, target, waypoint: G.waypoint, islands: true, zone: m.zoneSp });
    compassRose(ctx, w - 60 * dpr, h - 64 * dpr, 40 * dpr);
  };
  const hp = homePort();
  return (
    <div class="screen paper doc">
      <header class="head">
        <h1>Sea chart</h1>
        <div class="legend">
          <span><i class="lg port" />Port</span><span><i class="lg light" />Lighthouse</span><span><i class="lg wreck" />Wreck</span>
          <span><i class="lg treasure" />Treasure</span><span><Icon k="star" size="s" />Feeding frenzy</span><span><i class="lg unknown" />Uncharted</span>
          {target && <span><i class="lg" style={{ background: 'none', border: '0.16em solid #f0cf6a', borderRadius: '50%', boxShadow: '0 0 0 0.08em #1b2a33' }} />Next step</span>}
        </div>
      </header>
      <div class="chartwrap">
        {m.zoneSp != null && <div class="chip zone-on"><Fish sp={m.zoneSp} size="s" /><span>{G.log[SPECIES[m.zoneSp].id] ? SPECIES[m.zoneSp].name : 'Unknown fish'}{zoneKnown(m.zoneSp) ? ': gold water is where it lives' : ''}{G.log[SPECIES[m.zoneSp].id]?.at?.length ? ', pins are where you caught it' : ''}</span>
          {nearestHome(m.zoneSp) && <button class="btn small-btn" onClick={() => { const p = nearestHome(m.zoneSp!); if (p) setWaypoint(p.x, p.y); }}>Waypoint to nearest</button>}
          <button class="x" aria-label="Stop showing this fish" onClick={() => { m.zoneSp = null; }}>×</button></div>}
        <Canvas
          draw={draw}
          onPointerDown={e => { if (e.button !== 0) return; drag = [e.clientX, e.clientY]; moved = 0; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => {
            if (!drag) return;
            m.x -= (e.clientX - drag[0]) * base;
            m.y -= (e.clientY - drag[1]) * base;
            moved += Math.hypot(e.clientX - drag[0], e.clientY - drag[1]);
            drag = [e.clientX, e.clientY];
          }}
          onPointerUp={e => { if (drag && moved < 6) chartClick(e, base); drag = null; }}
          onContextMenu={e => { e.preventDefault(); clearWaypoint(); }}
          onWheel={e => { m.zoom = e.deltaY > 0 ? 2 : 1; }}
        />
      </div>
      <footer class="foot">
        <span>{guideOn() && <><span class="gold">Next:</span> {stepLine(step)}. </>}{hp.name} is {Math.round(Math.hypot(G.boat.x - hp.x, G.boat.y - hp.y) / 10)} m away. Your position: {Math.round(G.boat.x / 10)}, {Math.round(G.boat.y / 10)}.</span>
        <span class="hints-inline"><span class="hint muted">Click the sea for a waypoint, an island to buy or view it</span>{G.waypoint && <button data-track="chart-waypoint-clear" class="btn small-btn" onClick={clearWaypoint}>Clear waypoint</button>}<Hint k="ArrowUp" pad="Stick">Move, or drag</Hint><Hint k="z">Zoom</Hint><Hint k="m" pad="Y">Close</Hint></span>
      </footer>
    </div>
  );
}

// ---------- logbook ----------
const WHEN: Record<string, string> = { any: 'Any time', day: 'By day', night: 'At night', twilight: 'At dusk or dawn' };
const WX_TXT: Record<string, string> = { any: '', rain: ', in rain', storm: ', in storms' };
const FIGHTS: Record<string, string> = {
  steady: 'Pulls steadily', darter: 'Darts off suddenly', generic: 'Pulls hard in bursts', jumper: 'Jumps. Stop reeling while it is in the air', erratic: 'Pulls in random directions', boss: 'Fights in three rounds',
};
// ---------- fish charts ----------
/** Where to centre the chart for a species: your nearest catch spot, else the nearest water it lives in (searched outward). */
let homeKey = '', homeAt: { x: number; y: number } | null = null;   // the search below is too slow to repeat every frame
function nearestHome(sp: number): { x: number; y: number } | null {
  const b = G.boat, spots = G.log[SPECIES[sp].id]?.at ?? [];
  const key = `${sp}:${Math.round(b.x / 100)},${Math.round(b.y / 100)}:${spots.length}:${zoneKnown(sp)}`;
  if (key === homeKey) return homeAt;
  homeKey = key;
  return homeAt = findHome(sp, spots);
}
function findHome(sp: number, spots: [number, number][]): { x: number; y: number } | null {
  const b = G.boat;
  if (spots.length) { const [x, y] = spots.reduce((a, s) => Math.hypot(s[0] - b.x, s[1] - b.y) < Math.hypot(a[0] - b.x, a[1] - b.y) ? s : a); return { x, y }; }
  if (!zoneKnown(sp) || SPECIES[sp].special) return null;
  for (let r = 150; r <= 6000; r += 150) for (let k = 0, n = Math.ceil(r / 40); k < n; k++) {
    const a = k / n * Math.PI * 2, x = b.x + Math.cos(a) * r, y = b.y + Math.sin(a) * r, h = heightAt(x, y);
    if (h < -0.07 && livesAt(sp, x, y, h)) return { x, y };
  }
  return null;
}
/** Open the sea chart on a species: its waters (if known), your catch spots, centred on the nearest of them. */
export function showOnChart(sp: number, how: 'logbook' | 'chart' = 'logbook'): void {
  const m = G.map, p = nearestHome(sp);
  m.zoneSp = sp; m.zoom = 2;
  if (p) { m.x = p.x - G.boat.x; m.y = p.y - G.boat.y; }
  G.mode = 'map';
  track('fish_chart_opened', { species: SPECIES[sp].id, how });
}
function FishChartRow({ sp }: { sp: number }) {
  const s = SPECIES[sp], e = G.log[s.id], known = zoneKnown(sp), price = fishChartPrice(sp), spots = e?.at?.length ?? 0;
  return (
    <div class="fish-chart">
      {(e || known) && <button data-track="fish-show-on-chart" class="btn small-btn" onClick={() => showOnChart(sp)}>Show on chart</button>}
      {chartable(sp) && !known && <button data-track="fish-chart-buy" class="btn small-btn" disabled={G.coins < price} onClick={() => buyFishChart(sp)}>Buy its chart · {money(price)}</button>}
      <span class="muted small">{s.legend ? 'Legends are on no chart. Follow the stories.'
        : known ? `Its waters are on your chart${spots ? `, with ${spots} spot${spots === 1 ? '' : 's'} where you caught it` : ''}.`
        : e ? `Catch ${5 - e.n} more to learn where it lives, or buy its chart.`
        : 'Buy its chart to see where it lives, before you ever catch one.'}</span>
    </div>
  );
}
export function Logbook() {
  const sel = clamp(G.logSel || 0, 0, SPECIES.length - 1), s = SPECIES[sel], e = G.log[s.id], world = NET.records[s.id];
  return (
    <div class="screen paper doc flush">
      <div class="journal">
        <div class="page">
          <header class="head"><h1>Logbook</h1><span class="muted">{logged()} of {SPECIES.length} species</span></header>
          <div class="lgrid">{SPECIES.map((sp, i) => (
            <Cell cls="lcell" sel={i === sel} onClick={() => { G.logSel = i; }}>
              <Fish sp={i} size="l" cls={G.log[sp.id] ? '' : 'sil'} />{G.log[sp.id]?.trophy && <Icon k="star" size="s" cls="corner" />}
              {isRunningNow(sp.id) && <span class="running-dot" title="Running this week" />}
            </Cell>
          ))}</div>
        </div>
        <div class="page">
          <div class="hero"><Fish sp={sel} cls={'huge' + (e ? '' : ' sil')} /></div>
          <h2 class={'center-t' + (s.legend ? ' gold' : '')}>{e ? s.name : 'Unknown species'}</h2>
          <div class="center-t">{isRunningNow(s.id) && <span class="stamp good" title="Sells for a quarter more this week, and has its own weekly board">Running this week</span>}{s.legend && <span class="stamp gold">Legend</span>}{e?.trophy && <span class="stamp bad">Trophy caught</span>}</div>
          <dl class="facts">
            <dt>Where</dt><dd>{s.where}</dd>
            <dt>When</dt><dd>{WHEN[s.time]}{WX_TXT[s.weather]}</dd>
            <dt>Rod</dt><dd class={s.rod > G.up.rod ? 'bad' : 'good'}>Level {s.rod + 1}{s.rod > G.up.rod ? '. Yours is too weak' : ''}</dd>
            {s.deck > 0 && <><dt>Boat</dt><dd class={s.deck > deckLvl() ? 'bad' : 'good'}>{deckBoat(sel).name}{s.deck < 2 ? ' or larger' : ''}{s.deck > deckLvl() ? '. Yours is too small' : ''}</dd></>}
            <dt>Worth</dt><dd class="gold">About {money(s.base)}</dd>
            <dt>Fights</dt><dd>{FIGHTS[s.fight]}</dd>
            {e && <><dt>Caught</dt><dd>{e.n}</dd><dt>Your best</dt><dd>{fmtKg(e.best)}</dd></>}
            {world && <><dt>World record</dt><dd class="gold">{fmtKg(world.kg)} by {world.name}</dd></>}
          </dl>
          <FishChartRow sp={sel} />
        </div>
      </div>
      <footer class="foot">
        <span>Caught {G.stats.caught}, trophies {G.stats.trophies}, earned {money(G.earned)}</span>
        <span class="hints-inline"><Hint k="ArrowLeft" k2="ArrowRight" pad="D-pad">Browse</Hint><Hint k="l" pad="LB">Close</Hint></span>
      </footer>
    </div>
  );
}

// ---------- ship + hold ----------
// a golden fish (always a trophy too) gets a small gold coin badge in place of the trophy star
const GOLD_DOT = { display: 'inline-block', width: '0.75em', height: '0.75em', borderRadius: '50%', background: 'radial-gradient(circle at 35% 35%, #fff6d6, #f0cf6a 45%, #b0832a)', boxShadow: '0 0 0 0.1em #1b2a33', verticalAlign: 'middle' } as const;
const BAITS = ['shrimp', 'glow', 'chum'] as const;
export function Ship() {
  const bd = boatDef(), cp = cap(), sel = G.hold[G.shipSel];
  let tot = 0, kg = 0;
  for (const f of G.hold) { tot += fishValue(f); kg += f.kg; }
  // species index -> fish wanted by active contracts
  const need = new Map<number, number>();
  for (const c of G.active) need.set(c.sp, (need.get(c.sp) || 0) + c.n);
  const fitted = (Object.keys(UPGRADES) as UpgradeKey[]).filter(k => G.up[k] > 0);
  // helpers you own (or your boat carries) can be switched off without selling them
  const helpers = ([['deckhand', 'Deckhand', 'Sometimes lands a second, smaller fish from the same school'], ['net', 'Drift net', 'Catches small fish while you drift slowly over them'], ['pots', 'Crab pots', 'Haul a crab into your hold now and then']] as const).filter(([k]) => ownedLvl(k) > 0);
  const fry = smallFry().length;
  return (
    <div class="screen panel rivets">
      <header class="head">
        <div><h1>{bd.name}</h1><div class="sub">{PAINTS.find(p => p.id === G.paint)?.name} paint. {bd.what}.</div></div>
        <div class="row"><span class="caps">Hold worth</span><span class="coins">{money(tot)}</span><span class="muted">{fmtKg(kg)}</span></div>
      </header>
      <div class="body">
        <div class="col side">
          <Canvas cls="preview" draw={boatPreview(bd.id, equipment(), 8)} />
          <div class="stat"><span class="caps">Speed</span><Bar k={speedMul() / 3.1} /><span class="num">{Math.round(speedMul() * 100)}%</span></div>
          <div class="stat"><span class="caps">Hull</span><Bar k={G.boat.hp / hpMax()} /><span class="num">{Math.max(0, Math.ceil(G.boat.hp))}/{hpMax()}</span></div>
          <div class="stat"><span class="caps">Hold</span><Bar k={G.hold.length / cp} tone="gold" /><span class="num">{G.hold.length}/{cp}</span></div>
          <div class="row wrap">
            {BAITS.map(k => <span class="row" title={SUPPLIES[k].name}><Icon k={k} size="s" />{G.bait[k] || 0}</span>)}
            <span class="row" title="Treasure maps"><Icon k="map" size="s" />{G.maps.length}</span>
          </div>
          {G.pet && <div class="well pad row"><span class="cat-dot" />Ship's cat: <span class="gold">{G.pet.name}</span><span class="grow" /><Hint k="p">Pet</Hint></div>}
        </div>
        <div class="col">
          <div class="hold-grid">{Array.from({ length: cp }, (_, i) => {
            const f = G.hold[i];
            if (!f) return <div class="fcard empty" />;
            return (
              <Cell cls="fcard" sel={i === G.shipSel} onClick={() => { G.shipSel = i; }}>
                <Fish sp={f.sp} size="l" /><div><div>{fmtKg(f.kg)}</div><div class="gold">{money(fishValue(f))}</div></div>
                <span class="badges">{f.gold ? <i style={GOLD_DOT} title="Golden" /> : f.trophy && <Icon k="star" size="s" />}{need.get(f.sp) && <Icon k="map" size="s" />}</span>
              </Cell>
            );
          })}</div>
          <div class="well pad row">{sel
            ? <>
              <Fish sp={sel.sp} size="s" /><span class="gold">{SPECIES[sel.sp].name}</span>
              <span>{fmtKg(sel.kg)}{sel.gold ? ', golden' : ''}{sel.trophy ? ', trophy' : ''}{need.get(sel.sp) ? ', wanted for a contract' : ''}</span><span class="grow" />
              <button data-track="release-fish" class="btn" onClick={() => { G.pressed.add('x'); }}>Release<Key k="x" /></button>
            </>
            : <span class="muted">Your hold is empty. Go fishing!</span>}</div>
          {fry > 0 && <div class="well pad row"><span class="grow">{fry} small fish worth under {money(SMALL_FRY)} each. Fish kept for contracts and the harbour stay.</span>
            <button data-track="release-small" class="btn" onClick={releaseSmallFry}>Release small fish</button></div>}
        </div>
        <div class="col side">
          <div class="list-head caps">Upgrades</div>
          {fitted.map(k => {
            const u = UPGRADES[k];
            return (
              <div class="item static">
                <Icon k={k} /><div class="grow"><div>{u.name(bd)}</div><div class="sub">{u.lv[G.up[k] - 1]}</div></div><Pips n={G.up[k]} of={u.costs.length} />
              </div>
            );
          })}
          {!fitted.length && <p class="muted">No upgrades yet. Buy them in the Outfitter tab at any port.</p>}
          {helpers.length > 0 && <>
            <div class="list-head caps">Helpers</div>
            {helpers.map(([k, name, what]) => (
              <div class="item static helper">
                <Icon k={k} /><div class="grow"><div>{name}</div><div class="sub">{what}</div></div>
                <button data-track={`helper-${k}`} class={'btn small-btn' + (G.gearOff[k] ? '' : ' on')} aria-pressed={!G.gearOff[k]} onClick={() => toggleHelper(k)}>{G.gearOff[k] ? 'Off' : 'On'}</button>
              </div>
            ))}
          </>}
        </div>
      </div>
      <footer class="foot">
        <span class="hints-inline"><Hint k="ArrowLeft" k2="ArrowRight" pad="D-pad">Choose fish</Hint><Hint k="x">Release</Hint></span>
        <Hint k="Tab" pad="B">Close</Hint>
      </footer>
    </div>
  );
}

// ---------- journal: the story so far ----------
export function Journal() {
  const st = story(), cur = currentQuest(), pr = cur && questProgress(cur);
  return (
    <div class="screen paper doc">
      <header class="head"><h1>Journal</h1><span class="muted">{Math.min(st.i, QUESTS.length)} of {QUESTS.length} quests</span></header>
      <div class="body">
        <div class="col journal-list">
          {CHAPTERS.map((c, ci) => {
            const qs = QUESTS.map((q, i) => [q, i] as const).filter(([q]) => q.ch === ci);
            if (qs[0][1] > st.i) return null;                      // chapters not reached yet stay hidden
            return (
              <div>
                <div class="list-head caps">Chapter {ci + 1}: {c}</div>
                {qs.filter(([, i]) => i <= st.i).map(([q, i]) => (
                  <div class={'item static' + (i === st.i ? ' sel' : '')}>
                    <Icon k={q.by} /><div class="grow"><div>{q.title}</div><div class="sub">{i < st.i ? 'Done' : q.goal}</div></div>
                    {i === st.i && pr ? <span class="num">{pr.have}/{pr.want}</span> : <Icon k="star" size="s" />}
                  </div>
                ))}
              </div>
            );
          })}
          {!cur && <p class="gold">The story is complete. Nell is home.</p>}
          {!cur && <p><span class="caps">Next step</span> {stepLine()}</p>}
        </div>
        {cur && (
          <aside class="detail paper">
            <div class="d-icon"><Icon k={cur.by} size="xl" /></div><h2>{cur.title}</h2>
            <p class="muted">{PEOPLE[cur.by].name}, {PEOPLE[cur.by].role}</p>{cur.intro.map(([, line]) => <p>{line}</p>)}
            <p><span class="caps">Goal</span> {cur.goal}{pr && pr.want > 1 ? ` (${pr.have}/${pr.want})` : ''}</p>
            <p><span class="caps">Next step</span> {stepLine()}</p>
            {cur.hint && <p class="muted">{cur.hint}</p>}
          </aside>
        )}
      </div>
      <footer class="foot"><span /><Hint k="j" pad="B">Close</Hint></footer>
    </div>
  );
}
