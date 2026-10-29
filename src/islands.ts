import { G } from './game';
import { claimableNear, claimableAt, realmPlots } from './world';
import { reveal } from './game/explore';
import { NET, watchIslands, watchKingdom, watchLedger, type IslandRow, type KingdomRow } from './net';
import { toast, addCoins } from './game/feedback';
import { saveGame } from './game/save';
import { accrueTreasury } from './game/treasury';
import { track } from './analytics';
import { islandIncome, islandWorth, titleOf } from '../convex/islandRules';

export { TREASURY_MIN } from './game/treasury';
export { islandPrice } from '../convex/islandRules';
/** An island's own colour, from its key: its pennant until the owner's logo is approved, the same on the chart and in the world. */
export function islandColour(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360, f = (n: number) => { const k = (n + hue / 30) % 12, a = 0.6 * Math.min(0.55, 1 - 0.55); return Math.round(255 * (0.55 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Where to sail for an island: the open water off its shore nearest to (fx, fy), since its middle is land. */
export function islandLanding(c: { x: number; y: number; R: number }, fx: number, fy: number, deep: (x: number, y: number) => boolean): { x: number; y: number } {
  let best = { x: c.x, y: c.y }, bd = Infinity;
  for (let r = c.R * 0.5; r <= c.R * 1.8; r += 8) {
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r, d = Math.hypot(x - fx, y - fy);
      if (d < bd && deep(x, y)) { best = { x, y }; bd = d; }
    }
    if (bd < Infinity) return best;                       // the first ring with water is the shore
  }
  return best;
}
/** Owner, name, title, buildings and logo by island key ("i,j"); islands nobody owns are absent. */
export const ISLANDS = new Map<string, IslandRow>();

const WATCH_R = 1400;
let lastKeys = '', extra: string[] = [], focus: string | null = null;
/** The chart asks for the islands it shows, beyond the ones around the boat. */
export function watchExtra(keys: string[]): void { extra = keys.slice(0, 120); }
/** The island whose card is open: watched wherever it is (null when the card closes). */
export function focusIsland(key: string | null): void { focus = key; }
export function tickIslands(dt: number): void {
  if (G.mode === 'play') G.treasury = accrueTreasury(G.treasury, G.realmRate, dt);
  if (!NET.authed) return;
  if (!REALM.watching) { REALM.watching = true; watchKingdom(onKingdom); watchLedger(l => { REALM.ledger = l; }); }
  const keys = [...new Set([...claimableNear(G.boat.x, G.boat.y, WATCH_R).map(c => c.key), ...extra, ...(focus ? [focus] : [])])].sort();
  const sig = keys.join(';');
  if (sig === lastKeys) return;
  lastKeys = sig;
  watchIslands(keys, rows => {
    ISLANDS.clear();
    for (const r of rows) ISLANDS.set(r.key, r);
  });
}

// ---------- your kingdom ----------
/** Your islands (from the server), and the earnings it has counted for you and what islands have cost. */
export const REALM = { islands: [] as KingdomRow[], ledger: null as { earned: number; spent: number } | null, watching: false };
/** Earnings the server will let you spend on islands (it checks them, not the save's coins). */
export const ledgerLeft = (): number | null => REALM.ledger && Math.max(0, REALM.ledger.earned - REALM.ledger.spent);
/** Coins a minute your islands bring in. */
export const realmRate = (rows: readonly KingdomRow[] = REALM.islands): number => rows.reduce((a, r) => { const c = claimableAt(r.key); return a + (c ? islandIncome(c.i, c.j, r.buildings) : 0); }, 0);
/** Your islands' worth (prices and buildings), and the title it earns you. */
const realmWorth = (): number => REALM.islands.reduce((a, r) => a + islandWorth(r.price, r.buildings), 0);
export const realmTitle = (): string | null => titleOf(realmWorth());
let titleSeen: string | null | undefined;
function onKingdom(rows: KingdomRow[]): void {
  REALM.islands = rows;
  G.realmRate = realmRate(rows);
  chartRealm();
  const t = realmTitle();
  if (titleSeen !== undefined && t && t !== titleSeen) { toast(`Your realm has grown: you are now ${t} of your islands`, 'good'); track('realm_title', { title: t }); }
  titleSeen = t;
}
/** Step ashore at your island from its dock: its card opens. */
export function landAtRealm(key: string): void {
  G.islandKey = key; G.islandBack = 'play'; G.mode = 'island'; focusIsland(key);
  track('island_opened', { owned: true, mine: true });
}
/** Your island whose dock the boat is at (by the pier's end), or null. */
export function realmDockAt(x: number, y: number): KingdomRow | null {
  for (const r of REALM.islands) {
    if (!r.buildings.includes('dock')) continue;
    const c = claimableAt(r.key), d = c && realmPlots(c)?.shore[0];
    if (d && Math.hypot(x - (d.x + Math.cos(d.a) * 30), y - (d.y + Math.sin(d.a) * 30)) < 26) return r;   // off the pier's end
  }
  return null;
}
// a lighthouse on your island charts the sea round it (once a session per island)
const charted = new Set<string>();
function chartRealm(): void {
  for (const r of REALM.islands) {
    if (!r.buildings.includes('lighthouse') || charted.has(r.key)) continue;
    charted.add(r.key);
    const m = claimableAt(r.key);
    if (m) reveal(m.x, m.y, 1100);
  }
}
export function realmInReach(key: string): boolean {
  const m = claimableAt(key);
  return REALM.islands.some(r => r.key === key) && !!m && Math.hypot(G.boat.x - m.x, G.boat.y - m.y) <= m.R + 160;
}
export function collectRealm(key: string): number {
  if (G.mode !== 'island' || G.islandKey !== key || !realmInReach(key) || G.fish || G.card) return 0;
  const n = Math.floor(G.treasury);
  if (!Number.isFinite(n) || n < 1) return 0;
  G.treasury -= n;
  addCoins(n);
  saveGame();
  toast(`Treasury collected: +$${n.toLocaleString('en-US')}`, 'good');
  track('realm_collected', { earned_bucket: n < 1000 ? 'under 1k' : n < 10000 ? '1k-10k' : n < 100000 ? '10k-100k' : '100k+' });
  return n;
}
export function realmWhileAway(savedAt: number | undefined): void {
  const away = savedAt ? (Date.now() - savedAt) / 60_000 : 0;
  if (away < 1 || G.realmRate <= 0) return;
  const before = G.treasury;
  G.treasury = accrueTreasury(G.treasury, G.realmRate, away * 60);
  const n = Math.floor(G.treasury - before);
  if (n > 0) toast(`Your islands brought in $${n.toLocaleString('en-US')} while you were away. Open one of your islands when nearby to collect`, 'good');
}
