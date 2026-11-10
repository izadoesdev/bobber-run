import { v } from 'convex/values';
import { action, internalMutation, query } from './_generated/server';
import { internal } from './_generated/api';
import { authUserId, limits, profileOf, requireUser } from './lib';
import { isAdminUser } from './profiles';
import { filterChat } from './moderate';
import { CHAT_MAX } from './limits';

// Chat for everyone in a sea. A line is rate-limited, filtered the way Roblox does (moderate.ts; admins aren't
// filtered), then kept for good: what was typed, what other sailors saw, and who said it. Sailors read the shown text
// through `recent`; the typed text never leaves the server.
const RECENT = 20;
const line = { userId: v.string(), name: v.string(), sea: v.number(), text: v.string(), shown: v.string(), filtered: v.boolean(), whole: v.boolean(), source: v.string(), at: v.number() };

export const record = internalMutation({
  args: line,
  returns: v.null(),
  handler: async (ctx, row) => {
    if (row.text.length > 200 || row.shown.length > 200) throw new Error('line too long');
    await ctx.db.insert('chats', row);
    return null;
  },
});

/** Who is speaking, or null when they're sending too fast. */
export const begin = internalMutation({
  args: {},
  returns: v.union(v.null(), v.object({ userId: v.id('users'), name: v.string(), sea: v.number(), admin: v.boolean() })),
  handler: async ctx => {
    const userId = await requireUser(ctx);
    if (!(await limits.limit(ctx, 'chatGap', { key: userId })).ok || !(await limits.limit(ctx, 'chat', { key: userId })).ok) return null;
    const [p, admin] = await Promise.all([profileOf(ctx, userId), isAdminUser(ctx, userId)]);
    return { userId, name: p?.name ?? 'Sailor', sea: p?.sea ?? 0, admin };
  },
});

/** Say something to everyone in your sea. 'slow': wait a moment and try again. */
export const send = action({
  args: { text: v.string() },
  returns: v.union(v.literal('ok'), v.literal('slow'), v.literal('empty')),
  handler: async (ctx, args): Promise<'ok' | 'slow' | 'empty'> => {
    const text = args.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return 'empty';
    const who = await ctx.runMutation(internal.chat.begin, {});
    if (!who) return 'slow';
    const verdict = who.admin ? { text, filtered: false, whole: false, source: 'admin' } : await filterChat(text);
    await ctx.runMutation(internal.chat.record, { userId: who.userId, name: who.name, sea: who.sea, text, shown: verdict.text, filtered: verdict.filtered, whole: verdict.whole, source: verdict.source, at: Date.now() });
    return 'ok';
  },
});

/**
 * The newest lines in your sea since `since` (a time the client picks, as queries can't read the clock). id is the
 * speaker's boat (its position row, as in sea.near) so the line shows as their speech bubble, 'me' for your own, or
 * the line's own id when the speaker isn't sailing.
 */
export const recent = query({
  args: { since: v.number() },
  returns: v.array(v.object({ key: v.string(), id: v.string(), name: v.string(), text: v.string(), at: v.number(), admin: v.boolean() })),
  handler: async (ctx, { since }) => {
    const userId = await authUserId(ctx); if (!userId) return [];
    const sea = (await profileOf(ctx, userId))?.sea ?? 0;
    const rows = (await ctx.db.query('chats').withIndex('by_at', q => q.gt('at', since)).order('desc').take(RECENT)).filter(r => r.sea === sea).reverse();
    return Promise.all(rows.map(async r => {
      const speaker = ctx.db.normalizeId('users', r.userId);
      const boat = speaker && speaker !== userId ? await ctx.db.query('positions').withIndex('by_user', q => q.eq('userId', speaker)).unique() : null;
      return { key: r._id, id: speaker === userId ? 'me' : boat?._id ?? r._id, name: r.name, text: r.shown, at: r.at, admin: r.source === 'admin' };
    }));
  },
});
