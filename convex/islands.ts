import { v } from 'convex/values';
import { query, mutation, action, internalAction, internalMutation, internalQuery, type QueryCtx, type MutationCtx, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, nameOf } from './lib';
import { jevYes } from './jev';
import { cleanName } from './names';
import { jevAllowsName, isAdminUser } from './profiles';
import { isClaimable, priceOfKey, MAX_ISLANDS, ISLAND_NAME_MAX, LOGO_MAX_BYTES, BUILDINGS, isBuilding, cantBuild, islandWorth, titleOf } from './islandRules';
import { spend } from './stats';

// Claimable islands, the end game: an account buys the main island of a world cell with the game's coins (see
// islandRules.ts for prices and buildings), names it, gives it a logo and a link, and builds on it. Coins live in the
// player's save, so a purchase is checked against the earnings this server has counted for them (stats.ts), never
// the save's balance. Admins claim for free. Islands go back on the market when their owner hasn't been seen for
// 120 days.
type Result = { ok: true; price?: number } | { ok: false; why: string };
const IDLE_MS = 120 * 86_400_000;

export const byKey = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query('islands').withIndex('by_key', q => q.eq('key', key)).unique();
const LINK_FAILS_HIDE = 3;   // daily checks in a row a link may fail before its sign stops showing it
const linkShown = (isl: Doc<'islands'>): boolean => !!isl.url && (isl.linkFails ?? 0) < LINK_FAILS_HIDE;
const islandsOf = (ctx: QueryCtx | MutationCtx, userId: Id<'users'>) => ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2);
/** A ruler's title from all their islands and buildings. */
async function titleFor(ctx: QueryCtx | MutationCtx, userId: Id<'users'>): Promise<string | null> {
  let worth = 0;
  for (const isl of await islandsOf(ctx, userId)) worth += islandWorth(isl.price, isl.buildings ?? []);
  return titleOf(worth);
}

/** Islands for these cells, as other sailors see them. */
export const near = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const me = await getAuthUserId(ctx), out = [], titles = new Map<Id<'users'>, string | null>();
    for (const key of keys.slice(0, 150)) {
      const isl = await byKey(ctx, key);
      if (!isl) continue;
      if (!titles.has(isl.ownerId)) titles.set(isl.ownerId, await titleFor(ctx, isl.ownerId));
      // a logo shows to others only once an admin has approved it; its owner sees it straight away, marked as waiting
      const mine = isl.ownerId === me, showLogo = !!isl.logo && (isl.logoOk || mine);
      out.push({ key, name: isl.name, owner: isl.ownerName, title: titles.get(isl.ownerId) ?? null, buildings: isl.buildings ?? [], logoUrl: showLogo ? await ctx.storage.getUrl(isl.logo!) : null, logoPending: mine && !!isl.logo && !isl.logoOk, url: linkShown(isl) ? isl.url! : null, mine });
    }
    return out;
  },
});
/** Your islands wherever they are, with what's built on them: the kingdom the game draws income from. */
export const mine = query({
  args: {},
  handler: async ctx => {
    const me = await getAuthUserId(ctx);
    if (!me) return [];
    return (await islandsOf(ctx, me)).map(i => ({ key: i.key, name: i.name, price: i.price, buildings: i.buildings ?? [] }));
  },
});

/** A purchase, checked inside one transaction: the island is free, you have room for it, and your earnings cover it. */
export const applyBuy = internalMutation({
  args: { userId: v.id('users'), key: v.string(), name: v.string(), admin: v.boolean() },
  handler: async (ctx, { userId, key, name, admin }): Promise<Result> => {
    const price = priceOfKey(key), now = Date.now();
    if (price === null) return { ok: false, why: "There's no island to buy here" };
    const isl = await byKey(ctx, key);
    if (isl) return { ok: false, why: isl.ownerId === userId ? 'This island is already yours' : `${isl.ownerName} already owns this island` };
    if ((await islandsOf(ctx, userId)).length >= MAX_ISLANDS) return { ok: false, why: `You can rule ${MAX_ISLANDS} islands. Release one first` };
    if (!admin) { const why = await spend(ctx, userId, price); if (why) return { ok: false, why }; }
    await ctx.db.insert('islands', { key, ownerId: userId, ownerName: await nameOf(ctx, userId), name, price, buildings: [], claimedAt: now, updatedAt: now, seenAt: now });
    return { ok: true, price: admin ? 0 : price };
  },
});
export const applyRename = internalMutation({
  args: { userId: v.id('users'), key: v.string(), name: v.string() },
  handler: async (ctx, { userId, key, name }): Promise<Result> => {
    const isl = await byKey(ctx, key);
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    await ctx.db.patch(isl._id, { name, updatedAt: Date.now() });
    return { ok: true };
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
/** Buy an island with coins (admins claim it for free). The game takes the coins from the save when this succeeds. */
export const buy = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<Result> => {
    const b = await buyer(ctx, key, name);
    if (!b.ok) return b;
    return ctx.runMutation(internal.islands.applyBuy, { userId: b.userId, key, name: b.name, admin: b.acct.admin });
  },
});
/** Build on your island, paid from your counted earnings like the island itself. */
export const build = mutation({
  args: { key: v.string(), building: v.string() },
  handler: async (ctx, { key, building }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    if (!isBuilding(building)) return { ok: false, why: 'Nothing like that can be built' };
    const have = isl.buildings ?? [], no = cantBuild(building, have);
    if (no) return { ok: false, why: no };
    const cost = BUILDINGS[building].cost;
    if (!await isAdminUser(ctx, userId)) { const why = await spend(ctx, userId, cost); if (why) return { ok: false, why }; }
    await ctx.db.patch(isl._id, { buildings: [...have, building], updatedAt: Date.now() });
    return { ok: true, price: cost };
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
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    await ctx.db.patch(isl._id, { url, linkFails: undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});

// ---------- links are checked again every day: dead links fade from the sign, and a link that now leads somewhere
// unsafe (a lapsed domain, a new redirect) is removed ----------
export const linksToCheck = internalQuery({
  args: {},
  handler: async ctx => (await ctx.db.query('islands').collect()).filter(i => i.url).map(i => ({ key: i.key, url: i.url! })),
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
    return ctx.runMutation(internal.islands.applyRename, { userId, key, name: n.name });
  },
});
/** Give an island back, buildings and all (no refund). */
export const release = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
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
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    return { ok: true, url: await ctx.storage.generateUploadUrl() };
  },
});
export const setLogo = mutation({
  args: { key: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, { key, storageId }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    const meta = await ctx.db.system.get(storageId);
    const bad = !meta || meta.contentType !== 'image/png' || meta.size > LOGO_MAX_BYTES;
    if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
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
 * For a world reset (the map regenerates, so a cell may hold a different island or none), or the move from bought
 * islands to coins: every claim, logo and report goes. Command line only: `bunx convex run --prod islands:resetAll '{"confirm":"reset islands"}'`.
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
  for (const isl of await islandsOf(ctx, userId)) await ctx.db.patch(isl._id, { seenAt: Date.now() });
}
/** Daily: islands whose owner hasn't been seen for 120 days go back on the market. */
export const sweepIdle = internalMutation({
  args: {},
  handler: async ctx => {
    for (const isl of await ctx.db.query('islands').withIndex('by_seen', q => q.lt('seenAt', Date.now() - IDLE_MS)).take(200)) {
      if (isl.logo) await ctx.storage.delete(isl.logo);
      await ctx.db.delete(isl._id);
    }
  },
});
