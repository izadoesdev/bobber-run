import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import { authUserId, requireUser, profileOf, cellOf, finite } from './lib';
import { touchIslands } from './islands';
import { NEAR_MAX, MOVE_MIN_MS, EMOTE_MIN_MS, ABOARD_MAX } from './limits';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

// Boat positions, who is sailing, and coast news.
// Everyone sails one shared sea, sea 0; the sea field stays on rows and cell keys so the world could be split again.
// a boat unheard for ACTIVE_MS is swept (crons.ts); still boats report every 10 s and aboard rows every 20 s at worst
const ACTIVE_MS = 30_000, ABOARD_MS = 15_000, ABOARD_MOVE = 300;
/** Keep a sailor's aboard row (the roster and the map) roughly current, without rewriting it on every move. */
async function stayAboard(ctx: MutationCtx, row: { userId: Id<'users'>; sea: number; name: string; x: number; y: number }, pos: Id<'positions'>, now: number) {
  const a = await ctx.db.query('aboard').withIndex('by_user', q => q.eq('userId', row.userId)).unique();
  const next = { userId: row.userId, pos, sea: row.sea, name: row.name, x: row.x, y: row.y, at: now };
  if (!a) await ctx.db.insert('aboard', next);
  else if (now - a.at > ABOARD_MS || Math.hypot(a.x - row.x, a.y - row.y) > ABOARD_MOVE || a.name !== row.name || a.pos !== pos || a.sea !== row.sea) await ctx.db.replace(a._id, next);
}
async function goAshore(ctx: MutationCtx, userId: Id<'users'>) {
  const p = await ctx.db.query('positions').withIndex('by_user', q => q.eq('userId', userId)).unique(); if (p) await ctx.db.delete(p._id);
  const a = await ctx.db.query('aboard').withIndex('by_user', q => q.eq('userId', userId)).unique(); if (a) await ctx.db.delete(a._id);
}
export const join = mutation({
  args: {},
  handler: async ctx => {
    const userId = await requireUser(ctx), p = await profileOf(ctx, userId);
    await touchIslands(ctx, userId);                                      // their islands count as visited
    await ctx.db.patch(userId, { lastSeen: Date.now() });                 // keeps a guest from the idle sweep (cleanup.ts)
    if (p?.sea === 0) return 0;
    if (p) await ctx.db.patch(p._id, { sea: 0 }); else await ctx.db.insert('profiles', { userId, name: 'Sailor', sea: 0 });
    return 0;
  },
});
export const move = mutation({
  args: { x: v.number(), y: v.number(), a: v.number(), vx: v.optional(v.number()), vy: v.optional(v.number()), w: v.optional(v.number()), boat: v.string(), paint: v.string() },
  handler: async (ctx, { x, y, a, vx = 0, vy = 0, w = 0, boat, paint }) => {
    const userId = await requireUser(ctx);
    if (!finite(x, y, a, vx, vy, w) || Math.hypot(vx, vy) > 400 || Math.abs(w) > 20 || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || boat.length > 16 || paint.length > 16) return;
    const now = Date.now(), prof = await profileOf(ctx, userId), sea = prof?.sea ?? 0;
    const p = await ctx.db.query('positions').withIndex('by_user', q => q.eq('userId', userId)).unique();
    if (p && now - p.at < MOVE_MIN_MS) return;                               // too fast: drop it
    const row = { userId, sea, cell: cellOf(sea, x, y), x, y, a, vx, vy, w, boat, paint, name: prof?.name ?? 'Sailor', at: now, emote: p?.emote, emoteAt: p?.emoteAt };
    const pos = p ? p._id : await ctx.db.insert('positions', row);
    if (p) await ctx.db.replace(p._id, row);
    await stayAboard(ctx, row, pos, now);
  },
});
// a preset greeting shown over your boat for a few seconds
export const emote = mutation({
  args: { i: v.number() },
  handler: async (ctx, { i }) => {
    const userId = await requireUser(ctx), now = Date.now();
    if (!(Number.isInteger(i) && i >= 0 && i < 16)) return;
    const p = await ctx.db.query('positions').withIndex('by_user', q => q.eq('userId', userId)).unique();
    if (!p || (p.emoteAt && now - p.emoteAt < EMOTE_MIN_MS)) return;
    await ctx.db.patch(p._id, { emote: i, emoteAt: now, at: now });
  },
});
export const leave = mutation({
  args: {},
  handler: async ctx => {
    const userId = await authUserId(ctx); if (!userId) return;
    await goAshore(ctx, userId);
  },
});
// signed-in sailors only see their own sea; ids are position rows, not account ids
export const near = query({
  args: { cells: v.array(v.string()) },
  handler: async (ctx, { cells }) => {
    const userId = await authUserId(ctx);
    const out: { id: string; x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; name: string; at: number; emote: number | null; emoteAt: number }[] = [];
    if (!userId) return out;
    const prefix = `${(await profileOf(ctx, userId))?.sea ?? 0}|`;
    for (const cell of cells.slice(0, 9)) {
      if (!cell.startsWith(prefix)) continue;
      for (const p of await ctx.db.query('positions').withIndex('by_cell', q => q.eq('cell', cell)).take(NEAR_MAX))
        if (p.userId !== userId) out.push({ id: p._id, x: p.x, y: p.y, a: p.a, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.w ?? 0, boat: p.boat, paint: p.paint, name: p.name, at: p.at, emote: p.emote ?? null, emoteAt: p.emoteAt ?? 0 });
    }
    return out;
  },
});
/** Everyone sailing your sea, for the roster and the map (positions are a few seconds stale; uid matches sea.near's id). */
export const everyone = query({
  args: {},
  returns: v.array(v.object({ uid: v.string(), name: v.string(), x: v.number(), y: v.number(), me: v.boolean() })),
  handler: async ctx => {
    const userId = await authUserId(ctx); if (!userId) return [];
    const sea = (await profileOf(ctx, userId))?.sea ?? 0;
    return (await ctx.db.query('aboard').withIndex('by_sea_at', q => q.eq('sea', sea)).take(ABOARD_MAX))
      .map(a => ({ uid: a.pos, name: a.name, x: Math.round(a.x), y: Math.round(a.y), me: a.userId === userId }));
  },
});
// coastwide news since a time the client picks (queries can't read the clock reactively)
export const news = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => (await ctx.db.query('events').withIndex('by_at', q => q.gt('at', since)).order('desc').take(8))
    .map(e => ({ id: e._id, name: e.name, text: e.text, at: e.at })),
});
export const sweep = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    for (const p of await ctx.db.query('positions').withIndex('by_sea_at', q => q.eq('sea', 0).lt('at', now - ACTIVE_MS)).take(100)) await goAshore(ctx, p.userId);
    for (const a of await ctx.db.query('aboard').withIndex('by_sea_at', q => q.eq('sea', 0).lt('at', now - ACTIVE_MS)).take(100)) await ctx.db.delete(a._id);
  },
});
/** Once a minute: recount who is sailing, for the title screen (leaderboard.online), and drop day-old news. Kept off the 15 s sweep so that stays cheap. */
export const count = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    // shortcut: counts at most 1000, use @convex-dev/aggregate past that
    const online = (await ctx.db.query('aboard').withIndex('by_sea_at', q => q.eq('sea', 0)).take(1000)).length;
    const m = await ctx.db.query('meta').withIndex('by_key', q => q.eq('key', 'online')).unique();
    if (m) await ctx.db.patch(m._id, { value: online, at: now }); else await ctx.db.insert('meta', { key: 'online', value: online, at: now });
    for (const e of await ctx.db.query('events').withIndex('by_at', q => q.lt('at', now - 86_400_000)).take(200)) await ctx.db.delete(e._id);
  },
});
