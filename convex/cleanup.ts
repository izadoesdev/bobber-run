import { v } from 'convex/values';
import { internalMutation, mutation, type MutationCtx } from './_generated/server';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireUser } from './lib';
import { FUND_KEYS, GUEST_IDLE_MS } from './limits';

// Removes a player's account and everything tied to it. World records stay, since they are the coast's history.
async function erase(ctx: MutationCtx, userId: Id<'users'>) {
  // shortcut: Convex Auth v2 has no way to delete an account, so its session rows and any password hash stay, unlinked from the email; call its delete API once there is one
  await ctx.runMutation(components.authUsername.public.deleteUsername, { userId });
  for (const a of await ctx.db.query('authAccounts').withIndex('userIdAndProvider', q => q.eq('userId', userId)).collect()) await ctx.db.delete(a._id);
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

// Daily sweep, oldest accounts first: deletes guests older than GUEST_IDLE_MS who haven't joined the sea in that long.
export const guests = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const now = Date.now();
    const page = await ctx.db.query('users').withIndex('by_creation_time', q => q.lt('_creationTime', now - GUEST_IDLE_MS))
      .paginate({ cursor: cursor ?? null, numItems: 100 });
    for (const u of page.page) {
      if (u.isAnonymous && (u.lastSeen ?? 0) < now - GUEST_IDLE_MS) await erase(ctx, u._id);
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.cleanup.guests, { cursor: page.continueCursor });
  },
});
