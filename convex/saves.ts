import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser } from './lib';

// one cloud save per player; a write never replaces a newer save
const MAX_SAVE_CHARS = 400_000;
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
    if (s && s.updatedAt > updatedAt) return { ok: false, newer: s.updatedAt };
    if (s) await ctx.db.patch(s._id, { data, updatedAt }); else await ctx.db.insert('saves', { userId, data, updatedAt });
    return { ok: true };
  },
});
