// Claimable islands. While sailing, only the owners' signs show (flag, name and a link if they've added one). Buying
// and managing happen in the island card, opened from a port's Islands tab, from the sea chart, or by clicking a sign.
import { W, H, money } from '../config';
import { G, saveGame } from '../game';
import { claimableNear } from '../world';
import { sfx } from '../audio';
import { NET, buyIsland, claimIsland, renameIsland, releaseIsland, uploadIslandLogo, reportIsland, setIslandUrl } from '../net';
import { ISLANDS, islandPrice, stashLogo } from '../islands';
import { setWaypoint } from '../waypoint';
import { pixelLogo, type Logo } from './logo';
import { viewPct } from './parts';
import { track, bucket, flushAnalytics } from '../analytics';

/** Owners' links open in a new tab, after saying plainly that they leave the game. */
export function visit(url: string): void {
  if (confirm(`You're leaving Bobber Run to visit:\n${url}`)) window.open(url, '_blank', 'noopener,noreferrer');
}
const host = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The owners' signs over the claimed islands in view. */
export function IslandSigns() {
  const out = [];
  for (const c of claimableNear(G.cam.x + W / 2, G.cam.y + H / 2, Math.hypot(W, H) / 2)) {
    const row = ISLANDS.get(c.key);
    if (!row) continue;
    // over the island's middle, or held at the edge of the view while some of the island is on screen
    const [cx, cy] = viewPct(c.x, c.y - c.R * 0.35), x = Math.min(90, Math.max(10, cx)), y = Math.min(85, Math.max(30, cy));   // clear of the top HUD
    out.push(
      <div class={'island-sign' + (row.mine ? ' mine' : '')} key={c.key} style={{ left: x + '%', top: y + '%' }}>
        <button data-track="island-sign" class="sign-main" onClick={() => openIsland(c.key, 'play')}>{row.logoUrl && <img src={row.logoUrl} alt="" />}<span>{row.name}</span></button>
        {row.url && <button data-track="island-sign-visit" class="sign-link" title={row.url} onClick={() => visit(row.url!)}>visit ↗</button>}
      </div>,
    );
  }
  return <>{out}</>;
}

// ---------- the island card ----------
interface Form { key: string; name: string; url: string; logo: Logo | null; msg: { s: string; bad: boolean } | null; busy: boolean; confirm: boolean; adult: boolean }
let form: Form | null = null;
export function openIsland(key: string, back: 'play' | 'map' | 'port' = 'play'): void {
  G.islandKey = key; G.islandBack = back; G.mode = 'island'; sfx('select');
  const row = ISLANDS.get(key);
  track('island_opened', { owned: !!row, mine: !!row?.mine });
}
export function closeIsland(): void {
  if (form?.logo) URL.revokeObjectURL(form.logo.url);
  form = null; G.mode = G.islandBack || 'play'; G.islandKey = null;
}

export function IslandDialog() {
  const key = G.islandKey;
  if (!key) return null;
  const row = ISLANDS.get(key);
  if (!form || form.key !== key) form = { key, name: row?.name ?? '', url: row?.url ?? '', logo: null, msg: null, busy: false, confirm: false, adult: false };
  const f = form, [i, j] = key.split(',').map(Number), price = islandPrice(i, j), home = i === 0 && j === 0, admin = !!NET.profile?.admin;
  const say = (s: string, bad = false) => { f.msg = { s, bad }; };
  const run = async (job: () => Promise<{ ok: boolean; why?: string }>, done: string) => {
    f.busy = true; f.msg = null;
    const r = await job();
    f.busy = false;
    if (r.ok) { say(done); sfx('coin'); } else { say(r.why ?? 'Something went wrong. Try again', true); sfx('deny'); }
    return r.ok;
  };
  const pick = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    const l = await pixelLogo(file);
    if ('why' in l) return say(l.why, true);
    if (f.logo) URL.revokeObjectURL(f.logo.url);
    f.logo = l;
  };
  // admins claim on the spot; everyone else pays on Stripe's page and comes back to find the island theirs
  const buy = () => run(async () => {
    if (admin) {
      const r = await claimIsland(key, f.name.trim());
      if (r.ok && f.logo) await uploadIslandLogo(key, f.logo.blob);
      if (r.ok && f.url.trim()) await setIslandUrl(key, f.url.trim());
      return r;
    }
    const r = await buyIsland(key, f.name.trim(), admin || f.adult);
    if (!r.ok) return r;
    if (f.logo) await stashLogo(key, f.logo.blob);
    saveGame();
    track('island_checkout_started', { price_bucket: bucket(r.price) });
    flushAnalytics();
    location.href = r.url;
    return { ok: true };
  }, admin ? `${f.name.trim()} is yours` : 'Opening checkout…');
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
  const waypoint = () => { const c = claimableNear((i + 0.5) * 560, (j + 0.5) * 560, 560).find(x => x.key === key); if (c) { setWaypoint(c.x, c.y); closeIsland(); } };
  const named = f.name.trim().length >= 2;
  return (
    <div class="center dim-bg">
      <div class="panel rivets dialog island">
        <header class="isl-head">
          {row?.logoUrl && <span class="flag-box"><img class="flag" src={row.logoUrl} alt="" /></span>}
          <div class="grow">
            <h1>{row ? row.name : home ? 'The island of Alderhaven' : 'Unclaimed island'}</h1>
            <p class="muted">{row ? (row.mine ? 'Your island' : `Owned by ${row.owner}`) : admin ? 'Free to claim (admin)' : `${money(price)} · paid with Stripe`}</p>
          </div>
          {row?.url && <button data-track="island-visit" class="btn small-btn" onClick={() => visit(row.url!)}>Visit {host(row.url)} ↗</button>}
        </header>
        {row?.mine && row.logoPending && <p class="muted small">Your new flag is waiting for review. Other sailors will see it once a moderator approves it.</p>}
        {(!row || row.mine) && <IslandForm f={f} onPick={pick} />}
        {!row && !admin && <p class="muted small">Real money, paid securely with Stripe. Islands cost less the farther they are from Alderhaven, and you can own up to 3. Your name, flag and link show to every sailor.</p>}
        {!row && !admin && <label class="row adult"><input data-track="island-adult" type="checkbox" checked={f.adult} onChange={e => { f.adult = e.currentTarget.checked; }} />
          <span class="small">I'm 18 or older, or a parent or guardian said yes. <a href="/privacy.html#purchases" target="_blank" rel="noopener">About purchases</a></span></label>}
        {!row && NET.profile?.guest && <p class="why left">Sign in to buy islands, so yours stay yours on any device.</p>}
        {f.msg && <p class={f.msg.bad ? 'why left' : 'good'}>{f.msg.s}</p>}
        <footer class="foot">
          <button data-track="island-waypoint" class="btn" onClick={waypoint}>Set waypoint</button>
          {row?.mine && <button data-track="island-release" class={'btn' + (f.confirm ? ' danger' : '')} disabled={f.busy} onClick={release}>{f.confirm ? 'Press again to release' : 'Release'}</button>}
          {row && !row.mine && <button data-track="island-report" class="btn small-btn" disabled={f.busy} onClick={() => run(() => reportIsland(key), 'Thanks. A moderator will take a look')}>Report</button>}
          <span class="grow" />
          <button data-track="island-close" class="btn" onClick={closeIsland}>Close</button>
          {!row && <button data-track="island-buy" class="btn primary" disabled={f.busy || !named || !!NET.profile?.guest || (!admin && !f.adult)} onClick={buy}>{f.busy ? 'Working…' : admin ? 'Claim' : `Buy · ${money(price)}`}</button>}
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
