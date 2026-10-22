// The content format: packs of characters and quest chains, written as plain data (src/content/packs/*.ts) and run
// by src/content/engine.ts alongside the main story. tests/content.test.ts checks every pack, so a typo in a species
// id or a character name fails CI rather than a player's quest.
import type { BiomeId } from '../biome';
import type { BaitKind, ProjectId } from '../types';

/**
 * What a quest asks for. Counting objectives (catch, sell) count from when the quest starts; state objectives
 * (chart, fund, visit) are checked against the game as it is.
 */
export type Objective =
  | { catch: number; species?: string; trophy?: true; variant?: string; region?: BiomeId; night?: true }
  | { sell: number }                                       // coins taken at the market while the quest runs
  | { chart: number; kind: 'port' | 'light' | 'wreck' }    // places on your chart, in all
  | { visit: { x: number; y: number; r?: number }; place: string }   // sail within r (default 60) of a spot; `place` names it
  | { fund: ProjectId };

export interface Reward { coins?: number; bait?: Partial<Record<BaitKind, number>> }
export interface QuestDef {
  id: string;
  /** the character who gives it (an id from the pack's characters) */
  by: string;
  title: string;
  /** one plain line: what to do */
  goal: string;
  hint?: string;
  obj: Objective;
  reward: Reward;
  /** spoken when the quest starts, and when it's done (by `by` unless a line names someone else as "id: text") */
  intro: string[];
  outro: string[];
}
export interface Character { id: string; name: string; role: string }
export interface Pack {
  id: string;
  name: string;
  /** when the pack opens: once the main story reaches quest `afterQuest`, and/or once you first sail into `region` */
  unlock: { afterQuest?: number; region?: BiomeId };
  characters: Character[];
  quests: QuestDef[];
}
/** Progress through one pack: the quest it's on, the count toward that quest's objective, and whether it began. */
export interface PackState { i: number; n: number; started: boolean }
