// Claimed islands on the client: who owns the islands around you (and on the chart), kept live from the server.
// The main island of every world cell can be bought (with real money, through Stripe; admins claim free); the price
// falls with distance from Alderhaven. A flag picked before paying waits here until the island is ours, then uploads.
import { G } from './game';
import { claimableNear } from './world';
import { NET, watchIslands, uploadIslandLogo, type IslandRow } from './net';
import { toast } from './game/feedback';
import { track } from './analytics';

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
/** Owner, name and logo by island key ("i,j"); islands nobody owns are absent. */
export const ISLANDS = new Map<string, IslandRow>();

const WATCH_R = 1400;
let lastKeys = '', extra: string[] = [];
/** The chart asks for the islands it shows, beyond the ones around the boat. */
export function watchExtra(keys: string[]): void { extra = keys.slice(0, 120); }
/** Keep the subscription on the islands around the boat (and on the chart); cheap to call every frame. */
export function tickIslands(): void {
  if (!NET.authed) return;
  if (returnNote) { toast(returnNote.s, returnNote.good ? 'good' : undefined); track('island_checkout_returned', { paid: returnNote.good }); returnNote = null; }
  const keys = [...new Set([...claimableNear(G.boat.x, G.boat.y, WATCH_R).map(c => c.key), ...extra])].sort();
  const sig = keys.join(';');
  if (sig === lastKeys) return;
  lastKeys = sig;
  watchIslands(keys, rows => {
    ISLANDS.clear();
    for (const r of rows) { ISLANDS.set(r.key, r); if (r.mine) void flushLogo(r.key); }
  });
}

// ---------- paying through Stripe ----------
const LOGO_KEY = (key: string) => `bobber-island-logo:${key}`;
/** Keep the chosen flag until the paid island shows up as ours (Checkout leaves the page). */
export async function stashLogo(key: string, png: Blob): Promise<void> {
  const url = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(png); });
  try { localStorage.setItem(LOGO_KEY(key), url); } catch { /* storage full: the owner can add the flag later */ }
}
const flushing = new Set<string>();
async function flushLogo(key: string): Promise<void> {
  let url: string | null = null;
  try { url = localStorage.getItem(LOGO_KEY(key)); } catch { }
  if (!url || flushing.has(key)) return;
  flushing.add(key);
  const r = await uploadIslandLogo(key, await (await fetch(url)).blob());
  if (r.ok) try { localStorage.removeItem(LOGO_KEY(key)); } catch { }
  flushing.delete(key);
}
// back from Stripe Checkout: /?island=<key>&paid=1 (or 0); say how it went once sailing, and tidy the address bar
let returnNote: { s: string; good: boolean } | null = null;
{
  const q = new URLSearchParams(location.search), key = q.get('island'), paid = q.get('paid');
  if (key && paid !== null) {
    returnNote = paid === '1' ? { s: 'Payment received. Your island will appear in a moment', good: true } : { s: 'Checkout cancelled. You were not charged', good: false };
    q.delete('island'); q.delete('paid');
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  }
}

