import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { authTables } from '@convex-dev/auth/server';

// Bobber Run online data. Fast-changing boat positions live in their own table so position
// writes never re-run queries that read saves, records or the fund.
export default defineSchema({
  ...authTables,
  profiles: defineTable({ userId: v.id('users'), name: v.string(), nameAt: v.optional(v.number()), sea: v.optional(v.number()), catchAt: v.optional(v.number()) }).index('by_user', ['userId']),
  saves: defineTable({ userId: v.id('users'), data: v.string(), updatedAt: v.number(), putAt: v.optional(v.number()) }).index('by_user', ['userId']),
  // best catch per player per species
  records: defineTable({ species: v.string(), userId: v.id('users'), name: v.string(), kg: v.number(), at: v.number() })
    .index('by_species_kg', ['species', 'kg']).index('by_user_species', ['userId', 'species']),
  // the coastwide fund everyone gives to; gifts track each player's total and today's giving
  fund: defineTable({ key: v.string(), total: v.number(), givers: v.number() }).index('by_key', ['key']),
  gifts: defineTable({ key: v.string(), userId: v.id('users'), amount: v.number(), day: v.optional(v.string()), today: v.optional(v.number()) }).index('by_key_user', ['key', 'userId']),
  // other sailors, a few times a second while moving, with velocity and turn rate so others can draw them smoothly. cell = "sea|cx,cy"; stale rows are swept by a cron
  positions: defineTable({ userId: v.id('users'), sea: v.optional(v.number()), cell: v.string(), x: v.number(), y: v.number(), a: v.number(), vx: v.optional(v.number()), vy: v.optional(v.number()), w: v.optional(v.number()),
    boat: v.string(), paint: v.string(), name: v.string(), at: v.number(),
    emote: v.optional(v.number()), emoteAt: v.optional(v.number()) })
    .index('by_cell', ['cell']).index('by_user', ['userId']).index('by_sea_at', ['sea', 'at']),
  // coastwide news: legendary catches and new world records
  events: defineTable({ kind: v.string(), name: v.string(), text: v.string(), at: v.number() }).index('by_at', ['at']),
  // every chat line, kept permanently (written only by the relay): typed text, what others saw, and who said it
  chats: defineTable({ userId: v.string(), name: v.string(), sea: v.number(), text: v.string(), shown: v.string(), filtered: v.boolean(), whole: v.boolean(), source: v.string(), at: v.number() })
    .index('by_at', ['at']).index('by_user', ['userId', 'at']),
  // shared rate-limit windows (guest sign-ups, coastwide fund per day)
  counters: defineTable({ key: v.string(), start: v.number(), used: v.number() }).index('by_key', ['key']),
});
