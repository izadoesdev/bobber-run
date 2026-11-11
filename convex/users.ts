import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { limits } from './lib';

const provider = <N extends string>(name: N) => v.object({ provider: v.object({ name: v.literal(name), accountId: v.string(), profile: v.object({}) }) }).fields;

// guests cost nothing to make, so cap how many the whole coast can create per window; throwing rolls the sign-up back
export const createGuest = internalMutation({
  args: provider('anonymous'),
  returns: v.id('users'),
  handler: async ctx => {
    if (!(await limits.limit(ctx, 'guests')).ok) throw new Error('The server is busy. Try again in a few minutes');
    return ctx.db.insert('users', { isAnonymous: true, lastSeen: Date.now() });
  },
});

export const createAccount = internalMutation({
  args: provider('password'),
  returns: v.id('users'),
  handler: async ctx => {
    // Until legacyAccounts:reserveEmails has run, an old account's email looks free, and taking it would lock out its owner (or claim an ADMIN_EMAILS address).
    const unreserved = await ctx.db.query('authAccounts').withIndex('by_provider_reserved', q => q.eq('provider', 'password').eq('reserved', undefined)).first();
    if (unreserved) throw new Error('The server is busy. Try again in a few minutes');
    return ctx.db.insert('users', { lastSeen: Date.now() });
  },
});
