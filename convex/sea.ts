import { v } from 'convex/values';
import { query, mutation, internalMutation } from './_generated/server';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, profileOf, cellOf, finite } from './lib';
import { SEA_CAP, SEAS, MOVE_MIN_MS, EMOTE_MIN_MS } from './limits';

const ACTIVE_MS = 60_000;
// Players are spread across seas of at most SEA_CAP sailors. You stay in your sea while it has room,
// otherwise you are moved to the first sea with space. Seas only see their own boats.
export const join = mutation({
  args: {},
  handler: async ctx => {
    const userId = await requireUser(ctx), p = await profileOf(ctx, userId), since = Date.now() - ACTIVE_MS;
    const crowd = async (sea: number) => (await ctx.db.query('positions').withIndex('by_sea_at', q => q.eq('sea', sea).gt('at', since)).take(SEA_CAP + 1))
      .filter(r => r.userId !== userId).length;
    if (p?.sea !== undefined && await crowd(p.sea) < SEA_CAP) return p.sea;
    let sea = 0; while (sea < SEAS - 1 && await crowd(sea) >= SEA_CAP) sea++;
    if (p) await ctx.db.patch(p._id, { sea }); else await ctx.db.insert('profiles', { userId, name: 'Sailor', sea });
    return sea;
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
    if (p) await ctx.db.replace(p._id, row); else await ctx.db.insert('positions', row);
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
    const userId = await getAuthUserId(ctx); if (!userId) return;
    const p = await ctx.db.query('positions').withIndex('by_user', q => q.eq('userId', userId)).unique(); if (p) await ctx.db.delete(p._id);
  },
});
// signed-in sailors only see their own sea; ids are position rows, not account ids
export const near = query({
  args: { cells: v.array(v.string()) },
  handler: async (ctx, { cells }) => {
    const userId = await getAuthUserId(ctx);
    const out: { id: string; x: number; y: number; a: number; vx: number; vy: number; w: number; boat: string; paint: string; name: string; at: number; emote: number | null; emoteAt: number }[] = [];
    if (!userId) return out;
    const prefix = `${(await profileOf(ctx, userId))?.sea ?? 0}|`;
    for (const cell of cells.slice(0, 9)) {
      if (!cell.startsWith(prefix)) continue;
      for (const p of await ctx.db.query('positions').withIndex('by_cell', q => q.eq('cell', cell)).take(SEA_CAP))
        if (p.userId !== userId) out.push({ id: p._id, x: p.x, y: p.y, a: p.a, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.w ?? 0, boat: p.boat, paint: p.paint, name: p.name, at: p.at, emote: p.emote ?? null, emoteAt: p.emoteAt ?? 0 });
    }
    return out;
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
    for (const sea of [undefined, ...Array.from({ length: SEAS }, (_, i) => i)])
      for (const p of await ctx.db.query('positions').withIndex('by_sea_at', q => q.eq('sea', sea).lt('at', now - ACTIVE_MS)).take(100)) await ctx.db.delete(p._id);
    for (const e of await ctx.db.query('events').withIndex('by_at', q => q.lt('at', now - 86_400_000)).take(200)) await ctx.db.delete(e._id);
  },
});
