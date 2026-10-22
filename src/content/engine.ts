// Runs the content packs (src/content/packs) beside the main story: a pack opens when its unlock is met, its quests
// run one after another, catches and sales count toward them as they happen, and charting, funding and visiting are
// checked about once a second. Progress lives in G.packs and the regions you've sailed into in G.regionsSeen, both
// saved. The UI shows the lines through setPackTalk (until then they appear as toasts).
import { G } from '../game/state';
import { addCoins, toast } from '../game/feedback';
import { isNight } from '../game/rules';
import { biomeAt, type BiomeId } from '../biome';
import { SPECIES } from '../species';
import type { Fish } from '../types';
import { PACKS } from './packs';
import type { Character, Objective, Pack, PackState, QuestDef } from './types';

export interface PackLine { name: string; role: string; text: string }
let talk: (lines: PackLine[]) => void = lines => { for (const l of lines) toast(`${l.name}: ${l.text}`); };
/** The UI's dialogue box for pack lines (it falls back to toasts). */
export const setPackTalk = (fn: (lines: PackLine[]) => void): void => { talk = fn; };

const stateOf = (p: Pack): PackState => (G.packs[p.id] ??= { i: 0, n: 0, started: false });
const isOpen = (p: Pack): boolean => {
  const u = p.unlock;
  return (u.afterQuest === undefined || (G.story?.i ?? 0) >= u.afterQuest) && (u.region === undefined || G.regionsSeen.includes(u.region));
};
/** "id: text" is spoken by that character; a plain line by whoever gave the quest. */
function lines(p: Pack, q: QuestDef, raw: string[]): PackLine[] {
  const who = (id: string): Character | undefined => p.characters.find(c => c.id === id);
  return raw.map(l => { const m = /^([a-z0-9-]+): (.*)$/.exec(l), c = (m && who(m[1])) || who(q.by)!; return { name: c.name, role: c.role, text: m && who(m[1]) ? m[2] : l }; });
}

/** How far the current quest of a pack has come: [have, want]. */
export function progress(q: QuestDef, s: PackState): [number, number] {
  const o: Objective = q.obj;
  if ('catch' in o) return [Math.min(s.n, o.catch), o.catch];
  if ('sell' in o) return [Math.min(s.n, o.sell), o.sell];
  if ('chart' in o) return [Math.min(o.chart, [...G.found].filter(id => id.startsWith(o.kind + ':')).length), o.chart];
  if ('fund' in o) return [G.projects.includes(o.fund) ? 1 : 0, 1];
  const b = G.boat;
  return [Math.hypot(b.x - o.visit.x, b.y - o.visit.y) < (o.visit.r ?? 60) ? 1 : 0, 1];
}
const current = (p: Pack): { q: QuestDef; s: PackState } | null => { const s = stateOf(p), q = p.quests[s.i]; return q && s.started ? { q, s } : null; };

/** A fish was landed at (x, y): it counts toward every running catch objective it fits. */
export function packCatch(fish: Fish, x: number, y: number): void {
  for (const p of PACKS) {
    const cur = isOpen(p) ? current(p) : null, o = cur?.q.obj;
    if (!cur || !o || !('catch' in o)) continue;
    if (o.species && SPECIES[fish.sp]?.id !== o.species) continue;
    if (o.trophy && !fish.trophy) continue;
    if (o.variant && fish.variant !== o.variant) continue;
    if (o.region && biomeAt(x, y) !== o.region) continue;
    if (o.night && !isNight()) continue;
    cur.s.n++;
  }
}
/** Coins taken at a market: they count toward running sell objectives. */
export function packSell(coins: number): void {
  for (const p of PACKS) { const cur = isOpen(p) ? current(p) : null; if (cur && 'sell' in cur.q.obj) cur.s.n += coins; }
}

let acc = 0;
/** Per frame from the main loop: notes the region you're in, starts and finishes quests (about once a second). */
export function tickPacks(dt: number): void {
  if ((acc += dt) < 1 || G.mode !== 'play' || G.talk) return;
  acc = 0;
  const here: BiomeId = biomeAt(G.boat.x, G.boat.y);
  if (!G.regionsSeen.includes(here)) G.regionsSeen.push(here);
  for (const p of PACKS) {
    if (!isOpen(p)) continue;
    const s = stateOf(p), q = p.quests[s.i];
    if (!q) continue;                                                     // the pack is finished
    if (!s.started) {                                                     // one new conversation a second, at most
      s.started = true; s.n = 0;
      if (s.i === 0) toast(`A new story: ${p.name}`, 'good');
      talk(lines(p, q, q.intro));
      return;
    }
    const [have, want] = progress(q, s);
    if (have < want) continue;
    if (q.reward.coins) addCoins(q.reward.coins);
    for (const [k, n] of Object.entries(q.reward.bait ?? {})) G.bait[k as keyof typeof G.bait] = (G.bait[k as keyof typeof G.bait] || 0) + (n ?? 0);
    toast(`${q.title} done${q.reward.coins ? `  +$${q.reward.coins}` : ''}`, 'good');
    talk(lines(p, q, q.outro));
    s.i++; s.n = 0; s.started = false;
    return;
  }
}
/** Every open pack with its current quest and progress, for the journal. */
export function packJournal(): { pack: Pack; quest: QuestDef | null; have: number; want: number }[] {
  return PACKS.filter(isOpen).map(pack => {
    const s = stateOf(pack), quest = pack.quests[s.i] ?? null, [have, want] = quest && s.started ? progress(quest, s) : [0, 0];
    return { pack, quest, have, want };
  });
}
