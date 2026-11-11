import { v } from 'convex/values';
import { query, mutation, internalMutation, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { authUserId, requireUser, trusted, userIdByEmail } from './lib';
import { GUEST_TRUST_MS, MAX_KG } from './limits';
import { reported } from './statsRules';

// Per-player totals for the leaderboards. Species logged and the heaviest fish come from records.submit (the server
// already checks those); fish caught and coins earned come from the client's save, so they only ever go up and
// can't climb faster than a fast player could manage (a ruler's islands add to what they earn, so earnings may climb
// faster than fishing alone). Earnings, less what's been spent on islands (`spent`), are what islands are paid from.
export async function statsOf(ctx: MutationCtx, userId: Id<'users'>): Promise<Doc<'stats'>> {
  const s = await ctx.db.query('stats').withIndex('by_user', q => q.eq('userId', userId)).unique();
  if (s) return s;
  const id = await ctx.db.insert('stats', { userId, caught: 0, earned: 0, species: 0, heaviest: 0, heaviestSp: '', at: Date.now() });
  const made = await ctx.db.get(id);
  if (!made) throw new Error('stats row vanished');
  return made;
}

/** Pay `amount` from the earnings counted for this player, or say why not (null when paid). */
export async function spend(ctx: MutationCtx, userId: Id<'users'>, amount: number): Promise<string | null> {
  const s = await statsOf(ctx, userId), left = s.earned - (s.spent ?? 0);
  if (left < amount) return `The harbour office has counted $${Math.max(0, left).toLocaleString('en-US')} of your earnings to spend. Sail on and try again`;
  await ctx.db.patch(s._id, { spent: (s.spent ?? 0) + amount });
  return null;
}
/** What the harbour office has counted: your earnings, and what you've spent on islands. */
export const ledger = query({
  args: {},
  handler: async ctx => {
    const userId = await authUserId(ctx);
    if (!userId) return null;
    const s = await ctx.db.query('stats').withIndex('by_user', q => q.eq('userId', userId)).unique();
    return { earned: s?.earned ?? 0, spent: s?.spent ?? 0 };
  },
});

export const report = mutation({
  args: { caught: v.number(), earned: v.number(), cheated: v.optional(v.boolean()) },
  handler: async (ctx, { caught, earned, cheated }) => {
    const userId = await requireUser(ctx);
    if (cheated || !await trusted(ctx, userId, GUEST_TRUST_MS)) return;
    const s = await statsOf(ctx, userId), now = Date.now(), next = reported(s, caught, earned, now);
    if (next) await ctx.db.patch(s._id, { ...next, at: now });
  },
});

/**
 * Command line only (support, testing): count `earned` more earnings for the account with this email, e.g. when a
 * player's save outran what the server counted. `bunx convex run stats:credit '{"email":"…","earned":500000}'`
 * (add --prod for production).
 */
export const credit = internalMutation({
  args: { email: v.string(), earned: v.number() },
  handler: async (ctx, { email, earned }) => {
    const userId = await userIdByEmail(ctx, email);
    if (!userId) throw new Error('No account with that email');
    const s = await statsOf(ctx, userId), next = s.earned + Math.floor(earned);
    await ctx.db.patch(s._id, { earned: next, at: Date.now() });
    return { earned: next, spent: s.spent ?? 0 };
  },
});

/** One-off: fill species and heaviest from existing valid records, zeroing everyone else (`convex run stats:backfill`). */
export const backfill = internalMutation({
  args: {},
  handler: async ctx => {
    const per = new Map<Id<'users'>, { species: number; heaviest: number; heaviestSp: string }>();
    for (const r of await ctx.db.query('records').collect()) {
      if (!(r.kg > 0 && r.kg <= (MAX_KG[r.species] ?? 0))) continue;            // records from before weights were checked
      const e = per.get(r.userId) ?? { species: 0, heaviest: 0, heaviestSp: '' };
      e.species++; if (r.kg > e.heaviest) { e.heaviest = r.kg; e.heaviestSp = r.species; }
      per.set(r.userId, e);
    }
    for (const s of await ctx.db.query('stats').collect()) if (!per.has(s.userId)) await ctx.db.patch(s._id, { species: 0, heaviest: 0, heaviestSp: '' });
    for (const [userId, e] of per) { const s = await statsOf(ctx, userId); await ctx.db.patch(s._id, e); }
    return per.size;
  },
});
