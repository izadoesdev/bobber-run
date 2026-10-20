import { v } from 'convex/values';
import { query, mutation, action, internalMutation, internalQuery, httpAction, type QueryCtx, type MutationCtx, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { requireUser, nameOf, envVar, spend } from './lib';
import { jevYes } from './jev';
import { cleanName } from './names';
import { jevAllowsName, isAdminUser } from './profiles';
import { isClaimable, priceOfKey, MAX_ISLANDS, ISLAND_NAME_MAX, LOGO_MAX_BYTES } from './islandRules';

// Claimable islands: an account buys the main island of a world cell (see islandRules.ts) with real money through
// Stripe Checkout, names it and can give it a small logo. Buying holds the island for 30 minutes while the player pays;
// Stripe's webhook (POST /stripe/webhook) turns the hold into ownership, or lets it go if checkout expires. Admins
// claim for free. Islands go back on the market when their owner hasn't been seen for 60 days.
type Result = { ok: true; price?: number } | { ok: false; why: string };
const IDLE_MS = 60 * 86_400_000, HOLD_MS = 31 * 60_000, HOLDS_PER_HOUR = 6;

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
      if (!owned(isl)) continue;
      // a logo shows to others only once an admin has approved it; its owner sees it straight away, marked as waiting
      const mine = isl.ownerId === me, showLogo = !!isl.logo && (isl.logoOk || mine);
      out.push({ key, name: isl.name, owner: isl.ownerName, logoUrl: showLogo ? await ctx.storage.getUrl(isl.logo!) : null, logoPending: mine && !!isl.logo && !isl.logoOk, url: isl.url ?? null, mine });
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
  handler: async (ctx, { userId, key, name, mode }): Promise<{ ok: true; price: number; holdId?: Id<'islands'>; previousSession?: string } | { ok: false; why: string }> => {
    const isl = await byKey(ctx, key), now = Date.now(), price = priceOfKey(key);
    if (mode === 'rename') {
      if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
      await ctx.db.patch(isl._id, { name, updatedAt: now });
      return { ok: true, price: isl.price };
    }
    if (taken(isl, now) && !(isl!.status === 'pending' && isl!.ownerId === userId)) return { ok: false, why: isl!.status === 'pending' ? 'Someone is buying this island right now' : `${isl!.ownerName} already owns this island` };
    const mine = (await ctx.db.query('islands').withIndex('by_owner', q => q.eq('ownerId', userId)).take(MAX_ISLANDS + 2)).filter(i => i.key !== key && taken(i, now));
    if (mine.length >= MAX_ISLANDS) return { ok: false, why: `You can own ${MAX_ISLANDS} islands. Release one first` };
    if (mode === 'hold' && !await spend(ctx, `hold:${userId}`, HOLDS_PER_HOUR, 3_600_000)) return { ok: false, why: 'Too many purchases started. Try again in an hour' };
    const previousSession = isl?.status === 'pending' && isl.ownerId === userId ? isl.sessionId : undefined;   // our own earlier checkout
    if (isl) await ctx.db.delete(isl._id);                                   // an expired hold, or our own earlier attempt
    const row = { key, ownerId: userId, ownerName: await nameOf(ctx, userId), name, price, claimedAt: now, updatedAt: now, seenAt: now };
    if (mode === 'free') { await ctx.db.insert('islands', { ...row, status: 'owned' }); return { ok: true, price: 0 }; }
    const holdId = await ctx.db.insert('islands', { ...row, status: 'pending', holdUntil: now + HOLD_MS });
    return { ok: true, price, holdId, previousSession };
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
/** Buyers confirm they are 18 or older, or have a parent's or guardian's permission (minors can cancel purchases). */
export const buy = action({
  args: { key: v.string(), name: v.string(), adult: v.optional(v.boolean()) },
  handler: async (ctx, { key, name, adult }): Promise<{ ok: true; url: string; price: number } | { ok: false; why: string }> => {
    if (adult !== true) return { ok: false, why: 'Ask a parent or guardian before buying an island' };
    const site = envVar('SITE_URL');
    if (!envVar('STRIPE_SECRET_KEY') || !site) return { ok: false, why: 'Buying islands is not available right now' };
    const b = await buyer(ctx, key, name);
    if (!b.ok) return b;
    const hold = await ctx.runMutation(internal.islands.applyClaim, { userId: b.userId, key, name: b.name, mode: 'hold' });
    if (!hold.ok || !hold.holdId) return hold.ok ? { ok: false, why: 'Could not hold the island' } : hold;
    if (hold.previousSession) await stripePost(`/checkout/sessions/${hold.previousSession}/expire`).catch(() => null);   // so the old page can't be paid too
    const session = await stripePost('/checkout/sessions', {
      mode: 'payment', client_reference_id: b.userId,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': String(hold.price * 100),
      'line_items[0][price_data][product_data][name]': `Island: ${b.name}`, 'line_items[0][price_data][product_data][description]': `Bobber Run island at cell ${key}`,
      'metadata[holdId]': hold.holdId, 'metadata[islandKey]': key, 'metadata[userId]': b.userId, 'metadata[name]': b.name,
      success_url: `${site}/?island=${encodeURIComponent(key)}&paid=1`, cancel_url: `${site}/?island=${encodeURIComponent(key)}&paid=0`,
      expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
      ...(b.acct.email ? { customer_email: b.acct.email } : {}),
    }).catch(() => null);
    const id = session?.ok ? session.body.id : undefined, url = session?.ok ? session.body.url : undefined;
    if (!id || !url) { await ctx.runMutation(internal.islands.dropHold, { holdId: hold.holdId }); return { ok: false, why: 'Could not open checkout. Try again' }; }
    await ctx.runMutation(internal.islands.attachSession, { holdId: hold.holdId, sessionId: id });
    return { ok: true, url, price: hold.price };
  },
});
export const attachSession = internalMutation({
  args: { holdId: v.id('islands'), sessionId: v.string() },
  handler: async (ctx, { holdId, sessionId }) => { if (await ctx.db.get(holdId)) await ctx.db.patch(holdId, { sessionId }); },
});
/**
 * Payment went through: the hold becomes ownership (even if it expired meanwhile and nobody else took the island).
 * 'conflict' means the island can't be granted (someone else owns it, or the buyer is gone) and the payment needs a
 * refund. Each checkout session is handled once; Stripe sending the event again gets the first outcome back.
 */
export const confirmPaid = internalMutation({
  args: { holdId: v.string(), key: v.string(), userId: v.string(), name: v.optional(v.string()), sessionId: v.string(), paymentIntent: v.optional(v.string()), cents: v.number() },
  handler: async (ctx, a): Promise<string> => {
    const prior = await ctx.db.query('payments').withIndex('by_session', q => q.eq('sessionId', a.sessionId)).unique();
    if (prior) return prior.outcome;
    const now = Date.now(), outcome = await grant(ctx, a, now);
    await ctx.db.insert('payments', { sessionId: a.sessionId, key: a.key, outcome, at: now });
    return outcome;
  },
});
async function grant(ctx: MutationCtx, a: { holdId: string; key: string; userId: string; name?: string; paymentIntent?: string; cents: number }, now: number): Promise<'owned' | 'conflict'> {
  const isl = await byKey(ctx, a.key), userId = ctx.db.normalizeId('users', a.userId);
  if (!userId || !await ctx.db.get(userId)) return 'conflict';
  const paid = { status: 'owned' as const, holdUntil: undefined, paymentIntent: a.paymentIntent, paidCents: a.cents, claimedAt: now, updatedAt: now, seenAt: now };
  // this checkout's hold, or a newer hold by the same buyer (they opened checkout again, then paid the first page)
  if (isl && isl.status === 'pending' && (isl._id === a.holdId || isl.ownerId === userId)) { await ctx.db.patch(isl._id, paid); return 'owned'; }
  if (isl && taken(isl, now)) return 'conflict';
  if (isl) await ctx.db.delete(isl._id);
  await ctx.db.insert('islands', { key: a.key, ownerId: userId, ownerName: await nameOf(ctx, userId), name: a.name ?? 'My island', price: Math.round(a.cents / 100), ...paid });
  return 'owned';
}
/** A refunded payment gives the island back. */
export const refunded = internalMutation({
  args: { paymentIntent: v.string() },
  handler: async (ctx, { paymentIntent }) => {
    const isl = await ctx.db.query('islands').withIndex('by_payment', q => q.eq('paymentIntent', paymentIntent)).unique();
    if (isl) { if (isl.logo) await ctx.storage.delete(isl.logo); await ctx.db.delete(isl._id); }
  },
});

/** Stripe's signature: HMAC-SHA256 of "timestamp.payload" with the endpoint secret, within five minutes. */
export async function signedByStripe(payload: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(','), t = parts.find(p => p.startsWith('t='))?.slice(2), sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const enc = new TextEncoder(), key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return sigs.some(s => s.length === mac.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ mac.charCodeAt(i)), 0) === 0);
}
/** POST to Stripe's API with the secret key; `idempotencyKey` makes a retried request do nothing new. */
async function stripePost(path: string, form: Record<string, string> = {}, idempotencyKey?: string): Promise<{ ok: boolean; body: { id?: string; url?: string; error?: { code?: string } } }> {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method: 'POST', body: new URLSearchParams(form), signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${envVar('STRIPE_SECRET_KEY')}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) } });
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}
type StripeEvent = { type: string; data: { object: { id: string; payment_status?: string; amount_total?: number; payment_intent?: string | null; refunded?: boolean; metadata?: Record<string, string> } } };
export const stripeWebhook = httpAction(async (ctx, req) => {
  const secret = envVar('STRIPE_WEBHOOK_SECRET'), payload = await req.text();
  if (!secret || !await signedByStripe(payload, req.headers.get('stripe-signature'), secret)) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(payload) as StripeEvent, o = ev.data.object, m = o.metadata ?? {};
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o.payment_status === 'paid' && m.holdId && m.islandKey && m.userId) {
    const r = await ctx.runMutation(internal.islands.confirmPaid, { holdId: m.holdId, key: m.islandKey, userId: m.userId, name: m.name, sessionId: o.id, paymentIntent: o.payment_intent ?? undefined, cents: o.amount_total ?? 0 });
    if (r === 'conflict' && o.payment_intent) {                             // paid for an island we can't give: money back
      const refund = await stripePost('/refunds', { payment_intent: o.payment_intent, reason: 'duplicate' }, `refund-${o.id}`).catch(() => null);
      const done = !!refund && (refund.ok || refund.body.error?.code === 'charge_already_refunded');
      console.error(JSON.stringify({ msg: 'paid island not granted', refunded: done, session: o.id, key: m.islandKey }));
      if (!done) return new Response('refund failed', { status: 500 });     // Stripe retries the event, and with it the refund
    }
  } else if (ev.type === 'checkout.session.expired' && m.holdId) {
    await ctx.runMutation(internal.islands.dropHold, { holdId: m.holdId });
  } else if (ev.type === 'charge.refunded') {                             // only a full refund gives the island back
    if (o.payment_intent && o.refunded) await ctx.runMutation(internal.islands.refunded, { paymentIntent: o.payment_intent });
  }
  return new Response('ok');
});
/** Let a hold go (checkout failed or expired); never touches an island that was paid for. */
export const dropHold = internalMutation({
  args: { holdId: v.string() },
  handler: async (ctx, { holdId }) => { const id = ctx.db.normalizeId('islands', holdId); const h = id && await ctx.db.get(id); if (h && h.status === 'pending') await ctx.db.delete(h._id); },
});

// ---------- the owner's link, shown on their sign ----------
const URL_MAX = 120;
/** A clean https link, or why not. Plain hosts only: no logins in the URL, no bare IPs, no localhost. */
function cleanUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { return { ok: false, why: 'That doesn\'t look like a web address' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'Use an https:// link' };
  if (u.username || u.password || !/\.[a-z]{2,}$/i.test(u.hostname) || /^[\d.]+$/.test(u.hostname)) return { ok: false, why: 'Use a normal website address' };
  const url = u.toString().replace(/\/$/, '');
  return url.length <= URL_MAX ? { ok: true, url } : { ok: false, why: `Keep the link under ${URL_MAX} characters` };
}
const LINK_QUESTION = 'Is the website `link.url` likely adult or sexual, gambling, a scam or phishing, malware, drugs, hate or violence, '
  + 'or otherwise unsafe to link from a game played by teenagers?';
/** Links have no local filter, so when Jev can't answer the link waits (null). */
async function jevAllowsLink(url: string): Promise<boolean | null> {
  const p = await jevYes({ link: { url } }, LINK_QUESTION);
  return p === null ? null : p < 0.5;
}
/** Set (or with '' clear) the link on your island's sign. */
export const setUrl = action({
  args: { key: v.string(), url: v.string() },
  handler: async (ctx, { key, url }): Promise<Result> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, why: 'Sign in first' };
    const acct = await ctx.runQuery(internal.islands.accountOf, { userId });
    if (!url.trim()) return ctx.runMutation(internal.islands.applyUrl, { userId, key, url: undefined });
    const c = cleanUrl(url);
    if (!c.ok) return c;
    const allowed = acct.admin || await jevAllowsLink(c.url);
    if (allowed === null) return { ok: false, why: "Links can't be checked right now. Try again later" };
    if (!allowed) return { ok: false, why: "That link isn't allowed" };
    return ctx.runMutation(internal.islands.applyUrl, { userId, key, url: c.url });
  },
});
export const applyUrl = internalMutation({
  args: { userId: v.id('users'), key: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, { userId, key, url }): Promise<Result> => {
    const isl = await byKey(ctx, key);
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    await ctx.db.patch(isl._id, { url, updatedAt: Date.now() });
    return { ok: true };
  },
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
    if (!owned(isl) || isl.ownerId !== userId) return { ok: false, why: "That isn't your island" };
    if (bad) { if (meta) await ctx.storage.delete(storageId); return { ok: false, why: 'Use a PNG under 16 KB' }; }
    if (isl.logo) await ctx.storage.delete(isl.logo);
    await ctx.db.patch(isl._id, { logo: storageId, logoOk: await isAdminUser(ctx, userId), updatedAt: Date.now() });
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
/**
 * Logos waiting for review, oldest first. Admins approve or remove them from the command line:
 * `bunx convex run --prod islands:pendingLogos` then `bunx convex run --prod islands:reviewLogo '{"key":"3,-2","ok":true}'`.
 */
export const pendingLogos = internalQuery({
  args: {},
  handler: async ctx => {
    const out = [];
    for (const isl of await ctx.db.query('islands').collect()) if (isl.logo && !isl.logoOk) out.push({ key: isl.key, name: isl.name, owner: isl.ownerName, url: await ctx.storage.getUrl(isl.logo), at: isl.updatedAt });
    return out.sort((a, b) => a.at - b.at);
  },
});
export const reviewLogo = internalMutation({
  args: { key: v.string(), ok: v.boolean() },
  handler: async (ctx, { key, ok }) => {
    const isl = await byKey(ctx, key);
    if (!isl?.logo) return 'no logo';
    if (ok) await ctx.db.patch(isl._id, { logoOk: true }); else { await ctx.storage.delete(isl.logo); await ctx.db.patch(isl._id, { logo: undefined, logoOk: undefined }); }
    return ok ? 'approved' : 'removed';
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
    if (all) await ctx.db.delete(isl._id); else await ctx.db.patch(isl._id, { name: 'Unnamed island', logo: undefined, logoOk: undefined, url: undefined, updatedAt: Date.now() });
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
