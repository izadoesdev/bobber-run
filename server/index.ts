// Realtime boat positions for Bobber Run. A client connects with its Convex sign-in token; the relay checks the token
// against Convex's published keys, asks Convex for the player's captain name and sea, then sends every boat the boats
// near it in the same sea ten times a second. Saves, records, accounts and names stay in Convex.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import type { ServerWebSocket } from 'bun';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const CONVEX_URL = env('CONVEX_URL'), SITE = env('CONVEX_SITE_URL');
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT ?? 4820);
const JWKS = createRemoteJWKSet(new URL(`${SITE}/.well-known/jwks.json`));
const me = makeFunctionReference<'query', Record<string, never>, { userId: string; name: string; sea: number | null } | null>('profiles:me');

const TICK_MS = 100;          // how often each boat is told about its neighbours
const RANGE = 900;            // world units; farther boats aren't sent
const STALE_MS = 25_000;      // a boat that hasn't reported for this long is dropped from others' views
const MSGS_PER_S = 30, MAX_PER_USER = 3, MAX_MSG = 4096;   // a sign-in token is about 1-2 KB

type Boat = { x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; at: number };
interface Peer { id: string; userId: string; name: string; sea: number; token: string; boat: Boat | null; emote: number | null; emoteAt: number; tokens: number; refill: number }
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
function leave(ws: Sock): void {
  const p = ws.data; if (!p) return;
  seas.get(p.sea)?.delete(ws);
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
    ws.data = { id: crypto.randomUUID().slice(0, 12), ...who, token: m.token, boat: null, emote: null, emoteAt: 0, tokens: MSGS_PER_S, refill: Date.now() };
    if (!seas.has(who.sea)) seas.set(who.sea, new Set());
    seas.get(who.sea)!.add(ws);
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
  } else if (m.t === 'renamed') {                                // re-read the name from Convex; the client's word isn't taken
    if (typeof m.token === 'string') p.token = m.token;
    const who = await player(p.token);
    if (who) p.name = who.name;
  } else if (m.t === 'token' && typeof m.token === 'string') {   // sign-in tokens expire; the client hands over fresh ones
    p.token = m.token;
  }
}

function broadcast(): void {
  const now = Date.now();
  for (const socks of seas.values()) {
    const boats: { ws: Sock; p: Peer; b: Boat }[] = [];
    for (const ws of socks) { const p = ws.data; if (p?.boat && now - p.boat.at < STALE_MS) boats.push({ ws, p, b: p.boat }); }
    for (const ws of socks) {
      const me = ws.data; if (!me) continue;
      const list = boats.filter(o => o.ws !== ws && (!me.boat || Math.hypot(o.b.x - me.boat.x, o.b.y - me.boat.y) < RANGE))
        .map(({ p, b }) => ({ id: p.id, name: p.name, emote: p.emote, emoteAt: p.emoteAt, ...b }));
      ws.send(JSON.stringify({ t: 'boats', now, list }));
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
