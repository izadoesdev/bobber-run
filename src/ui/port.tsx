// The port screen: tabbed shop lists on wood, the selected item's details on parchment.
import { G, portItems, portTabs, projDone, setTab, leavePort, hpMax, equipment, fishValue, priceAt } from '../game';
import { SPECIES, BOATS } from '../econ';
import { WX } from '../weather';
import type { Fish as FishT, NeedStatus, Port as PortT, PortItem, PortRow, Project } from '../types';
import { drawChart } from './chart';
import { Bar, Canvas, Fish, Hint, Icon, Key, Pips, boatPreview, boatThumb, cap1, flashing, money, useScrollTo } from './parts';

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
  if ((it.kind === 'boat' || it.kind === 'fleet') && it.boat) return <Icon src={boatThumb(it.boat.id)} />;
  if (it.kind === 'paint') return <span class="swatch" style={{ background: SWATCH[it.paint ?? ''] }} />;
  return <Icon k={it.icon} />;
}

function Row({ it, i }: { it: PortRow; i: number }) {
  const sel = G.menu.sel === i, ref = useScrollTo(sel);
  const cls = 'item' + (sel ? ' sel' : '') + (it.ok ? '' : ' off') + (flashing(it.key) ? ' flash' : '');
  // the first click selects, a click on the selected row buys
  const onClick = () => { if (G.menu.sel === i) it.act(); else G.menu.sel = i; };
  return (
    <div ref={ref} class={cls} onClick={onClick}>
      <RowVisual it={it} />
      <div class="grow"><div>{it.label}</div>{it.pips ? <Pips n={it.pips[0]} of={it.pips[1]} /> : it.sub && <div class="sub">{it.sub}</div>}</div>
      <span class={'price' + (it.cost != null && G.coins < it.cost ? ' short' : '')}>{it.right}</span>
    </div>
  );
}

// the fish in the hold grouped by species, with what this port pays for each
function SellDetail({ p }: { p: PortT }) {
  const groups: Record<number, FishT[]> = {};
  for (const f of G.hold) (groups[f.sp] = groups[f.sp] || []).push(f);
  const best = SPECIES.map((s, i) => ({ s, m: p.mult[i] })).filter(o => G.log[o.s.id]).sort((a, b) => b.m - a.m).slice(0, 3);
  return (
    <div class="d-body">
      {Object.keys(groups).length
        ? <div class="ledger">{Object.entries(groups).map(([key, fs]) => {
          const sp = +key, m = p.mult[sp], pct = Math.round((m - 1) * 100);
          const each = Math.round(fs.reduce((a, f) => a + fishValue(f), 0) / fs.length * priceAt(p, sp) * (1 + 0.1 * G.up.cook));
          return (
            <div class="row">
              <Fish sp={sp} size="s" /><span class="grow">{SPECIES[sp].name} ×{fs.length}</span>
              <span class={'trend ' + (pct > 0 ? 'up good' : pct < 0 ? 'down bad' : '')}>{pct > 0 ? '+' : ''}{pct}%</span>
              <span class="gold">{money(each)}</span>
            </div>
          );
        })}</div>
        : <p>Nothing in the hold yet.</p>}
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
            <span class="num">{G.coins >= pr.cost ? 'Ready' : `${money(G.coins)} now`}</span>
          </div>
          <div class={'row' + (st.have >= st.want ? ' good' : '')}>
            {st.sp !== undefined ? <Fish sp={st.sp} size="s" /> : <Icon k="hold" size="s" />}{st.label}<span class="grow" />
            <span class="num">{st.have}/{st.want}</span>
          </div>
          {st.pick.length > 0 && <div class="row wrap muted small">Donates: {st.pick.map(f => <Fish sp={f.sp} size="s" />)}</div>}
        </div>
      )}
      <p><span class="caps">Unlocks</span> <span class="good">{pr.gives}</span></p>
    </>
  );
}

// the picture at the top of the detail card: a boat preview, the ferry route, or a big icon
function DetailVisual({ p, it }: { p: PortT; it: PortRow }) {
  if (it.kind === 'upgrade') return <Canvas cls="preview" draw={boatPreview(G.boatId, equipment())} />;
  if ((it.kind === 'boat' || it.kind === 'fleet') && it.boat) return <Canvas cls="preview" draw={boatPreview(it.boat.id, { ...equipment(), paint: G.paint })} />;
  if (it.kind === 'paint') return <Canvas cls="preview" draw={boatPreview(G.boatId, { ...equipment(), paint: it.paint ?? G.paint })} />;
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

const MAX_BOAT = BOATS[BOATS.length - 1];

// the kind-specific middle of the detail card
function DetailBody({ it }: { it: PortRow }) {
  switch (it.kind) {
    case 'upgrade': {
      if (!it.pips) return null;
      return (
        <>
          <div class="row"><Pips n={it.pips[0]} of={it.pips[1]} /><span class="muted">Level {it.pips[0] + 1} of {it.pips[1] + 1}</span></div>
          <p><span class="caps">Now</span> {it.now}</p>
          {it.what && <p><span class="caps">Next</span> <span class="good">{it.what}</span></p>}
          {it.key !== 'keel' && <p class="muted small">Fitted gear shows on your boat.</p>}
        </>
      );
    }
    case 'boat': {
      const b = it.boat;
      if (!b) return null;
      const stats: [string, number, (string | number)?][] = [
        ['Speed', b.speed / MAX_BOAT.speed], ['Hold', b.hold / MAX_BOAT.hold, b.hold + ' fish'], ['Hull', b.hp / MAX_BOAT.hp, b.hp], ['Turning', b.turn / 1.05],
      ];
      return (
        <>
          {stats.map(([n, k, v]) => <div class="stat"><span class="caps">{n}</span><Bar k={k} tone="gold" /><span class="num">{v || ''}</span></div>)}
          <p>{b.what}.</p>
        </>
      );
    }
    case 'repair':
      return (
        <>
          <div class="stat"><span class="caps">Hull</span><Bar k={G.boat.hp / hpMax()} /><span class="num">{G.boat.hp}/{hpMax()}</span></div>
          <p>{it.what}</p>
        </>
      );
    case 'project':
      return it.pr && it.st ? <ProjectDetail pr={it.pr} st={it.st} /> : null;
    case 'supply':
    case 'ferry':
      return (
        <>
          <p>{it.what}.</p><p class="muted">{it.sub}.</p>
          {it.repeat && <p class="muted small">Hold the button down to keep buying.</p>}
        </>
      );
    case 'rest':
    case 'fleet':
    case 'collect':
    case 'fund':
    case 'take':
      return <p>{it.what}</p>;
    case 'deliver':
    case 'note':
      return <p>{it.sub}.</p>;
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
        {it.kind !== 'note' && !finished && (
          <button class="btn primary" disabled={!it.ok} onClick={() => it.act()}>
            {!it.ok && it.why && it.why.startsWith('Fully') ? 'Maxed' : it.action}{it.ok && <Key k=" " pad="A" />}
          </button>
        )}
      </div>
      {!it.ok && it.why && !finished && <p class="why">{it.why}</p>}
    </aside>
  );
}

const WX_ICON: Record<string, string> = { clear: 'sun', cloudy: 'cloud', rain: 'rain', storm: 'storm' };
// every port posts the weather, so you can plan the next trip from the quay
function Forecast() {
  const m = Math.floor(WX.next / 60), s = String(Math.floor(WX.next % 60)).padStart(2, '0');
  const storm = WX.upcoming === 'storm', same = WX.upcoming === WX.state;
  return (
    <div class={'chip forecast' + (storm ? ' warn' : '')} title="Harbour forecast">
      <span class="caps">Forecast</span><Icon k={WX_ICON[WX.upcoming] || 'sun'} size="s" />
      {same ? `${cap1(WX.state)} for now` : `${cap1(WX.upcoming)} in ${m}:${s}`}
    </div>
  );
}

export function Port({ p }: { p: PortT }) {
  const tabs = portTabs(p), items = portItems(p), cur = items[G.menu.sel], it = isRow(cur) ? cur : null;
  return (
    <div class="screen panel rivets">
      <header class="head">
        <div><h1>{p.name}</h1><div class="sub">{GREET[hashStr(p.id) % GREET.length]}</div></div>
        <div class="row"><Forecast /><Icon k="coin" size="l" /><span class="coins big">{money(G.coinsShown)}</span></div>
      </header>
      <nav class="tabs">
        <Key k="q" pad="LB" />
        {tabs.map((t, i) => <button class={'tab' + (i === G.menu.tab ? ' on' : '')} onClick={() => setTab(i)}><span class="tnum">{i + 1}</span>{t}</button>)}
        <Key k="e" pad="RB" />
      </nav>
      <div class="body">
        <div class="list well">{items.map((x, i) => isRow(x) ? <Row it={x} i={i} /> : <div class="list-head caps">{x.label}</div>)}</div>
        <Detail p={p} it={it} />
      </div>
      <footer class="foot">
        <span class="hints-inline">
          <Hint k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose</Hint><Hint k=" " pad="A">Buy</Hint><Hint k="q" k2="e" pad="LB RB">Switch tab</Hint>
        </span>
        <button class="btn" onClick={leavePort}><Icon k="anchor" size="s" />Set off<Key k="Escape" pad="B" /></button>
      </footer>
    </div>
  );
}
