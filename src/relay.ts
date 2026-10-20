// The realtime position relay (server/). When VITE_RELAY_URL is set, boat positions and greetings go over this
// WebSocket at about ten updates a second; otherwise, or while it is unreachable, net.ts uses Convex instead.
const URL: string | undefined = import.meta.env.VITE_RELAY_URL;
export type RelayBoat = { id: string; name: string; x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; at: number; emote: number | null; emoteAt: number };

let ws: WebSocket | null = null, open = false, token: string | null = null, retry = 1000, retryAt = 0;
let boats: RelayBoat[] = [];

/** True while the relay is connected and has accepted our sign-in. */
export const relayLive = (): boolean => open;
/** The latest boats near us, stamped with the relay's clock. */
export const relayBoats = (): RelayBoat[] => boats;

/** Keep a connection open for this sign-in token (call every frame; it reconnects with backoff and passes on new tokens). */
export function relayKeep(next: string | null): void {
  if (!URL) return;
  if (next !== token) {
    const wasSet = token !== null; token = next;
    if (!next) { ws?.close(); return; }
    if (wasSet && open) ws?.send(JSON.stringify({ t: 'token', token: next }));
  }
  if (!token || ws || Date.now() < retryAt) return;
  const sock = new WebSocket(URL); ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ t: 'hello', token }));
  sock.onmessage = e => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'welcome') { open = true; retry = 1000; }
    else if (m.t === 'boats') boats = m.list;
  };
  sock.onclose = () => {
    if (ws === sock) { ws = null; open = false; boats = []; }
    retryAt = Date.now() + retry; retry = Math.min(30_000, retry * 2);
  };
}
export function relaySend(state: { x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string }): void {
  if (open) ws?.send(JSON.stringify({ t: 's', ...state }));
}
export function relayEmote(i: number): void { if (open) ws?.send(JSON.stringify({ t: 'emote', i })); }
/** Ask the relay to re-read our captain name from Convex. */
export function relayRenamed(): void { if (open) ws?.send(JSON.stringify({ t: 'renamed', token })); }
