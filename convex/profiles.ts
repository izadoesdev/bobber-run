import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, profileOf } from './lib';
import { cleanName } from './names';
import { NAME_MIN_MS } from './limits';

export const me = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx); if (!userId) return null;
    const [user, profile] = await Promise.all([ctx.db.get(userId), profileOf(ctx, userId)]);
    return { userId, name: profile?.name ?? 'Sailor', guest: !!user?.isAnonymous, email: user?.email ?? null, sea: profile?.sea ?? null };
  },
});
export const setName = mutation({
  args: { name: v.string(), auto: v.optional(v.boolean()) },
  handler: async (ctx, { name, auto }) => {
    const userId = await requireUser(ctx), checked = cleanName(name);
    if (!checked.ok) return checked;
    const p = await profileOf(ctx, userId), now = Date.now();
    if (auto && p && p.name !== 'Sailor') return { ok: true as const, name: p.name };   // a generated name never replaces a chosen one
    if (!auto && p?.nameAt && now - p.nameAt < NAME_MIN_MS) return { ok: false as const, why: 'You just changed your name. Try again in a moment' };
    const nameAt = auto ? p?.nameAt : now;                                   // a generated guest name doesn't count as a rename
    if (p) await ctx.db.patch(p._id, { name: checked.name, nameAt }); else await ctx.db.insert('profiles', { userId, name: checked.name, nameAt });
    return { ok: true as const, name: checked.name };
  },
});
