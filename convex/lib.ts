import { getAuthUserId } from '@convex-dev/auth/server';
import { RateLimiter, DAY } from '@convex-dev/rate-limiter';
import { components } from './_generated/api';
import { GUESTS_PER_WINDOW, GUEST_WINDOW_MS, FUND_DAILY_ALL } from './limits';
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
// read through globalThis: the browser build also type-checks convex files (via convex/_generated), without Node's types
export const envVar = (k: string): string | undefined => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];
/** True when an HTTP request carries the relay's shared secret (RELAY_SECRET). */
export const isFromRelay = (req: Request): boolean => { const s = envVar('RELAY_SECRET'); return !!s && req.headers.get('authorization') === `Bearer ${s}`; };
// signed-up players, or guests who have been around long enough that making them in bulk doesn't pay
export async function trusted(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, trustMs: number): Promise<boolean> {
  const u = await ctx.db.get(userId);
  return !!u && (!u.isAnonymous || Date.now() - u._creationTime >= trustMs);
}
/**
 * Rate limits (the Convex rate-limiter component). guests: new guest accounts across everyone; fund: coins the whole coast can give per UTC day (matching each sailor's own daily cap).
 */
export const limits = new RateLimiter(components.rateLimiter, {
  guests: { kind: 'token bucket', rate: GUESTS_PER_WINDOW, period: GUEST_WINDOW_MS },
  fund: { kind: 'fixed window', rate: FUND_DAILY_ALL, period: DAY, start: 0 },
});
