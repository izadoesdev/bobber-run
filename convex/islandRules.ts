// Island rules shared by the server and the game (no Convex imports, so the client can use them too).
// Each 560-unit world cell's main island can be claimed, Alderhaven's included.
import { hash, mulberry } from '../src/noise';

export const ISLAND_CELL = 560, MAX_ISLANDS = 6, ISLAND_NAME_MAX = 24, LOGO_MAX_BYTES = 16 * 1024;

// ---------- where each cell's main island is (the world generator's first draws, so the server knows them too) ----------
// how big main islands are: tuned for open channels between islands (about a fifth of the sea near home is land)
export const ISLAND_SCALE = 0.75;
// islands bought before World 3 keep the size they were bought at (Alderhaven, 0,0, never changed)
const KEPT_SIZE = new Set(['0,-1', '2,-2']);
export const HOME_ISLAND = { x: 280, y: 280, R: 145, peak: 0.8 };
export interface MainIsland { x: number; y: number; R: number; peak: number }
/**
 * The main island of cell (i, j), or null (about 28% of cells have none), drawn from `r`, the cell's generator
 * (mulberry(hash(i, j, 7))), which world.ts goes on drawing the cell's islets from.
 */
export function drawMainIsland(i: number, j: number, r: () => number): MainIsland | null {
  if (i === 0 && j === 0) return { ...HOME_ISLAND };
  if (r() >= 0.72) return null;
  const ox = i * ISLAND_CELL, oy = j * ISLAND_CELL;
  const x = ox + ISLAND_CELL * (0.3 + 0.4 * r()), y = oy + ISLAND_CELL * (0.3 + 0.4 * r());
  const R = (75 + Math.pow(r(), 1.25) * 230) * (KEPT_SIZE.has(`${i},${j}`) ? 1 : ISLAND_SCALE), peak = 0.6 + 0.4 * r();
  return { x, y, R, peak };
}
/** The main island of cell (i, j), or null. */
export const mainIsland = (i: number, j: number): MainIsland | null => drawMainIsland(i, j, mulberry(hash(i, j, 7)));
export const islandKey = (i: number, j: number): string => `${i},${j}`;
export const isClaimable = (key: string): boolean => /^-?\d{1,4},-?\d{1,4}$/.test(key);
// ---------- prices, in the game's coins ----------
// An island is the end game: a small one far out costs about what a captain earns in a few hours at sea with the
// best boat, a large one near home many times that, and Alderhaven itself, the crown of the coast, the most.
export const CROWN_PRICE = 2_500_000;
const PRICE_BASE = 100_000, PRICE_PER_SIZE = 300_000;
/**
 * Coins for the main island of cell (i, j), or null when the cell has none: by its area (radius squared) and how
 * near home it lies (a far island costs half what the same island would at home), rounded to $5,000.
 */
export function islandPrice(i: number, j: number): number | null {
  const m = mainIsland(i, j);
  if (!m) return null;
  if (i === 0 && j === 0) return CROWN_PRICE;
  const d = Math.hypot(m.x - HOME_ISLAND.x, m.y - HOME_ISLAND.y), near = 0.5 + 0.5 / (1 + Math.pow(d / 4000, 1.5));
  return Math.min(CROWN_PRICE - 500_000, Math.round((PRICE_BASE + PRICE_PER_SIZE * (m.R / 100) ** 2 * near) / 5000) * 5000);   // below the crown, even for the two oversized old islands
}
export const priceOfKey = (key: string): number | null => { const [i, j] = key.split(',').map(Number); return islandPrice(i, j); };

// ---------- buildings: what makes islands a kingdom ----------
export type BuildingId = 'dock' | 'hall' | 'keep' | 'castle' | 'fishery' | 'market' | 'garden' | 'lighthouse' | 'shipyard';
export interface Building {
  name: string; cost: number;
  /** built first */
  needs?: BuildingId;
  /** coins a minute for an island of radius 100 (scaled by the island's size), collected at your islands */
  income?: number;
  what: string;
}
export const BUILDINGS: Record<BuildingId, Building> = {
  dock:       { name: 'Dock', cost: 40_000, what: 'Moor at your island and open it from the water' },
  garden:     { name: 'Gardens', cost: 60_000, income: 40, what: 'Orchards and kitchen gardens: a small steady income' },
  fishery:    { name: 'Fishery', cost: 150_000, needs: 'dock', income: 220, what: 'Boats and smokehouses that fish for you' },
  market:     { name: 'Market', cost: 220_000, needs: 'dock', income: 160, what: 'Sell your catch here at a good price, and trade brings in coin' },
  lighthouse: { name: 'Lighthouse', cost: 120_000, what: 'Lights your island by night and charts the sea round it' },
  shipyard:   { name: 'Shipyard', cost: 400_000, needs: 'dock', what: 'Change between your boats at your own island' },
  hall:       { name: 'Hall', cost: 90_000, what: 'A hall in place of the cottage: your seat on the island' },
  keep:       { name: 'Keep', cost: 450_000, needs: 'hall', what: 'A stone keep: your islands bring in 15% more' },
  castle:     { name: 'Castle', cost: 1_400_000, needs: 'keep', what: 'A castle: your islands bring in 40% more, and everyone sees it' },
};
export const BUILDING_IDS = Object.keys(BUILDINGS) as BuildingId[];
export const isBuilding = (b: string): b is BuildingId => b in BUILDINGS;
/** Why `b` can't be built on an island that has `have`, or null. */
export function cantBuild(b: BuildingId, have: readonly string[]): string | null {
  if (have.includes(b)) return 'Already built';
  const need = BUILDINGS[b].needs;
  return need && !have.includes(need) ? `Build the ${BUILDINGS[need].name.toLowerCase()} first` : null;
}
/** Coins a minute an island brings in: its buildings' income by its size, raised by a keep or a castle. */
export function islandIncome(i: number, j: number, have: readonly string[]): number {
  const m = mainIsland(i, j);
  if (!m) return 0;
  let n = 0;
  for (const b of have) if (isBuilding(b)) n += BUILDINGS[b].income ?? 0;
  const seat = have.includes('castle') ? 1.4 : have.includes('keep') ? 1.15 : 1;
  return Math.round(n * (m.R / 100) * seat);
}
/** The worth of an island with its buildings, for a ruler's title. */
export const islandWorth = (price: number, have: readonly string[]): number => price + have.reduce((a, b) => a + (isBuilding(b) ? BUILDINGS[b].cost : 0), 0);
/** A ruler's title by the worth of their islands (none for no islands). */
export const TITLES: readonly [number, string][] = [[1, 'Landholder'], [600_000, 'Warden'], [1_500_000, 'Governor'], [3_500_000, 'High Steward'], [7_000_000, 'Sovereign']];
export function titleOf(worth: number): string | null {
  let t: string | null = null;
  for (const [at, name] of TITLES) if (worth >= at) t = name;
  return t;
}
