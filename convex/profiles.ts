import { v } from 'convex/values';
import { query, action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { getAuthUserId } from '@convex-dev/auth/server';
import { profileOf } from './lib';
import { cleanName, guestName } from './names';
import { NAME_MIN_MS } from './limits';

export const me = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx); if (!userId) return null;
    const [user, profile] = await Promise.all([ctx.db.get(userId), profileOf(ctx, userId)]);
    const admin = !!user?.email && adminEmails().includes(user.email.toLowerCase());
    // chosen: the player picked this name themselves (a generated guest name has no nameAt)
    return { userId, name: profile?.name ?? 'Sailor', chosen: !!profile?.nameAt, guest: !!user?.isAnonymous, email: user?.email ?? null, sea: profile?.sea ?? null, admin };
  },
});
// Names are checked twice: the local filter (names.ts) catches the obvious ones at once, then Jev is asked whether
// Roblox would reject the name. Guest names are generated here from fixed word lists, so they skip both.
const NAME_QUESTION = 'Would Roblox reject `name.text` as a display name? Reject profanity or slurs (including misspellings, spacing, '
  + 'symbols or leetspeak), sexual innuendo or dating, hard drug references, hate, violence, personal information, or pretending to be staff.';
type NameResult = { ok: true; name: string } | { ok: false; why: string };
async function jevAllowsName(name: string): Promise<boolean> {
  // read through globalThis: the browser build also type-checks this file (via convex/_generated), without Node's types
  const key = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AI_GATEWAY_API_KEY;
  if (!key) return true;                                                   // no key configured: the local filter alone decides
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/evaluate', {
      method: 'POST', signal: AbortSignal.timeout(4000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev-1.14.0', state: { name: { text: name } }, questions: { reject: { type: 'boolean', instructions: NAME_QUESTION } } }),
    });
    const p = r.ok ? (await r.json()).answers?.reject?.probability : undefined;
    return typeof p !== 'number' || p < 0.65;
  } catch { return true; }
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
    if (!await jevAllowsName(checked.name)) return { ok: false, why: "That name isn't allowed. Try another" };
    return ctx.runMutation(internal.profiles.applyName, { userId, name: checked.name, auto: !!auto });
  },
});
/** Admins are the accounts whose email is listed in ADMIN_EMAILS (comma-separated); their chat and names aren't filtered. */
export const adminEmails = (): string[] => ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ADMIN_EMAILS ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
export const isAdmin = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }): Promise<boolean> => { const u = await ctx.db.get(userId); return !!u?.email && adminEmails().includes(u.email.toLowerCase()); },
});
export const applyName = internalMutation({
  args: { userId: v.id('users'), name: v.string(), auto: v.boolean() },
  handler: async (ctx, { userId, name, auto }): Promise<NameResult> => {
    const p = await profileOf(ctx, userId), now = Date.now();
    if (auto && p && p.name !== 'Sailor') return { ok: true, name: p.name };   // a generated name never replaces a chosen one
    if (!auto && p?.nameAt && now - p.nameAt < NAME_MIN_MS) return { ok: false, why: 'You just changed your name. Try again in a moment' };
    const nameAt = auto ? p?.nameAt : now;                                   // a generated guest name doesn't count as a rename
    if (p) await ctx.db.patch(p._id, { name, nameAt }); else await ctx.db.insert('profiles', { userId, name, nameAt });
    return { ok: true, name };
  },
});
