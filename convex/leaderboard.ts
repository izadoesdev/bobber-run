import { v } from 'convex/values';
import { query, internalMutation, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { isAdminEmail } from './profiles';
import { profileOf } from './lib';
import { MAX_KG, SPECIES_NAMES } from './limits';
import { runningSpecies, weekOf, weekBounds } from './rotation';

const TOP = 20;
type Row = { name: string; value: number; label?: string; admin?: boolean };
const by = v.union(v.literal('species'), v.literal('records'), v.literal('heaviest'), v.literal('caught'), v.literal('earned'));

async function rowFor(ctx: QueryCtx, userId: Id<'users'>, value: number, label?: string): Promise<Row> {
  const [p, u] = await Promise.all([profileOf(ctx, userId), ctx.db.get(userId)]);
  return { name: p?.name ?? 'Sailor', value, ...(label ? { label } : {}), ...(isAdminEmail(u?.email) ? { admin: true } : {}) };
}

/** The top 20 by a measure, and where the caller stands. */
export const top = query({
  args: { by },
  handler: async (ctx, { by }): Promise<{ rows: Row[]; me: { rank: number; value: number } | null }> => {
    const userId = await getAuthUserId(ctx);
    if (by === 'records') {                    // world records held: the best valid catch of each species
      const held = new Map<Id<'users'>, number>();
      for (const sp of Object.keys(MAX_KG)) {
        const best = (await ctx.db.query('records').withIndex('by_species_kg', q => q.eq('species', sp)).order('desc').take(3)).find(r => r.kg <= MAX_KG[sp]);
        if (best) held.set(best.userId, (held.get(best.userId) ?? 0) + 1);
      }
      const ranked = [...held].sort((a, b) => b[1] - a[1]);
      const rows = await Promise.all(ranked.slice(0, TOP).map(([u, n]) => rowFor(ctx, u, n)));
      const i = userId ? ranked.findIndex(([u]) => u === userId) : -1;
      return { rows, me: userId ? { rank: i < 0 ? 0 : i + 1, value: i < 0 ? 0 : ranked[i][1] } : null };
    }
    const index = ({ species: 'by_species', heaviest: 'by_heaviest', caught: 'by_caught', earned: 'by_earned' } as const)[by];
    const field = by;                                                          // narrowed: 'records' returned above
    const fair = (s: Doc<'stats'>) => s[field] > 0 && (by !== 'heaviest' || s.heaviest <= (MAX_KG[s.heaviestSp] ?? 0));
    const best = (await ctx.db.query('stats').withIndex(index).order('desc').take(TOP * 3)).filter(fair).slice(0, TOP);
    const rows = await Promise.all(best.map(s => rowFor(ctx, s.userId, s[field], by === 'heaviest' ? SPECIES_NAMES[s.heaviestSp] ?? s.heaviestSp : undefined)));
    let me: { rank: number; value: number } | null = null;
    if (userId) {
      const mine: Doc<'stats'> | null = await ctx.db.query('stats').withIndex('by_user', q => q.eq('userId', userId)).unique();
      const value = mine?.[field] ?? 0;
      const ahead = value > 0 ? (await ctx.db.query('stats').withIndex(index, q => q.gt(field, value)).take(10_000)).length : 0;
      me = { rank: value > 0 ? ahead + 1 : 0, value };
    }
    return { rows, me };
  },
});

/** This week's running species, each with its five heaviest catches this week and the caller's own best. */
export const weekly = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx), week = weekOf(Date.now()), { start, end } = weekBounds(week);
    const species = await Promise.all(runningSpecies(week).map(async id => {
      const best = await ctx.db.query('weekly').withIndex('by_week_species_kg', q => q.eq('week', week).eq('species', id)).order('desc').take(5);
      const top = await Promise.all(best.map(async b => ({ ...(await rowFor(ctx, b.userId, b.kg)), at: b.at })));
      const mine = userId ? await ctx.db.query('weekly').withIndex('by_week_user_species', q => q.eq('week', week).eq('userId', userId).eq('species', id)).unique() : null;
      return { id, name: SPECIES_NAMES[id] ?? id, top, mine: mine?.kg ?? null };
    }));
    return { week, start, end, species };
  },
});
/** Daily: forget weekly boards older than twelve weeks. */
export const pruneWeeks = internalMutation({
  args: {},
  handler: async ctx => {
    for (const r of await ctx.db.query('weekly').withIndex('by_week', q => q.lt('week', weekOf(Date.now()) - 12)).take(500)) await ctx.db.delete(r._id);
  },
});

/** Sailors online right now, as the relay last reported (0 if it hasn't for a minute). No sign-in needed. */
export const online = query({
  args: {},
  handler: async (ctx): Promise<{ total: number }> => {
    const m = await ctx.db.query('meta').withIndex('by_key', q => q.eq('key', 'online')).unique();
    return { total: m && Date.now() - m.at < 60_000 ? m.value : 0 };
  },
});
