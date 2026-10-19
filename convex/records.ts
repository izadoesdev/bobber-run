import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireUser, nameOf } from './lib';
import { MAX_KG, LEGENDS } from './limits';

const valid = (species: string, kg: number) => kg > 0 && kg <= (MAX_KG[species] ?? 0);
// keeps each player's best per species; announces legends and new world records to the coast
export const submit = mutation({
  args: { species: v.string(), kg: v.number() },
  handler: async (ctx, { species, kg }) => {
    const userId = await requireUser(ctx);
    if (!valid(species, kg)) return;
    const mine = await ctx.db.query('records').withIndex('by_user_species', q => q.eq('userId', userId).eq('species', species)).unique();
    if (mine && mine.kg >= kg) return;
    const top = await ctx.db.query('records').withIndex('by_species_kg', q => q.eq('species', species)).order('desc').first();
    const name = await nameOf(ctx, userId), at = Date.now();
    if (mine) await ctx.db.patch(mine._id, { kg, name, at }); else await ctx.db.insert('records', { species, userId, name, kg, at });
    if (LEGENDS[species] && !mine) await ctx.db.insert('events', { kind: 'legend', name, text: `caught ${LEGENDS[species]}!`, at });
    else if (top && top.userId !== userId && kg > top.kg && valid(species, top.kg)) await ctx.db.insert('events', { kind: 'record', name, text: `set a new world record: ${kg} kg`, at });
  },
});
export const world = query({
  args: { species: v.array(v.string()) },
  handler: async (ctx, { species }) => {
    const out: Record<string, { name: string; kg: number }> = {};
    for (const s of species.slice(0, 64)) {
      for (const r of await ctx.db.query('records').withIndex('by_species_kg', q => q.eq('species', s)).order('desc').take(3))
        if (valid(s, r.kg)) { out[s] = { name: r.name, kg: r.kg }; break; }
    }
    return out;
  },
});
