// The leaderboard: the coast's top captains by species logged, world records, heaviest fish, fish caught and coins
// earned, with your own rank underneath. Each tab is fetched once when shown and kept for half a minute.
import { G } from '../game';
import { NET, leaders, type LeaderBy, type Leaders } from '../net';
import { fmtKg } from '../econ';
import { Hint } from './parts';
import { money } from '../config';

export const BOARDS: { by: LeaderBy; label: string; what: string }[] = [
  { by: 'species', label: 'Species', what: 'Most species logged' },
  { by: 'records', label: 'Records', what: 'Most world records held' },
  { by: 'heaviest', label: 'Heaviest', what: 'Heaviest single fish' },
  { by: 'caught', label: 'Caught', what: 'Most fish caught' },
  { by: 'earned', label: 'Earned', what: 'Most coins earned' },
];
const KEEP_MS = 30_000;
const cache = new Map<LeaderBy, { at: number; data: Leaders | null; loading: boolean }>();
function board(by: LeaderBy): { data: Leaders | null; loading: boolean } {
  const c = cache.get(by);
  if (!c || (!c.loading && Date.now() - c.at > KEEP_MS)) {
    const entry = { at: Date.now(), data: c?.data ?? null, loading: true };
    cache.set(by, entry);
    void leaders(by).then(d => { entry.data = d; entry.loading = false; entry.at = Date.now(); });
  }
  return cache.get(by)!;
}
const show = (by: LeaderBy, v: number): string => by === 'heaviest' ? fmtKg(v) : by === 'earned' ? money(v) : String(v);

export function Leaderboard() {
  const tab = G.leaderTab % BOARDS.length, b = BOARDS[tab], { data, loading } = board(b.by);
  return (
    <div class="screen paper doc leaders">
      <header class="head"><h1>Leaderboard</h1><span class="muted">{b.what}</span></header>
      <nav class="tabs">
        {BOARDS.map((x, i) => <button data-track={`leaders-${x.label}`} class={'tab' + (i === tab ? ' on' : '')} onClick={() => { G.leaderTab = i; }}>{x.label}</button>)}
      </nav>
      <div class="body">
        {!NET.on ? <p>The leaderboard needs an internet connection.</p>
          : !data ? <p class="muted">{loading ? 'Loading…' : 'The leaderboard could not be loaded. Try again in a moment.'}</p>
          : data.rows.length === 0 ? <p class="muted">No captains on this board yet. Be the first.</p>
          : (
            <ol class="board">
              {data.rows.map((r, i) => (
                <li class={r.name === NET.profile?.name ? 'me' : ''}>
                  <span class="rank">{i + 1}</span>
                  <span class="grow">{r.admin && <b class="gold" title="Admin">★ </b>}{r.name}</span>
                  {r.label && <span class="muted">{r.label}</span>}
                  <span class="num">{show(b.by, r.value)}</span>
                </li>
              ))}
            </ol>
          )}
        {data?.me && data.me.rank > 0 && <p class="mine">You are <b>#{data.me.rank}</b> with {show(b.by, data.me.value)}.</p>}
        {data && !(data.me && data.me.rank > 0) && NET.profile?.guest && <p class="muted small">Guests join the boards after sailing for 15 minutes. Sign in to keep your place.</p>}
      </div>
      <footer class="foot">
        <span class="muted">Updated every 30 seconds</span>
        <span class="hints-inline"><Hint k="ArrowLeft" k2="ArrowRight" pad="D-pad">Board</Hint><Hint k="Escape" pad="B">Close</Hint></span>
      </footer>
    </div>
  );
}
