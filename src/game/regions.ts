// Regions opening up: the sea isn't all yours at the start. Each named region (biome.regionAt) lies some steps out
// from Alderhaven's (bands north and south, regions east and west along a band), and each step opens with the main
// story: Alderhaven Reach from the start, its neighbours once the pier is mended, and so on out. A region you've
// already sailed into, or start a voyage in, stays open. Sailing into a closed one meets rough water that turns
// the boat back (sailing reads lockPush), and the chart shows what opens it.
import { G } from './state';
import { toast } from './feedback';
import { sfx } from '../audio';
import { regionAt, type Region } from '../biome';
import { QUESTS } from '../story';
import { track } from '../analytics';
import { heightAt, poisNear } from '../world';
import { SPECIES, livesAt } from '../species';
import { seen } from './explore';

/** Steps from home: the region grid distance (band and place along it) from Alderhaven Reach ('3:0'). */
export function tier(id: string): number {
  const [b, k] = id.split(':').map(Number);
  return Math.abs(b - 3) + Math.abs(k);
}
// the story quest (index) that must be done for each step out; past the last, the last one's
const OPENS_AFTER = [0, 3, 7, 10, 13, 14];
const needFor = (t: number): number => OPENS_AFTER[Math.min(t, OPENS_AFTER.length - 1)];
const storyAt = (): number => G.story?.i ?? 0;

/** Is the region with this id open to sail into? */
export const regionOpenId = (id: string): boolean => storyAt() >= needFor(tier(id)) || G.unlocked.includes(id);
/** Is region r open to sail into? */
export const regionOpen = (r: Region): boolean => regionOpenId(r.id);
/** Is the sea at (x, y) closed to you yet? */
export const lockedAt = (x: number, y: number): boolean => !regionOpen(regionAt(x, y));
/** What opens region r, in a few words, or null if it's open. */
export function opensAfter(r: Region): string | null {
  if (regionOpen(r)) return null;
  const q = QUESTS[needFor(tier(r.id)) - 1];
  return q ? `Opens after "${q.title}"` : 'Opens later in the story';
}

// ---------- the border ----------
let lastOpen: { x: number; y: number } | null = null, warnedAt = -99, inside = 0;
const blockedOnce = new Set<string>();
/**
 * While sailing: the push (world units per second squared) that turns the boat back out of a closed region, or null
 * in open water. It points back the way the boat came in and grows the deeper it goes, so a boat is turned within a
 * few lengths; it never traps a boat that started inside (that region simply opens).
 */
export function lockPush(x: number, y: number, dt: number): { x: number; y: number } | null {
  if (!lockedAt(x, y)) { lastOpen = { x, y }; inside = 0; return null; }
  if (!lastOpen) { G.unlocked.push(regionAt(x, y).id); return null; }      // a voyage that starts here: never stuck
  inside += dt;
  if (G.t - warnedAt > 6) {
    warnedAt = G.t;
    const r = regionAt(x, y);
    toast(`Rough water: ${r.name}. ${opensAfter(r)}`, 'bad'); sfx('slap', 0.6);
    if (!blockedOnce.has(r.id)) { blockedOnce.add(r.id); track('region_blocked', { region: r.name, step: tier(r.id), story_i: storyAt() }); }
  }
  const dx = lastOpen.x - x, dy = lastOpen.y - y, d = Math.hypot(dx, dy) || 1, k = 120 + 260 * Math.min(1, inside);
  return { x: dx / d * k, y: dy / d * k };
}

// ---------- new waters ----------
let openTier = -1;
/** Announces the regions a story step has just opened (called with the story's progress, a few times a second). */
export function tickRegions(): void {
  let t = 0;
  while (t < 9 && storyAt() >= needFor(t + 1)) t++;
  if (openTier < 0) { openTier = t; return; }                      // what's open at load needs no fanfare
  if (t === openTier) return;
  const up = t > openTier;
  openTier = t;
  if (!up) return;                                                   // a different save loaded
  toast('New waters are open: sail out past the rough water', 'good'); sfx('fanfare', 0.6);
  track('region_opened', { step: t, story_i: storyAt() });
  newWaters.at = G.t; newWaters.tier = t;
}
/** A short key for which regions are open: it changes whenever the chart's shading must (a step opens, a region is kept). */
export const openKey = (): string => OPENS_AFTER.filter(n => storyAt() >= n).length + '|' + G.unlocked.length;
/** The last opening, for the banner and the chart's glow on the newly opened regions. */
export const newWaters = { at: -99, tier: 0 };

// ---------- what each kind of region is like ----------
const ABOUT: Record<string, string> = {
  'Alderhaven Reach': 'Home waters. Green islands, calm seas and easy fish.',
  'Amber Isles': 'Autumn woods to the edge of the sea. Steady fishing, few storms.',
  'Meadowmere': 'Wide, gentle meadows and shallow bays.',
  'Blossom Coast': 'Pink trees over warm, clear reefs.',
  'Pinewood Isles': 'Dark pine forests over cold kelp water.',
  'Birchholm': 'Pale birch woods and open water.',
  'Chalk Downs': 'White cliffs and kelp at their feet.',
  'Bogmoor': 'Low, wet islands and slow brown channels.',
  'Ember Reach': 'Black sand and smoking peaks. Fish that love hot water.',
  'Basalt Shelf': 'Columns of dark rock standing in the sea.',
  'Fungal Hollows': 'Strange glowing islands. Few go there.',
  'Fjordlands': 'Steep cold inlets. Deep water right up to the cliffs.',
  'Glacier Sound': 'Ice to the waterline and icebergs in the channels.',
  'Frozen Reach': 'The edge of the map. Ice, fog and the largest fish.',
  'Mangrove Channels': 'Tangled roots and muddy water full of life.',
  'Mangrove Delta': 'A maze of mangroves where the rivers meet the sea.',
  'Sunlit Atolls': 'White sand rings around bright lagoons.',
  'Dune Coast': 'Hot sand hills down to the water.',
  'Red Mesas': 'Flat red rock towers above warm seas.',
  'Bamboo Reach': 'Green bamboo isles and warm reefs.',
};
// ---------- a region's card ----------
interface Survey { pts: number[]; fish: number[]; places: { id: string; type: string }[] }
const surveys = new Map<string, Survey>();
/** Region r surveyed once: sample points across it (water ones flagged), the fish that live there, its places. */
function survey(r: Region): Survey {
  let s = surveys.get(r.id);
  if (s) return s;
  const pts: number[] = [], fish = new Set<number>(), R = 1800, N = 16;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = r.centre.x + (i / (N - 1) - 0.5) * 2 * R, y = r.centre.y + (j / (N - 1) - 0.5) * 2 * R;
    if (regionAt(x, y).id !== r.id) continue;
    pts.push(x, y);
    const h = heightAt(x, y);
    if (h < -0.05) for (let sp = 0; sp < SPECIES.length; sp++) if (!SPECIES[sp].legend && livesAt(sp, x, y, h)) fish.add(sp);
  }
  const places = poisNear(r.centre.x, r.centre.y, R).filter(p => regionAt(p.x, p.y).id === r.id).map(p => ({ id: p.id, type: p.type }));
  s = { pts, fish: [...fish].sort((a, b) => SPECIES[a].base - SPECIES[b].base), places };
  surveys.set(r.id, s);
  return s;
}
/** What the chart's region card shows: how much of it you've seen, its places charted, and its fish (logged or not). */
export function regionInfo(r: Region): { seenPct: number; charted: number; places: number; fish: { sp: number; logged: boolean }[] } {
  const s = survey(r);
  let n = 0;
  for (let i = 0; i < s.pts.length; i += 2) if (seen(s.pts[i], s.pts[i + 1])) n++;
  return {
    seenPct: s.pts.length ? Math.round(n / (s.pts.length / 2) * 100) : 0,
    charted: s.places.filter(p => G.found.has(p.id)).length, places: s.places.length,
    fish: s.fish.map(sp => ({ sp, logged: !!G.log[SPECIES[sp].id] })),
  };
}

/** A line about region r. */
export const regionAbout = (r: Region): string => ABOUT[r.name.replace(/^(Far )?(West |East )/, '')] ?? '';
