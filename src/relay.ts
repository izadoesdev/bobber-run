// The realtime position relay (server/). When VITE_RELAY_URL is set, boat positions and greetings go over this
// WebSocket at about ten updates a second; otherwise, or while it is unreachable, net.ts uses Convex instead.
import { heard, ONLINE } from './online';
import { FORCED_OFFLINE } from './offline';

const URL: string | undefined = FORCED_OFFLINE ? undefined : import.meta.env.VITE_RELAY_URL;
export type RelayBoat = { id: string; name: string; x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; at: number; ts?: number; emote: number | null; emoteAt: number };

let ws: WebSocket | null = null, open = false, token: string | null = null, user: string | null = null, retry = 1000, retryAt = 0, heardAt = 0;
let boats: RelayBoat[] = [];
/** The relay's clock when it sent the latest boats, and ours when they arrived (for the clock offset in net.ts). */
export const relayClock = { sent: 0, heard: 0 };
// the relay talks ten times a second; this long without a word (a laptop waking from sleep) means the link is dead
const SILENT_MS = 6000, WELCOME_MS = 10_000;

/** True while the relay is connected and has accepted our sign-in. */
export const relayLive = (): boolean => open;
/** The latest boats near us, stamped with the relay's clock. */
export const relayBoats = (): RelayBoat[] => boats;

/** Forget the connection at once (its close event may come much later, or never). */
function drop(): void {
  const sock = ws; ws = null; open = false; boats = []; ONLINE.roster = []; ONLINE.far = []; ONLINE.total = 0;
  sock?.close();
}
/**
 * Keep a connection open for this sign-in (call every frame; null signs off). It reconnects with backoff, passes on
 * refreshed tokens, and starts over at once when a different account signs in.
 */
export function relayKeep(next: string | null, userId: string | null): void {
  if (!URL) return;
  if (userId !== user) { user = userId; token = next; if (ws) { drop(); retryAt = 0; } }
  else if (next !== token) { token = next; if (next && open) ws?.send(JSON.stringify({ t: 'token', token: next })); }
  if (!token) return;
  if (ws && Date.now() - heardAt > (open ? SILENT_MS : WELCOME_MS)) { drop(); retryAt = Date.now() + retry; retry = Math.min(30_000, retry * 2); }
  if (ws || Date.now() < retryAt) return;
  const sock = new WebSocket(URL); ws = sock; heardAt = Date.now();
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }));
  sock.onmessage = e => {
    if (ws !== sock) return;
    heardAt = Date.now();
    let m; try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.t === 'welcome') { open = true; retry = 1000; }
    else if (m.t === 'boats') { boats = Array.isArray(m.list) ? m.list : []; if (typeof m.now === 'number') { relayClock.sent = m.now; relayClock.heard = Date.now(); } if (Array.isArray(m.roster)) { ONLINE.roster = m.roster; ONLINE.total = m.total ?? ONLINE.roster.length; } if (Array.isArray(m.far)) ONLINE.far = m.far; }
    else if (m.t === 'sys') heard({ id: 'sys', name: '', text: m.text, at: m.at });
    else if (m.t === 'chat') heard({ id: m.id, name: m.name, text: m.text, at: m.at, admin: !!m.admin });
    else if (m.t === 'chat-slow') ONLINE.note = 'You are sending messages too fast. Wait a moment';
  };
  sock.onclose = () => {
    if (ws !== sock) return;                                   // already dropped on purpose
    drop(); retryAt = Date.now() + retry; retry = Math.min(30_000, retry * 2);
  };
}
export function relaySend(state: { x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string }): void {
  // to the hundredth (a JSON double runs to 17 digits), stamped with our own clock
  const r = (v: number) => Math.round(v * 100) / 100;
  if (open) ws?.send(JSON.stringify({ t: 's', x: r(state.x), y: r(state.y), a: r(state.a), vx: r(state.vx), vy: r(state.vy), w: r(state.w), boat: state.boat, paint: state.paint, ts: Date.now() }));
}
/** Say something to everyone in your sea; the relay filters it before anyone sees it. */
export function relayChat(text: string): void { if (open) ws?.send(JSON.stringify({ t: 'chat', text })); }
export function relayEmote(i: number): void { if (open) ws?.send(JSON.stringify({ t: 'emote', i })); }
/** Ask the relay to re-read our captain name from Convex. */
export function relayRenamed(): void { if (open) ws?.send(JSON.stringify({ t: 'renamed', token })); }
