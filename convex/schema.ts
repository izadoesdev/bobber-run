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
  // leaderboard totals per player (species and heaviest from records.submit; caught and earned reported, capped)
  stats: defineTable({ userId: v.id('users'), caught: v.number(), earned: v.number(), species: v.number(), heaviest: v.number(), heaviestSp: v.string(), at: v.number() })
    .index('by_user', ['userId']).index('by_species', ['species']).index('by_heaviest', ['heaviest']).index('by_caught', ['caught']).index('by_earned', ['earned']),
  // claimed islands (one per world cell, see islandRules.ts) and players' reports about them
  // status 'pending' is a hold while the buyer pays on Stripe Checkout (until holdUntil); price is in US dollars
  islands: defineTable({ key: v.string(), ownerId: v.id('users'), ownerName: v.string(), name: v.string(), logo: v.optional(v.id('_storage')), price: v.number(),
    claimedAt: v.number(), updatedAt: v.number(), seenAt: v.number(), status: v.optional(v.union(v.literal('owned'), v.literal('pending'))),
    holdUntil: v.optional(v.number()), sessionId: v.optional(v.string()), paymentIntent: v.optional(v.string()), paidCents: v.optional(v.number()),
    url: v.optional(v.string()) })
    .index('by_key', ['key']).index('by_owner', ['ownerId']).index('by_seen', ['seenAt']).index('by_payment', ['paymentIntent']),
  islandReports: defineTable({ key: v.string(), userId: v.id('users'), name: v.string(), logo: v.optional(v.id('_storage')), at: v.number() }).index('by_key_user', ['key', 'userId']),
  // small server-wide values (the relay's online count)
  meta: defineTable({ key: v.string(), value: v.number(), at: v.number() }).index('by_key', ['key']),
  // shared rate-limit windows (guest sign-ups, coastwide fund per day)
  counters: defineTable({ key: v.string(), start: v.number(), used: v.number() }).index('by_key', ['key']),
});
