import { v } from 'convex/values';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireUser } from './lib';
import { FUND_KEYS, GUEST_IDLE_MS } from './limits';

// Removes a player's account and everything tied to it. World records stay, since they are the coast's history.
async function erase(ctx: MutationCtx, userId: Id<'users'>) {
  for (const s of await ctx.db.query('authSessions').withIndex('userId', q => q.eq('userId', userId)).collect()) {
    for (const t of await ctx.db.query('authRefreshTokens').withIndex('sessionId', q => q.eq('sessionId', s._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(s._id);
  }
  for (const a of await ctx.db.query('authAccounts').withIndex('userIdAndProvider', q => q.eq('userId', userId)).collect()) {
    for (const c of await ctx.db.query('authVerificationCodes').withIndex('accountId', q => q.eq('accountId', a._id)).collect()) await ctx.db.delete(c._id);
    await ctx.db.delete(a._id);
  }
  for (const t of ['profiles', 'saves', 'positions', 'stats'] as const)
    for (const r of await ctx.db.query(t).withIndex('by_user', q => q.eq('userId', userId)).collect()) await ctx.db.delete(r._id);
  for (const key of FUND_KEYS)
    for (const g of await ctx.db.query('gifts').withIndex('by_key_user', q => q.eq('key', key).eq('userId', userId)).collect()) await ctx.db.delete(g._id);
  for (const isl of await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).collect()) {   // their islands go back on the market
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.delete(isl._id);
  }
  await ctx.db.delete(userId);
}

// "Delete my account" for signed-in players
export const deleteMe = mutation({
  args: {},
  handler: async ctx => { await erase(ctx, await requireUser(ctx)); return { ok: true }; },
});

// Daily sweep, oldest accounts first: deletes guests older than GUEST_IDLE_MS with no live session.
export const guests = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query('users').withIndex('by_creation_time', q => q.lt('_creationTime', now - GUEST_IDLE_MS))
      .paginate({ cursor: cursor ?? null, numItems: 100 });
    for (const u of page.page) {
      if (!u.isAnonymous) continue;
      const live = (await ctx.db.query('authSessions').withIndex('userId', q => q.eq('userId', u._id)).collect()).some(s => s.expirationTime > now - GUEST_IDLE_MS);
      if (!live) await erase(ctx, u._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.cleanup.guests, { cursor: page.continueCursor });
  },
});
