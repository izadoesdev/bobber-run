// Realtime boat positions for Bobber Run. A client connects with its Convex sign-in token; the relay checks the token
// against Convex's published keys, asks Convex for the player's captain name and sea, then sends every boat the boats
// near it in the same sea ten times a second, and relays chat to the sea after filtering it the way Roblox does
// (moderate.ts). Saves, records, accounts and names stay in Convex.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { ServerWebSocket } from 'bun';
import { filterChat } from './moderate';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const CONVEX_URL = env('CONVEX_URL'), SITE = env('CONVEX_SITE_URL'), RELAY_SECRET = process.env.RELAY_SECRET;
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT ?? 4820);
const JWKS = createRemoteJWKSet(new URL(`${SITE}/.well-known/jwks.json`));
const me = makeFunctionReference<'query', Record<string, never>, { userId: string; name: string; sea: number | null } | null>('profiles:me');

const TICK_MS = 100;          // how often each boat is told about its neighbours
const RANGE = 900;            // world units; farther boats aren't sent
const STALE_MS = 25_000;      // a boat that hasn't reported for this long is dropped from others' views
const MSGS_PER_S = 30, MAX_PER_USER = 3, MAX_MSG = 4096;   // a sign-in token is about 1-2 KB
const CHAT_MAX = 120, CHAT_GAP_MS = 1200, CHAT_BURST = 6, CHAT_WINDOW_MS = 15_000;   // chat: a line every 1.2 s, 6 per 15 s

type Boat = { x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; at: number };
interface Peer { id: string; userId: string; name: string; sea: number; token: string; boat: Boat | null; emote: number | null; emoteAt: number; tokens: number; refill: number; chats: number[] }
type Sock = ServerWebSocket<Peer | null>;
const seas = new Map<number, Set<Sock>>();
const perUser = new Map<string, number>();

/** The signed-in player behind a token, as Convex sees them; null if the token or profile doesn't check out. */
async function player(token: string): Promise<{ userId: string; name: string; sea: number } | null> {
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: SITE, audience: 'convex' });
    const convex = new ConvexHttpClient(CONVEX_URL); convex.setAuth(token);
    const p = await convex.query(me, {});
    if (!p || String(payload.sub).split('|')[0] !== p.userId) return null;
    return { userId: p.userId, name: p.name, sea: p.sea ?? 0 };
  } catch (e) {
    console.log(JSON.stringify({ msg: 'sign-in refused', why: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 160) : 'unknown' }));
    return null;
  }
}
const num = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
const str = (v: unknown) => typeof v === 'string' && v.length <= 16;
/** Token bucket: false once a socket sends faster than MSGS_PER_S on average. */
function allowed(p: Peer): boolean {
  const now = Date.now();
  p.tokens = Math.min(MSGS_PER_S, p.tokens + (now - p.refill) / 1000 * MSGS_PER_S); p.refill = now;
  return p.tokens >= 1 && p.tokens-- > 0;
}
/** A line from the game itself (joins and leaves), sent to everyone in a sea. */
function announce(sea: number, text: string, except?: Sock): void {
  const line = JSON.stringify({ t: 'sys', text, at: Date.now() });
  for (const o of seas.get(sea) ?? []) if (o !== except && o.data) o.send(line);
}
/** Who is in a sea, by captain name; sent with each boats update so the list stays current. */
const roster = (sea: number) => [...(seas.get(sea) ?? [])].flatMap(s => s.data ? [s.data.name] : []).sort();
function leave(ws: Sock): void {
  const p = ws.data; if (!p) return;
  seas.get(p.sea)?.delete(ws);
  announce(p.sea, `${p.name} left the sea`);
  const n = (perUser.get(p.userId) ?? 1) - 1;
  if (n > 0) perUser.set(p.userId, n); else perUser.delete(p.userId);
  ws.data = null;
}

async function onMessage(ws: Sock, text: string): Promise<void> {
  let m: Record<string, unknown>;
  try { m = JSON.parse(text); } catch { return; }
  const p = ws.data;
  if (!p) {                                                     // the first message must be hello with a token
    if (m.t !== 'hello' || typeof m.token !== 'string') return void ws.close(4001, 'hello first');
    const who = await player(m.token);
    if (!who) return void ws.close(4003, 'not signed in');
    if ((perUser.get(who.userId) ?? 0) >= MAX_PER_USER) return void ws.close(4008, 'too many tabs');
    perUser.set(who.userId, (perUser.get(who.userId) ?? 0) + 1);
    ws.data = { id: crypto.randomUUID().slice(0, 12), ...who, token: m.token, boat: null, emote: null, emoteAt: 0, tokens: MSGS_PER_S, refill: Date.now(), chats: [] };
    if (!seas.has(who.sea)) seas.set(who.sea, new Set());
    seas.get(who.sea)!.add(ws);
    announce(who.sea, `${who.name} joined the sea`, ws);
    ws.send(JSON.stringify({ t: 'welcome', sea: who.sea }));
    return;
  }
  if (!allowed(p)) return;
  if (m.t === 's') {
    if (!num(m.x, 1e6) || !num(m.y, 1e6) || !num(m.a, 1e4) || !num(m.vx, 400) || !num(m.vy, 400) || !num(m.w, 20) || !str(m.boat) || !str(m.paint)) return;
    p.boat = { x: m.x as number, y: m.y as number, a: m.a as number, vx: m.vx as number, vy: m.vy as number, w: m.w as number, boat: m.boat as string, paint: m.paint as string, at: Date.now() };
  } else if (m.t === 'emote') {
    if (!(Number.isInteger(m.i) && (m.i as number) >= 0 && (m.i as number) < 16) || Date.now() - p.emoteAt < 1500) return;
    p.emote = m.i as number; p.emoteAt = Date.now();
  } else if (m.t === 'chat' && typeof m.text === 'string') {     // everyone in the sea hears it, filtered first
    const text = m.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX), now = Date.now();
    p.chats = p.chats.filter(t => now - t < CHAT_WINDOW_MS);
    if (!text) return;
    if (p.chats.length >= CHAT_BURST || now - (p.chats.at(-1) ?? 0) < CHAT_GAP_MS) return void ws.send(JSON.stringify({ t: 'chat-slow' }));
    p.chats.push(now);
    const v = await filterChat(text);
    void keep({ userId: p.userId, name: p.name, sea: p.sea, text, shown: v.text, filtered: v.filtered, whole: v.whole, source: v.source, at: now });
    const line = JSON.stringify({ t: 'chat', id: p.id, name: p.name, text: v.text, at: Date.now() });
    for (const o of seas.get(p.sea) ?? []) if (o !== ws && o.data) o.send(line);
    ws.send(JSON.stringify({ t: 'chat', id: 'me', name: p.name, text: v.text, at: Date.now(), filtered: v.filtered }));   // like Roblox, you see what others see
  } else if (m.t === 'renamed') {                                // re-read the name from Convex; the client's word isn't taken
    if (typeof m.token === 'string') p.token = m.token;
    const who = await player(p.token);
    if (who) p.name = who.name;
  } else if (m.t === 'token' && typeof m.token === 'string') {   // sign-in tokens expire; the client hands over fresh ones
    p.token = m.token;
  }
}

let rosterAt = 0;
/** Store a chat line in Convex for good (convex/chat.ts); a failed write is logged and retried once. */
async function keep(line: Record<string, unknown>, retry = true): Promise<void> {
  if (!RELAY_SECRET) return;
  try {
    const r = await fetch(`${SITE}/relay/chat`, { method: 'POST', headers: { Authorization: `Bearer ${RELAY_SECRET}`, 'Content-Type': 'application/json' }, body: JSON.stringify(line), signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    console.log(JSON.stringify({ msg: 'chat not stored', why: e instanceof Error ? e.message : 'unknown', retry }));
    if (retry) setTimeout(() => void keep(line, false), 3000);
  }
}
function broadcast(): void {
  const now = Date.now(), withRoster = now - rosterAt > 3000;
  if (withRoster) rosterAt = now;
  for (const [sea, socks] of seas) {
    const names = withRoster ? roster(sea) : null;
    const boats: { ws: Sock; p: Peer; b: Boat }[] = [];
    for (const ws of socks) { const p = ws.data; if (p?.boat && now - p.boat.at < STALE_MS) boats.push({ ws, p, b: p.boat }); }
    for (const ws of socks) {
      const me = ws.data; if (!me) continue;
      const list = boats.filter(o => o.ws !== ws && (!me.boat || Math.hypot(o.b.x - me.boat.x, o.b.y - me.boat.y) < RANGE))
        .map(({ p, b }) => ({ id: p.id, name: p.name, emote: p.emote, emoteAt: p.emoteAt, ...b }));
      ws.send(JSON.stringify(names ? { t: 'boats', now, list, roster: names } : { t: 'boats', now, list }));
    }
  }
}
setInterval(broadcast, TICK_MS);

Bun.serve<Peer | null>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');
    const origin = req.headers.get('origin') ?? '';
    if (ORIGINS.length && !ORIGINS.includes(origin)) return new Response('origin not allowed', { status: 403 });
    if (server.upgrade(req, { data: null })) return undefined;
    return new Response('Bobber Run relay', { status: 426 });
  },
  websocket: {
    maxPayloadLength: MAX_MSG,
    idleTimeout: 60,
    message(ws, msg) { if (typeof msg === 'string') void onMessage(ws, msg); },
    close(ws, code, reason) { if (code !== 1000 && code !== 1001) console.log(JSON.stringify({ msg: 'closed', code, reason })); leave(ws); },
  },
});
console.log(JSON.stringify({ msg: 'relay listening', port: PORT, origins: ORIGINS.length }));
