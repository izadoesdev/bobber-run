// Online play through Convex: guest sign-in, accounts, cloud saves, world records, the coastwide fund,
// greetings and other sailors. Without VITE_CONVEX_URL the game stays offline. The Convex client itself lives in
// netClient.ts, loaded after the first frame so it never delays the game appearing; this module owns all the state.
import type { ConvexReactClient } from 'convex/react';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import type { useAuthActions } from '@convex-dev/auth/react';
import { api } from '../convex/_generated/api';
import { ONLINE, type Sailor } from './online';
import type { ToastKind } from './types';
import { track } from './analytics';
import { celebrate } from './game/feedback';
import { relayKeep, relayLive, relayBoats, relaySend, relayEmote, relayRenamed, relayClock, type RelayBoat } from './relay';

import { FORCED_OFFLINE } from './offline';
export { FORCED_OFFLINE };
const URL: string | undefined = FORCED_OFFLINE ? undefined : import.meta.env.VITE_CONVEX_URL;
const SAVE_KEY = 'bobber-run-save-v3';
const FUND_KEY = 'grand-harbour';

/** Just what this module needs from the game state. */
interface Game { mode: string; boat: { x: number; y: number; a: number; vx: number; vy: number; w: number }; boatId: string; paint: string }
// shapes come straight from the server functions, so client and server can't drift apart
type Profile = NonNullable<FunctionReturnType<typeof api.profiles.me>>;
/** round: which filling of the fund this is (each filled round raises the next goal). */
type Fund = FunctionReturnType<typeof api.fund.get>;
type Status = 'offline' | 'connecting' | 'online';
type Result = { ok: true; msg?: string; loaded?: boolean; name?: string } | { ok: false; why: string };
/** Set once this browser has signed into an account, so the Online screen opens on "I have an account". */
export const HAD_ACCOUNT_KEY = 'bobber-run-had-account';

export const NET = {
  on: !!URL, status: (URL ? 'connecting' : 'offline') as Status, authed: false, busy: false,
  profile: null as Profile | null, records: {} as Record<string, { name: string; kg: number }>, fund: null as Fund | null,
};
export const EMOTES = ['Ahoy!', 'Nice catch!', 'Follow me!', 'Look over here!', 'Thanks!', 'Fair winds!', 'Good night!', 'Wow!'];
const errText = (e: unknown) => String(e instanceof Error ? e.message : e).slice(0, 120);
type News = { id: string; name: string; text: string; at: number };

let client: ConvexReactClient | null = null;
let actions: ReturnType<typeof useAuthActions> | null = null, authToken: string | null = null;
let G: Game | null = null, speciesIds: string[] = [], toast: (s: string, kind?: ToastKind) => void = () => { };
let signingIn = false, switching = false, naming = false;
/** Re-runs the guest sign-in check (after an account switch or delete ends signed out, or a failed guest sign-in). */
let wakeBridge = () => { };

// ---------- subscriptions ----------
const watches: Record<string, { sig: string; off: () => void }> = {};
function watch<T>(key: string, ref: FunctionReference<'query'>, args: Record<string, unknown>, cb: (r: T) => void) {
  const sig = JSON.stringify(args); if (!client || watches[key]?.sig === sig) return;
  watches[key]?.off();
  const w = client.watchQuery(ref, args);
  const pull = () => { try { const r = w.localQueryResult(); if (r !== undefined) cb(r as T); } catch { /* a failed query keeps the last result */ } };
  watches[key] = { sig, off: w.onUpdate(pull) }; pull();
}
/** Stop a subscription made with watch(). */
const unwatch = (key: string) => { watches[key]?.off(); delete watches[key]; };
const call = <A extends Record<string, unknown>>(ref: FunctionReference<'mutation'>, args: A) => client!.mutation(ref, args);

// ---------- sign-in ----------
/** What the sign-in bridge in netClient.ts reports here and asks of this module. */
export const bridge = {
  connected(a: ReturnType<typeof useAuthActions>, token: string | null, wake: () => void): void { actions = a; authToken = token; wakeBridge = wake; },
  /** A guest session may start now (nobody signed in, and no account switch in progress). */
  mayStartGuest: (): boolean => !signingIn && !switching,
  guestStarting(on: boolean): void { signingIn = on; },
  authChanged(authed: boolean): void { NET.authed = authed; if (authed) { NET.status = 'online'; void onSignedIn(); } else NET.profile = null; },
};
export function initNet(game: Game, species: string[], notify: (s: string, kind?: ToastKind) => void) {
  G = game; speciesIds = species; toast = notify;
  const url = URL;
  if (!url) return;
  requestAnimationFrame(() => setTimeout(() => void import('./netClient').then(m => { client = m.connect(url); }), 0));   // after the first frame
  addEventListener('beforeunload', () => { if (NET.authed) client?.mutation(api.sea.leave, {}).catch(() => { }); });
}
const pageStart = Date.now();
async function onSignedIn() {
  watch<Profile | null>('profile', api.profiles.me, {}, p => {
    NET.profile = p;
    if (p && p.name === 'Sailor' && !naming && !switching) { naming = true; void setName('', true); }   // the server picks a guest name
  });
  watch('records', api.records.world, { species: speciesIds }, r => { NET.records = r as typeof NET.records; });
  watch<Fund>('fund', api.fund.get, { key: FUND_KEY }, f => {
    const prev = NET.fund; NET.fund = f;
    if (prev && f.round > prev.round) celebrate();                     // the coast filled a round: fireworks for everyone sailing
  });
  watch<News[]>('news', api.sea.news, { since: pageStart - 60_000 }, onNews);
  try { await call(api.sea.join, {}); } catch { /* stays in its last sea */ }
  if (!switching) await syncSave();   // during an account switch, account() decides which save wins
}
// coastwide news shows as toasts, once each, newest last
const seenNews = new Set<string>();
function onNews(list: News[]) {
  for (const e of [...list].reverse()) if (!seenNews.has(e.id)) { seenNews.add(e.id); if (e.name !== NET.profile?.name) toast(`${e.name} ${e.text}`, 'good'); }
}

// ---------- cloud save: whichever copy is newer wins (the cloud copy replaces a local one only on the title screen) ----------
const localSave = () => { try { const s = localStorage.getItem(SAVE_KEY); return s ? { data: s, at: (JSON.parse(s).savedAt as number) || 0 } : null; } catch { return null; } };
/**
 * Set when the cloud has newer progress (another device) but the player is already sailing: uploads wait, so this
 * device's older save can't overwrite it, and the cloud copy loads the next time the title screen shows.
 */
let cloudAhead = false;
async function syncSave() {
  try {
    const cloud = await client!.query(api.saves.load, {}), local = localSave();
    if (cloud && (!local || cloud.updatedAt > local.at)) {
      if (G?.mode === 'title') { localStorage.setItem(SAVE_KEY, cloud.data); cloudAhead = false; }
      else if (!cloudAhead) { cloudAhead = true; toast('This account has newer progress from another device. It loads next time you open the title screen'); }
    } else if (local) await putSave(local.data, local.at || Date.now());
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
  if (!NET.authed || saveTimer || cloudAhead) return;
  saveTimer = window.setTimeout(() => { saveTimer = 0; if (!NET.authed || switching || cloudAhead) return; const l = localSave(); if (l) putSave(l.data, l.at || Date.now()).catch(() => { }); }, 4000);
}
// cheat-tainted saves never call these (the server also accepts an optional `cheated` flag, which this client
// leaves out so it works against older backends too)
export function netCatch(species: string, kg: number, cheated = false) { if (NET.authed && !cheated) call(api.records.submit, { species, kg: Math.round(kg * 10) / 10 }).catch(() => { }); }
export async function netGive(amount: number, cheated = false): Promise<Result> {
  if (!NET.authed) return { ok: false, why: 'You are offline' };
  if (cheated) return { ok: false, why: 'Saves that used cheats cannot give to the fund' };
  try { const r = await call(api.fund.give, { key: FUND_KEY, amount }); return r.ok ? { ok: true } : { ok: false, why: r.why ?? 'Could not give' }; } catch { return { ok: false, why: 'Could not reach the server' }; }
}
export async function setName(name: string, auto = false): Promise<Result> {
  if (!NET.authed) return { ok: false, why: 'You are offline' };
  try { const r = await client!.action(api.profiles.setName, { name, auto }); if (r.ok) relayRenamed(); return r; } catch { return { ok: false, why: 'Could not reach the server' }; } finally { naming = false; }
}
export function sendEmote(i: number) {
  if (!NET.authed) return;
  if (relayLive()) relayEmote(i); else call(api.sea.emote, { i }).catch(() => { });
  track('greeting_sent', { greeting: i });
}

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
  if (NET.busy) return { ok: false, why: 'Still working on the last request' };
  NET.busy = true; switching = true;
  let timedOut = false;
  await waitFor(() => !signingIn, 8000);                              // a guest sign-in still in flight would race this one
  const keep = localSave(), oldName = NET.profile?.name, oldUser = NET.profile?.userId;
  try {
    // Convex Auth only re-authenticates the connection on a signed-out -> signed-in change, so leave the guest
    // session first; otherwise the server keeps seeing the guest. If sign-in then fails, a new guest session starts (finally).
    if (NET.authed) { await actions.signOut(); await waitFor(() => !NET.authed, 4000); }
    try { await actions.signIn('password', { email, password, flow }); }
    catch (e) {                                                        // accounts made before emails were lower-cased keep their original case
      const typed = rawEmail.trim();
      if (flow !== 'signIn' || typed === email || !/InvalidAccountId/i.test(errText(e))) throw e;
      await actions.signIn('password', { email: typed, password, flow });
    }
    // wait until the server sees the new account (slow connections can take a while)
    if (!await waitFor(() => !!NET.profile && NET.profile.userId !== oldUser && !NET.profile.guest, 20_000)) { timedOut = true; return failed(flow, null); }
    try { localStorage.setItem(HAD_ACCOUNT_KEY, '1'); } catch { /* private mode */ }
    if (flow === 'signUp') {
      if (keep) await putSave(keep.data, Date.now());
      if (oldName && oldName !== 'Sailor') await setName(oldName);   // keep the guest's name (auto would make the server pick a new one)
      track('account_signed_up', { kept_save: !!keep });
      return { ok: true, msg: `Account made and signed in as ${email}. Your progress is saved to it` };
    }
    const cloud = await client.query(api.saves.load, {});
    track('account_signed_in', { loaded_cloud_save: !!cloud });
    if (cloud) {
      if (keep) try { localStorage.setItem(`${SAVE_KEY}-guest`, keep.data); } catch { /* full */ }   // the guest's progress, in case it mattered
      localStorage.setItem(SAVE_KEY, cloud.data); return { ok: true, loaded: true, msg: 'Signed in. Your save is loaded' }; }   // the caller loads it into the game
    if (keep) await putSave(keep.data, Date.now());
    return { ok: true, msg: `Signed in as ${email}` };
  } catch (e) {
    return failed(flow, errText(e));
  } finally {
    NET.busy = false; switching = false;
    if (timedOut && NET.authed) void syncSave();                     // it may still have signed in, just slowly
    wakeBridge();                                                    // signed out after a failure: start a guest session
  }
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
  finally { NET.busy = false; switching = false; wakeBridge(); }
}
/** Sign out; a new guest session starts by itself. */
export async function signOut(): Promise<Result> {
  if (!actions) return { ok: false, why: 'You are offline' };
  NET.busy = true;
  try { await actions.signOut(); NET.profile = null; track('signed_out', {}); return { ok: true }; }
  catch { return { ok: false, why: 'Could not reach the server' }; }
  finally { NET.busy = false; }
}
// ---------- leaderboards and the online count ----------
export type LeaderBy = 'species' | 'records' | 'heaviest' | 'caught' | 'earned';
export type Leaders = FunctionReturnType<typeof api.leaderboard.top>;
export type WeeklyBoard = FunctionReturnType<typeof api.leaderboard.weekly>;
/** One fetch, not a subscription; null when offline or the query isn't deployed yet. */
async function fetchOnce<Q extends FunctionReference<'query'>>(ref: Q, args: FunctionArgs<Q>): Promise<FunctionReturnType<Q> | null> {
  if (!client) return null;
  try { return await client.query(ref, args); } catch { return null; }
}
export const leaders = (by: LeaderBy) => fetchOnce(api.leaderboard.top, { by });
/** This week's running species and their heaviest catches. See convex/rotation.ts. */
export const weeklyBoard = () => fetchOnce(api.leaderboard.weekly, {});
/** Admins only: captains whose name contains `q`, online or not, with where they are (convex/admin.ts); null if offline or refused. */
export const adminPlayers = (q: string) => fetchOnce(api.admin.players, { q });
export type AdminPlayer = NonNullable<FunctionReturnType<typeof api.admin.players>>[number];
/** Sailors online coastwide, for the title screen (no sign-in needed); null if unknown. */
export const onlineCount = async () => (await fetchOnce(api.leaderboard.online, {}))?.total ?? null;
let statsAt = 0;
/** Report lifetime totals for the leaderboards, at most once a minute; nothing for cheated saves or when offline. */
export function reportStats(caught: number, earned: number, cheated = false): void {
  if (!NET.authed || cheated || Date.now() - statsAt < 60_000) return;
  statsAt = Date.now();
  call(api.stats.report, { caught, earned }).catch(() => { statsAt = 0; });
}
// ---------- islands ----------
/** logoPending: your own logo, still waiting for an admin to approve it before other sailors see it. */
export type IslandRow = FunctionReturnType<typeof api.islands.near>[number];
/** Keep `cb` up to date with the claimed islands among these cell keys (one subscription; a new key list replaces it). */
export function watchIslands(keys: string[], cb: (list: IslandRow[]) => void): void {
  if (client) watch<IslandRow[]>('islands', api.islands.near, { keys: keys.slice(0, 150) }, cb);
}
const islandCall = async (fn: () => Promise<{ ok: boolean; why?: string; price?: number }>): Promise<Result & { price?: number }> => {
  if (!NET.authed) return { ok: false, why: 'Sign in to buy islands' };
  try { const r = await fn(); return r.ok ? { ok: true, ...(r.price ? { price: r.price } : {}) } : { ok: false, why: r.why ?? 'Something went wrong' }; }
  catch { return { ok: false, why: 'Could not reach the server' }; }
};
/** Report your totals now (not the once-a-minute report), so the server has counted your latest earnings before a purchase. */
async function countEarnings(caught: number, earned: number): Promise<void> {
  statsAt = Date.now();
  await call(api.stats.report, { caught, earned }).catch(() => { });
}
/** Buy an island with coins (admins claim it free); on success the caller takes the coins from the save. */
export const buyIsland = (key: string, name: string, caught: number, earned: number) =>
  islandCall(async () => { await countEarnings(caught, earned); return client!.action(api.islands.buy, { key, name }); });
/** Build on your island, paid like the island (the caller takes the coins from the save on success). */
export const buildOnIsland = (key: string, building: string, caught: number, earned: number) =>
  islandCall(async () => { await countEarnings(caught, earned); return client!.mutation(api.islands.build, { key, building }); });
export type KingdomRow = FunctionReturnType<typeof api.islands.mine>[number];
/** Keep `cb` up to date with your islands, wherever they are (your kingdom). */
export function watchKingdom(cb: (list: KingdomRow[]) => void): void {
  if (client) watch<KingdomRow[]>('kingdom', api.islands.mine, {}, cb);
}
/** Keep `cb` up to date with the earnings the server has counted for you, and what islands have cost. */
export function watchLedger(cb: (l: { earned: number; spent: number } | null) => void): void {
  if (client) watch<{ earned: number; spent: number } | null>('ledger', api.stats.ledger, {}, cb);
}
export const renameIsland = (key: string, name: string) => islandCall(() => client!.action(api.islands.rename, { key, name }));
export const releaseIsland = (key: string) => islandCall(() => client!.mutation(api.islands.release, { key }));
export const reportIsland = (key: string) => islandCall(() => client!.mutation(api.islands.report, { key }));
/** Set the link on your island's sign (https only, checked on the server); '' removes it. */
export const setIslandUrl = (key: string, url: string) => islandCall(() => client!.action(api.islands.setUrl, { key, url }));
/** Upload an already downscaled PNG (16 KB at most) as an island's logo. */
export async function uploadIslandLogo(key: string, png: Blob): Promise<Result> {
  return islandCall(async () => {
    const u = await client!.mutation(api.islands.uploadUrl, { key });
    if (!u.ok) return u;
    const r = await fetch(u.url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png });
    if (!r.ok) return { ok: false, why: 'The upload failed. Try again' };
    const { storageId } = await r.json();
    return client!.mutation(api.islands.setLogo, { key, storageId });
  });
}
/** Test hook: ask the server who we are right now (no tokens exposed). */
export const whoami = () => client?.query(api.profiles.me, {}) ?? null;

// ---------- other sailors near you ----------
const CELL = 400, MAX_SHOWN = 12, QUIET_MS = 25_000;
const cellsAround = (sea: number, x: number, y: number) => {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), out: string[] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.push(`${sea}|${cx + i},${cy + j}`);
  return out;
};
type Raw = RelayBoat;   // the relay and the Convex fallback (sea.near) send boats in the same shape
let lastSent: { x: number; y: number; a: number } | null = null, sendT = 0, sentAt = 0, inFlight = false, raw: Raw[] = [];
/**
 * Other boats are drawn a little in the past, between two real reports, so they move smoothly however unevenly
 * reports arrive. Each report carries the boat's velocity and turn rate, so the path between reports curves the way
 * the boat actually moved; if reports stop, the boat coasts on for a moment before holding still.
 */
type Snap = { at: number; x: number; y: number; a: number; vx: number; vy: number; w: number };
const snaps = new Map<string, Snap[]>();
// ---------- timing ----------
// Each report goes on the server's clock at the moment its sender took it: the sender's own stamp (ts) plus that
// sender's clock offset, the least (server heard - sender took) seen from it lately, i.e. its least delayed delivery,
// so network jitter doesn't bunch reports up or spread them out. Boats are drawn on a playback clock that runs a little
// behind the server's (ours less the least (we heard - server sent) seen lately): far enough behind that the next
// report has nearly always arrived, judged from how late reports have been arriving, and it speeds up or slows down by
// a few percent to keep there, so the timeline never jumps. Without the relay, Convex's stamps stand in for both.
const SEND_MOVING_S = 0.5, SEND_STILL_S = 10, RELAY_SEND_MS = 100, RELAY_STILL_S = 1, COAST_MS = 1500, SNAP_DIST = 200;
const WINDOW_MS = 5000;
/** The least of the values seen in the last WINDOW_MS (a sliding minimum). */
class LeastLately {
  private v: [number, number][] = [];
  add(at: number, x: number): void { while (this.v.length && this.v[this.v.length - 1][1] >= x) this.v.pop(); this.v.push([at, x]); while (this.v[0][0] < at - WINDOW_MS) this.v.shift(); }
  get(): number | null { return this.v.length ? this.v[0][1] : null; }
}
const serverLag = new LeastLately();                       // our clock minus the server's, least seen lately
const senderOff = new Map<string, LeastLately>();          // per boat: server clock minus its sender's, least seen lately
let ageMax: [number, number][] = [];                       // how old each newest report was on arrival (server ms), lately
let playT = -Infinity, lastHeard = 0, clockFrom: boolean | null = null;
/** Server time a report was taken at. */
function stamp(r: Raw, now: number): number {
  if (r.ts === undefined) return r.at;
  let o = senderOff.get(r.id);
  if (!o) senderOff.set(r.id, o = new LeastLately());
  o.add(now, r.at - r.ts);
  return r.ts + o.get()!;
}
/** How far behind the server clock boats are drawn: the oldest a newest report has lately been on arrival, plus room. */
function behindMs(now: number): number {
  ageMax = ageMax.filter(([t]) => t > now - WINDOW_MS);
  const worst = ageMax.reduce((m, [, a]) => Math.max(m, a), 0);
  return Math.min(700, Math.max(relayLive() ? 120 : 400, worst + 40));
}
const turn = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
/** Where a boat was at server time t: a cubic curve through the reports either side, matching their velocities. */
function sample(list: Snap[], t: number): { x: number; y: number; a: number; vx: number; vy: number; w: number } {
  const last = list[list.length - 1];
  if (t >= last.at) {
    const e = Math.min(t - last.at, COAST_MS) / 1000;
    const going = e < COAST_MS / 1000;
    return { x: last.x + last.vx * e, y: last.y + last.vy * e, a: last.a + last.w * e, vx: going ? last.vx : 0, vy: going ? last.vy : 0, w: going ? last.w : 0 };
  }
  const first = list[0];
  if (list.length < 2 || t <= first.at) return { x: first.x, y: first.y, a: first.a, vx: 0, vy: 0, w: 0 };
  let i = list.length - 2;
  while (i > 0 && list[i].at > t) i--;
  const p = list[i], q = list[i + 1];
  const span = (q.at - p.at) / 1000, u = (t - p.at) / (q.at - p.at), u2 = u * u, u3 = u2 * u;
  const h = [2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2];          // Hermite basis
  const d = [(6 * u2 - 6 * u) / span, 3 * u2 - 4 * u + 1, (6 * u - 6 * u2) / span, 3 * u2 - 2 * u];   // its derivative
  const at = (k: 'x' | 'y', vk: 'vx' | 'vy', b: number[]) => b[0] * p[k] + b[1] * span * p[vk] + b[2] * q[k] + b[3] * span * q[vk];
  return { x: at('x', 'vx', h), y: at('y', 'vy', h), a: p.a + turn(p.a, q.a) * u, vx: at('x', 'vx', d) / span, vy: at('y', 'vy', d) / span, w: p.w + (q.w - p.w) * u };
}
export function netTick(dt: number) {
  relayKeep(NET.authed ? authToken : null, NET.authed ? NET.profile?.userId ?? null : null);
  if (!NET.authed || !G || NET.profile?.sea == null) {             // signed out: nobody else is drawn
    if (raw.length || ONLINE.sailors.length) { raw = []; ONLINE.sailors = []; snaps.clear(); }
    return;
  }
  if (cloudAhead && G.mode === 'title') { cloudAhead = false; void syncSave(); }
  const b = G.boat, state = { x: b.x, y: b.y, a: b.a, vx: b.vx, vy: b.vy, w: b.w, boat: G.boatId, paint: G.paint };
  if (clockFrom !== relayLive()) { clockFrom = relayLive(); snaps.clear(); senderOff.clear(); ageMax = []; playT = -Infinity; }
  sendT += dt;
  const now = Date.now(), moved = !lastSent || Math.hypot(b.x - lastSent.x, b.y - lastSent.y) > 0.5 || Math.abs(b.a - lastSent.a) > 0.03;
  if (relayLive()) {                                           // realtime: every 100 ms of real time while moving, once a second still
    unwatch('sailors');
    raw = relayBoats();
    if (relayClock.heard !== lastHeard) { lastHeard = relayClock.heard; serverLag.add(now, relayClock.heard - relayClock.sent); }
    if (G.mode === 'play' && ((moved && now - sentAt >= RELAY_SEND_MS - 4) || sendT > RELAY_STILL_S)) { sendT = 0; sentAt = now; lastSent = state; relaySend(state); }
  } else {                                                     // Convex: twice a second while moving, every 10 s when still
    watch<Raw[]>('sailors', api.sea.near, { cells: cellsAround(NET.profile.sea, b.x, b.y) }, list => { raw = list; });
    for (const r of raw) serverLag.add(now, now - r.at);       // no server clock of its own: its stamps bound it
    if (G.mode === 'play' && !inFlight && ((moved && sendT > SEND_MOVING_S) || sendT > SEND_STILL_S)) {
      sendT = 0; inFlight = true; lastSent = state;
      client!.mutation(api.sea.move, state).catch(() => { }).finally(() => { inFlight = false; });
    }
  }
  const lag = serverLag.get() ?? 0, serverNow = now - lag, prev = new Map(ONLINE.sailors.map(s => [s.uid, s]));
  let newest = -Infinity;
  for (const r of raw) {
    const at = stamp(r, now), list = snaps.get(r.id) ?? [];
    if (!list.length || at > list[list.length - 1].at) { list.push({ at, x: r.x, y: r.y, a: r.a, vx: r.vx, vy: r.vy, w: r.w }); newest = Math.max(newest, at); }
    while (list.length > 2 && list[1].at < playT - 2000) list.shift();
    snaps.set(r.id, list);
  }
  if (newest > -Infinity) ageMax.push([now, serverNow - newest]);
  // the playback clock: a few percent fast or slow to stay `behind` the server; a big gap (a stall, a new source) is a jump
  const want = serverNow - behindMs(now), off = want - playT;
  playT = Math.abs(off) > 1000 ? want : playT + dt * 1000 * (1 + Math.max(-0.05, Math.min(0.05, off / 1000)));
  const k = 1 - Math.exp(-30 * dt);
  const live = raw.filter(r => serverNow - r.at < QUIET_MS).sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)).slice(0, MAX_SHOWN);
  ONLINE.sailors = live.map(r => {
    const at = sample(snaps.get(r.id)!, playT);
    const s: Sailor = prev.get(r.id) ?? { uid: r.id, id: r.boat, name: r.name, paint: r.paint, x: at.x, y: at.y, a: at.a, vx: 0, vy: 0, w: 0, online: true, emote: null, emoteAt: 0 };
    // follow the sampled path closely; a big gap (a ferry trip, a respawn) is a real jump, so take it at once
    if (Math.hypot(at.x - s.x, at.y - s.y) > SNAP_DIST) { s.x = at.x; s.y = at.y; s.a = at.a; }
    else { s.x += (at.x - s.x) * k; s.y += (at.y - s.y) * k; s.a += turn(s.a, at.a) * k; }
    s.vx = at.vx; s.vy = at.vy; s.w = at.w;
    Object.assign(s, { id: r.boat, paint: r.paint, name: r.name, emote: r.emote, emoteAt: r.emoteAt });   // id = boat model, as the renderer expects
    return s;
  });
  for (const id of snaps.keys()) if (!raw.some(r => r.id === id)) snaps.delete(id);
}
