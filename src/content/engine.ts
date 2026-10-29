import { G } from '../game/state';
import { addCoins, toast } from '../game/feedback';
import { isNight } from '../game/rules';
import { saveGame } from '../game/save';
import { biomeAt } from '../biome';
import { WX } from '../weather';
import { regionSite } from '../world';
import { SPECIES } from '../species';
import type { Fish } from '../types';
import { PACKS } from './packs';
import type { Objective, Pack, PackState, PackStatus, QuestDef } from './types';

export interface PackLine { name: string; role: string; text: string }

const stateOf = (pack: Pack): PackState => G.packs[pack.id] ?? { i: 0, n: 0, started: false };

export function packStatus(pack: Pack): PackStatus {
  const state = stateOf(pack);
  if (state.i >= pack.quests.length) return 'done';
  return state.status ?? (state.started || state.i > 0 ? 'active' : 'available');
}

function isOpen({ unlock }: Pack): boolean {
  return (unlock.afterQuest === undefined || (G.story?.i ?? 0) >= unlock.afterQuest)
    && (unlock.region === undefined || G.regionsSeen.includes(unlock.region));
}

function activeQuest(pack: Pack): { quest: QuestDef; state: PackState } | null {
  if (!isOpen(pack) || packStatus(pack) !== 'active') return null;
  const state = stateOf(pack), quest = pack.quests[state.i];
  return quest && state.started ? { quest, state } : null;
}

// A recognized "id: text" prefix overrides the quest's speaker.
export function packLines(pack: Pack, quest: QuestDef, lines: string[]): PackLine[] {
  const narrator = pack.characters.find(c => c.id === quest.by)!;
  return lines.map(line => {
    const match = /^([a-z0-9-]+): (.*)$/.exec(line);
    const speaker = match && pack.characters.find(c => c.id === match[1]);
    const character = speaker || narrator;
    return { name: character.name, role: character.role, text: match && speaker ? match[2] : line };
  });
}

export function progress(quest: QuestDef, state: PackState): [number, number] {
  const objective = quest.obj;
  if ('catch' in objective) return [Math.min(state.n, objective.catch), objective.catch];
  if ('sell' in objective) return [Math.min(state.n, objective.sell), objective.sell];
  if ('chart' in objective) return [Math.min(objective.chart, [...G.found].filter(id => id.startsWith(objective.kind + ':')).length), objective.chart];
  if ('fund' in objective) return [G.projects.includes(objective.fund) ? 1 : 0, 1];
  const boat = G.boat;
  if ('site' in objective) {
    const site = regionSite(objective.site);
    return [site && Math.hypot(boat.x - site.x, boat.y - site.y) < (objective.r ?? 90) ? 1 : 0, 1];
  }
  return [Math.hypot(boat.x - objective.visit.x, boat.y - objective.visit.y) < (objective.visit.r ?? 60) ? 1 : 0, 1];
}

export function setPackStatus(id: string, status: 'active' | 'paused'): boolean {
  const pack = PACKS.find(pack => pack.id === id);
  if (!pack || !isOpen(pack)) return false;
  const previous = packStatus(pack);
  if (previous === 'done' || (status === 'paused' && previous === 'available')) return false;
  const state = stateOf(pack);
  state.status = status;
  if (status === 'active') state.started = true;
  G.packs[id] = state;
  saveGame();
  return true;
}

type CatchObjective = Extract<Objective, { catch: number }>;
function fits(objective: CatchObjective, fish: Fish, x: number, y: number): boolean {
  const species = SPECIES[fish.sp];
  return (!objective.species || species?.id === objective.species)
    && (!objective.trophy || fish.trophy)
    && (!objective.variant || fish.variant === objective.variant)
    && (!objective.region || biomeAt(x, y) === objective.region)
    && (!objective.night || isNight())
    && (!objective.weather || WX.state === 'storm' || (objective.weather === 'rain' && WX.state === 'rain'))
    && (!objective.fight || species?.fight === objective.fight)
    && (!objective.kg || fish.kg >= objective.kg)
    && (!objective.lightRod || G.up.rod <= (species?.rod ?? 0))
    && (!objective.stars || (fish.stars ?? 0) >= objective.stars)
    && (!objective.perfect || !!fish.perfect);
}

// Nets, pots and deckhands don't break rod-catch streaks.
export function packCatch(fish: Fish, x: number, y: number, byRod = true): void {
  for (const pack of PACKS) {
    const active = activeQuest(pack);
    if (!active || !('catch' in active.quest.obj)) continue;
    if (fits(active.quest.obj, fish, x, y)) active.state.n++;
    else if (active.quest.obj.inARow && byRod) active.state.n = 0;
  }
}

export function packSell(coins: number): void {
  for (const pack of PACKS) {
    const active = activeQuest(pack);
    if (active && 'sell' in active.quest.obj) active.state.n += coins;
  }
}

let elapsed = 0;
export function tickPacks(dt: number): void {
  if (G.mode !== 'play' || G.talk) return;
  if ((elapsed += dt) < 1) return;
  elapsed = 0;
  const region = biomeAt(G.boat.x, G.boat.y);
  if (!G.regionsSeen.includes(region)) G.regionsSeen.push(region);
  if (G.fish || G.card) return;
  for (const pack of PACKS) {
    if (!isOpen(pack) || packStatus(pack) !== 'active') continue;
    const state = stateOf(pack), quest = pack.quests[state.i];
    if (!quest) continue;
    // Legacy saves can sit between quests with started=false.
    if (!state.started) { state.started = true; G.packs[pack.id] = state; }
    const [have, want] = progress(quest, state);
    if (have < want) continue;
    if (quest.reward.coins) addCoins(quest.reward.coins);
    for (const [bait, amount] of Object.entries(quest.reward.bait ?? {})) G.bait[bait as keyof typeof G.bait] = (G.bait[bait as keyof typeof G.bait] || 0) + (amount ?? 0);
    state.i++;
    state.n = 0;
    state.started = state.i < pack.quests.length;
    state.status = 'active';
    saveGame();
    toast(`Story complete: ${quest.title}${quest.reward.coins ? `  +$${quest.reward.coins}` : ''}. Journal updated`, 'good');
    return;
  }
}

export function packJournal(): { pack: Pack; quest: QuestDef | null; status: PackStatus; have: number; want: number; completed: number }[] {
  return PACKS.filter(isOpen).map(pack => {
    const state = stateOf(pack), quest = pack.quests[state.i] ?? null, status = packStatus(pack);
    const [have, want] = quest ? progress(quest, status === 'available' ? { ...state, n: 0 } : state) : [0, 0];
    return { pack, quest, status, have, want, completed: Math.min(state.i, pack.quests.length) };
  });
}
