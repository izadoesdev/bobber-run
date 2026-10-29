// The port screen: tabbed shop lists on wood, the selected item's details on parchment.
import { G, portItems, portTabs, projDone, setTab, leavePort, equipment, fishValue, priceAt, catchNeed } from '../game';
import { boatDef, boatStats, builtIn, upgradeStat } from '../game/rules';
import { saleBonus, sailorsNear } from '../game/port';
import { SPECIES } from '../econ';
import { NET } from '../net';
import { CREW_RANGE } from '../online';
import { WX } from '../weather';
import type { BoatDef, BoatId, Fish as FishT, NeedStatus, Port as PortT, PortItem, PortRow, Project, UpgradeKey } from '../types';
import type { Fit } from '../models';
import { BoatPortrait } from './boats';
import { drawChart } from './chart';
import { Canvas, Cell, Fish, Hint, HullStat, Icon, Key, Pips, WX_ICON, boatThumb, cap1, clockText, flashing } from './parts';
import { money } from '../config';
import { today, FEATURED_PRICE } from '../today';

const GREET = [
  'The harbourmaster tips his cap.', 'Gulls squabble over the pilings.', 'The smell of tar and salt hangs in the air.',
  'A fiddle plays somewhere on the quay.', 'Nets dry on every rail.', 'The fishwife sizes up your catch.',
];
// a stable greeting per port
function hashStr(s: string): number {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}
const SWATCH: Record<string, string> = { classic: '#d8d0bf', seafoam: '#5fa38c', crimson: '#a2342c', midnight: '#22304a', sunny: '#d9ae3e', gold: '#c49a32' };
const isRow = (x: PortItem | undefined): x is PortRow => !!x && x.kind !== 'header';

function RowVisual({ it }: { it: PortRow }) {
  if (it.fish !== undefined) return <Fish sp={it.fish} />;
  if ((it.kind === 'boat' || it.kind === 'fleet') && it.boat) return <Icon cls="boat-thumb" src={boatThumb(it.boat.id)} />;
  if (it.kind === 'paint') return <span class="swatch" style={{ background: SWATCH[it.paint ?? ''] }} />;
  return <Icon k={it.icon} />;
}

function Row({ it, i }: { it: PortRow; i: number }) {
  // the first click selects, a click on the selected row buys
  const onClick = () => { if (G.menu.sel === i) it.act(); else G.menu.sel = i; };
  return (
    <Cell cls={'item' + (it.ok ? '' : ' off') + (flashing(it.key) ? ' flash' : '')} sel={G.menu.sel === i} onClick={onClick}>
      <RowVisual it={it} />
      <div class="grow"><div>{it.label}</div>{it.pips ? <Pips n={it.pips[0]} of={it.pips[1]} /> : it.sub && <div class="sub">{it.sub}</div>}</div>
      <span class={'price' + (it.cost != null && G.coins < it.cost ? ' short' : '')}>{it.right}</span>
    </Cell>
  );
}

function SaleReceipt() {
  const sale = G.menu.sale;
  return sale && <p class="sale-receipt good" role="status">Sold {sale.count} fish for {money(sale.coins)}</p>;
}

// the fish in the hold grouped by species, with what this port pays for each
function SellDetail({ p }: { p: PortT }) {
  const groups: Record<number, FishT[]> = {};
  for (const f of G.hold) (groups[f.sp] ||= []).push(f);
  const best = SPECIES.map((s, i) => ({ s, m: p.mult[i] })).filter(o => G.log[o.s.id]).sort((a, b) => b.m - a.m).slice(0, 3);
  const bonus = saleBonus(), mul = (1 + bonus.cook) * (1 + bonus.crew), sailors = sailorsNear(G.boat.x, G.boat.y);
  return (
    <div class="d-body">
      <SaleReceipt />
      {Object.keys(groups).length
        ? <div class="ledger">{Object.entries(groups).map(([key, fs]) => {
          const sp = +key, m = p.mult[sp], pct = Math.round((m - 1) * 100);
          const each = Math.round(fs.reduce((a, f) => a + fishValue(f), 0) / fs.length * priceAt(p, sp) * mul), golden = fs.filter(f => f.gold).length;
          return (
            <div class="row">
              <Fish sp={sp} size="s" /><span class="grow">{SPECIES[sp].name} ×{fs.length}{golden > 0 && <> <span class="stamp gold">{golden > 1 ? `${golden} golden` : 'Golden'}</span></>}</span>
              <span class={'trend ' + (pct > 0 ? 'up good' : pct < 0 ? 'down bad' : '')}>{pct > 0 ? '+' : ''}{pct}%</span>
              <span class="gold">{money(each)}</span>
            </div>
          );
        })}</div>
        : <p>Nothing in the hold yet.</p>}
      {(G.up.ice > 0 || bonus.cook > 0) && <p class="small">Prices include: {[G.up.ice > 0 && `ice box +${5 * G.up.ice}%`, bonus.cook > 0 && `cook +${Math.round(bonus.cook * 100)}%`].filter(Boolean).join(', ')}.</p>}
      {bonus.crew > 0
        ? <p class="small good">Crew bonus +{Math.round(bonus.crew * 100)}%: {sailors} sailor{sailors === 1 ? '' : 's'} nearby</p>
        : NET.on && <p class="small muted">Crew bonus: +5% per sailor within {CREW_RANGE / 10} m, up to +15%.</p>}
      <p class="small muted">Prices are per fish. The % compares this port's price with the usual price. Each fish you sell here lowers the price of that kind by 7% for a few minutes.</p>
      {best.length > 0 && <p class="muted">This port pays well for {best.map(o => o.s.name).join(', ')}.</p>}
    </div>
  );
}

function ProjectDetail({ pr, st }: { pr: Project; st: NeedStatus }) {
  const done = projDone(pr.id);
  return (
    <>
      <p>{pr.what}</p>
      {!done && (
        <div class="checklist">
          <div class={'row' + (G.coins >= pr.cost ? ' good' : '')}>
            <Icon k="coin" size="s" />{money(pr.cost)}<span class="grow" />
            <span class="num">{G.coins >= pr.cost ? 'Ready' : `You have ${money(G.coins)}`}</span>
          </div>
          <div class={'row' + (st.have >= st.want ? ' good' : '')}>
            {st.sp !== undefined ? <Fish sp={st.sp} size="s" /> : <Icon k="hold" size="s" />}{st.label}<span class="grow" />
            <span class="num">{st.have}/{st.want}</span>
          </div>
          {st.pick.length > 0 && <div class="row wrap muted small">Uses these fish: {st.pick.map(f => <Fish sp={f.sp} size="s" />)}</div>}
        </div>
      )}
      <p><span class="caps">Unlocks</span> <span class="good">{pr.gives}</span></p>
    </>
  );
}

// the picture at the top of the detail card: a boat preview, the ferry route, or a big icon
const preview = (id: BoatId, fit: Fit) => <BoatPortrait id={id} fit={fit} />;
function DetailVisual({ p, it }: { p: PortT; it: PortRow }) {
  if (it.kind === 'sale') return null;
  if (it.kind === 'upgrade') return preview(G.boatId, equipment());
  if ((it.kind === 'boat' || it.kind === 'fleet') && it.boat) return preview(it.boat.id, { ...equipment(), paint: G.paint });
  if (it.kind === 'paint') return preview(G.boatId, { ...equipment(), paint: it.paint ?? G.paint });
  if (it.kind === 'ferry' && it.q) {
    const q = it.q;
    return (
      <Canvas cls="preview chart" draw={(ctx, w, h, dpr) =>
        drawChart(ctx, w, h, (p.x + q.x) / 2, (p.y + q.y) / 2, Math.max(2, Math.hypot(q.x - p.x, q.y - p.y) * 1.4 / w), { dpr, labels: true })} />
    );
  }
  if (it.fish !== undefined) return <div class="d-icon"><Fish sp={it.fish} size="xl" /></div>;
  return <div class="d-icon"><Icon k={it.icon} size="xl" /></div>;
}

const pct = (n: number): string => Math.round(n * 100) + '%';
/** "+8" / "-12%" style change, coloured by direction. */
function Delta({ d, rel }: { d: number; rel?: boolean }) {
  const v = rel ? Math.round(d * 100) : Math.round(d);
  if (!v) return <span class="num muted">same</span>;
  return <span class={'num ' + (v > 0 ? 'good' : 'bad')}>{v > 0 ? '+' : ''}{v}{rel ? '%' : ''}</span>;
}
const STAT_ROWS: [string, (s: ReturnType<typeof boatStats>) => number, (v: number) => string, boolean][] = [
  ['Top speed', s => s.speed, pct, true], ['Hold', s => s.hold, v => v + ' fish', false], ['Hull', s => s.hp, v => String(v), false],
  ['Turning', s => s.turn, pct, true],
];
const GEAR_NAMES: [keyof BoatDef, string][] = [['net', 'net'], ['sonar', 'sonar'], ['crew', 'deckhand'], ['keel', 'keel'], ['harpoon', 'harpoon']];
// a boat against the one you sail now, both with your upgrades fitted
function BoatCompare({ b }: { b: BoatDef }) {
  const cur = boatDef(), mine = boatStats(cur), it = boatStats(b), same = cur.id === b.id;
  const gear = GEAR_NAMES.filter(([k]) => (b[k] as number | undefined ?? 0) > 0).map(([k, n]) => `level ${b[k]} ${n}`);
  const giants = SPECIES.filter(s => s.deck > 0 && s.deck <= (b.deck ?? 0)).map(s => s.name);   // sea giants this deck can land
  return (
    <>
      <p>{b.what}.</p>
      <div class="ledger">
        {STAT_ROWS.map(([n, get, fmt, rel]) => (
          <div class="row"><span class="caps grow">{n}</span>
            {!same && <><span class="muted">{fmt(get(mine))}</span><span class="muted">to</span></>}<span>{fmt(get(it))}</span>
            {!same && <Delta d={rel ? get(it) / get(mine) - 1 : get(it) - get(mine)} rel={rel} />}
          </div>
        ))}
      </div>
      {gear.length > 0 && <p class="small">Built in: {gear.join(', ')}.</p>}
      {giants.length > 0 && <p>Big enough to land sea giants: {giants.join(', ')}.</p>}
    </>
  );
}
function UpgradeDetail({ k, lvl, max, next }: { k: UpgradeKey; lvl: number; max: number; next: string | null | undefined }) {
  const [stat, now] = upgradeStat(k, lvl), after = lvl < max ? upgradeStat(k, lvl + 1)[1] : null, b = builtIn(k);
  return (
    <>
      <div class="checklist">
        <span class="caps">{stat}</span>
        <div class="row wrap"><span>{now}</span>{after && after !== now && <><span class="muted">to</span><span class="good">{after}</span></>}</div>
      </div>
      {next && <p><span class="caps">Next</span> {k === 'rod' ? `Level ${lvl + 2} rod. New fish: ${SPECIES.filter(s => s.rod === lvl + 1 && s.w > 0).map(s => s.name).join(', ')}` : next}.</p>}
      {b > lvl && <p class="warn small">Your {boatDef().name} already has level {b} built in, so levels up to {b} only help on boats without it.</p>}
      {k === 'prop' && <p class="muted small">100% is a plain rowboat. Speed upgrades stay with this boat.</p>}
    </>
  );
}

// the kind-specific middle of the detail card
function DetailBody({ it }: { it: PortRow }) {
  switch (it.kind) {
    case 'sale':
      return <><SaleReceipt />{it.what && <p>{it.what}</p>}</>;
    case 'upgrade':
      return it.pips && it.key ? <UpgradeDetail k={it.key as UpgradeKey} lvl={it.pips[0]} max={it.pips[1]} next={it.what} /> : null;
    case 'boat':
      return it.boat ? <BoatCompare b={it.boat} /> : null;
    case 'repair':
      return <><HullStat /><p>{it.what}</p></>;
    case 'project':
      return it.pr && it.st ? <ProjectDetail pr={it.pr} st={it.st} /> : null;
    case 'supply': case 'ferry':
      return (
        <>
          <p>{it.what}.</p><p class="muted">{it.sub}.</p>
          {it.repeat && <p class="muted small">Hold the button down to keep buying.</p>}
        </>
      );
    case 'rest': case 'paint': case 'fleet': case 'collect': case 'fund': case 'take': case 'contract':
      return <p>{it.what}</p>;
    case 'deliver':
      return <><p>{it.sub}.</p>{it.what && <p class="muted">{it.what}</p>}</>;
    case 'note':
      return <p>{it.sub}.</p>;
    case 'island':
      return <><p>{it.sub}.</p><p class="muted">{it.right === 'Yours' ? 'Open it to build on it, rename it, change its flag or link, or release it.' : it.right === 'Held' ? 'Open it to see who rules it and what they have built.' : 'Open it to name it, pick a flag and buy it with your coins.'}</p></>;
    default:
      return null;
  }
}

function Detail({ p, it }: { p: PortT; it: PortRow | null }) {
  if (!it) return <aside class="detail paper" />;
  const finished = it.kind === 'project' && !!it.pr && projDone(it.pr.id);
  return (
    <aside class={'detail paper' + (flashing(it.key) ? ' flash' : '')}>
      <DetailVisual p={p} it={it} />
      <h2>{it.kind === 'take' ? `Contract: ${it.label}` : it.label}</h2>
      {it.kind === 'sell' ? <SellDetail p={p} /> : <div class="d-body"><DetailBody it={it} /></div>}
      <div class="d-foot">
        {it.cost != null && <span class={'price big' + (G.coins < it.cost ? ' short' : '')}>{money(it.cost)}</span>}
        {it.action && !finished && (
          <button data-track={`port-${it.kind}`} class="btn primary" disabled={!it.ok} onClick={() => it.act()}>
            {!it.ok && it.why?.startsWith('Fully') ? 'Maxed' : it.action}{it.ok && <Key k=" " pad="A" />}
          </button>
        )}
      </div>
      {!it.ok && it.why && !finished && <p class="why">{it.why}</p>}
    </aside>
  );
}

// every port posts the weather, so you can plan the next trip from the quay
function Forecast() {
  const storm = WX.upcoming === 'storm', same = WX.upcoming === WX.state;
  return (
    <div class={'chip forecast' + (storm ? ' warn' : '')} title="Harbour forecast">
      <span class="caps">Forecast</span><Icon k={WX_ICON[WX.upcoming]} size="s" />
      {same ? `${cap1(WX.state)} for now` : `${cap1(WX.upcoming)} in ${clockText(WX.next)}`}
    </div>
  );
}

const inTime = (ms: number): string => { const m = Math.max(1, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
/** What to bring, cut from catchNeed's own wording; only ship and deck needs make rumours (a rod is no secret). */
function rumourNeed(need: string | null): string | null {
  const boat = need && /^needs a bigger boat: the (.+)$/.exec(need), sails = need && /needs sails \(the (.+)\)/.exec(need);
  return boat ? `a ${boat[1]}` : sails ? `sails, the ${sails[1]}` : need && /needs a Storm Keel/.test(need) ? 'a Storm Keel' : null;
}
/** One dockside rumour of a valuable fish your ship can't land yet, fixed per port and day; legends only once logged. */
function rumour(p: PortT, day: number): string | null {
  const locked = SPECIES.map((s, i) => ({ s, what: s.w > 0 && (!s.legend || G.log[s.id]) ? rumourNeed(catchNeed(i)) : null }))
    .filter(o => o.what).sort((a, b) => b.s.base - a.s.base).slice(0, 3);
  if (!locked.length) return null;
  const o = locked[hashStr(p.id + ':' + day) % locked.length];
  return `Rumour: big ${o.s.name} past the shelf, needs ${o.what}`;
}
// the market's notice board: kept to one clipped line (two on phones) so it never pushes the item list off a small screen
function Board({ p }: { p: PortT }) {
  const t = today(), now = Date.now(), on = t.frenzy.start <= now, rum = rumour(p, t.day);
  return (
    <div class="port-board">
      <div class="chip today" title={`Today these sell for ${FEATURED_PRICE}× everywhere: ${t.featured.map(sp => SPECIES[sp].name).join(', ')}`}>
        <span class="caps">Today</span>
        {t.featured.map(sp => <span class="feat" title={SPECIES[sp].name}><Fish sp={sp} size="s" /></span>)}
        <span class="gold">×{FEATURED_PRICE}</span>
      </div>
      <div class={'chip today' + (on ? ' on' : '')} title="A feeding frenzy for every sailor at once, everywhere at sea">
        <Icon k="star" size="s" /><span>{on ? `Frenzy now, ${inTime(t.frenzy.end - now)} left` : `Frenzy in ${inTime(t.frenzy.start - now)}`}</span>
      </div>
      {rum && <span class="rumour" title={rum}>{rum}</span>}
    </div>
  );
}

export function Port({ p }: { p: PortT }) {
  const tabs = portTabs(p), items = portItems(p), cur = items[G.menu.sel], it = isRow(cur) ? cur : null;
  return (
    <div class="screen port panel rivets">
      <header class="head">
        <div><h1>{p.name}</h1><div class="sub">{GREET[hashStr(p.id) % GREET.length]}</div></div>
        <div class="row"><Forecast /><Icon k="coin" size="l" /><span class="coins big">{money(G.coinsShown)}</span></div>
      </header>
      <nav class="tabs">
        <Key k="q" pad="LB" />
        {tabs.map((t, i) => <button data-track={`port-tab-${t}`} class={'tab' + (i === G.menu.tab ? ' on' : '')} onClick={() => setTab(i)}><span class="tnum">{i + 1}</span>{t}</button>)}
        <Key k="e" pad="RB" />
      </nav>
      {G.menu.tab === 0 && <Board p={p} />}
      <div class="body">
        <div class="list well">{items.map((x, i) => isRow(x) ? <Row it={x} i={i} /> : <div class="list-head caps">{x.label}</div>)}</div>
        <Detail p={p} it={it} />
      </div>
      <footer class="foot">
        <span class="hints-inline">
          <Hint k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose</Hint><Hint k=" " pad="A">Buy</Hint><Hint k="q" k2="e" pad="LB RB">Switch tab</Hint>
        </span>
        <button data-track="port-leave" class="btn" onClick={leavePort}><Icon k="anchor" size="s" />Leave port<Key k="Escape" pad="B" /></button>
      </footer>
    </div>
  );
}
