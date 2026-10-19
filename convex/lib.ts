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
