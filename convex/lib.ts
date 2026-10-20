import { getAuthUserId } from '@convex-dev/auth/server';
import type { QueryCtx, MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

// world cells for spatial queries; a cell key also carries the sea, so seas never see each other
export const CELL = 400;
export const cellOf = (sea: number, x: number, y: number) => `${sea}|${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Not signed in');
  return userId;
}
export const profileOf = (ctx: QueryCtx | MutationCtx, userId: Id<'users'>) =>
  ctx.db.query('profiles').withIndex('by_user', q => q.eq('userId', userId)).unique();
export async function nameOf(ctx: QueryCtx | MutationCtx, userId: Id<'users'>) { return (await profileOf(ctx, userId))?.name ?? 'Sailor'; }
export const finite = (...n: number[]) => n.every(Number.isFinite);
// signed-up players, or guests who have been around long enough that making them in bulk doesn't pay
export async function trusted(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, trustMs: number): Promise<boolean> {
  const u = await ctx.db.get(userId);
  return !!u && (!u.isAnonymous || Date.now() - u._creationTime >= trustMs);
}
// fixed-window counter shared by everyone; returns false once `limit` uses have been spent in the window
export async function spend(ctx: MutationCtx, key: string, limit: number, windowMs: number, n = 1): Promise<boolean> {
  const now = Date.now(), c = await ctx.db.query('counters').withIndex('by_key', q => q.eq('key', key)).unique();
  if (!c || now - c.start >= windowMs) {
    if (n > limit) return false;
    if (c) await ctx.db.patch(c._id, { start: now, used: n }); else await ctx.db.insert('counters', { key, start: now, used: n });
    return true;
  }
  if (c.used + n > limit) return false;
  await ctx.db.patch(c._id, { used: c.used + n });
  return true;
}
