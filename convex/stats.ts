import { v } from 'convex/values';
import { mutation, internalMutation, httpAction, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireUser, trusted, isFromRelay } from './lib';
import { GUEST_TRUST_MS, MAX_KG } from './limits';

// Per-player totals for the leaderboards. Species logged and the heaviest fish come from records.submit (the server
// already checks those); fish caught and coins earned come from the client's save, so they only ever go up and
// can't climb faster than a fast player could manage.
const CAUGHT_PER_MIN = 40, EARNED_PER_MIN = 4000, SLACK_CAUGHT = 60, SLACK_EARNED = 8000;

export async function statsOf(ctx: MutationCtx, userId: Id<'users'>): Promise<Doc<'stats'>> {
  const s = await ctx.db.query('stats').withIndex('by_user', q => q.eq('userId', userId)).unique();
  if (s) return s;
  const id = await ctx.db.insert('stats', { userId, caught: 0, earned: 0, species: 0, heaviest: 0, heaviestSp: '', at: Date.now() });
  const made = await ctx.db.get(id);
  if (!made) throw new Error('stats row vanished');
  return made;
}

export const report = mutation({
  args: { caught: v.number(), earned: v.number(), cheated: v.optional(v.boolean()) },
  handler: async (ctx, { caught, earned, cheated }) => {
    const userId = await requireUser(ctx);
    if (cheated || !Number.isFinite(caught) || !Number.isFinite(earned) || !await trusted(ctx, userId, GUEST_TRUST_MS)) return;
    const s = await statsOf(ctx, userId), now = Date.now(), mins = Math.min(10, Math.max(0, (now - s.at) / 60_000));   // idle time doesn't bank allowance
    const nextCaught = Math.min(Math.max(s.caught, Math.floor(caught)), s.caught + SLACK_CAUGHT + mins * CAUGHT_PER_MIN);
    const nextEarned = Math.min(Math.max(s.earned, Math.floor(earned)), s.earned + SLACK_EARNED + mins * EARNED_PER_MIN);
    if (nextCaught !== s.caught || nextEarned !== s.earned) await ctx.db.patch(s._id, { caught: Math.floor(nextCaught), earned: Math.floor(nextEarned), at: now });
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

// how many sailors the relay says are online (it reports every 15 s)
export const setOnline = internalMutation({
  args: { online: v.number() },
  handler: async (ctx, { online }) => {
    const m = await ctx.db.query('meta').withIndex('by_key', q => q.eq('key', 'online')).unique();
    if (m) await ctx.db.patch(m._id, { value: online, at: Date.now() }); else await ctx.db.insert('meta', { key: 'online', value: online, at: Date.now() });
  },
});
export const onlineFromRelay = httpAction(async (ctx, req) => {
  if (!isFromRelay(req)) return new Response('forbidden', { status: 403 });
  try { await ctx.runMutation(internal.stats.setOnline, await req.json()); } catch { return new Response('bad', { status: 400 }); }
  return new Response('ok');
});
