// Online play through Convex: guest sign-in, accounts, cloud saves, world records, the coastwide fund,
// greetings and other sailors. Without VITE_CONVEX_URL the game stays offline.
import { h, render } from 'preact';
import { useEffect } from 'preact/hooks';
import { ConvexReactClient } from 'convex/react';
import type { FunctionReference } from 'convex/server';
import { ConvexAuthProvider, useAuthActions, useConvexAuth } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { ONLINE, type Sailor } from './online';
import type { ToastKind } from './types';
import { track } from './analytics';

const URL: string | undefined = import.meta.env.VITE_CONVEX_URL;
export const SAVE_KEY = 'bobber-run-save-v3';
export const FUND_KEY = 'grand-harbour';

/** Just what this module needs from the game state. */
interface Game { mode: string; boat: { x: number; y: number; a: number }; boatId: string; paint: string }
type Profile = { userId: string; name: string; guest: boolean; email: string | null; sea: number | null };
type Fund = { total: number; givers: number; goal: number; mine: number };
type Status = 'offline' | 'connecting' | 'online';
type Result = { ok: true; msg?: string; reload?: boolean; name?: string } | { ok: false; why: string };

export const NET = {
  on: !!URL, status: (URL ? 'connecting' : 'offline') as Status, authed: false, busy: false,
  profile: null as Profile | null, records: {} as Record<string, { name: string; kg: number }>, fund: null as Fund | null,
  news: [] as { id: string; name: string; text: string; at: number }[], err: null as string | null,
  cloudNote: null as string | null, skipUnloadSave: false,
};
export const EMOTES = ['Ahoy!', 'Nice catch!', 'Follow me!', 'Look over here!', 'Thanks!', 'Fair winds!', 'Good night!', 'Wow!'];
const ADJ = ['Salty', 'Sunny', 'Misty', 'Brave', 'Quiet', 'Lucky', 'Rusty', 'Jolly', 'Sleepy', 'Wandering', 'Merry', 'Tidal'];
const NOUN = ['Gull', 'Tern', 'Otter', 'Cod', 'Puffin', 'Heron', 'Seal', 'Skipper', 'Mackerel', 'Barnacle', 'Pelican', 'Kelp'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 120);

let client: ConvexReactClient | null = null;
let actions: ReturnType<typeof useAuthActions> | null = null;
let G: Game | null = null, speciesIds: string[] = [], toast: (s: string, kind?: ToastKind) => void = () => { };
let signingIn = false, switching = false, naming = false;

// ---------- subscriptions ----------
const watches: Record<string, { sig: string; off: () => void }> = {};
function watch<T>(key: string, ref: FunctionReference<'query'>, args: Record<string, unknown>, cb: (r: T) => void) {
  const sig = JSON.stringify(args); if (!client || watches[key]?.sig === sig) return;
  watches[key]?.off();
  const w = client.watchQuery(ref, args);
  const pull = () => { try { const r = w.localQueryResult(); if (r !== undefined) cb(r as T); } catch (e) { NET.err = errText(e); } };
  watches[key] = { sig, off: w.onUpdate(pull) }; pull();
}
const call = <A extends Record<string, unknown>>(ref: FunctionReference<'mutation'>, args: A) =>
  client!.mutation(ref, args).catch((e: unknown) => { NET.err = errText(e); throw e; });

// ---------- sign-in ----------
// Signs in as a guest when nobody is signed in (never during an account switch) and tracks the session.
function Bridge() {
  const a = useAuthActions(), { isLoading, isAuthenticated } = useConvexAuth();
  actions = a;
  useEffect(() => {
    if (isLoading || isAuthenticated || signingIn || switching) return;
    signingIn = true; NET.status = 'connecting';
    a.signIn('anonymous').catch(e => { NET.err = errText(e); NET.status = 'offline'; }).finally(() => { signingIn = false; });
  }, [isLoading, isAuthenticated]);
  useEffect(() => {
    NET.authed = isAuthenticated; NET.status = isAuthenticated ? 'online' : isLoading ? 'connecting' : NET.status;
    if (isAuthenticated) void onSignedIn(); else NET.profile = null;
  }, [isAuthenticated]);
  return null;
}
export function initNet(game: Game, species: string[], notify: (s: string, kind?: ToastKind) => void) {
  G = game; speciesIds = species; toast = notify;
  if (!URL) return;
  client = new ConvexReactClient(URL);
  const host = document.createElement('div'); host.style.display = 'none'; document.body.appendChild(host);
  render(h(ConvexAuthProvider, { client, children: h(Bridge, null) }), host);
  addEventListener('beforeunload', () => { if (NET.authed) client!.mutation(api.sea.leave, {}).catch(() => { }); });
}
const pageStart = Date.now();
async function onSignedIn() {
  watch<Profile | null>('profile', api.profiles.me, {}, p => {
    NET.profile = p;
    if (p && p.name === 'Sailor' && !naming && !switching) { naming = true; void setName(`${pick(ADJ)} ${pick(NOUN)}`, true); }
  });
  watch('records', api.records.world, { species: speciesIds }, r => { NET.records = r as typeof NET.records; });
  watch('fund', api.fund.get, { key: FUND_KEY }, f => { NET.fund = f as Fund; });
  watch('news', api.sea.news, { since: pageStart - 60_000 }, list => onNews(list as typeof NET.news));
  try { await call(api.sea.join, {}); } catch { /* stays in its last sea */ }
  if (!switching) await syncSave();   // during an account switch, account() decides which save wins
}
// coastwide news shows as toasts, once each, newest last
const seenNews = new Set<string>();
function onNews(list: typeof NET.news) {
  NET.news = list;
  for (const e of [...list].reverse()) if (!seenNews.has(e.id)) { seenNews.add(e.id); if (e.name !== NET.profile?.name) toast(`${e.name} ${e.text}`, 'good'); }
}

// ---------- cloud save: whichever copy is newer wins (the cloud copy replaces a local one only on the title screen) ----------
const localSave = () => { try { const s = localStorage.getItem(SAVE_KEY); return s ? { data: s, at: (JSON.parse(s).savedAt as number) || 0 } : null; } catch { return null; } };
async function syncSave() {
  try {
    const cloud = await client!.query(api.saves.load, {}), local = localSave();
    if (cloud && (!local || cloud.updatedAt > local.at)) { if (G?.mode === 'title') { localStorage.setItem(SAVE_KEY, cloud.data); NET.cloudNote = 'Loaded your save from the cloud'; } }
    else if (local) await putSave(local.data, local.at || Date.now());
  } catch { /* offline: try again on the next save */ }
}
/** Upload a save. The server turns away writes less than 2 s after the last one ("busy"), so retry once after that. */
async function putSave(data: string, updatedAt: number) {
  const r = await call(api.saves.put, { data, updatedAt });
  if (!r.ok && 'busy' in r && r.busy) { await new Promise(res => setTimeout(res, 2200)); return call(api.saves.put, { data, updatedAt }); }
  return r;
}
let saveTimer = 0;
/** Called after every local save; uploads at most every few seconds. */
export function netSaved() {
  if (!NET.authed || saveTimer) return;
  saveTimer = window.setTimeout(() => { saveTimer = 0; if (!NET.authed || switching) return; const l = localSave(); if (l) putSave(l.data, l.at || Date.now()).catch(() => { }); }, 4000);
}
// cheat-tainted saves never call these (the server also accepts an optional `cheated` flag, which this client
// leaves out so it works against older backends too)
export function netCatch(species: string, kg: number, cheated = false) { if (NET.authed && !cheated) call(api.records.submit, { species, kg: Math.round(kg * 10) / 10 }).catch(() => { }); }
export async function netGive(amount: number, cheated = false): Promise<Result> {
  if (!NET.authed) return { ok: false, why: 'You are offline' };
  if (cheated) return { ok: false, why: 'Saves that used cheats cannot give to the fund' };
  try { const r = await call(api.fund.give, { key: FUND_KEY, amount }); return r.ok ? { ok: true } : { ok: false, why: r.why ?? 'Could not give' }; } catch { return { ok: false, why: 'Could not reach the coast' }; }
}
export async function setName(name: string, auto = false): Promise<Result> {
  if (!NET.authed) return { ok: false, why: 'You are offline' };
  try { return await call(api.profiles.setName, { name, auto }); } catch { return { ok: false, why: 'Could not reach the server' }; } finally { naming = false; }
}
export function sendEmote(i: number) { if (NET.authed) { call(api.sea.emote, { i }).catch(() => { }); track('greeting_sent', { greeting: i }); } }

// ---------- accounts: a guest can make an account (keeping this save), sign into one (loading its save), or sign out ----------
const waitFor = async (test: () => boolean, ms = 10_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (test()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };
/** Convex Auth's error codes (raw messages are codes like InvalidSecret), the reason analytics records, and what the player reads. */
const FAILS = [
  [/TooManyFailedAttempts|rate/i, 'rate_limited', 'Too many tries. Wait a few minutes, then try again'],
  [/InvalidAccountId/i, 'no_account', 'No account uses that email. Make one instead'],
  [/InvalidSecret|Invalid password/i, 'wrong_password', 'Wrong password for that email'],
  [/already exists/i, 'exists', 'That email already has an account. Sign in instead'],
  [/password/i, 'weak_password', 'Use a password of at least 8 characters'],
] as const;
const NETWORK = [/$/, 'network', 'Could not reach the server. Check your connection and try again'] as const;
/** `m` is the error text, or null when the server never confirmed the sign-in. */
function failed(flow: 'signUp' | 'signIn', m: string | null): Result {
  if (m === null) { track('sign_in_failed', { flow, reason: 'timeout' }); return { ok: false, why: 'The server is taking a long time. Check your connection, then try again' }; }
  const [, reason, why] = FAILS.find(([re]) => re.test(m)) ?? NETWORK;
  track('sign_in_failed', { flow, reason });
  return { ok: false, why: reason === 'no_account' && flow === 'signUp' ? 'Could not make the account. Try again' : why };
}
export async function account(flow: 'signUp' | 'signIn', rawEmail: string, password: string): Promise<Result> {
  if (!actions || !client) return { ok: false, why: 'You are offline' };
  const email = rawEmail.trim().toLowerCase();                       // addresses are case-insensitive; accounts are stored lower case
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, why: 'Enter a valid email address' };
  if (password.length < 8) return { ok: false, why: 'Use a password of at least 8 characters' };
  NET.busy = true; NET.err = null; switching = true;
  const keep = localSave(), oldName = NET.profile?.name, oldUser = NET.profile?.userId;
  try {
    // Convex Auth only re-authenticates the connection on a signed-out -> signed-in change, so leave the guest
    // session first; otherwise the server keeps seeing the guest. If sign-in then fails, a new guest session starts.
    if (NET.authed) { await actions.signOut(); await waitFor(() => !NET.authed, 4000); }
    try { await actions.signIn('password', { email, password, flow }); }
    catch (e) {                                                        // accounts made before emails were lower-cased keep their original case
      const typed = rawEmail.trim();
      if (flow !== 'signIn' || typed === email || !/InvalidAccountId/i.test(errText(e))) throw e;
      await actions.signIn('password', { email: typed, password, flow });
    }
    // wait until the server sees the new account (slow connections can take a while)
    if (!await waitFor(() => !!NET.profile && NET.profile.userId !== oldUser && !NET.profile.guest, 20_000)) return failed(flow, null);
    if (flow === 'signUp') {
      if (keep) await putSave(keep.data, Date.now());
      if (oldName && oldName !== 'Sailor') await setName(oldName);
      track('account_signed_up', { kept_save: !!keep });
      return { ok: true, msg: `Account made and signed in as ${email}. Your progress is saved to it` };
    }
    const cloud = await client.query(api.saves.load, {});
    track('account_signed_in', { loaded_cloud_save: !!cloud });
    if (cloud) { localStorage.setItem(SAVE_KEY, cloud.data); NET.skipUnloadSave = true; return { ok: true, reload: true, msg: 'Signed in. Loading your save' }; }   // the reload must not save over it
    if (keep) await putSave(keep.data, Date.now());
    return { ok: true, msg: `Signed in as ${email}` };
  } catch (e) {
    return failed(flow, errText(e));
  } finally { NET.busy = false; switching = false; }
}
/** Erase this account and its cloud save, name and gifts on the server (world records stay), then sign out. This device keeps its own save. */
export async function deleteAccount(): Promise<Result> {
  if (!NET.authed || !actions) return { ok: false, why: 'You are offline' };
  NET.busy = true; switching = true;
  try {
    await call(api.cleanup.deleteMe, {});
    try { await actions.signOut(); } catch { /* the session was erased with the account */ }
    NET.profile = null;
    track('account_deleted', {});
    return { ok: true, msg: 'Your account is deleted. You are sailing as a guest on this device' };
  } catch { return { ok: false, why: 'Could not reach the server. Your account is unchanged' }; }
  finally { NET.busy = false; switching = false; }
}
export async function signOut() { if (!actions) return; NET.busy = true; try { await actions.signOut(); NET.profile = null; track('signed_out', {}); } finally { NET.busy = false; } }
/** Test hook: ask the server who we are right now (no tokens exposed). */
export const whoami = () => client?.query(api.profiles.me, {}) ?? null;

// ---------- other sailors near you ----------
const CELL = 400, MAX_SHOWN = 12, QUIET_MS = 25_000;
const cellsAround = (sea: number, x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), out: string[] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.push(`${sea}|${cx + i},${cy + j}`);
  return out;
};
type Raw = { id: string; x: number; y: number; a: number; boat: string; paint: string; name: string; at: number; emote: number | null; emoteAt: number };
let lastSent: { x: number; y: number; a: number } | null = null, sendT = 0, inFlight = false, raw: Raw[] = [];
const seenSailors = new Set<string>();
/** Each sailor's last report, its estimated velocity (from the last two reports) and when it arrived here. */
interface Track { x: number; y: number; a: number; at: number; vx: number; vy: number; recv: number }
const tracks = new Map<string, Track>();
const SEND_MOVING_S = 2.5, SEND_STILL_S = 10, PREDICT_MAX_S = 3;
export function netTick(dt: number) {
  if (!NET.authed || !G || NET.profile?.sea == null) return;
  const b = G.boat, cells = cellsAround(NET.profile.sea, b.x, b.y);
  watch<Raw[]>('sailors', api.sea.near, { cells }, list => { raw = list; });
  // our position: every 2.5 s while moving, every 10 s when still, one request at a time (others predict in between)
  sendT += dt;
  const moved = !lastSent || Math.hypot(b.x - lastSent.x, b.y - lastSent.y) > 1 || Math.abs(b.a - lastSent.a) > 0.05;
  if (G.mode === 'play' && !inFlight && ((moved && sendT > SEND_MOVING_S) || sendT > SEND_STILL_S)) {
    sendT = 0; inFlight = true; lastSent = { x: b.x, y: b.y, a: b.a };
    client!.mutation(api.sea.move, { x: b.x, y: b.y, a: b.a, boat: G.boatId, paint: G.paint }).catch(() => { }).finally(() => { inFlight = false; });
  }
  // the nearest few sailors: dead-reckon from their last two reports, and glide the drawn boat toward that guess
  const now = Date.now(), prev = new Map(ONLINE.sailors.map(s => [s.uid, s])), k = 1 - Math.exp(-4 * dt);
  const live = raw.filter(r => now - r.at < QUIET_MS).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, MAX_SHOWN);
  ONLINE.sailors = live.map(r => {
    let tr = tracks.get(r.id);
    if (!tr || tr.at !== r.at) {                                      // a new report: update the velocity estimate
      const span = tr ? (r.at - tr.at) / 1000 : 0;
      const vx = tr && span > 0.2 && span < 12 ? (r.x - tr.x) / span : 0, vy = tr && span > 0.2 && span < 12 ? (r.y - tr.y) / span : 0;
      tr = { x: r.x, y: r.y, a: r.a, at: r.at, vx, vy, recv: now }; tracks.set(r.id, tr);
    }
    const ahead = Math.min(PREDICT_MAX_S, (now - tr.recv) / 1000), tx = tr.x + tr.vx * ahead, ty = tr.y + tr.vy * ahead;
    const s: Sailor = prev.get(r.id) ?? { uid: r.id, id: r.boat, name: r.name, paint: r.paint, x: tx, y: ty, a: r.a, vx: 0, vy: 0, online: true, emote: null, emoteAt: 0 };
    const px = s.x, py = s.y, da = Math.atan2(Math.sin(r.a - s.a), Math.cos(r.a - s.a));
    s.x += (tx - s.x) * k; s.y += (ty - s.y) * k; s.a += da * k;
    s.vx = (s.x - px) / Math.max(dt, 1e-3); s.vy = (s.y - py) / Math.max(dt, 1e-3);
    Object.assign(s, { id: r.boat, paint: r.paint, name: r.name, emote: r.emote, emoteAt: r.emoteAt });   // id = boat model, as the renderer expects
    if (!seenSailors.has(r.id)) { seenSailors.add(r.id); if (seenSailors.size > 1 || G!.mode === 'play') toast(`${r.name} sailed into view`); }
    return s;
  });
  for (const id of tracks.keys()) if (!live.some(r => r.id === id)) tracks.delete(id);
}
