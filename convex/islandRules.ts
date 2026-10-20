// Island rules shared by the server and the game (no Convex imports, so the client can use them too).
// Each 560-unit world cell's main island can be claimed, Alderhaven's included.
export const ISLAND_CELL = 560, MAX_ISLANDS = 3, ISLAND_NAME_MAX = 24, LOGO_MAX_BYTES = 16 * 1024;
export const islandKey = (i: number, j: number): string => `${i},${j}`;
export const isClaimable = (key: string): boolean => /^-?\d{1,4},-?\d{1,4}$/.test(key);
/**
 * $1000 for Alderhaven's cell, falling smoothly with distance from home, never below $150, in $10 steps.
 * Distance is to the cell's nearest edge (so the home cell is 0).
 */
export function islandPrice(i: number, j: number): number {
  const d = Math.max(0, Math.hypot((i + 0.5) * ISLAND_CELL, (j + 0.5) * ISLAND_CELL) - ISLAND_CELL * Math.SQRT1_2);
  return Math.max(150, Math.round((150 + 850 / (1 + Math.pow(d / 3000, 1.5))) / 10) * 10);
}
export const priceOfKey = (key: string): number => { const [i, j] = key.split(',').map(Number); return islandPrice(i, j); };
