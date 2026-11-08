'use node';
// @ts-ignore: the browser's tsconfig checks this file too (via convex/_generated), without Node's types
import { scrypt, timingSafeEqual } from 'node:crypto';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';

const KEY_BYTES = 64, N = 16384, R = 16;

/** Checks a password against a Convex Auth v1 hash: Lucia's Scrypt, stored as "salt:hexkey", with the salt used as text. */
export async function matchesLegacyHash(hash: string, password: string): Promise<boolean> {
  const [salt, key, extra] = hash.split(':');
  if (!salt || !key || extra !== undefined) return false;
  const want = Uint8Array.from(key.match(/../g) ?? [], h => parseInt(h, 16));
  if (want.length !== KEY_BYTES) return false;
  const got = await new Promise<Uint8Array>((res, rej) => scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { N, r: R, p: 1, maxmem: 256 * N * R }, (e: Error | null, k: Uint8Array) => e ? rej(e) : res(k)));
  return timingSafeEqual(got, want);
}

/**
 * Moves a v1 password account to v2 once its owner proves the password; the client then signs in as usual. `weak`: the
 * password was right, but v2 refuses it (under 10 characters, too common, or spaces at the ends), so the player passes a `newPassword`.
 */
export const migrate = action({
  args: { email: v.string(), password: v.string(), newPassword: v.optional(v.string()) },
  returns: v.union(v.literal('none'), v.literal('moved'), v.literal('wrong'), v.literal('rate_limited'), v.literal('weak')),
  handler: async (ctx, { email, password, newPassword }): Promise<'none' | 'moved' | 'wrong' | 'rate_limited' | 'weak'> => {
    const old = await ctx.runQuery(internal.legacyAccounts.find, { email });
    if (!old) return 'none';
    if (!await ctx.runMutation(internal.legacyAccounts.allowAttempt, { userId: old.userId })) return 'rate_limited';
    if (!await matchesLegacyHash(old.secret, password)) return 'wrong';
    return await ctx.runMutation(internal.legacyAccounts.finish, { userId: old.userId, password: newPassword ?? password }) ? 'moved' : 'weak';
  },
});
