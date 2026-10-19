import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireUser, nameOf, cellOf, profileOf, finite } from './lib';
import { BOTTLE_MIN_MS } from './limits';

const MAX_AFLOAT = 5;
// preset phrases only (msg is an index into the client's list), so there is nothing to moderate
export const toss = mutation({
  args: { x: v.number(), y: v.number(), msg: v.number() },
  handler: async (ctx, { x, y, msg }) => {
    const userId = await requireUser(ctx);
    if (!(Number.isInteger(msg) && msg >= 0 && msg < 64) || !finite(x, y)) return { ok: false, why: 'Bad bottle' };
    const mine = (await ctx.db.query('bottles').withIndex('by_user', q => q.eq('userId', userId)).collect()).sort((a, b) => a.at - b.at);
    if (mine.length && Date.now() - mine[mine.length - 1].at < BOTTLE_MIN_MS) return { ok: false, why: 'Wait a little before tossing another bottle' };
    if (mine.length >= MAX_AFLOAT) await ctx.db.delete(mine[0]._id);
    const sea = (await profileOf(ctx, userId))?.sea ?? 0;
    await ctx.db.insert('bottles', { userId, name: await nameOf(ctx, userId), cell: cellOf(sea, x, y), x, y, msg, at: Date.now(), reads: 0 });
    return { ok: true };
  },
});
export const near = query({
  args: { cells: v.array(v.string()) },
  handler: async (ctx, { cells }) => {
    const out = [];
    for (const cell of cells.slice(0, 9)) for (const b of await ctx.db.query('bottles').withIndex('by_cell', q => q.eq('cell', cell)).take(20))
      out.push({ id: b._id, x: b.x, y: b.y, msg: b.msg, name: b.name, userId: b.userId });
    return out;
  },
});
export const read = mutation({
  args: { id: v.id('bottles') },
  handler: async (ctx, { id }) => { await requireUser(ctx); const b = await ctx.db.get(id); if (b) await ctx.db.patch(id, { reads: b.reads + 1 }); },
});
