import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser } from './lib';
import { isAdminEmail } from './profiles';
import { SAVE_MIN_MS, MAX_SAVE_CHARS } from './limits';

// one cloud save per player; a write never replaces a newer save
export const load = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx); if (!userId) return null;
    const s = await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', userId)).unique();
    return s ? { data: s.data, updatedAt: s.updatedAt } : null;
  },
});
export const put = mutation({
  args: { data: v.string(), updatedAt: v.number() },
  handler: async (ctx, { data, updatedAt }) => {
    const userId = await requireUser(ctx);
    if (data.length > MAX_SAVE_CHARS) throw new Error('Save too large');
    const s = await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', userId)).unique();
    const now = Date.now(), at = Math.min(updatedAt, now + 60_000);          // a fast device clock can't lock out other devices
    if (s && s.updatedAt > at) return { ok: false, newer: s.updatedAt };
    if (s?.putAt && now - s.putAt < SAVE_MIN_MS) return { ok: false, busy: true };
    if (s) await ctx.db.patch(s._id, { data, updatedAt: at, putAt: now }); else await ctx.db.insert('saves', { userId, data, updatedAt: at, putAt: now });
    return { ok: true };
  },
});

/**
 * Admins only, from the command line: set the coins in an admin's cloud save (lifetime earnings and the leaderboards
 * are left alone). The game loads it from the title screen. `bunx convex run --prod saves:setAdminCoins '{"email":"…","coins":999999999}'`
 */
export const setAdminCoins = internalMutation({
  args: { email: v.string(), coins: v.number() },
  handler: async (ctx, { email, coins }) => {
    if (!isAdminEmail(email)) throw new Error('Not an admin email');
    const acct = await ctx.db.query('authAccounts').withIndex('providerAndAccountId', q => q.eq('provider', 'password').eq('providerAccountId', email.toLowerCase())).unique();
    const s = acct && await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', acct.userId)).unique();
    if (!s) throw new Error('No cloud save for that account yet');
    // stamped a few minutes ahead, so a tab still open mid-voyage can't overwrite it before the player reloads
    const now = Date.now(), at = now + 5 * 60_000, data = JSON.parse(s.data);
    Object.assign(data, { coins: Math.floor(coins), savedAt: at });
    await ctx.db.patch(s._id, { data: JSON.stringify(data), updatedAt: at });
    return { coins: data.coins };
  },
});
