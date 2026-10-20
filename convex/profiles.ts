import { v } from 'convex/values';
import { query, action, internalMutation, internalQuery, type QueryCtx, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { getAuthUserId } from '@convex-dev/auth/server';
import { profileOf, envVar } from './lib';
import { jevYes } from './jev';
import { cleanName, guestName } from './names';
import { NAME_MIN_MS } from './limits';

export const me = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx); if (!userId) return null;
    const [user, profile] = await Promise.all([ctx.db.get(userId), profileOf(ctx, userId)]);
    // chosen: the player picked this name themselves (a generated guest name has no nameAt)
    return { userId, name: profile?.name ?? 'Sailor', chosen: !!profile?.nameAt, guest: !!user?.isAnonymous, email: user?.email ?? null, sea: profile?.sea ?? null, admin: isAdminEmail(user?.email) };
  },
});
// Names are checked twice: the local filter (names.ts) catches the obvious ones at once, then Jev is asked whether
// Roblox would reject the name. Guest names are generated here from fixed word lists, so they skip both.
const NAME_QUESTION = 'Would Roblox reject `name.text` as a display name? Reject profanity or slurs (including misspellings, spacing, '
  + 'symbols or leetspeak), sexual innuendo or dating, hard drug references, hate, violence, personal information, or pretending to be staff.';
type NameResult = { ok: true; name: string } | { ok: false; why: string };
/** Jev's say on a name that passed the local filter; no answer means allowed. */
export async function jevAllowsName(name: string): Promise<boolean> {
  const p = await jevYes({ name: { text: name } }, NAME_QUESTION);
  return p === null || p < 0.65;
}
export const setName = action({
  args: { name: v.string(), auto: v.optional(v.boolean()) },
  handler: async (ctx, { name, auto }): Promise<NameResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error('Not signed in');
    if (!auto && await ctx.runQuery(internal.profiles.isAdmin, { userId })) {      // admins pick any name of a sane length
      const plain = name.replace(/\s+/g, ' ').trim();
      if (plain.length < 2 || plain.length > 18) return { ok: false, why: 'Use 2 to 18 characters' };
      return ctx.runMutation(internal.profiles.applyName, { userId, name: plain, auto: false });
    }
    if (auto) return ctx.runMutation(internal.profiles.applyName, { userId, name: guestName(), auto: true });
    const checked = cleanName(name);
    if (!checked.ok) return checked;
    if (await ctx.runQuery(internal.profiles.renamedRecently, { userId })) return TOO_SOON;   // before asking Jev, which costs money
    if (!await jevAllowsName(checked.name)) return { ok: false, why: "That name isn't allowed. Try another" };
    return ctx.runMutation(internal.profiles.applyName, { userId, name: checked.name, auto: !!auto });
  },
});
/**
 * Admins are the accounts whose email is listed in ADMIN_EMAILS (comma-separated); their chat and names aren't filtered.
 * Emails aren't verified, so only list an address after its account exists (sign-up refuses an email already in use).
 */
export const isAdminEmail = (email: string | null | undefined): boolean =>
  !!email && (envVar('ADMIN_EMAILS') ?? '').split(',').map(s => s.trim().toLowerCase()).includes(email.toLowerCase());
export const isAdminUser = async (ctx: QueryCtx | MutationCtx, userId: Id<'users'>): Promise<boolean> => isAdminEmail((await ctx.db.get(userId))?.email);
export const isAdmin = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<boolean> => isAdminUser(ctx, userId),
});
const TOO_SOON = { ok: false as const, why: 'You just changed your name. Try again in a moment' };
const isTooSoon = (nameAt: number | undefined) => !!nameAt && Date.now() - nameAt < NAME_MIN_MS;
export const renamedRecently = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<boolean> => isTooSoon((await profileOf(ctx, userId))?.nameAt),
});
export const applyName = internalMutation({
  args: { userId: v.id('users'), name: v.string(), auto: v.boolean() },
  handler: async (ctx, { userId, name, auto }): Promise<NameResult> => {
    const p = await profileOf(ctx, userId), now = Date.now();
    if (auto && p && p.name !== 'Sailor') return { ok: true, name: p.name };   // a generated name never replaces a chosen one
    if (!auto && isTooSoon(p?.nameAt)) return TOO_SOON;
    const nameAt = auto ? p?.nameAt : now;                                   // a generated guest name doesn't count as a rename
    if (p) await ctx.db.patch(p._id, { name, nameAt }); else await ctx.db.insert('profiles', { userId, name, nameAt });
    return { ok: true, name };
  },
});
