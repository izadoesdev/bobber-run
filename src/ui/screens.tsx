// Full-screen documents and panels: the sea chart, the logbook, the ship and hold, and the story journal.
import { clamp, dirTo, money } from '../config';
import { G, logged, cap, boatDef, equipment, fishValue, speedMul, deckLvl, deckBoat, ownedLvl, smallFry, releaseSmallFry, toggleHelper, SMALL_FRY, buyFishChart, fishChartPrice, chartable } from '../game';
import { track } from '../analytics';
import { isRunningNow } from '../tides';
import { SPECIES, UPGRADES, PAINTS, SUPPLIES, fmtKg } from '../econ';
import { homePort, heightAt, regionSite } from '../world';
import { livesAt, VARIANTS, type VariantId } from '../species';
import { setWaypoint, clearWaypoint, sailToWaypoint, waypointMetres } from '../waypoint';
import { openIsland } from './island';
import { NET } from '../net';
import { QUESTS, CHAPTERS, PEOPLE, currentQuest, questProgress, story } from '../story';
import { guide, guideOn, stepLine } from '../game/guide';
import { chartPerks } from '../game/rules';
import { GRADES, grade } from '../game/mastery';
import { packJournal } from '../content/engine';
import { Face } from './faces';
import type { UpgradeKey } from '../types';
import { drawChart, compassRose, zoneKnown, chartAt, drawn, type Legend } from './chart';
import { Canvas, Cell, Fish, Hint, HullStat, Icon, Key, Pips, Stat, boatPreview, type DrawFn } from './parts';
import type { ComponentChildren } from 'preact';

// ---------- chart ----------
// Drag (or the arrow keys) to look around, Z or the buttons to zoom. Hovering says what a spot is and what a click
// does there: islands open their card, the waypoint clears, anywhere else gets the waypoint (snapped onto a port's
// dock or a wreck). On touch the tip shows for a moment after each tap.
let drag: [number, number] | null = null, moved = 0;
let tip: { x: number; y: number; cx: number; cy: number; w: number; h: number; until: number } | null = null;   // pointer in wrap and canvas CSS px
const LEGEND: [Legend, ComponentChildren][] = [
  ['you', <><i class="lg you" />You</>], ['target', <><i class="lg target" />Next step</>], ['waypoint', <><i class="wp-glyph" />Your waypoint</>],
  ['port', <><i class="lg port" />Port</>], ['light', <><i class="lg light" />Lighthouse</>], ['wreck', <><i class="lg wreck" />Wreck</>],
  ['treasure', <><i class="lg treasure" />Treasure</>], ['escaped', <><i class="lg escaped" />Got away</>], ['frenzy', <><Icon k="star" size="s" />Feeding frenzy</>], ['school', <><i class="lg school" />Fish</>],
  ['sailor', <><i class="lg sailor" />Sailors</>], ['owned', <><i class="lg owned" />Claimed island</>], ['island', <><i class="lg island" />Island for sale</>], ['uncharted', <><i class="lg unknown" />Uncharted</>],
];
function pointAt(e: PointerEvent): void {
  const until = e.pointerType === 'mouse' ? Infinity : performance.now() + 2500, c = (e.currentTarget as HTMLElement).getBoundingClientRect(), w = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
  tip = { x: e.clientX - w.left, y: e.clientY - w.top, cx: e.clientX - c.left, cy: e.clientY - c.top, w: c.width, h: c.height, until };
}
export function Chart() {
  const m = G.map, base = m.zoom === 1 ? 2.2 : 4.6;           // world units per CSS pixel
  const step = guide(), on = guideOn(), target = on ? step.at ?? null : null;
  const draw: DrawFn = (ctx, w, h, dpr) => {
    drawChart(ctx, w, h, G.boat.x + m.x, G.boat.y + m.y, base / dpr, { dpr, labels: true, grid: true, budget: 10, sextant: G.up.sextant, target, waypoint: G.waypoint, islands: true, zone: m.zoneSp });
    compassRose(ctx, w - 34 * dpr, 42 * dpr, 20 * dpr);
  };
  if (tip && performance.now() > tip.until) tip = null;
  // what's under the pointer, worked out again on a click since a tap has no hover before it
  const pick = () => {
    if (!tip) return null;
    const at = { x: G.boat.x + m.x + (tip.cx - tip.w / 2) * base, y: G.boat.y + m.y + (tip.cy - tip.h / 2) * base };
    return { at, spot: chartAt(at.x, at.y, 12 * base, target && { at: target, text: stepLine(step) }) };
  };
  const spot = pick()?.spot;
  const click = (): void => {
    const { at, spot } = pick() ?? {};
    if (!spot || !at) return;
    if (spot.island) openIsland(spot.island, 'map');
    else if (spot.clear) clearWaypoint();
    else if (!spot.none) { const to = spot.snap && heightAt(spot.snap.x, spot.snap.y) < -0.05 ? spot.snap : at; setWaypoint(to.x, to.y); }
  };
  const hp = homePort(), flip = tip && tip.x > tip.w * 0.62;
  return (
    <div class="screen paper doc">
      <header class="head">
        <h1>Sea chart</h1>
        <div class="legend">{LEGEND.filter(([k]) => drawn.has(k)).map(([k, el]) => <span key={k}>{el}</span>)}</div>
      </header>
      <div class="chartwrap">
        <div class="chart-chips">
          {G.waypoint && <ChartWaypoint />}
          {m.zoneSp != null && <ZoneChip sp={m.zoneSp} />}
        </div>
        <Canvas
          draw={draw}
          style={{ cursor: drag && moved > 6 ? 'grabbing' : spot?.island || spot?.clear ? 'pointer' : 'crosshair' }}
          onPointerDown={e => { if (e.button !== 0) return; drag = [e.clientX, e.clientY]; moved = 0; e.currentTarget.setPointerCapture(e.pointerId); pointAt(e); }}
          onPointerMove={e => {
            if (e.pointerType === 'mouse' || drag) pointAt(e);
            if (!drag) return;
            m.x -= (e.clientX - drag[0]) * base;
            m.y -= (e.clientY - drag[1]) * base;
            moved += Math.hypot(e.clientX - drag[0], e.clientY - drag[1]);
            drag = [e.clientX, e.clientY];
          }}
          onPointerUp={() => { if (drag && moved < 6) click(); drag = null; }}
          onPointerLeave={e => { if (e.pointerType === 'mouse') tip = null; }}
          onContextMenu={e => { e.preventDefault(); clearWaypoint(); }}
          onWheel={e => { m.zoom = e.deltaY > 0 ? 2 : 1; }}
        />
        {spot && tip && !(drag && moved > 6) && (
          <div class="chart-tip" style={{ left: tip.x + (flip ? -14 : 14) + 'px', top: tip.y + 14 + 'px', transform: flip ? 'translateX(-100%)' : undefined }}>
            <b>{spot.title}</b>{spot.sub && <span class="muted">{spot.sub}</span>}{spot.act && <span class="gold">{spot.act}</span>}
          </div>
        )}
        <div class="chart-ctl">
          {(m.x || m.y) ? <button data-track="chart-recentre" class="btn small-btn" onClick={() => { m.x = m.y = 0; }}>Recentre</button> : null}
          <button data-track="chart-zoom-in" class="btn small-btn" aria-label="Zoom in" disabled={m.zoom === 1} onClick={() => { m.zoom = 1; }}>+</button>
          <button data-track="chart-zoom-out" class="btn small-btn" aria-label="Zoom out" disabled={m.zoom === 2} onClick={() => { m.zoom = 2; }}>−</button>
        </div>
      </div>
      <footer class="foot">
        <span>{on ? <><span class="gold">Next:</span> {stepLine(step)}</> : `${hp.name} is ${Math.round(Math.hypot(G.boat.x - hp.x, G.boat.y - hp.y) / 10)} m away`}</span>
        <span class="hints-inline"><span class="hint muted">Drag to look around</span><Hint k="z">Zoom</Hint><Hint k="c">Recentre</Hint><Hint k="m" pad="Y">Close</Hint></span>
      </footer>
    </div>
  );
}
/** The waypoint on the chart: how far and which way, Sail there (the autopilot takes the route), and clear. */
function ChartWaypoint() {
  const w = G.waypoint!;
  return (
    <div class="chip waypoint">
      <i class="wp-glyph" /><span>Waypoint</span><span class="gold">{waypointMetres()} m</span><span class="muted">{dirTo(G.boat.x, G.boat.y, w.x, w.y)}</span>
      <button data-track="chart-waypoint-sail" class="go" onClick={() => { sailToWaypoint(); G.mode = 'play'; }}>Sail there</button>
      <button data-track="chart-waypoint-clear" class="x" aria-label="Clear waypoint" onClick={clearWaypoint}>×</button>
    </div>
  );
}

// the species the chart is showing the waters of
function ZoneChip({ sp }: { sp: number }) {
  const e = G.log[SPECIES[sp].id], home = nearestHome(sp);
  return (
    <div class="chip zone-on"><Fish sp={sp} size="s" /><span>{e ? SPECIES[sp].name : 'Unknown fish'}{zoneKnown(sp) ? ': gold water is where it lives' : ''}{e?.at?.length ? ', pins are where you caught it' : ''}</span>
      {home && <button class="btn small-btn" onClick={() => setWaypoint(home.x, home.y)}>Waypoint to nearest</button>}
      <button class="x" aria-label="Stop showing this fish" onClick={() => { G.map.zoneSp = null; }}>×</button></div>
  );
}

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
function showOnChart(sp: number): void {
  const m = G.map, p = nearestHome(sp);
  m.zoneSp = sp; m.zoom = 2;
  if (p) { m.x = p.x - G.boat.x; m.y = p.y - G.boat.y; }
  G.mode = 'map';
  track('fish_chart_opened', { species: SPECIES[sp].id, how: 'logbook' });
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
// ---------- logbook ----------
const WHEN: Record<string, string> = { any: 'Any time', day: 'By day', night: 'At night', twilight: 'At dusk or dawn' };
const WX_TXT: Record<string, string> = { any: '', rain: ', in rain', storm: ', in storms' };
const FIGHTS: Record<string, string> = {
  steady: 'Pulls steadily', darter: 'Darts off suddenly', generic: 'Pulls hard in bursts', jumper: 'Jumps. Stop reeling while it is in the air', erratic: 'Pulls in random directions', boss: 'Fights in three rounds',
};
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
            {e && <><dt>Caught</dt><dd><Mastery n={e.n} /></dd><dt>Your best</dt><dd>{fmtKg(e.best)}</dd></>}
            {world && <><dt>World record</dt><dd class="gold">{fmtKg(world.kg)} by {world.name}</dd></>}
          </dl>
          {e && !s.legend && <Variants sp={sel} got={e.vars ?? []} />}
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
/** The story packs you've opened: each one's name, its current quest with progress and hint, or that it's done. */
function Stories() {
  const packs = packJournal();
  if (!packs.length) return null;
  return (
    <div>
      <div class="list-head caps">Stories</div>
      {packs.map(({ pack, quest, have, want }) => (
        <Item k="map" face={pack.characters.find(c => c.id === quest?.by) ?? pack.characters[0]} name={pack.name} sub={quest ? `${quest.title}: ${quest.goal}${quest.hint ? `. ${quest.hint}` : ''}` : 'Done'}>
          {quest && 'site' in quest.obj && !have && <SailToSite id={quest.obj.site} r={quest.obj.r ?? 90} />}
          {quest ? <span class="num">{have}/{want}</span> : <Icon k="star" size="s" />}
        </Item>
      ))}
    </div>
  );
}
/**
 * A story's place to sail to: a waypoint on open water beside it (villages and some legends stand on land), and off
 * you go. Villages face the sea along their angle; otherwise the nearest water on rings around the spot, inside the
 * distance that counts as arriving.
 */
function SailToSite({ id, r: reach }: { id: string; r: number }) {
  const go = () => {
    const s = regionSite(id);
    if (!s) return;
    let at = { x: s.x, y: s.y };
    found: for (let r = 0; r < reach - 5; r += 10) for (let k = 0; k < 24; k++) {
      const a = s.a + k / 24 * Math.PI * 2, x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
      if (heightAt(x, y) < -0.06) { at = { x, y }; break found; }
    }
    setWaypoint(at.x, at.y); sailToWaypoint(); G.mode = 'play';
  };
  return <button data-track="story-sail" class="btn small-btn" onClick={go}>Sail there</button>;
}
/** What charting the coast has earned so far, and what the next lighthouse or landmark adds. */
function ChartedPerks() {
  const { speed, hold } = chartPerks(), places = Math.max(0, G.found.size - 1), lights = [...G.found].filter(id => id.startsWith('light:')).length;
  const next = speed < 0.12 ? 'each new place adds 1% speed' : hold < 3 ? `${4 - lights % 4} more lighthouse${4 - lights % 4 === 1 ? '' : 's'} for another hold slot` : 'every perk earned';
  return (
    <span class="perks" title="Charting the coast makes you faster, and every 4 lighthouses add a slot to your hold">
      <Icon k="map" size="s" />{places} places charted: <span class="gold">+{Math.round(speed * 100)}% speed{hold ? `, +${hold} hold` : ''}</span><span class="muted"> ({next})</span>
    </span>
  );
}
/** How many you've caught, its mastery grade (Bronze 5, Silver 25, Gold 100), and how many to the next. */
function Mastery({ n }: { n: number }) {
  const g = grade(n), next = GRADES[g];
  return <>{n}{g > 0 && <span class={'stamp grade g' + g}>{GRADES[g - 1].name}</span>}{next && <span class="muted small"> {next.at - n} more for {next.name}</span>}</>;
}
/** Every variant a species can come in: the ones you've caught by name, the rest as silhouettes to look for. */
function Variants({ sp, got }: { sp: number; got: readonly string[] }) {
  return (
    <div class="variants"><span class="caps">Variants {got.length}/{VARIANT_IDS.length}</span>
      {VARIANT_IDS.map(v => { const has = got.includes(v); return <span class={'var' + (has ? ' got' : '')} title={has ? VARIANTS[v].name : 'Not caught yet'}><Fish sp={sp} size="s" cls={has ? '' : 'sil'} />{has ? VARIANTS[v].name : '?'}</span>; })}
    </div>
  );
}
const VARIANT_IDS = Object.keys(VARIANTS) as VariantId[];
/** A non-interactive list row: icon, name over a line of detail, then whatever goes on the right. */
const Item = ({ k, face, name, sub, cls = '', children }: { k: string; face?: { name: string; role: string }; name: string; sub: string; cls?: string; children?: ComponentChildren }) =>
  <div class={'item static' + cls}>{face ? <Face name={face.name} role={face.role} size="s" /> : <Icon k={k} />}<div class="grow"><div>{name}</div><div class="sub">{sub}</div></div>{children}</div>;
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
          <Stat label="Speed" k={speedMul() / 3.1}>{Math.round(speedMul() * 100)}%</Stat>
          <HullStat />
          <Stat label="Hold" k={G.hold.length / cp} tone="gold">{G.hold.length}/{cp}</Stat>
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
          {fitted.map(k => <Item k={k} name={UPGRADES[k].name(bd)} sub={UPGRADES[k].lv[G.up[k] - 1]}><Pips n={G.up[k]} of={UPGRADES[k].costs.length} /></Item>)}
          {!fitted.length && <p class="muted">No upgrades yet. Buy them in the Outfitter tab at any port.</p>}
          {helpers.length > 0 && <>
            <div class="list-head caps">Helpers</div>
            {helpers.map(([k, name, what]) => (
              <Item cls=" helper" k={k} name={name} sub={what}>
                <button data-track={`helper-${k}`} class={'btn small-btn' + (G.gearOff[k] ? '' : ' on')} aria-pressed={!G.gearOff[k]} onClick={() => toggleHelper(k)}>{G.gearOff[k] ? 'Off' : 'On'}</button>
              </Item>
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
      <header class="head"><h1>Journal</h1><span class="muted">{Math.min(st.i, QUESTS.length)} of {QUESTS.length} quests</span><ChartedPerks /></header>
      <div class="body">
        <div class="col journal-list">
          {CHAPTERS.map((c, ci) => {
            const qs = QUESTS.map((q, i) => [q, i] as const).filter(([q]) => q.ch === ci);
            if (qs[0][1] > st.i) return null;                      // chapters not reached yet stay hidden
            return (
              <div>
                <div class="list-head caps">Chapter {ci + 1}: {c}</div>
                {qs.filter(([, i]) => i <= st.i).map(([q, i]) => (
                  <Item cls={i === st.i ? ' sel' : ''} k={q.by} face={PEOPLE[q.by]} name={q.title} sub={i < st.i ? 'Done' : q.goal}>
                    {i === st.i && pr ? <span class="num">{pr.have}/{pr.want}</span> : <Icon k="star" size="s" />}
                  </Item>
                ))}
              </div>
            );
          })}
          {!cur && <><p class="gold">The story is complete. Nell is home.</p><p><span class="caps">Next step</span> {stepLine()}</p></>}
          <Stories />
        </div>
        {cur && (
          <aside class="detail paper">
            <div class="d-icon"><Face who={cur.by} name={PEOPLE[cur.by].name} role={PEOPLE[cur.by].role} size="l" /></div><h2>{cur.title}</h2>
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
