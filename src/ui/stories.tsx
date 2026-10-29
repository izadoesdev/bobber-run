import { G } from '../game/state';
import { money } from '../config';
import { heightAt, regionSite, type RegionSite } from '../world';
import { regionAt } from '../biome';
import { opensAfter } from '../game/regions';
import { packJournal, packLines, setPackStatus } from '../content/engine';
import type { PackStatus, Reward } from '../content/types';
import { sailToWaypoint, setWaypoint } from '../waypoint';
import { Face } from './faces';
import { Icon } from './parts';

type StoryEntry = ReturnType<typeof packJournal>[number];
const GROUPS: { status: PackStatus; label: string }[] = [
  { status: 'active', label: 'Active stories' },
  { status: 'available', label: 'Available stories' },
  { status: 'paused', label: 'Paused stories' },
  { status: 'done', label: 'Completed stories' },
];
const STATUS: Record<PackStatus, string> = { active: 'Active', available: 'Optional', paused: 'Paused', done: 'Complete' };
function rewardText(reward: Reward): string {
  const bait = Object.entries(reward.bait ?? {}).map(([kind, amount]) => `${amount} ${kind} bait`);
  return [reward.coins ? money(reward.coins) : '', ...bait].filter(Boolean).join(' · ');
}

export function Stories() {
  const entries = packJournal();
  if (!entries.length) return null;
  return (
    <section class="stories" aria-label="Optional stories">
      <h2>Optional stories</h2>
      <p class="muted small">Exploring adds stories here. Start one when you want a side quest. Pause any time without losing progress.</p>
      {GROUPS.map(({ status, label }) => {
        const rows = entries.filter(e => e.status === status);
        return rows.length > 0 && <details class="story-group" key={status} open={status === 'active'}>
          <summary>{label} <span class="muted">({rows.length})</span></summary>
          {rows.map(entry => <StoryCard key={entry.pack.id} entry={entry} />)}
        </details>;
      })}
    </section>
  );
}

function StoryCard({ entry }: { entry: StoryEntry }) {
  const { pack, quest, status, have, want, completed } = entry;
  const who = pack.characters.find(c => c.id === quest?.by) ?? pack.characters[0];
  const reward = quest && rewardText(quest.reward);
  return (
    <article class="story-entry" data-story={pack.id}>
      <header class="row">
        <Face name={who.name} role={who.role} size="s" />
        <div class="grow"><b>{pack.name}</b><div class="sub">{who.name} · {who.role}</div></div>
        <span class={'stamp' + (status === 'active' ? ' gold' : '')}>{STATUS[status]}</span>
      </header>
      {quest ? <>
        <h3>{quest.title}</h3>
        <p><span class="caps small">Goal</span> {quest.goal}{status !== 'available' && <span class="num gold"> · {have}/{want}</span>}</p>
        {quest.hint && <p class="muted small">{quest.hint}</p>}
        {reward && <p class="small"><span class="caps muted">Reward</span> {reward}</p>}
        <details class="story-dialogue"><summary>Read conversation</summary>
          {packLines(pack, quest, quest.intro).map((l, i) => <p key={i}><b>{l.name}:</b> {l.text}</p>)}
        </details>
        <div class="row story-actions">
          {status === 'active'
            ? <button data-track="story-pause" class="btn small-btn" onClick={() => setPackStatus(pack.id, 'paused')}>Pause story</button>
            : <button data-track="story-start" class="btn small-btn primary" onClick={() => setPackStatus(pack.id, 'active')}>{status === 'paused' ? 'Resume story' : 'Start story'}</button>}
          {status === 'active' && 'site' in quest.obj && !have && <SailToSite id={quest.obj.site} reach={quest.obj.r ?? 90} />}
        </div>
      </> : <p class="good"><Icon k="star" size="s" /> All quests complete</p>}
      {completed > 0 && <details class="story-dialogue"><summary>Story so far · {completed}/{pack.quests.length} quests</summary>
        {pack.quests.slice(0, completed).map(q => <div key={q.id}><h3>{q.title}</h3>
          {packLines(pack, q, [...q.intro, ...q.outro]).map((l, i) => <p key={i}><b>{l.name}:</b> {l.text}</p>)}
        </div>)}
      </details>}
    </article>
  );
}

function SailToSite({ id, reach }: { id: string; reach: number }) {
  const site = regionSite(id), locked = site && opensAfter(regionAt(site.x, site.y));
  if (locked) return <span class="muted small">{locked}</span>;
  const go = () => {
    if (!site) return;
    const at = siteLanding(site, reach);
    setWaypoint(at.x, at.y);
    sailToWaypoint();
    G.mode = 'play';
  };
  return <button data-track="story-sail" class="btn small-btn" onClick={go}>Sail there</button>;
}

function siteLanding(site: RegionSite, reach: number): { x: number; y: number } {
  for (let radius = 0; radius < reach - 5; radius += 10) {
    for (let i = 0; i < 24; i++) {
      const angle = site.a + i / 24 * Math.PI * 2;
      const x = site.x + Math.cos(angle) * radius, y = site.y + Math.sin(angle) * radius;
      if (heightAt(x, y) < -0.06) return { x, y };
    }
  }
  return { x: site.x, y: site.y };
}
