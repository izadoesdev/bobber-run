import { W, H, money } from '../config';
import { G, saveGame } from '../game';
import { addCoins } from '../game/feedback';
import { claimableNear, claimableAt, heightAt, homesteadSite, realmPlots } from '../world';
import { sfx } from '../audio';
import { NET, buyIsland, buildOnIsland, renameIsland, releaseIsland, uploadIslandLogo, reportIsland, setIslandUrl } from '../net';
import { ISLANDS, REALM, focusIsland, islandLanding, islandPrice, ledgerLeft, realmTitle, realmDockAt, realmInReach, collectRealm, TREASURY_MIN } from '../islands';
import { realmSaleValue, sellAtRealm } from '../game/port/market';
import { boardOwned } from '../game/port/shop';
import { BOATS } from '../econ';
import { BUILDINGS, BUILDING_IDS, MAX_ISLANDS, cantBuild, islandIncome, type BuildingId } from '../../convex/islandRules';
import { sailToWaypoint, setWaypoint } from '../waypoint';
import { pixelLogo, type Logo } from './logo';
import { edgeFade, pin, viewPct } from './parts';
import { track, bucket } from '../analytics';

/** Owners' links open in a new tab, after saying plainly that they leave the game. */
function visit(url: string): void {
  if (confirm(`You're leaving Bobber Run to visit:\n${url}`)) window.open(url, '_blank', 'noopener,noreferrer');
}
const host = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The owners' signs over the claimed islands in view. */
export function IslandSigns() {
  return <>{claimableNear(G.cam.x + W / 2, G.cam.y + H / 2, Math.hypot(W, H) / 2).map(c => {
    const row = ISLANDS.get(c.key);
    if (!row) return null;
    // just under the island's flagpole (homesteadSite) while that is in view and clear of the top HUD, fading near
    // the edges so signs never crowd them or blink out
    const site = homesteadSite(c) ?? c, [x, y] = viewPct(site.x, site.y + 6), a = edgeFade(x, y, 6, 94, 24, 90);
    if (!a) return null;
    return (
      <div class={'island-sign' + (row.mine ? ' mine' : '')} key={c.key} style={{ ...pin(x, y), opacity: a, pointerEvents: a < 0.5 ? 'none' : undefined }}>
        <button data-track="island-sign" class="sign-main" onClick={() => openIsland(c.key, 'play')}>{row.logoUrl && <img src={row.logoUrl} alt="" />}
          <span class="txt"><span>{row.name}</span><span class="who">{row.mine ? 'your island' : `held by ${row.title ? row.title + ' ' : ''}${row.owner}`}</span></span></button>
        {row.url && <button data-track="island-sign-visit" class="sign-link" title={row.url} onClick={() => visit(row.url!)}>visit ↗</button>}
      </div>
    );
  })}</>;
}

// ---------- the island card ----------
interface Form { key: string; name: string; url: string; logo: Logo | null; msg: { s: string; bad: boolean } | null; busy: boolean; confirm: boolean; buying: boolean }
let form: Form | null = null;
export function openIsland(key: string, back: 'play' | 'map' | 'port' = 'play'): void {
  G.islandKey = key; G.islandBack = back; G.mode = 'island'; sfx('select'); focusIsland(key);
  const row = ISLANDS.get(key);
  track('island_opened', { owned: !!row, mine: !!row?.mine });
}
export function closeIsland(): void {
  if (form?.logo) URL.revokeObjectURL(form.logo.url);
  form = null; G.mode = G.islandBack || 'play'; G.islandKey = null; focusIsland(null);
}

export function IslandDialog() {
  const key = G.islandKey;
  if (!key) return null;
  // your own islands come from your kingdom (wherever they are); others' from the islands watched round the boat
  const own = REALM.islands.find(r => r.key === key), seen = ISLANDS.get(key);
  const row = seen ?? (own && { key, name: own.name, owner: NET.profile?.name ?? '', title: realmTitle(), buildings: own.buildings, logoUrl: null, logoPending: false, url: null, mine: true });
  if (!form || form.key !== key) form = { key, name: row?.name ?? '', url: row?.url ?? '', logo: null, msg: null, busy: false, confirm: false, buying: false };
  const f = form, [i, j] = key.split(',').map(Number), price = islandPrice(i, j) ?? 0, home = i === 0 && j === 0, admin = !!NET.profile?.admin;
  const left = ledgerLeft(), owned = REALM.islands.length, full = owned >= MAX_ISLANDS;
  // what stops a purchase of `cost` coins: your purse, then the earnings the server has counted for you
  const short = (cost: number): string | null => admin ? null : G.coins < cost ? `You have ${money(G.coins)}` : left !== null && left < cost ? `The harbour office has counted ${money(left)} of your earnings` : null;
  const say = (s: string, bad = false) => { f.msg = { s, bad }; };
  const run = async (job: () => Promise<{ ok: boolean; why?: string }>, done: string) => {
    f.busy = true; f.msg = null;
    const r = await job();
    f.busy = false;
    if (r.ok) { say(done); sfx('coin'); } else { say(r.why ?? 'Something went wrong. Try again', true); sfx('deny'); }
  };
  const pick = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const l = await pixelLogo(file);
    if ('why' in l) return say(l.why, true);
    if (f.logo) URL.revokeObjectURL(f.logo.url);
    f.logo = l;
  };
  // a fortune: the first press asks, the second buys; the coins come out of the save once the server agrees
  const buy = () => {
    if (!f.buying && !admin) { f.buying = true; say(`Buy this island for ${money(price)}? Press Buy again to pay`, false); return; }
    void run(async () => {
      const r = await buyIsland(key, f.name.trim(), G.stats.caught, G.earned);
      if (!r.ok) return r;
      if (r.price) addCoins(-r.price);
      saveGame();
      track('island_bought', { price_bucket: bucket(r.price ?? 0) });
      if (f.logo) await uploadIslandLogo(key, f.logo.blob);
      if (f.url.trim()) await setIslandUrl(key, f.url.trim());
      return r;
    }, `${f.name.trim()} is yours`);
  };
  const build = (b: BuildingId) => run(async () => {
    const r = await buildOnIsland(key, b, G.stats.caught, G.earned);
    if (!r.ok) return r;
    if (r.price) addCoins(-r.price);
    saveGame();
    track('island_built', { building: b });
    return r;
  }, `The ${BUILDINGS[b].name.toLowerCase()} is built`);
  const save = (r0: NonNullable<typeof row>) => run(async () => {
    let r: { ok: boolean; why?: string } = { ok: true };
    if (f.name.trim() !== r0.name) r = await renameIsland(key, f.name.trim());
    if (r.ok && f.url.trim() !== (r0.url ?? '')) r = await setIslandUrl(key, f.url.trim());
    if (r.ok && f.logo) r = await uploadIslandLogo(key, f.logo.blob);
    return r;
  }, f.logo ? 'Saved. Others will see the new flag once a moderator approves it' : 'Saved');
  const release = () => {
    if (!f.confirm) { f.confirm = true; say('Release it? Anyone can then buy it, and there is no refund. Press again to release', true); return; }
    void run(() => releaseIsland(key), 'Released');
  };
  // the island's middle is land: head for the open water off its shore nearest the boat
  const landing = () => { const c = claimableAt(key); return c && islandLanding(c, G.boat.x, G.boat.y, (x, y) => heightAt(x, y) < -0.1); };
  const waypoint = () => { const p = landing(); if (p) { setWaypoint(p.x, p.y); closeIsland(); } };
  const sail = () => { const p = landing(); if (!p) return; setWaypoint(p.x, p.y); sailToWaypoint(); closeIsland(); G.mode = 'play'; };
  const named = f.name.trim().length >= 2, mine = own, why = !row ? (full && !admin ? `You rule ${MAX_ISLANDS} islands already` : short(price)) : null;
  return (
    <div class="center dim-bg">
      <div class="panel rivets dialog island">
        <header class="isl-head">
          {row?.logoUrl && <span class="flag-box"><img class="flag" src={row.logoUrl} alt="" /></span>}
          <div class="grow">
            <h1>{row ? row.name : home ? 'The island of Alderhaven' : 'Unclaimed island'}</h1>
            <p class="muted">{row ? (row.mine ? `Your island${realmTitle() ? ` · ${realmTitle()}` : ''}` : `Held by ${row.title ? row.title + ' ' : ''}${row.owner}`) : admin ? 'Free to claim (admin)' : `For sale · ${money(price)}`}</p>
          </div>
          {row?.url && <button data-track="island-visit" class="btn small-btn" onClick={() => visit(row.url!)}>Visit {host(row.url)} ↗</button>}
        </header>
        {row?.mine && row.logoPending && <p class="muted small">Your new flag is waiting for review. Other sailors will see it once a moderator approves it.</p>}
        {(!row || row.mine) && <IslandForm f={f} onPick={pick} />}
        {!row && !admin && <p class="muted small">Islands are the end game: the bigger and the nearer Alderhaven, the dearer. Rule up to {MAX_ISLANDS}; build on them for an income and a title. Your name, flag and link show to every sailor.{left !== null && ` Earnings counted for you: ${money(left)}.`}</p>}
        {own && <AtIsland islandKey={key} name={own.name} have={own.buildings} landed={realmDockAt(G.boat.x, G.boat.y)?.key === key} />}
        {row && <Buildings have={mine?.buildings ?? row.buildings} income={islandIncome(i, j, mine?.buildings ?? row.buildings)} build={mine ? build : null} short={short} busy={f.busy} berth={berth(key)} />}
        {!row && NET.profile?.guest && <p class="why left">Sign in to buy islands, so yours stay yours on any device.</p>}
        {f.msg && <p class={f.msg.bad ? 'why left' : 'good'}>{f.msg.s}</p>}
        <footer class="foot">
          <button data-track="island-waypoint" class="btn" onClick={waypoint}>Set waypoint</button>
          {G.islandBack !== 'port' && <button data-track="island-sail" class="btn" onClick={sail}>Sail there</button>}
          {row?.mine && <button data-track="island-release" class={'btn' + (f.confirm ? ' danger' : '')} disabled={f.busy} onClick={release}>{f.confirm ? 'Press again to release' : 'Release'}</button>}
          {row && !row.mine && <button data-track="island-report" class="btn small-btn" disabled={f.busy} onClick={() => run(() => reportIsland(key), 'Thanks. A moderator will take a look')}>Report</button>}
          <span class="grow" />
          <button data-track="island-close" class="btn" onClick={closeIsland}>Close</button>
          {!row && why && <span class="why small">{why}</span>}
          {!row && <button data-track="island-buy" class="btn primary" disabled={f.busy || !named || !!NET.profile?.guest || !!why} onClick={buy}>{f.busy ? 'Working…' : admin ? 'Claim' : f.buying ? `Pay ${money(price)}` : `Buy · ${money(price)}`}</button>}
          {row?.mine && <button data-track="island-save" class="btn primary" disabled={f.busy || !named} onClick={() => save(row)}>Save</button>}
        </footer>
      </div>
    </div>
  );
}
function IslandForm({ f, onPick }: { f: Form; onPick: (e: Event) => void }) {
  return (
    <div class="form-grid island-form">
      <label class="caps" for="isl-name">Name</label>
      <input id="isl-name" maxlength={24} autocomplete="off" value={f.name} placeholder="Gull Rock" onInput={e => { f.name = e.currentTarget.value; }} />
      <label class="caps" for="isl-url">Link</label>
      <input id="isl-url" maxlength={200} autocomplete="off" inputMode="url" value={f.url} placeholder="yoursite.com (optional)" onInput={e => { f.url = e.currentTarget.value; }} />
      <span class="caps">Flag</span>
      <span class="row">
        {f.logo && <span class="flag-box"><img class="flag" src={f.logo.url} alt="New flag" /></span>}
        <label class="btn small-btn">{f.logo ? 'Choose another' : 'Choose image'}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={onPick} /></label>
        <span class="muted small">Any picture becomes a 32×32 pixel flag.</span>
      </span>
    </div>
  );
}

/** Does the island have deep water off its shore for a dock (world.realmPlots)? */
const berth = (key: string): boolean => { const c = claimableAt(key); return !!c && !!realmPlots(c)?.shore.length; };
/** An island's buildings: what's built, and on your own island what you can build next, with its cost and income. */
function Buildings({ have, income, build, short, busy, berth }: { have: readonly string[]; income: number; build: ((b: BuildingId) => void) | null; short: (cost: number) => string | null; busy: boolean; berth: boolean }) {
  const ids = build ? BUILDING_IDS : BUILDING_IDS.filter(b => have.includes(b));
  if (!ids.length) return <p class="muted small">Nothing built here yet.</p>;
  return (
    <div class="isl-builds">
      <p class="caps small">Buildings{income > 0 && ` · ${money(income)} a minute`}</p>
      {ids.map(b => {
        const B = BUILDINGS[b], built = have.includes(b), no = built ? null : (b === 'dock' && !berth ? 'No deep water off this shore for a dock' : null) ?? cantBuild(b, have) ?? short(B.cost);
        return (
          <div class={'isl-build' + (built ? ' built' : '')} key={b}>
            <span class="grow"><b>{B.name}{B.income ? <span class="muted"> · +{money(B.income)}/min</span> : null}</b><span class="muted">{B.what}</span></span>
            {built ? <span class="good small">Built</span>
              : <button data-track={`island-build-${b}`} class="btn small-btn" disabled={busy || !!no} title={no ?? undefined} onClick={() => build!(b)}>{money(B.cost)}</button>}
          </div>
        );
      })}
    </div>
  );
}

function IslandTreasury({ islandKey }: { islandKey: string }) {
  const banked = Math.floor(G.treasury), near = realmInReach(islandKey), fishing = !!(G.fish || G.card);
  const why = !near ? 'Sail near this island to collect.' : fishing ? 'Finish your catch to collect.' : '';
  return <>
    <p class="small muted">{G.realmRate > 0
      ? `Your islands bring in ${money(G.realmRate)} a minute while sailing or away. The treasury holds ${TREASURY_MIN / 60} hours' worth. Collect here when nearby; sailing past never collects it.`
      : 'Build a fishery, a market or gardens for an income.'}</p>
    {(G.realmRate > 0 || banked > 0) && <div class="row isl-act">
      <span class="grow">Treasury: <b class="gold">{money(banked)}</b>{why && ` · ${why}`}</span>
      <button data-track="island-collect" class="btn small-btn" disabled={!near || fishing || banked < 1} onClick={() => collectRealm(islandKey)}>Collect treasury</button>
    </div>}
  </>;
}

function AtIsland({ islandKey, name, have, landed }: { islandKey: string; name: string; have: readonly string[]; landed: boolean }) {
  const sale = realmSaleValue(), boats = BOATS.filter(b => G.owned.includes(b.id));
  return (
    <div class="isl-here">
      <IslandTreasury islandKey={islandKey} />
      {landed && have.includes('market') && <div class="row isl-act"><span class="grow">Sell your catch at {name}'s market (a third over a fair price)</span>
        <button data-track="island-sell" class="btn small-btn" disabled={!sale.n} onClick={() => sellAtRealm(name)}>{sale.n ? `Sell ${sale.n} · ${money(sale.tot)}` : 'Nothing to sell'}</button></div>}
      {landed && have.includes('shipyard') && boats.length > 1 && <div class="row isl-act"><span class="grow">Change boats</span>
        {boats.map(b => <button data-track={`island-board-${b.id}`} key={b.id} class="btn small-btn" disabled={G.boatId === b.id} onClick={() => boardOwned(b)}>{b.name}</button>)}</div>}
      {!landed && (have.includes('market') || have.includes('shipyard')) && <p class="small muted">Land at the island's dock to use its {[have.includes('market') && 'market', have.includes('shipyard') && 'shipyard'].filter(Boolean).join(' and ')}.</p>}
    </div>
  );
}
