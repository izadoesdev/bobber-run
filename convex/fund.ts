import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, trusted, spend } from './lib';
import { FUND_DAILY, FUND_DAILY_ALL, FUND_KEYS, GUEST_TRUST_MS } from './limits';

export const GOAL = 1_000_000;
const today = () => new Date().toISOString().slice(0, 10);
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const f = await ctx.db.query('fund').withIndex('by_key', q => q.eq('key', key)).unique();
    const userId = await getAuthUserId(ctx);
    const mine = userId ? await ctx.db.query('gifts').withIndex('by_key_user', q => q.eq('key', key).eq('userId', userId)).unique() : null;
    return { total: f?.total ?? 0, givers: f?.givers ?? 0, goal: GOAL, mine: mine?.amount ?? 0 };
  },
});
export const give = mutation({
  args: { key: v.string(), amount: v.number(), cheated: v.optional(v.boolean()) },
  handler: async (ctx, { key, amount, cheated }) => {
    const userId = await requireUser(ctx), day = today();
    if (cheated) return { ok: false, why: 'Saves that used cheats cannot give to the fund' };
    if (!FUND_KEYS.includes(key)) return { ok: false, why: 'Unknown fund' };
    if (!(Number.isInteger(amount) && amount > 0 && amount <= 100_000)) return { ok: false, why: 'Bad amount' };
    if (!await trusted(ctx, userId, GUEST_TRUST_MS)) return { ok: false, why: 'Sail a little longer before giving to the fund' };
    const g = await ctx.db.query('gifts').withIndex('by_key_user', q => q.eq('key', key).eq('userId', userId)).unique();
    const given = g?.day === day ? g.today ?? 0 : 0;
    if (given + amount > FUND_DAILY) return { ok: false, why: 'You have given all you can for today' };
    if (!await spend(ctx, `fund:${key}`, FUND_DAILY_ALL, 86_400_000, amount)) return { ok: false, why: 'The fund has taken all it can for today. Try tomorrow' };
    if (g) await ctx.db.patch(g._id, { amount: g.amount + amount, day, today: given + amount }); else await ctx.db.insert('gifts', { key, userId, amount, day, today: amount });
    const f = await ctx.db.query('fund').withIndex('by_key', q => q.eq('key', key)).unique();
    if (f) await ctx.db.patch(f._id, { total: f.total + amount, givers: f.givers + (g ? 0 : 1) }); else await ctx.db.insert('fund', { key, total: amount, givers: 1 });
    return { ok: true };
  },
});
