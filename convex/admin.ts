import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireUser } from './lib';
import { isAdminUser } from './profiles';

const LIVE_MS = 60_000, MAX_MATCHES = 20;   // a name search reads the newest 5000 profiles (about 230 today)

/**
 * Admins only: find any captain by name, online or not, in any sea: where they are (their live boat if they're sailing,
 * else their last cloud save), how far into the story and on which boat. Newest first, at most 20.
 */
export const players = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const userId = await requireUser(ctx);
    if (!(await isAdminUser(ctx, userId))) throw new Error('Admins only');
    const want = q.trim().toLowerCase();
    if (want.length < 2) return [];
    const matches = (await ctx.db.query('profiles').order('desc').take(5000)).filter(p => p.name.toLowerCase().includes(want)).slice(0, 30);   // each save can be large: 30 keeps a search well inside a query's read limit
    const now = Date.now();
    const rows = await Promise.all(matches.map(async p => {
      const [save, pos] = await Promise.all([
        ctx.db.query('saves').withIndex('by_user', i => i.eq('userId', p.userId)).unique(),
        ctx.db.query('positions').withIndex('by_user', i => i.eq('userId', p.userId)).first(),
      ]);
      let d: { x?: unknown; y?: unknown; story?: { i?: unknown } | null; boatId?: unknown } = {};
      try { d = save ? JSON.parse(save.data) : {}; } catch { /* a corrupt save still lists the captain */ }
      const live = pos && now - pos.at < LIVE_MS ? pos : null;
      const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null);
      return {
        userId: p.userId, name: p.name, sea: live?.sea ?? p.sea ?? null, online: !!live,
        x: live?.x ?? num(d.x), y: live?.y ?? num(d.y), savedAt: save?.updatedAt ?? null,
        story: num(d.story?.i), boat: live?.boat ?? (typeof d.boatId === 'string' ? d.boatId : null),
      };
    }));
    return rows.sort((a, b) => Number(b.online) - Number(a.online) || (b.savedAt ?? 0) - (a.savedAt ?? 0)).slice(0, MAX_MATCHES);
  },
});
