import { v } from 'convex/values';
import { query, mutation, action, internalMutation, internalQuery, httpAction, type QueryCtx, type MutationCtx, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, nameOf } from './lib';
import { cleanName } from './names';
import { jevAllowsName, isAdminUser } from './profiles';
import { isClaimable, priceOfKey, MAX_ISLANDS, ISLAND_NAME_MAX, LOGO_MAX_BYTES } from './islandRules';

// Claimable islands: an account buys the main island of a world cell (see islandRules.ts) with real money through
// Stripe Checkout, names it and can give it a small logo. Buying holds the island for 30 minutes while the player pays;
// Stripe's webhook (POST /stripe/webhook) turns the hold into ownership, or lets it go if checkout expires. Admins
// claim for free. Islands go back on the market when their owner hasn't been seen for 60 days.
type Result = { ok: true; price?: number } | { ok: false; why: string };
const IDLE_MS = 60 * 86_400_000, HOLD_MS = 31 * 60_000;
// read through globalThis: the browser build also type-checks this file (via convex/_generated), without Node's types
const env = (k: string) => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k];

const byKey = (ctx: QueryCtx | MutationCtx, key: string) => ctx.db.query('islands').withIndex('by_key', q => q.eq('key', key)).unique();
/** Owned, or held by someone who is still paying; an expired hold counts as free. */
const taken = (isl: Doc<'islands'> | null, now = Date.now()) => !!isl && (isl.status !== 'pending' || (isl.holdUntil ?? 0) > now);
const owned = (isl: Doc<'islands'> | null): isl is Doc<'islands'> => !!isl && isl.status !== 'pending';

/** Islands for these cells, as other sailors see them. */
export const near = query({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    const me = await getAuthUserId(ctx), out = [];
    for (const key of keys.slice(0, 150)) {
      const isl = await byKey(ctx, key);
      if (owned(isl)) out.push({ key, name: isl.name, owner: isl.ownerName, logoUrl: isl.logo ? await ctx.storage.getUrl(isl.logo) : null, mine: isl.ownerId === me });
    }
    return out;
  },
});

/**
 * Everything a claim, hold or rename needs checked inside one transaction. `free` (admins) owns it at once; otherwise
 * it is held while the player pays, and the hold's id is returned for the checkout.
 */
export const applyClaim = internalMutation({
  args: { userId: v.id('users'), key: v.string(), name: v.string(), mode: v.union(v.literal('free'), v.literal('hold'), v.literal('rename')) },
  handler: async (ctx, { userId, key, name, mode }): Promise<{ ok: true; price: number; holdId?: Id<'islands'> } | { ok: false; why: string }> => {
    const isl = await byKey(ctx, key), now = Date.now(), price = priceOfKey(key);
    if (mode === 'rename') {
      if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
      await ctx.db.patch(isl._id, { name, updatedAt: now });
      return { ok: true, price: isl.price };
    }
    if (taken(isl, now) && !(isl!.status === 'pending' && isl!.ownerId === userId)) return { ok: false, why: isl!.status === 'pending' ? 'Someone is buying this island right now' : `${isl!.ownerName} already owns this island` };
    const mine = (await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2)).filter(i => i.key !== key && taken(i, now));
    if (mine.length >= MAX_ISLANDS) return { ok: false, why: `You can own ${MAX_ISLANDS} islands. Release one first` };
    if (isl) await ctx.db.delete(isl._id);                                   // an expired hold, or our own earlier attempt
    const row = { key, ownerId: userId, ownerName: await nameOf(ctx, userId), name, price, claimedAt: now, updatedAt: now, seenAt: now };
    if (mode === 'free') { await ctx.db.insert('islands', { ...row, status: 'owned' }); return { ok: true, price: 0 }; }
    const holdId = await ctx.db.insert('islands', { ...row, status: 'pending', holdUntil: now + HOLD_MS });
    return { ok: true, price, holdId };
  },
});
export const accountOf = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const u = await ctx.db.get(userId);
    return { guest: !u || !!u.isAnonymous, admin: await isAdminUser(ctx, userId), email: u?.email ?? null };
  },
});

async function checkName(raw: string, isAdmin: boolean): Promise<{ ok: true; name: string } | { ok: false; why: string }> {
  if (isAdmin) { const name = raw.replace(/\s+/g, ' ').trim(); return name.length >= 2 && name.length <= ISLAND_NAME_MAX ? { ok: true, name } : { ok: false, why: `Use 2 to ${ISLAND_NAME_MAX} characters` }; }
  const c = cleanName(raw, ISLAND_NAME_MAX);
  if (!c.ok) return c;
  return await jevAllowsName(c.name) ? c : { ok: false, why: "That name isn't allowed. Try another" };
}
/** Who may buy, and with which checked name. */
async function buyer(ctx: ActionCtx, key: string, name: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return { ok: false as const, why: 'Sign in to buy islands' };
  if (!isClaimable(key)) return { ok: false as const, why: "This island can't be bought" };
  const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
  if (acct.guest) return { ok: false as const, why: 'Sign in to buy islands' };
  const n = await checkName(name, acct.admin);
  return n.ok ? { ok: true as const, userId, acct, name: n.name } : n;
}

/** Admins only: take an island for free. */
export const claim = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<Result> => {
    const b = await buyer(ctx, key, name);
    if (!b.ok) return b;
    if (!b.acct.admin) return { ok: false, why: 'Buy islands with Buy' };
    const r = await ctx.runMutation(internal.islands.applyClaim, { userId: b.userId, key, name: b.name, mode: 'free' });
    return r.ok ? { ok: true, price: 0 } : r;
  },
});

/** Start buying an island: hold it, open a Stripe Checkout page, and return its URL for the game to open. */
export const buy = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<{ ok: true; url: string; price: number } | { ok: false; why: string }> => {
    const secret = env('STRIPE_SECRET_KEY'), site = env('SITE_URL');
    if (!secret || !site) return { ok: false, why: 'Buying islands is not available right now' };
    const b = await buyer(ctx, key, name);
    if (!b.ok) return b;
    const hold = await ctx.runMutation(internal.islands.applyClaim, { userId: b.userId, key, name: b.name, mode: 'hold' });
    if (!hold.ok || !hold.holdId) return hold.ok ? { ok: false, why: 'Could not hold the island' } : hold;
    const form = new URLSearchParams({
      mode: 'payment', client_reference_id: b.userId,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(hold.price * 100),
      'line_items[0][price_data][product_data][name]': `Island: ${b.name}`, 'line_items[0][price_data][product_data][description]': `Bobber Run island at cell ${key}`,
      'metadata[holdId]': hold.holdId, 'metadata[islandKey]': key, 'metadata[userId]': b.userId,
      success_url: `${site}/?island=${encodeURIComponent(key)}&paid=1`, cancel_url: `${site}/?island=${encodeURIComponent(key)}&paid=0`,
      expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      ...(b.acct.email ? { customer_email: b.acct.email } : {}),
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const session = await r.json() as { id?: string; url?: string };
    if (!r.ok || !session.url || !session.id) { await ctx.runMutation(internal.islands.dropHold, { holdId: hold.holdId }); return { ok: false, why: 'Could not open checkout. Try again' }; }
    await ctx.runMutation(internal.islands.attachSession, { holdId: hold.holdId, sessionId: session.id });
    return { ok: true, url: session.url, price: hold.price };
  },
});
export const attachSession = internalMutation({
  args: { holdId: v.id('islands'), sessionId: v.string() },
  handler: async (ctx, { holdId, sessionId }) => { if (await ctx.db.get(holdId)) await ctx.db.patch(holdId, { sessionId }); },
});
/** Payment went through: the hold becomes ownership (even if it expired meanwhile and nobody else took the island). */
export const confirmPaid = internalMutation({
  args: { holdId: v.string(), key: v.string(), userId: v.string(), sessionId: v.string(), paymentIntent: v.optional(v.string()), cents: v.number() },
  handler: async (ctx, a) => {
    const now = Date.now(), isl = await byKey(ctx, a.key);
    const paid = { status: 'owned' as const, holdUntil: undefined, sessionId: a.sessionId, paymentIntent: a.paymentIntent, paidCents: a.cents, claimedAt: now, updatedAt: now, seenAt: now };
    if (isl && isl._id === a.holdId) { await ctx.db.patch(isl._id, paid); return 'owned'; }
    if (isl && taken(isl, now)) return 'conflict';                         // someone else got it: needs a refund (logged below)
    const userId = ctx.db.normalizeId('users', a.userId);
    if (!userId) return 'bad-user';
    if (isl) await ctx.db.delete(isl._id);
    await ctx.db.insert('islands', { key: a.key, ownerId: userId, ownerName: await nameOf(ctx, userId), name: 'My island', price: Math.round(a.cents / 100), ...paid });
    return 'owned';
  },
});
/** A refunded payment gives the island back. */
export const refunded = internalMutation({
  args: { paymentIntent: v.string() },
  handler: async (ctx, { paymentIntent }) => {
    const isl = await ctx.db.query('islands').withIndex('by_payment', q => q.eq('paymentIntent', paymentIntent)).unique();
    if (isl) { if (isl.logo) await ctx.storage.delete(isl.logo); await ctx.db.delete(isl._id); }
  },
});

/** Stripe's signature: HMAC-SHA256 of "timestamp.payload" with the endpoint secret, within five minutes. */
async function signedByStripe(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(','), t = parts.find(p => p.startsWith('t='))?.slice(2), sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const enc = new TextEncoder(), key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === mac.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}
type StripeEvent = { type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; payment_intent?: string | null; metadata?: Record<string, string> } } };
export const stripeWebhook = httpAction(async (ctx, req) => {
  const secret = env('STRIPE_WEBHOOK_SECRET'), payload = await req.text();
  if (!secret || !await signedByStripe(payload, req.headers.get('stripe-signature'), secret)) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(payload) as StripeEvent, o = ev.data.object, m = o.metadata ?? {};
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o.payment_status === 'paid' && m.holdId && m.islandKey && m.userId) {
    const r = await ctx.runMutation(internal.islands.confirmPaid, { holdId: m.holdId, key: m.islandKey, userId: m.userId, sessionId: o.id, paymentIntent: o.payment_intent ?? undefined, cents: o.amount_total ?? 0 });
    if (r !== 'owned') console.error(JSON.stringify({ msg: 'paid island not granted, refund needed', result: r, session: o.id, key: m.islandKey }));
  } else if (ev.type === 'checkout.session.expired' && m.holdId) {
    await ctx.runMutation(internal.islands.dropHold, { holdId: m.holdId });
  } else if (ev.type === 'charge.refunded') {
    if (o.payment_intent) await ctx.runMutation(internal.islands.refunded, { paymentIntent: o.payment_intent });
  }
  return new Response('ok');
});
/** Let a hold go (checkout failed or expired); never touches an island that was paid for. */
export const dropHold = internalMutation({
  args: { holdId: v.string() },
  handler: async (ctx, { holdId }) => { const id = ctx.db.normalizeId('islands', holdId); const h = id && await ctx.db.get(id); if (h && h.status === 'pending') await ctx.db.delete(h._id); },
});

export const rename = action({
  args: { key: v.string(), name: v.string() },
  handler: async (ctx, { key, name }): Promise<Result> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, why: 'Sign in first' };
    const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
    const n = await checkName(name, acct.admin);
    if (!n.ok) return n;
    const r = await ctx.runMutation(internal.islands.applyClaim, { userId, key, name: n.name, mode: 'rename' });
    return r.ok ? { ok: true } : r;
  },
});
/** Give an island back (no refund). */
export const release = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.delete(isl._id);
    return { ok: true };
  },
});

// ---------- logos: the owner uploads a small PNG straight to storage, then attaches it ----------
export const uploadUrl = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ ok: true; url: string } | { ok: false; why: string }> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    return { ok: true, url: await ctx.storage.generateUploadUrl() };
  },
});
export const setLogo = mutation({
  args: { key: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, { key, storageId }): Promise<Result> => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    const meta = await ctx.db.system.get(storageId);
    const bad = !meta || meta.contentType !== 'image/png' || meta.size > LOGO_MAX_BYTES;
    if (!owned(isl) || isl.ownerId !== userId || bad) { await ctx.storage.delete(storageId); return { ok: false, why: bad ? 'Use a PNG under 16 KB' : "That isn't your island" }; }
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.patch(isl._id, { logo: storageId, updatedAt: Date.now() });
    return { ok: true };
  },
});

// ---------- reports and admin ----------
export const report = mutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const userId = await requireUser(ctx), isl = await byKey(ctx, key);
    if (!isl) return { ok: false as const, why: 'No island here' };
    const dupe = await ctx.db.query('islandReports').withIndex('by_key_user', q => q.eq('key', key).eq('userId', userId)).unique();
    if (!dupe) await ctx.db.insert('islandReports', { key, userId, name: isl.name, logo: isl.logo, at: Date.now() });
    return { ok: true as const };
  },
});
/** Admins: clear an island's name and logo, or (all) the whole claim. */
export const clear = mutation({
  args: { key: v.string(), all: v.optional(v.boolean()) },
  handler: async (ctx, { key, all }): Promise<Result> => {
    const userId = await requireUser(ctx);
    if (!await isAdminUser(ctx, userId)) return { ok: false, why: 'Admins only' };
    const isl = await byKey(ctx, key);
    if (!isl) return { ok: false, why: 'No island here' };
    if (isl.logo) await ctx.storage.delete(isl.logo);
    if (all) await ctx.db.delete(isl._id); else await ctx.db.patch(isl._id, { name: 'Unnamed island', logo: undefined, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** Called when a sailor joins: their islands count as visited. */
export async function touchIslands(ctx: MutationCtx, userId: Id<'users'>): Promise<void> {
  for (const isl of await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2)) if (owned(isl)) await ctx.db.patch(isl._id, { seenAt: Date.now() });
}
/** Daily: islands whose owner hasn't been seen for 60 days go back on the market, and old unpaid holds go away. */
export const sweepIdle = internalMutation({
  args: {},
  handler: async ctx => {
    for (const isl of await ctx.db.query('islands').withIndex('by_seen', q => q.lt('seenAt', Date.now() - IDLE_MS)).take(200)) {
      if (isl.logo) await ctx.storage.delete(isl.logo);
      await ctx.db.delete(isl._id);
    }
  },
});
