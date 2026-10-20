// Buying an island with real money through Stripe Checkout. Buying holds the island for 30 minutes while the player
// pays; Stripe's webhook (POST /stripe/webhook) turns the hold into ownership, lets it go if checkout expires, refunds
// a payment that can't be granted, and gives the island back when a payment is refunded.
import { v } from 'convex/values';
import { action, internalMutation, httpAction, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { nameOf, envVar } from './lib';
import { byKey, taken, buyer } from './islands';

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
    if (!id || !url) { await ctx.runMutation(internal.payments.dropHold, { holdId: hold.holdId }); return { ok: false, why: 'Could not open checkout. Try again' }; }
    await ctx.runMutation(internal.payments.attachSession, { holdId: hold.holdId, sessionId: id });
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
    const r = await ctx.runMutation(internal.payments.confirmPaid, { holdId: m.holdId, key: m.islandKey, userId: m.userId, name: m.name, sessionId: o.id, paymentIntent: o.payment_intent ?? undefined, cents: o.amount_total ?? 0 });
    if (r === 'conflict' && o.payment_intent) {                             // paid for an island we can't give: money back
      const refund = await stripePost('/refunds', { payment_intent: o.payment_intent, reason: 'duplicate' }, `refund-${o.id}`).catch(() => null);
      const done = !!refund && (refund.ok || refund.body.error?.code === 'charge_already_refunded');
      console.error(JSON.stringify({ msg: 'paid island not granted', refunded: done, session: o.id, key: m.islandKey }));
      if (!done) return new Response('refund failed', { status: 500 });     // Stripe retries the event, and with it the refund
    }
  } else if (ev.type === 'checkout.session.expired' && m.holdId) {
    await ctx.runMutation(internal.payments.dropHold, { holdId: m.holdId });
  } else if (ev.type === 'charge.refunded') {                             // only a full refund gives the island back
    if (o.payment_intent && o.refunded) await ctx.runMutation(internal.payments.refunded, { paymentIntent: o.payment_intent });
  }
  return new Response('ok');
});
/** Let a hold go (checkout failed or expired); never touches an island that was paid for. */
export const dropHold = internalMutation({
  args: { holdId: v.string() },
  handler: async (ctx, { holdId }) => { const id = ctx.db.normalizeId('islands', holdId); const h = id && await ctx.db.get(id); if (h && h.status === 'pending') await ctx.db.delete(h._id); },
});
