// Claimable islands: a sign over every claimed island (its logo and name), a "Claim this island" chip when you
// sail up to one nobody owns, and the island dialog: claim it (name, logo, price), manage your own, or see whose it is.
import { W, H } from '../config';
import { G, saveGame } from '../game';
import { claimableNear } from '../world';
import { sfx } from '../audio';
import { NET, buyIsland, claimIsland, renameIsland, releaseIsland, uploadIslandLogo, reportIsland } from '../net';
import { ISLANDS, islandHere, islandPrice, stashLogo } from '../islands';
import { pixelLogo, type Logo } from './logo';
import { Icon } from './parts';

/** Islands are bought with real money (US dollars, through Stripe), unlike everything priced in coins. */
const usd = (n: number): string => `US$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (x: number, y: number): [number, number] => [(x - G.cam.x) / W * 100, (y - G.cam.y) / H * 100];

/** Signs over the claimed islands in view, and the claim chip for the unclaimed island you're at. */
export function IslandSigns() {
  const out = [];
  for (const c of claimableNear(G.cam.x + W / 2, G.cam.y + H / 2, Math.hypot(W, H) / 2)) {
    const row = ISLANDS.get(c.key);
    if (!row) continue;
    // over the island's middle, or held at the edge of the view while some of the island is on screen
    const [cx, cy] = pct(c.x, c.y - c.R * 0.35), x = Math.min(90, Math.max(10, cx)), y = Math.min(85, Math.max(30, cy));   // clear of the top HUD
    out.push(
      <button class={'island-sign' + (row.mine ? ' mine' : '')} key={c.key} style={{ left: x + '%', top: y + '%' }} onClick={() => openIsland(c.key)}>
        {row.logoUrl && <img src={row.logoUrl} alt="" />}<span>{row.name}</span>
      </button>,
    );
  }
  const here = NET.on ? islandHere() : null;
  if (here && !ISLANDS.has(here.key)) out.push(
    <button class="chip island-claim" key="claim" onClick={() => openIsland(here.key)}>
      <Icon k="anchor" size="s" />Unclaimed island<span class="gold">{usd(islandPrice(here.i, here.j))}</span><b>{NET.profile?.admin ? 'Claim' : 'Buy'}</b>
    </button>,
  );
  return <>{out}</>;
}

// ---------- the dialog ----------
interface Form { key: string; name: string; logo: Logo | null; msg: { s: string; bad: boolean } | null; busy: boolean; confirm: boolean }
let form: Form | null = null;
export function openIsland(key: string): void {
  form = { key, name: ISLANDS.get(key)?.name ?? '', logo: null, msg: null, busy: false, confirm: false };
  G.mode = 'island'; sfx('select');
}
export function closeIsland(): void { if (form?.logo) URL.revokeObjectURL(form.logo.url); form = null; G.mode = 'play'; }

export function IslandDialog() {
  const f = form;
  if (!f) return null;
  const [i, j] = f.key.split(',').map(Number), row = ISLANDS.get(f.key), price = islandPrice(i, j), home = i === 0 && j === 0;
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
  const admin = !!NET.profile?.admin;
  // admins claim on the spot; everyone else pays on Stripe's page and comes back to find the island theirs
  const claim = () => run(async () => {
    if (admin) {
      const r = await claimIsland(f.key, f.name.trim());
      if (r.ok && f.logo) await uploadIslandLogo(f.key, f.logo.blob);
      return r;
    }
    const r = await buyIsland(f.key, f.name.trim());
    if (!r.ok) return r;
    if (f.logo) await stashLogo(f.key, f.logo.blob);
    saveGame();
    location.href = r.url;
    return { ok: true };
  }, admin ? `${f.name.trim()} is yours!` : 'Opening checkout…');
  const named = f.name.trim().length >= 2;
  return (
    <div class="center dim-bg">
      <div class="panel rivets dialog island">
        {!row ? <>
          <h1>Claim this island</h1>
          <p>{home ? 'The island of Alderhaven itself.' : 'An island nobody owns yet.'} Name it and give it a flag; every sailor sees them over the island and on their chart.</p>
          <IslandForm f={f} onPick={pick} />
          <p class="row"><span class="caps">Price</span><span class="gold">{admin ? 'Free (admin)' : usd(price)}</span>
            <span class="muted small">{admin ? 'Admins claim islands without paying.' : 'Real money, paid securely with Stripe. Islands cost less the farther they are from Alderhaven. You can own up to 3.'}</span></p>
          {NET.profile?.guest && <p class="why left">Sign in to buy islands, so yours stay yours on any device.</p>}
          <footer class="foot"><button class="btn" onClick={closeIsland}>Cancel</button>
            <button class="btn primary" disabled={f.busy || !named || !!NET.profile?.guest} onClick={claim}>{f.busy ? 'Working…' : admin ? 'Claim (admin)' : `Buy for ${usd(price)}`}</button></footer>
        </> : row.mine ? <>
          <h1>{row.name}</h1>
          <p class="muted">Your island. Rename it or change its flag; sailors see the change right away.</p>
          <IslandForm f={f} onPick={pick} current={row.logoUrl} />
          <footer class="foot">
            <button class={'btn' + (f.confirm ? ' danger' : '')} disabled={f.busy} onClick={() => { if (!f.confirm) { f.confirm = true; say('Release it? Anyone can then claim it. You get no refund. Press again to release', true); return; } void run(() => releaseIsland(f.key), 'Released. The island is free to claim'); }}>{f.confirm ? 'Press again to release' : 'Release'}</button>
            <span class="grow" />
            <button class="btn" onClick={closeIsland}>Close</button>
            <button class="btn primary" disabled={f.busy || !named} onClick={() => run(async () => {
              const r = f.name.trim() !== row.name ? await renameIsland(f.key, f.name.trim()) : { ok: true };
              return r.ok && f.logo ? uploadIslandLogo(f.key, f.logo.blob) : r;
            }, 'Saved')}>Save</button>
          </footer>
        </> : <>
          <h1 class="row">{row.logoUrl && <img class="flag" src={row.logoUrl} alt="" />}{row.name}</h1>
          <p>Claimed by <b>{row.owner}</b>.</p>
          <footer class="foot"><button class="btn small-btn" disabled={f.busy} onClick={() => run(() => reportIsland(f.key), 'Thanks. A moderator will take a look')}>Report name or flag</button>
            <span class="grow" /><button class="btn primary" onClick={closeIsland}>Close</button></footer>
        </>}
        {f.msg && <p class={f.msg.bad ? 'why left' : 'good'}>{f.msg.s}</p>}
      </div>
    </div>
  );
}
function IslandForm({ f, onPick, current }: { f: Form; onPick: (e: Event) => void; current?: string | null }) {
  const shown = f.logo?.url ?? current ?? null;
  return (
    <div class="form-grid island-form">
      <label class="caps" for="isl-name">Name</label>
      <input id="isl-name" maxlength={24} autocomplete="off" value={f.name} placeholder="Gull Rock" onInput={e => { f.name = e.currentTarget.value; }} />
      <span class="caps">Flag</span>
      <span class="row">
        <span class="flag-box">{shown ? <img class="flag" src={shown} alt="Your flag" /> : <span class="muted small">none</span>}</span>
        <label class="btn small-btn">Choose image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={onPick} /></label>
        <span class="muted small">Any picture becomes a 32×32 pixel flag.</span>
      </span>
    </div>
  );
}
