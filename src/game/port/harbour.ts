// Restoring Alderhaven (the long goal): harbour projects, the coastwide fund, and the harbourmaster's welcome gifts.
import { homePort, poisNear } from '../../world';
import { SPECIES, SP, PROJECTS } from '../../econ';
import { sfx } from '../../audio';
import { NET, netGive } from '../../net';
import { track, bucket } from '../../analytics';
import type { Fish, NeedStatus, Port, Project, ProjectNeed } from '../../types';
import { G } from '../state';
import { dayNum, fishValue, hpMax, projDone } from '../rules';
import { addCoins, celebrate, markBought, toast } from '../feedback';
import { saveGame } from '../save';
import { money } from '../../config';
import { deny, header, short, spend, type Rows } from './kit';

// ---------- projects ----------
/** What a project still needs, and which fish in the hold would be donated (cheapest first). */
export function needStatus(nd: ProjectNeed): NeedStatus {
  const cheap = [...G.hold].sort((a, b) => fishValue(a) - fishValue(b));
  if ('any' in nd) {
    const pick = cheap.slice(0, nd.any);
    return { have: pick.length, want: nd.any, label: `${nd.any} fish of any kind`, pick };
  }
  if ('kinds' in nd) {
    const bySpecies = new Map<number, Fish>();
    for (const f of cheap) if (!bySpecies.has(f.sp)) bySpecies.set(f.sp, f);
    const pick = [...bySpecies.values()].slice(0, nd.kinds);
    return { have: pick.length, want: nd.kinds, label: `${nd.kinds} different species`, pick };
  }
  if ('trophy' in nd) {
    const pick = cheap.filter(f => f.trophy).slice(0, nd.trophy);
    return { have: pick.length, want: nd.trophy, label: `${nd.trophy} trophy fish`, pick };
  }
  const i = SP[nd.sp], name = SPECIES[i].name, pick = cheap.filter(f => f.sp === i).slice(0, nd.n);
  return { have: pick.length, want: nd.n, label: nd.n === 1 && name.startsWith('The ') ? name : `${nd.n} ${name}`, pick, sp: i };
}
export const nextProject = (): Project | null => PROJECTS.find(pr => !projDone(pr.id)) || null;
function fundProject(pr: Project): void {
  const st = needStatus(pr.need);
  if (st.have < st.want) { toast(`This project needs ${st.label} in your hold`, 'bad'); deny(); return; }
  if (!spend(pr.cost)) return;
  const gone = new Set(st.pick);
  G.hold = G.hold.filter(f => !gone.has(f));
  G.projects.push(pr.id);
  track('project_funded', { project: pr.id, done: G.projects.length });
  sfx('fanfare'); celebrate(); toast(`Project done: ${pr.name}. ${pr.gives}`, 'good'); markBought(pr.id);
  if (pr.id === 'lights') {                       // every lighthouse near home goes on the chart
    const hp = homePort();
    for (const q of poisNear(hp.x, hp.y, 1800)) if (q.type === 'light') G.found.add(q.id);
  }
  if (pr.id === 'grand' && G.story?.i !== 15) G.mode = 'finale';    // with the story running, Nell's homecoming plays first
  saveGame();
}

// ---------- the coastwide fund ----------
const FUND_DAILY = 50_000;   // the server's daily cap per sailor (convex/limits.ts)
let giving = false;          // one gift in flight at a time, so a held button can't spend twice
async function giveToFund(amt: number): Promise<void> {
  if (giving || G.coins < amt || !NET.authed || G.cheated) { deny(); return; }
  giving = true;
  addCoins(-amt); sfx('coin');
  const r = await netGive(amt, G.cheated);
  giving = false;
  if (r.ok) { toast(`You gave ${money(amt)} to the coastwide fund. Thank you!`, 'good'); track('fund_given', { amount_bucket: bucket(amt) }); }
  else { addCoins(amt); toast(`${r.why}. Your coins were returned`, 'bad'); }
  saveGame();
}

export function harbourItems(items: Rows): void {
  header(items, 'RESTORE ALDERHAVEN');
  const next = nextProject();
  for (const pr of PROJECTS) {
    const done = projDone(pr.id), cur = next === pr, st = needStatus(pr.need);
    const why = done ? 'Finished' : !cur ? `Finish "${next?.name}" first` : st.have < st.want ? `Bring ${st.label} (you have ${st.have})` : short(pr.cost);
    items.push({
      kind: 'project', key: pr.id, pr, st, icon: done ? 'star' : cur ? 'repair' : 'map', label: pr.name, sub: done ? pr.gives : `${money(pr.cost)} and ${st.label}`,
      cost: done ? null : pr.cost, right: done ? 'Done' : cur ? `${st.have}/${st.want}` : 'Later', ok: !done && cur && st.have >= st.want && G.coins >= pr.cost,
      why, action: 'Fund project', act: () => cur && !done ? fundProject(pr) : deny(), what: pr.what,
    });
  }
  if (!NET.on) return;
  header(items, 'COASTWIDE FUND');
  const f = NET.fund;
  for (const amt of [100, 1000, 10000]) items.push({
    kind: 'fund', key: 'fund' + amt, icon: 'coin', label: `Give ${money(amt)} to the coastwide fund`,
    sub: f ? `Round ${f.round}: ${money(f.total)} of ${money(f.goal)} from ${f.givers} sailor${f.givers === 1 ? '' : 's'}` : NET.authed ? 'Loading' : 'Connecting',
    cost: amt, right: money(amt), ok: NET.authed && !G.cheated && G.coins >= amt,
    why: G.cheated ? 'Saves that used cheats cannot give to the fund' : !NET.authed ? 'You are offline' : short(amt), action: 'Give', act: () => giveToFund(amt),
    what: `A gift for the whole coast: every sailor fills this fund together. When a round fills, the whole coast hears about it and the next round begins with a bigger goal. It buys nothing for you. Each sailor can give up to ${money(FUND_DAILY)} a day; you have given ${money(f?.mine || 0)} in all.`,
  });
}

// ---------- the harbourmaster ----------
// a small welcome, once per port per day: [weight, give]
const GIFTS: [number, () => string][] = [
  [40, () => { G.bait.shrimp = (G.bait.shrimp || 0) + 3; return '3 shrimp bait'; }],
  [25, () => { const n = 10 + Math.floor(Math.random() * 21); addCoins(n); return `$${n} for the trip`; }],
  [15, () => { G.bait.glow = (G.bait.glow || 0) + 1; return 'a glow lure'; }],
  [10, () => { G.bait.chum = (G.bait.chum || 0) + 1; return 'a bucket of chum'; }],
  [10, () => { G.boat.hp = Math.min(hpMax(), G.boat.hp + 20); return 'a free repair (+20 hull)'; }],
];
const CAT_NAMES = ['Biscuit', 'Pickle', 'Barnacle', 'Mackerel', 'Pip', 'Sardine', 'Captain', 'Mittens'];
export function harbourGift(p: Port): void {
  if (!G.pet && G.stats.caught >= 3) {
    G.pet = { name: CAT_NAMES[Math.floor(Math.random() * CAT_NAMES.length)] };
    toast(`A stray cat hops aboard. You name it ${G.pet.name}. Press P to pet`, 'good');
    setTimeout(() => sfx('meow'), 300);
  }
  const day = dayNum();
  if (G.gifts[p.id] === day) return;
  G.gifts[p.id] = day;
  let r = Math.random() * 100;
  const [, give] = GIFTS.find(([w]) => (r -= w) < 0) || GIFTS[0];
  toast(`The harbourmaster gives you ${give()}`, 'good');
}
