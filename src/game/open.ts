// Which regions are open (the rules only, with no sound or text, so the route planner and tests can use them):
// a region is some steps from Alderhaven Reach ('3:0') along the band grid, and each step opens after a story quest;
// a region you've been let into (G.unlocked) stays open. regions.ts has the rest: the border, the news, the cards.
import { G } from './state';
import { regionAt, type Region } from '../biome';

/** Steps from home: the region grid distance (band and place along it) from Alderhaven Reach ('3:0'). */
export function tier(id: string): number {
  const [b, k] = id.split(':').map(Number);
  return Math.abs(b - 3) + Math.abs(k);
}
// the story quest (index) that must be done for each step out; past the last, the last one's
const OPENS_AFTER = [0, 3, 7, 10, 13, 14];
export const needFor = (t: number): number => OPENS_AFTER[Math.min(t, OPENS_AFTER.length - 1)];
export const storyAt = (): number => G.story?.i ?? 0;

/** Is the region with this id open to sail into? */
export const regionOpenId = (id: string): boolean => storyAt() >= needFor(tier(id)) || G.unlocked.includes(id);
/** Is region r open to sail into? */
export const regionOpen = (r: Region): boolean => regionOpenId(r.id);
/** Is the sea at (x, y) closed to you yet? */
export const lockedAt = (x: number, y: number): boolean => !regionOpen(regionAt(x, y));
/** A short key for which regions are open: it changes whenever the chart's shading must (a step opens, a region is kept). */
export const openKey = (): string => OPENS_AFTER.filter(n => storyAt() >= n).length + '|' + G.unlocked.length;
