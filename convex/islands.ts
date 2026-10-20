import { v } from 'convex/values';
import { query, mutation, action, internalAction, internalMutation, internalQuery, type QueryCtx, type MutationCtx, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, nameOf, spend } from './lib';
import { jevYes } from './jev';
import { cleanName } from './names';
import { jevAllowsName, isAdminUser } from './profiles';
import { isClaimable, priceOfKey, MAX_ISLANDS, ISLAND_NAME_MAX, LOGO_MAX_BYTES } from './islandRules';

// Claimable islands: an account buys the main island of a world cell (see islandRules.ts; the payment flow is in
// payments.ts), names it, and can give it a logo and a link. Admins claim for free. Islands go back on the market when
// their owner hasn't been seen for 60 days.
type Result = { ok: true; price?: number } | { ok: false; why: string };
const IDLE_MS = 60 * 86_400_000, HOLD_MS = 31 * 60_000, HOLDS_PER_HOUR = 6;

export const byKey = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query('islands').withIndex('by_key', q => q.eq('key', key)).unique();
/** Owned, or held by someone who is still paying; an expired hold counts as free. */
export const taken = (isl: Doc<'islands'> | null, now = Date.now()) => !!isl && (isl.status !== 'pending' || (isl.holdUntil ?? 0) > now);
const owned = (isl: Doc<'islands'> | null): isl is Doc<'islands'> => !!isl && isl.status !== 'pending';
const LINK_FAILS_HIDE = 3;   // daily checks in a row a link may fail before its sign stops showing it
const linkShown = (isl: Doc<'islands'>): boolean => !!isl.url && (isl.linkFails ?? 0) < LINK_FAILS_HIDE;

/** Islands for these cells, as other sailors see them. */
export const near = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const me = await getAuthUserId(ctx), out = [];
    for (const key of keys.slice(0, 150)) {
      const isl = await byKey(ctx, key);
      if (!owned(isl)) continue;
      // a logo shows to others only once an admin has approved it; its owner sees it straight away, marked as waiting
      const mine = isl.ownerId === me, showLogo = !!isl.logo && (isl.logoOk || mine);
      out.push({ key, name: isl.name, owner: isl.ownerName, logoUrl: showLogo ? await ctx.storage.getUrl(isl.logo!) : null, logoPending: mine && !!isl.logo && !isl.logoOk, url: linkShown(isl) ? isl.url! : null, mine });
    }
    return out;
  },
});

/**
 * Everything a claim, hold or rename needs checked inside one transaction. `free` (admins) owns it at once; otherwise
 * it is held while the player pays, and the hold's id is returned for the checkout.
 */
export const applyClaim = internalMutation({
  args: { userId: v.id('users'), key: v.string(), name: v.string(), mode: v.union(v.literal('free'), v.literal('hold'), v.literal('rename')) },
  handler: async (ctx, { userId, key, name, mode }): Promise<{ ok: true; price: number; holdId?: Id<'islands'>; previousSession?: string } | { ok: false; why: string }> => {
    const isl = await byKey(ctx, key), now = Date.now(), price = priceOfKey(key);
    if (mode === 'rename') {
      if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
      await ctx.db.patch(isl._id, { name, updatedAt: now });
      return { ok: true, price: isl.price };
    }
    if (taken(isl, now) && !(isl!.status === 'pending' && isl!.ownerId === userId)) return { ok: false, why: isl!.status === 'pending' ? 'Someone is buying this island right now' : `${isl!.ownerName} already owns this island` };
    const mine = (await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2)).filter(i => i.key !== key && taken(i, now));
    if (mine.length >= MAX_ISLANDS) return { ok: false, why: `You can own ${MAX_ISLANDS} islands. Release one first` };
    if (mode === 'hold' && !await spend(ctx, `hold:${userId}`, HOLDS_PER_HOUR, 3_600_000)) return { ok: false, why: 'Too many purchases started. Try again in an hour' };
    const previousSession = isl?.status === 'pending' && isl.ownerId === userId ? isl.sessionId : undefined;   // our own earlier checkout
    if (isl) await ctx.db.delete(isl._id);                                   // an expired hold, or our own earlier attempt
    const row = { key, ownerId: userId, ownerName: await nameOf(ctx, userId), name, price, claimedAt: now, updatedAt: now, seenAt: now };
    if (mode === 'free') { await ctx.db.insert('islands', { ...row, status: 'owned' }); return { ok: true, price: 0 }; }
    const holdId = await ctx.db.insert('islands', { ...row, status: 'pending', holdUntil: now + HOLD_MS });
    return { ok: true, price, holdId, previousSession };
  },
});
export const accountOf = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId);
    return { guest: !u || !!u.isAnonymous, admin: await isAdminUser(ctx, userId), email: u?.email ?? null };
  },
});

async function checkName(raw: string, isAdmin: boolean): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  if (isAdmin) { const name = raw.replace(/\s+/g, ' ').trim(); return name.length >= 2 && name.length <= ISLAND_NAME_MAX ? { ok: true, name } : { ok: false, why: `Use 2 to ${ISLAND_NAME_MAX} characters` }; }
  const c = cleanName(raw, ISLAND_NAME_MAX);
  if (!c.ok) return c;
  return await jevAllowsName(c.name) ? c : { ok: false, why: "That name isn't allowed. Try another" };
}
/** Who may buy, and with which checked name. */
export async function buyer(ctx: ActionCtx, key: string, name: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return { ok: false as const, why: 'Sign in to buy islands' };
  if (!isClaimable(key)) return { ok: false as const, why: "This island can't be bought" };
  const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
  if (acct.guest) return { ok: false as const, why: 'Sign in to buy islands' };
  const n = await checkName(name, acct.admin);
  return n.ok ? { ok: true as const, userId, acct, name: n.name } : n;
}

/** Admins only: take an island for free. */
export const claim = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<Result> => {
    const b = await buyer(ctx, key, name);
    if (!b.ok) return b;
    if (!b.acct.admin) return { ok: false, why: 'Buy islands with Buy' };
    const r = await ctx.runMutation(internal.islands.applyClaim, { userId: b.userId, key, name: b.name, mode: 'free' });
    return r.ok ? { ok: true, price: 0 } : r;
  },
});

// ---------- the owner's link, shown on their sign ----------
const URL_MAX = 120;
/** A clean https link, or why not. Plain hosts only: no logins in the URL, no bare IPs, no localhost. */
function cleanUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { return { ok: false, why: 'That doesn\'t look like a web address' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'Use an https:// link' };
  if (u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname)) return { ok: false, why: 'Use a normal website address' };
  const url = u.toString().replace(/\/$/, '');
  return url.length <= URL_MAX ? { ok: true, url } : { ok: false, why: `Keep the link under ${URL_MAX} characters` };
}
const LINK_QUESTION = 'Is the website `link.url` likely adult or sexual, gambling, a scam or phishing, malware, drugs, hate or violence, '
  + 'or otherwise unsafe to link from a game played by teenagers?';
/** Links have no local filter, so when Jev can't answer the link waits (null). */
async function jevAllowsLink(url: string): Promise<boolean | null> {
  const p = await jevYes({ link: { url } }, LINK_QUESTION);
  return p === null ? null : p < 0.5;
}
/** Set (or with '' clear) the link on your island's sign. */
export const setUrl = action({
  args: { key: v.string(), url: v.string() },
  handler: async (ctx, { key, url }): Promise<Result> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, why: 'Sign in first' };
    const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
    if (!url.trim()) return ctx.runMutation(internal.islands.applyUrl, { userId, key, url: undefined });
    const c = cleanUrl(url);
    if (!c.ok) return c;
    const allowed = acct.admin || await jevAllowsLink(c.url);
    if (allowed === null) return { ok: false, why: "Links can't be checked right now. Try again later" };
    if (!allowed) return { ok: false, why: "That link isn't allowed" };
    return ctx.runMutation(internal.islands.applyUrl, { userId, key, url: c.url });
  },
});
export const applyUrl = internalMutation({
  args: { userId: v.id('users'), key: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, { userId, key, url }): Promise<Result> => {
    const isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    await ctx.db.patch(isl._id, { url, linkFails: undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});

// ---------- links are checked again every day: dead links fade from the sign, and a link that now leads somewhere
// unsafe (a lapsed domain, a new redirect) is removed ----------
export const linksToCheck = internalQuery({
  args: {},
  handler: async ctx => (await ctx.db.query('islands').collect()).filter(i => owned(i) && i.url).map(i => ({ key: i.key, url: i.url! })),
});
export const linkChecked = internalMutation({
  args: { key: v.string(), url: v.string(), result: v.union(v.literal('ok'), v.literal('dead'), v.literal('unsafe')) },
  handler: async (ctx, { key, url, result }) => {
    const isl = await byKey(ctx, key);
    if (!isl || isl.url !== url) return;                                   // changed since the check started
    if (result === 'unsafe') await ctx.db.patch(isl._id, { url: undefined, linkFails: undefined });
    else await ctx.db.patch(isl._id, { linkFails: result === 'ok' ? undefined : (isl.linkFails ?? 0) + 1 });
  },
});
/** Where a link ends up now, or null when it doesn't answer (a GET, since some sites refuse HEAD). */
async function landing(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'BobberRun-LinkCheck/1.0' } });
    await r.body?.cancel();
    return r.status < 400 ? r.url || url : null;
  } catch { return null; }
}
export const recheckLinks = internalAction({
  args: {},
  handler: async ctx => {
    for (const { key, url } of await ctx.runQuery(internal.islands.linksToCheck, {})) {
      const end = await landing(url);
      let result: 'ok' | 'dead' | 'unsafe' = end ? 'ok' : 'dead';
      if (end && new URL(end).host !== new URL(url).host) {               // it now leads elsewhere: check where
        const c = cleanUrl(end), allowed = c.ok ? await jevAllowsLink(c.url) : false;
        if (allowed === false) result = 'unsafe';
      }
      await ctx.runMutation(internal.islands.linkChecked, { key, url, result });
    }
  },
});

export const rename = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<Result> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, why: 'Sign in first' };
    const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
    const n = await checkName(name, acct.admin);
    if (!n.ok) return n;
    const r = await ctx.runMutation(internal.islands.applyClaim, { userId, key, name: n.name, mode: 'rename' });
    return r.ok ? { ok: true } : r;
  },
});
/** Give an island back (no refund). */
export const release = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.delete(isl._id);
    return { ok: true };
  },
});

// ---------- logos: the owner uploads a small PNG straight to storage, then attaches it ----------
export const uploadUrl = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ ok: true; url: string } | { ok: false; why: string }> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    return { ok: true, url: await ctx.storage.generateUploadUrl() };
  },
});
export const setLogo = mutation({
  args: { key: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, { key, storageId }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    const meta = await ctx.db.system.get(storageId);
    const bad = !meta || meta.contentType !== 'image/png' || meta.size > LOGO_MAX_BYTES;
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    if (bad) { if (meta) await ctx.storage.delete(storageId); return { ok: false, why: 'Use a PNG under 16 KB' }; }
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.patch(isl._id, { logo: storageId, logoOk: await isAdminUser(ctx, userId), updatedAt: Date.now() });
    return { ok: true };
  },
});

// ---------- reports and admin ----------
export const report = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!isl) return { ok: false as const, why: 'No island here' };
    const dupe = await ctx.db.query('islandReports').withIndex('by_key_user', q => q.eq('key', key).eq('userId', userId)).unique();
    if (!dupe) await ctx.db.insert('islandReports', { key, userId, name: isl.name, logo: isl.logo, at: Date.now() });
    return { ok: true as const };
  },
});
/**
 * Logos waiting for review, oldest first. Admins approve or remove them from the command line:
 * `bunx convex run --prod islands:pendingLogos` then `bunx convex run --prod islands:reviewLogo '{"key":"3,-2","ok":true}'`.
 */
export const pendingLogos = internalQuery({
  args: {},
  handler: async ctx => {
    const out = [];
    for (const isl of await ctx.db.query('islands').collect()) if (isl.logo && !isl.logoOk) out.push({ key: isl.key, name: isl.name, owner: isl.ownerName, url: await ctx.storage.getUrl(isl.logo), at: isl.updatedAt });
    return out.sort((a, b) => a.at - b.at);
  },
});
export const reviewLogo = internalMutation({
  args: { key: v.string(), ok: v.boolean() },
  handler: async (ctx, { key, ok }) => {
    const isl = await byKey(ctx, key);
    if (!isl?.logo) return 'no logo';
    if (ok) await ctx.db.patch(isl._id, { logoOk: true }); else { await ctx.storage.delete(isl.logo); await ctx.db.patch(isl._id, { logo: undefined, logoOk: undefined }); }
    return ok ? 'approved' : 'removed';
  },
});
/** Admins: clear an island's name and logo, or (all) the whole claim. */
export const clear = mutation({
  args: { key: v.string(), all: v.optional(v.boolean()) },
  handler: async (ctx, { key, all }): Promise<Result> => {
    const userId = await requireUser(ctx);
    if (!await isAdminUser(ctx, userId)) return { ok: false, why: 'Admins only' };
    const isl = await byKey(ctx, key);
    if (!isl) return { ok: false, why: 'No island here' };
    if (isl.logo) await ctx.storage.delete(isl.logo);
    if (all) await ctx.db.delete(isl._id); else await ctx.db.patch(isl._id, { name: 'Unnamed island', logo: undefined, logoOk: undefined, url: undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});

/**
 * For a world reset (the map regenerates, so a cell may hold a different island or none): every claim, hold, logo and
 * report goes. Payment records stay. Command line only: `bunx convex run --prod islands:resetAll '{"confirm":"reset islands"}'`.
 */
export const resetAll = internalMutation({
  args: { confirm: v.literal('reset islands') },
  handler: async ctx => {
    let n = 0;
    for (const isl of await ctx.db.query('islands').collect()) { if (isl.logo) await ctx.storage.delete(isl.logo); await ctx.db.delete(isl._id); n++; }
    for (const r of await ctx.db.query('islandReports').collect()) await ctx.db.delete(r._id);
    return n;
  },
});
/** Called when a sailor joins: their islands count as visited. */
export async function touchIslands(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  for (const isl of await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2)) if (owned(isl)) await ctx.db.patch(isl._id, { seenAt: Date.now() });
}
/** Daily: islands whose owner hasn't been seen for 60 days go back on the market, and old unpaid holds go away. */
export const sweepIdle = internalMutation({
  args: {},
  handler: async ctx => {
    for (const isl of await ctx.db.query('islands').withIndex('by_seen', q => q.lt('seenAt', Date.now() - IDLE_MS)).take(200)) {
      if (isl.logo) await ctx.storage.delete(isl.logo);
      await ctx.db.delete(isl._id);
    }
  },
});
