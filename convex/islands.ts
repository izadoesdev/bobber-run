import { v } from 'convex/values';
import { query, mutation, action, internalMutation, internalQuery, type QueryCtx, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, nameOf } from './lib';
import { cleanName } from './names';
import { jevAllowsName, isAdminUser } from './profiles';
import { isClaimable, priceOfKey, MAX_ISLANDS, ISLAND_NAME_MAX, LOGO_MAX_BYTES } from './islandRules';

// Claimable islands: an account buys the main island of a world cell (see islandRules.ts), names it and can give it
// a small logo. Coins live in the save, so the server records the price and the client deducts it on ok, as with fund
// gifts. Islands go back on the market when their owner hasn't been seen for 60 days.
type Result = { ok: true; price?: number } | { ok: false; why: string };
const IDLE_MS = 60 * 86_400_000;

const byKey = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query('islands').withIndex('by_key', q => q.eq('key', key)).unique();

/** Islands for these cells, as other sailors see them. */
export const near = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const me = await getAuthUserId(ctx), out = [];
    for (const key of keys.slice(0, 150)) {
      const isl = await byKey(ctx, key);
      if (isl) out.push({ key, name: isl.name, owner: isl.ownerName, logoUrl: isl.logo ? await ctx.storage.getUrl(isl.logo) : null, mine: isl.ownerId === me });
    }
    return out;
  },
});

/** Everything a claim or rename needs checked inside one transaction. */
export const applyClaim = internalMutation({
  args: { userId: v.id('users'), key: v.string(), name: v.string(), rename: v.boolean() },
  handler: async (ctx, { userId, key, name, rename }): Promise<Result> => {
    const isl = await byKey(ctx, key), now = Date.now();
    if (rename) {
      if (!isl || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
      await ctx.db.patch(isl._id, { name, updatedAt: now });
      return { ok: true };
    }
    if (isl) return { ok: false, why: `${isl.ownerName} already owns this island` };
    const owned = await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 1);
    if (owned.length >= MAX_ISLANDS) return { ok: false, why: `You can own ${MAX_ISLANDS} islands. Release one first` };
    const price = priceOfKey(key);
    await ctx.db.insert('islands', { key, ownerId: userId, ownerName: await nameOf(ctx, userId), name, price, claimedAt: now, updatedAt: now, seenAt: now });
    return { ok: true, price };
  },
});
export const accountOf = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId);
    return { guest: !u || !!u.isAnonymous, admin: await isAdminUser(ctx, userId) };
  },
});

async function checkName(raw: string, isAdmin: boolean): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  if (isAdmin) { const name = raw.replace(/\s+/g, ' ').trim(); return name.length >= 2 && name.length <= ISLAND_NAME_MAX ? { ok: true, name } : { ok: false, why: `Use 2 to ${ISLAND_NAME_MAX} characters` }; }
  const c = cleanName(raw, ISLAND_NAME_MAX);
  if (!c.ok) return c;
  return await jevAllowsName(c.name) ? c : { ok: false, why: "That name isn't allowed. Try another" };
}
export const claim = action({
  args: { key: v.string(), name: v.string(), cheated: v.optional(v.boolean()) },
  handler: async (ctx, { key, name, cheated }): Promise<Result> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, why: 'Sign in to claim islands' };
    if (cheated) return { ok: false, why: 'Saves that used cheats cannot claim islands' };
    if (!isClaimable(key)) return { ok: false, why: "This island can't be claimed" };
    const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
    if (acct.guest) return { ok: false, why: 'Sign in to claim islands' };
    const n = await checkName(name, acct.admin);
    if (!n.ok) return n;
    return ctx.runMutation(internal.islands.applyClaim, { userId, key, name: n.name, rename: false });
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
    return ctx.runMutation(internal.islands.applyClaim, { userId, key, name: n.name, rename: true });
  },
});
/** Give an island back (no refund). */
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
    if (!isl || isl.ownerId !== userId || bad) { await ctx.storage.delete(storageId); return { ok: false, why: bad ? 'Use a PNG under 16 KB' : "That isn't your island" }; }
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.patch(isl._id, { logo: storageId, updatedAt: Date.now() });
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
/** Admins: clear an island's name and logo, or (all) the whole claim. */
export const clear = mutation({
  args: { key: v.string(), all: v.optional(v.boolean()) },
  handler: async (ctx, { key, all }): Promise<Result> => {
    const userId = await requireUser(ctx);
    if (!await isAdminUser(ctx, userId)) return { ok: false, why: 'Admins only' };
    const isl = await byKey(ctx, key);
    if (!isl) return { ok: false, why: 'No island here' };
    if (isl.logo) await ctx.storage.delete(isl.logo);
    if (all) await ctx.db.delete(isl._id); else await ctx.db.patch(isl._id, { name: 'Unnamed island', logo: undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Called when a sailor joins: their islands count as visited. */
export async function touchIslands(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  for (const isl of await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS)) await ctx.db.patch(isl._id, { seenAt: Date.now() });
}
/** Daily: islands whose owner hasn't been seen for 60 days go back on the market. */
export const sweepIdle = internalMutation({
  args: {},
  handler: async ctx => {
    for (const isl of await ctx.db.query('islands').withIndex('by_seen', q => q.lt('seenAt', Date.now() - IDLE_MS)).take(200)) {
      if (isl.logo) await ctx.storage.delete(isl.logo);
      await ctx.db.delete(isl._id);
    }
  },
});
