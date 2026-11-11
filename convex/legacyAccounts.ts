import { createFunctionHandle } from 'convex/server';
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { components, internal } from './_generated/api';
import { limits, userIdByEmail } from './lib';

// Password accounts from Convex Auth v1 keep their user id, and with it their save, records and islands. v2 can't read
// v1's scrypt hashes, so each one moves at its owner's next sign-in (legacySignIn.ts), when the plain password is known.
// Remove this, legacySignIn.ts and the authAccounts table once the accounts left are ones nobody will come back for.

/**
 * Run once, straight after deploying: `bunx convex run --prod legacyAccounts:reserveEmails`. Holds every old email as a
 * v2 username, so sign-up calls it taken. New sign-ups are refused until it finishes (users.ts).
 */
export const reserveEmails = internalMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const page = await ctx.db.query('authAccounts').withIndex('by_provider_reserved', q => q.eq('provider', 'password').eq('reserved', undefined)).take(100);
    for (const a of page) {
      const r = await ctx.runMutation(components.authUsername.public.setUsername, { userId: a.userId, username: a.providerAccountId.toLowerCase() });
      // two old accounts whose emails differ only by case: the later one stays unreachable, as it can't have a username of its own
      if (!r.success) console.warn(`legacy account of user ${a.userId} not reserved: ${r.userError.error}`);
      await ctx.db.patch(a._id, { reserved: true });
    }
    if (page.length) await ctx.scheduler.runAfter(0, internal.legacyAccounts.reserveEmails, {});
    return null;
  },
});

/** The not yet moved account behind an email, or null. */
export const find = internalQuery({
  args: { email: v.string() },
  returns: v.union(v.object({ userId: v.id('users'), secret: v.string() }), v.null()),
  handler: async (ctx, { email }) => {
    const userId = await userIdByEmail(ctx, email); if (!userId) return null;
    const a = await ctx.db.query('authAccounts').withIndex('userIdAndProvider', q => q.eq('userId', userId).eq('provider', 'password')).unique();
    return a?.secret ? { userId, secret: a.secret } : null;
  },
});

export const allowAttempt = internalMutation({
  args: { userId: v.id('users') },
  returns: v.boolean(),
  handler: async (ctx, { userId }): Promise<boolean> => (await limits.limit(ctx, 'legacySignIn', { key: userId })).ok,
});

/** Called with a password legacySignIn.ts has verified. False when v2 refuses it as a password: nothing changes, and the player must choose another. */
export const finish = internalMutation({
  args: { userId: v.id('users'), password: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, password }): Promise<boolean> => {
    const a = await ctx.db.query('authAccounts').withIndex('userIdAndProvider', q => q.eq('userId', userId).eq('provider', 'password')).unique();
    if (!a) return true;                                                     // a second tab got here first
    const set = await ctx.runMutation(components.authPassword.public.setPassword, { userId, password });
    if (!set.success) return false;
    // v2 keys password accounts by user id
    await ctx.runMutation(components.auth.public.signUpWithoutSession, {
      claims: { providerName: 'password', providerAccountId: userId, profile: {} },
      createUserHandle: await createFunctionHandle(internal.legacyAccounts.adoptUser),
    });
    await ctx.db.delete(a._id);
    return true;
  },
});

/** v2's createUser callback for a moved account: the user already exists. */
export const adoptUser = internalMutation({
  args: { provider: v.object({ name: v.literal('password'), accountId: v.string(), profile: v.object({}) }) },
  returns: v.id('users'),
  handler: async (ctx, { provider }) => {
    const userId = ctx.db.normalizeId('users', provider.accountId);
    if (!userId) throw new Error('Not a user id');
    return userId;
  },
});
