import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { requireUser, nameOf, profileOf, trusted } from './lib';
import { statsOf } from './stats';
import { MAX_KG, LEGENDS, SPECIES_NAMES, CATCH_MIN_MS, GUEST_TRUST_MS, NEWS_MIN_MS } from './limits';
import { runningSpecies, weekOf } from './rotation';

const valid = (species: string, kg: number) => kg > 0 && kg <= (MAX_KG[species] ?? 0);
// keeps each player's best per species; announces legends and new world records to the coast
export const submit = mutation({
  // `cheated` is optional so older clients keep working; saves that used cheats don't count
  args: { species: v.string(), kg: v.number(), cheated: v.optional(v.boolean()) },
  handler: async (ctx, { species, kg: raw, cheated }) => {
    const userId = await requireUser(ctx), kg = Math.round(raw * 10) / 10;
    if (cheated || !valid(species, kg) || !await trusted(ctx, userId, GUEST_TRUST_MS)) return;
    const prof = await profileOf(ctx, userId), now = Date.now();
    if (prof?.catchAt && now - prof.catchAt < CATCH_MIN_MS) return;     // at most one record a few seconds apart
    if (prof) await ctx.db.patch(prof._id, { catchAt: now });
    else await ctx.db.insert('profiles', { userId, name: 'Sailor', catchAt: now });   // so the throttle applies to everyone
    const week = weekOf(now);
    if (runningSpecies(week).includes(species)) {                              // this week's board for a running species
      const best = await ctx.db.query('weekly').withIndex('by_week_user_species', q => q.eq('week', week).eq('userId', userId).eq('species', species)).unique();
      if (!best) await ctx.db.insert('weekly', { week, species, userId, kg, at: now }); else if (kg > best.kg) await ctx.db.patch(best._id, { kg, at: now });
    }
    const mine = await ctx.db.query('records').withIndex('by_user_species', q => q.eq('userId', userId).eq('species', species)).unique();
    if (mine && mine.kg >= kg) return;
    const top = await ctx.db.query('records').withIndex('by_species_kg', q => q.eq('species', species)).order('desc').first();
    const name = await nameOf(ctx, userId), at = Date.now();
    if (mine) await ctx.db.patch(mine._id, { kg, name, at }); else await ctx.db.insert('records', { species, userId, name, kg, at });
    const st = await statsOf(ctx, userId);                                       // leaderboard totals: species logged, heaviest fish
    await ctx.db.patch(st._id, { species: st.species + (mine ? 0 : 1), ...(kg > st.heaviest ? { heaviest: kg, heaviestSp: species } : {}) });
    const last = await ctx.db.query('events').withIndex('by_at').order('desc').first();
    if (last && at - last.at < NEWS_MIN_MS) return;                              // the coast hears at most one item at a time
    if (LEGENDS[species] && !mine) await ctx.db.insert('events', { kind: 'legend', name, text: `caught ${LEGENDS[species]}!`, at });
    else if (top && top.userId !== userId && kg > top.kg && valid(species, top.kg)) await ctx.db.insert('events', { kind: 'record', name, text: `set a world record: ${SPECIES_NAMES[species] ?? species}, ${kg} kg`, at });
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
