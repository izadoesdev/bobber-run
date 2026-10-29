import type { BiomeId } from '../biome';
import type { BaitKind, FightStyle, ProjectId } from '../types';

/**
 * What a quest asks for. Counting objectives (catch, sell) count from when the quest starts; state objectives
 * (chart, fund, visit) are checked against the game as it is.
 */
export type Objective =
  | {
      catch: number; species?: string; trophy?: true; variant?: string; region?: BiomeId; night?: true;
      weather?: 'rain' | 'storm';   // rain counts storms too
      fight?: FightStyle;           // the species fights this way
      kg?: number;                  // at least this heavy
      lightRod?: true;              // on the lightest rod that can land it (no rod to spare)
      inARow?: true;                // the count must come in a row: a rod catch that doesn't fit starts it over
      stars?: 1 | 2 | 3;            // at least this many stars (rod catches)
      perfect?: true;               // landed after a perfect strike
    }
  | { sell: number }                                       // coins taken at the market while the quest runs
  | { chart: number; kind: 'port' | 'light' | 'wreck' }    // places on your chart, in all
  | { visit: { x: number; y: number; r?: number }; place: string }   // sail within r (default 60) of a spot; `place` names it
  | { site: string; r?: number; place?: string }          // sail within r (default 90) of a region site (world.regionSite)
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
// Missing status preserves legacy running stories.
export interface PackState { i: number; n: number; started: boolean; status?: 'active' | 'paused' }
export type PackStatus = 'available' | 'active' | 'paused' | 'done';
