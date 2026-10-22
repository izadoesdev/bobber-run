import { v } from 'convex/values';
import { query, mutation, internalMutation, type MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
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

/** An admin's cloud save, found by their sign-in email (admins only, for the command-line tools below). */
async function adminSave(ctx: MutationCtx, email: string) {
  if (!isAdminEmail(email)) throw new Error('Not an admin email');
  const acct = await ctx.db.query('authAccounts').withIndex('providerAndAccountId', q => q.eq('provider', 'password').eq('providerAccountId', email.toLowerCase())).unique();
  const s = acct && await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', acct.userId)).unique();
  if (!s) throw new Error('No cloud save for that account yet');
  return s;
}
/** Write an admin's edited save, stamped a few minutes ahead so a tab still open mid-voyage can't overwrite it before the player reloads. */
async function putAdminSave(ctx: MutationCtx, s: Doc<'saves'>, data: Record<string, unknown>): Promise<void> {
  const at = Date.now() + 5 * 60_000;
  await ctx.db.patch(s._id, { data: JSON.stringify({ ...data, savedAt: at }), updatedAt: at });
}

/**
 * Admins only, from the command line: set the coins in an admin's cloud save (lifetime earnings and the leaderboards
 * are left alone). The game loads it from the title screen. `bunx convex run --prod saves:setAdminCoins '{"email":"…","coins":999999999}'`
 */
export const setAdminCoins = internalMutation({
  args: { email: v.string(), coins: v.number() },
  handler: async (ctx, { email, coins }) => {
    const s = await adminSave(ctx, email), data = JSON.parse(s.data);
    await putAdminSave(ctx, s, { ...data, coins: Math.floor(coins) });
    return { coins: Math.floor(coins) };
  },
});

/**
 * Admins only, from the command line: move an admin's boat in their cloud save, beside another player (from that
 * player's latest cloud save) or to a point, opening any regions given so rough water doesn't push the boat back.
 * `bunx convex run --prod saves:setAdminPosition '{"email":"…","toUserId":"…","unlock":["0:-7"]}'`
 */
export const setAdminPosition = internalMutation({
  args: { email: v.string(), toUserId: v.optional(v.id('users')), x: v.optional(v.number()), y: v.optional(v.number()), unlock: v.optional(v.array(v.string())) },
  handler: async (ctx, { email, toUserId, x, y, unlock = [] }) => {
    const s = await adminSave(ctx, email), data = JSON.parse(s.data);
    let to = x !== undefined && y !== undefined ? { x, y } : null;
    if (toUserId) {
      const other = await ctx.db.query('saves').withIndex('by_user', q => q.eq('userId', toUserId)).unique();
      const o = other && JSON.parse(other.data);
      if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) throw new Error('That player has no saved position');
      to = { x: o.x + 40, y: o.y };                                // alongside, not on top of them
    }
    if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) throw new Error('Give toUserId, or x and y');
    const unlocked = [...new Set([...(Array.isArray(data.unlocked) ? data.unlocked : []), ...unlock])];
    await putAdminSave(ctx, s, { ...data, x: to.x, y: to.y, waypoint: null, unlocked });
    return { x: to.x, y: to.y, unlocked };
  },
});
