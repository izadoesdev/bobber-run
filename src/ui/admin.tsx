// The admin panel: for accounts the server says are admins (NET.profile.admin), opened with F9 or the shield chip.
// Find sailors (online ones from the relay, and any captain by name once the server search is there) and sail or
// jump to them; teleport to coordinates, a region, a village or legend, home, or wherever you click on the chart;
// and fun: weather, time of day, a frenzy, a golden school, lifting the fog, opening every region. Moving about and
// the weather leave a save as it is; anything that hands out coins, gear or fish goes through the cheat console's
// codes, which mark the save as cheated (off the world records and the coastwide fund), as cheats always have.
import { useEffect, useState } from 'preact/hooks';
import { G, toast, saveGame, DAYLEN } from '../game';
import { NET, adminPlayers, type AdminPlayer } from '../net';
import { ONLINE } from '../online';
import { W, H } from '../config';
import { heightAt, homePort, regionSites } from '../world';
import { regionAt } from '../biome';
import { setWeather } from '../weather';
import { runCheat, CHEATS, SEA_TOYS } from '../cheats';
import { reveal } from '../game/explore';
import { openChart } from '../game/chart';
import { setWaypoint } from '../waypoint';
import { sfx } from '../audio';
import type { WeatherState } from '../types';

const isAdmin = (): boolean => !!NET.profile?.admin;
/** The panel's state: open, and whether the next chart click teleports instead of setting a waypoint. */
export const ADMIN = { open: false, clickTeleport: false };

if (typeof window !== 'undefined') window.addEventListener('keydown', e => {
  if (e.key !== 'F9' || !isAdmin() || e.repeat) return;
  e.preventDefault(); ADMIN.open = !ADMIN.open; sfx('select');
});

/** Jump the boat to (x, y): onto the nearest open water, its region opened so rough water doesn't push it back, the sea round it seen. */
export function teleport(x: number, y: number, why = ''): void {
  let at = { x, y };
  found: for (let r = 0; r <= 400; r += 20) for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (heightAt(px, py) < -0.08) { at = { x: px, y: py }; break found; }
  }
  const id = regionAt(at.x, at.y).id;
  if (!G.unlocked.includes(id)) G.unlocked.push(id);
  const b = G.boat;
  Object.assign(b, { x: at.x, y: at.y, px: at.x, py: at.y, vx: 0, vy: 0, w: 0, helm: 0, thr: 0 });
  G.cam.x = b.x - W / 2; G.cam.y = b.y - H / 2; G.look.x = G.look.y = 0;
  G.fish = null; G.waypoint = null;
  reveal(at.x, at.y, 400);
  if (G.mode === 'map' || G.mode === 'port') G.mode = 'play';
  toast(`Teleported${why ? ' to ' + why : ''} (${Math.round(at.x)}, ${Math.round(at.y)})`, 'good'); sfx('discover'); saveGame();
}

const atClock = (frac: number): void => {
  const base = Math.floor(G.clock / DAYLEN) * DAYLEN;
  G.clock = base + (frac > (G.clock - base) / DAYLEN ? 0 : DAYLEN) + frac * DAYLEN;
};
const ago = (t: number): string => { const m = Math.max(0, (Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const away = (x: number, y: number): string => `${Math.round(Math.hypot(x - G.boat.x, y - G.boat.y) / 10)} m`;
/** Every sailor the relay has told us about, nearest first. */
function sailors(): { uid: string; name: string; x: number; y: number }[] {
  const byUid = new Map<string, { uid: string; name: string; x: number; y: number }>();
  for (const f of ONLINE.far) byUid.set(f.uid, f);
  for (const s of ONLINE.sailors) byUid.set(s.uid, { uid: s.uid, name: s.name, x: s.x, y: s.y });
  return [...byUid.values()].sort((a, b) => Math.hypot(a.x - G.boat.x, a.y - G.boat.y) - Math.hypot(b.x - G.boat.x, b.y - G.boat.y));
}
// the regions worth jumping to: one point inside each, found once on a coarse sweep of the known seas
let regionList: { id: string; name: string; x: number; y: number }[] | null = null;
function regions(): typeof regionList & object {
  if (regionList) return regionList;
  const seen = new Map<string, { id: string; name: string; x: number; y: number }>();
  for (let y = -12000; y <= 12000; y += 700) for (let x = -24000; x <= 24000; x += 700) {
    const r = regionAt(x, y);
    if (!seen.has(r.id)) seen.set(r.id, { id: r.id, name: r.name, x: r.centre.x, y: r.centre.y });
  }
  return regionList = [...seen.values()].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
}

type Tab = 'sailors' | 'teleport' | 'fun';
export function AdminPanel() {
  const [tab, setTab] = useState<Tab>('sailors'), [q, setQ] = useState(''), [xy, setXy] = useState('');
  const [command, setCommand] = useState('');
  // every captain by name, online or not, in any sea (admin:players), a moment after typing stops
  const [found, setFound] = useState<AdminPlayer[] | null>(null);
  useEffect(() => {
    setFound(null);
    if (q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => { void adminPlayers(q.trim()).then(r => { if (live) setFound(r ?? []); }); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  if (!ADMIN.open || !isAdmin()) return null;
  const list = sailors().filter(s => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  const go = (fn: () => void) => () => { fn(); };
  const weather = (s: WeatherState) => go(() => { setWeather(s); toast(`Weather: ${s}`, 'good'); });
  const clock = (f: number, name: string) => go(() => { atClock(f); toast(`Time: ${name}`, 'good'); });
  return (
    <div class="admin panel" onPointerDown={e => e.stopPropagation()}>
      <div class="admin-head"><b>Captain’s sandbox</b><button class="btn small-btn" aria-label="Close admin panel" onClick={() => { ADMIN.open = false; }}>Close · F9</button></div>
      <div class="admin-tabs">{(['sailors', 'teleport', 'fun'] as Tab[]).map(t => <button class={'btn small-btn' + (t === tab ? ' on' : '')} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      <div class="admin-body">
      {tab === 'sailors' && <>
        <div class="caps small">In your sea</div>
        <input class="admin-input" placeholder="Find a sailor by name (2+ letters searches every captain)" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
        <div class="admin-list">
          {list.length ? list.slice(0, 40).map(s => (
            <div class="admin-row">
              <span class="grow"><b>{s.name}</b><span class="muted small"> {away(s.x, s.y)} · {regionAt(s.x, s.y).name}</span></span>
              <button class="btn small-btn" title="Set a waypoint to them" onClick={go(() => { setWaypoint(s.x, s.y); toast(`Waypoint set to ${s.name}`, 'good'); })}>Sail</button>
              <button class="btn small-btn" title="Jump next to them" onClick={go(() => teleport(s.x + 40, s.y, s.name))}>Go</button>
            </div>
          )) : <p class="muted small">No one in your sea {q ? 'by that name ' : ''}right now.</p>}
        </div>
        {q.trim().length >= 2 && <>
          <div class="caps small">All captains</div>
          <div class="admin-list">
            {found === null ? <p class="muted small">Searching…</p> : found.length ? found.filter((f): f is AdminPlayer & { x: number; y: number } => f.x != null && f.y != null).map(f => (
              <div class="admin-row">
                <span class="grow"><b>{f.name}</b>{f.online && <span class="gold small"> online</span>}
                  <span class="muted small"> {away(f.x, f.y)} · {regionAt(f.x, f.y).name} · story {f.story ?? 0}{f.online || f.savedAt == null ? '' : ` · seen ${ago(f.savedAt)}`}</span></span>
                <button class="btn small-btn" title="Set a waypoint to their last spot" onClick={go(() => { setWaypoint(f.x, f.y); toast(`Waypoint set to ${f.name}`, 'good'); })}>Sail</button>
                <button class="btn small-btn" title="Jump next to their last spot" onClick={go(() => teleport(f.x + 40, f.y, f.name))}>Go</button>
              </div>
            )) : <p class="muted small">No captain by that name.</p>}
          </div>
        </>}
        <p class="muted small">{ONLINE.total ? `${ONLINE.total} sailing now` : ''}</p>
      </>}
      {tab === 'teleport' && <>
        <div class="admin-row">
          <input class="admin-input grow" placeholder="x, y" value={xy} onInput={e => setXy((e.target as HTMLInputElement).value)}
            onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click(); }} />
          <button class="btn small-btn" onClick={go(() => { const m = /(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/.exec(xy); if (m) teleport(+m[1], +m[2]); else toast('Type two numbers, like -19611, -11884', 'bad'); })}>Go</button>
        </div>
        <div class="admin-row">
          <button class="btn small-btn" onClick={go(() => { const h = homePort(); teleport(h.dock.x, h.dock.y, 'Alderhaven'); })}>Home</button>
          <button class={'btn small-btn' + (ADMIN.clickTeleport ? ' on' : '')} onClick={go(() => { ADMIN.clickTeleport = !ADMIN.clickTeleport; if (ADMIN.clickTeleport) openChart(); })}>{ADMIN.clickTeleport ? 'Click the chart…' : 'Click on chart'}</button>
        </div>
        <div class="caps small">Regions</div>
        <div class="admin-list">{regions().map(r => <button class="btn small-btn admin-chip" onClick={go(() => teleport(r.x, r.y, r.name))}>{r.name}</button>)}</div>
        <div class="caps small">Villages and legends</div>
        <div class="admin-list">{regionSites().map(s => <button class="btn small-btn admin-chip" onClick={go(() => teleport(s.x, s.y, s.id))}>{s.id.replace('legend-', '').replace(/-village$/, ' village')}</button>)}</div>
      </>}
      {tab === 'fun' && <>
        <p class="admin-warning">Sea toys and cheats mark this voyage as a sandbox: no world records or coastwide fund contributions. Weather and time controls do not.</p>
        <div class="caps small">Make a little mischief</div>
        <div class="admin-toys">{SEA_TOYS.map(toy => <button key={toy.code} class="btn admin-toy" onClick={() => runCheat(toy.code)}><b>{toy.name}</b><span>{toy.what}</span><code>{toy.code}</code></button>)}</div>
        <label class="caps small" htmlFor="admin-command">Secret code</label>
        <div class="admin-row"><input id="admin-command" class="admin-input grow" value={command} placeholder="Try dontpanic…" onInput={e => setCommand(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runCheat(command); } }} /><button class="btn small-btn" onClick={() => runCheat(command)}>Run</button></div>
        <div class="caps small">Weather</div>
        <div class="admin-row">{(['clear', 'rain', 'storm'] as WeatherState[]).map(s => <button class="btn small-btn" onClick={weather(s)}>{s}</button>)}</div>
        <div class="caps small">Time</div>
        <div class="admin-row"><button class="btn small-btn" onClick={clock(0.06, 'dawn')}>Dawn</button><button class="btn small-btn" onClick={clock(0.3, 'noon')}>Noon</button><button class="btn small-btn" onClick={clock(0.6, 'dusk')}>Dusk</button><button class="btn small-btn" onClick={clock(0.75, 'night')}>Night</button></div>
        <div class="caps small">Sea</div>
        <div class="admin-row">
          <button class="btn small-btn" onClick={() => runCheat('frenzy')}>Frenzy</button>
          <button class="btn small-btn" onClick={() => runCheat('goldrush')}>Golden school</button>
          <button class="btn small-btn" onClick={go(() => { reveal(G.boat.x, G.boat.y, 3000); toast('The fog lifts for 300 m round you', 'good'); })}>Lift fog</button>
          <button class="btn small-btn" onClick={() => runCheat('openwaters')}>Open all regions</button>
          <button class="btn small-btn" onClick={() => runCheat('unsinkable')}>{G.god ? 'Mortal hull' : 'Unsinkable'}</button>
        </div>
        <div class="caps small">Cheats <span class="muted">(mark this save as cheated)</span></div>
        <div class="admin-list">{CHEATS.filter(c => !['stormy', 'clearsky', 'nightfall', 'daybreak', 'frenzy', 'unsinkable', 'homeward', 'goldrush', 'openwaters', ...SEA_TOYS.map(t => t.code)].includes(c.code)).map(c =>
          <button class="btn small-btn admin-chip" title={c.what} onClick={go(() => runCheat(c.code))}>{c.code}</button>)}</div>
      </>}
      </div>
    </div>
  );
}

/** The shield chip in the corner that opens the panel (admins only). */
export function AdminChip() {
  if (!isAdmin() || ADMIN.open) return null;
  return <button class="chip admin-chip-open" data-track="admin-open" title="Admin tools (F9)" onClick={() => { ADMIN.open = true; sfx('select'); }}>Admin</button>;
}
