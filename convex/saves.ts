import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser } from './lib';
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
