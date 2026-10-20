import { v } from 'convex/values';
import { httpAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { isFromRelay } from './lib';

// Every chat line, kept permanently: what was typed, what other sailors saw after filtering, and who said it.
// Only the relay writes here, through POST /relay/chat with the shared RELAY_SECRET; players can't reach it.
export const record = internalMutation({
  args: { userId: v.string(), name: v.string(), sea: v.number(), text: v.string(), shown: v.string(), filtered: v.boolean(), whole: v.boolean(), source: v.string(), at: v.number() },
  handler: async (ctx, line) => {
    if (line.text.length > 200 || line.shown.length > 200) throw new Error('line too long');
    await ctx.db.insert('chats', line);
  },
});

export const fromRelay = httpAction(async (ctx, req) => {
  if (!isFromRelay(req)) return new Response('forbidden', { status: 403 });
  try { await ctx.runMutation(internal.chat.record, await req.json()); }   // the mutation's validator checks the shape
  catch { return new Response('bad line', { status: 400 }); }
  return new Response('ok');
});
