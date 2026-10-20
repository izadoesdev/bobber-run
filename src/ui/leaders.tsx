// The leaderboard: the coast's top captains by species logged, world records, heaviest fish, fish caught and coins
// earned, with your own rank underneath. Each tab is fetched once when shown and kept for half a minute.
import { G } from '../game';
import { NET, leaders, weeklyBoard, type LeaderBy, type Leaders, type WeeklyBoard } from '../net';
import { tideEndsIn } from '../tides';
import { Fish, Hint } from './parts';
import { SP, fmtKg } from '../econ';
import { money } from '../config';

export const BOARDS: { by: LeaderBy | 'week'; label: string; what: string }[] = [
  { by: 'week', label: 'This week', what: 'Heaviest catch of each running fish' },
  { by: 'species', label: 'Species', what: 'Most species logged' },
  { by: 'records', label: 'Records', what: 'Most world records held' },
  { by: 'heaviest', label: 'Heaviest', what: 'Heaviest single fish' },
  { by: 'caught', label: 'Caught', what: 'Most fish caught' },
  { by: 'earned', label: 'Earned', what: 'Most coins earned' },
];
const KEEP_MS = 30_000;
interface Fetched<T> { at: number; data: T | null; loading: boolean }
const cache = new Map<LeaderBy | 'week', Fetched<unknown>>();
/** A board's last fetch, fetched again (keeping the old rows meanwhile) once it is older than KEEP_MS. */
function fetched<T>(by: LeaderBy | 'week', load: () => Promise<T | null>): Fetched<T> {
  let c = cache.get(by) as Fetched<T> | undefined;
  if (!c || (!c.loading && Date.now() - c.at > KEEP_MS)) {
    const entry: Fetched<T> = c = { at: Date.now(), data: c?.data ?? null, loading: true };
    cache.set(by, entry);
    void load().then(d => { entry.data = d; entry.loading = false; entry.at = Date.now(); });
  }
  return c;
}
const show = (by: LeaderBy, v: number): string => by === 'heaviest' ? fmtKg(v) : by === 'earned' ? money(v) : String(v);
// one ranked line on a board, yours highlighted
const Rank = ({ i, r, value }: { i: number; r: { name: string; admin?: boolean; label?: string }; value: string }) => (
  <li class={r.name === NET.profile?.name ? 'me' : ''}>
    <span class="rank">{i + 1}</span>
    <span class="grow">{r.admin && <b class="gold" title="Admin">★ </b>}{r.name}</span>
    {r.label && <span class="muted">{r.label}</span>}
    <span class="num">{value}</span>
  </li>
);

function ThisWeek() {
  const { data, loading } = fetched<WeeklyBoard>('week', weeklyBoard);
  if (!data) return <p class="muted">{loading ? 'Loading…' : 'The weekly boards could not be loaded. Try again in a moment.'}</p>;
  return (
    <>
      <p>These fish are running this week: they sell for a quarter more, and the heaviest catch of each tops its board. A new tide table comes in {tideEndsIn()}.</p>
      <div class="week-grid">{data.species.map(s => (
        <div class="week-card">
          <div class="row"><Fish sp={SP[s.id]} size="s" /><b>{s.name}</b>{s.mine != null && <span class="muted small">yours {fmtKg(s.mine)}</span>}</div>
          {s.top.length ? <ol class="board">{s.top.map((r, i) => <Rank i={i} r={r} value={fmtKg(r.value)} />)}</ol> : <p class="muted small">No catches yet this week.</p>}
        </div>
      ))}</div>
    </>
  );
}
export function Leaderboard() {
  const tab = G.leaderTab % BOARDS.length, b = BOARDS[tab], { data, loading } = b.by === 'week' ? { data: null, loading: false } : fetched<Leaders>(b.by, () => leaders(b.by as LeaderBy));
  return (
    <div class="screen paper doc leaders">
      <header class="head"><h1>Leaderboard</h1><span class="muted">{b.what}</span></header>
      <nav class="tabs">
        {BOARDS.map((x, i) => <button data-track={`leaders-${x.label}`} class={'tab' + (i === tab ? ' on' : '')} onClick={() => { G.leaderTab = i; }}>{x.label}</button>)}
      </nav>
      <div class="body">
        {!NET.on ? <p>The leaderboard needs an internet connection.</p>
          : b.by === 'week' ? <ThisWeek />
          : !data ? <p class="muted">{loading ? 'Loading…' : 'The leaderboard could not be loaded. Try again in a moment.'}</p>
          : data.rows.length === 0 ? <p class="muted">No captains on this board yet. Be the first.</p>
          : (
            <ol class="board">{data.rows.map((r, i) => <Rank i={i} r={r} value={show(b.by as LeaderBy, r.value)} />)}</ol>
          )}
        {data?.me && data.me.rank > 0 && <p class="mine">You are <b>#{data.me.rank}</b> with {show(b.by as LeaderBy, data.me.value)}.</p>}
        {data && !(data.me && data.me.rank > 0) && NET.profile?.guest && <p class="muted small">Guests join the boards after sailing for 15 minutes. Sign in to keep your place.</p>}
      </div>
      <footer class="foot">
        <span class="muted">Updated every 30 seconds</span>
        <span class="hints-inline"><Hint k="ArrowLeft" k2="ArrowRight" pad="D-pad">Board</Hint><Hint k="Escape" pad="B">Close</Hint></span>
      </footer>
    </div>
  );
}
