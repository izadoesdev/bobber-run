// Buying an island with real money through Stripe Checkout. Buying holds the island for 30 minutes while the player
// pays; Stripe's webhook (POST /stripe/webhook) turns the hold into ownership, lets it go if checkout expires, refunds
// a payment that can't be granted, and gives the island back when a payment is refunded.
import { v } from 'convex/values';
import Stripe from 'stripe';
import { action, internalMutation, httpAction, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { nameOf, envVar } from './lib';
import { byKey, taken, buyer } from './islands';

/** A Stripe client for this deployment's key; fetch-based, so it runs in Convex's default runtime. */
// Dev and prod deployments can share one Stripe test account, so each sees the other's events: every checkout
// session carries the deployment that made it, and a webhook leaves other deployments' sessions alone.
const ORIGIN = () => envVar('CONVEX_CLOUD_URL') ?? '';
const mine = (m: Record<string, string> | null): boolean => !m?.origin || m.origin === ORIGIN();
const stripe = (): Stripe => new Stripe(envVar('STRIPE_SECRET_KEY') ?? '', { httpClient: Stripe.createFetchHttpClient(), timeout: 10_000, maxNetworkRetries: 2 });

/**
 * Start buying an island: hold it, open a Stripe Checkout page, and return its URL for the game to open.
 * Buyers confirm they are 18 or older, or have a parent's or guardian's permission (minors can cancel purchases). */
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
    const s = stripe();
    if (hold.previousSession) await s.checkout.sessions.expire(hold.previousSession).catch(() => null);   // so the old page can't be paid too
    const session = await s.checkout.sessions.create({
      mode: 'payment', client_reference_id: b.userId,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: hold.price * 100, product_data: { name: `Island: ${b.name}`, description: `Bobber Run island at cell ${key}` } } }],
      metadata: { holdId: hold.holdId, islandKey: key, userId: b.userId, name: b.name, origin: ORIGIN() },
      success_url: `${site}/?island=${encodeURIComponent(key)}&paid=1`, cancel_url: `${site}/?island=${encodeURIComponent(key)}&paid=0`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      ...(b.acct.email ? { customer_email: b.acct.email } : {}),
    }).catch(() => null);
    if (!session?.url) { await ctx.runMutation(internal.payments.dropHold, { holdId: hold.holdId }); return { ok: false, why: 'Could not open checkout. Try again' }; }
    await ctx.runMutation(internal.payments.attachSession, { holdId: hold.holdId, sessionId: session.id });
    return { ok: true, url: session.url, price: hold.price };
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

/** The event Stripe sent, if its signature checks out against the endpoint secret (and is under five minutes old). */
export async function stripeEvent(payload: string, header: string | null, secret: string): Promise<Stripe.Event | null> {
  if (!header) return null;
  try { return await Stripe.webhooks.constructEventAsync(payload, header, secret, undefined, Stripe.createSubtleCryptoProvider()); } catch { return null; }
}
const intentId = (pi: string | { id: string } | null): string | undefined => typeof pi === 'string' ? pi : pi?.id;
export const stripeWebhook = httpAction(async (ctx, req) => {
  const secret = envVar('STRIPE_WEBHOOK_SECRET'), ev = secret ? await stripeEvent(await req.text(), req.headers.get('stripe-signature'), secret) : null;
  if (!ev) return new Response('bad signature', { status: 400 });
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const o = ev.data.object, m = o.metadata ?? {}, paymentIntent = intentId(o.payment_intent);
    if (!mine(o.metadata) || o.payment_status !== 'paid' || !m.holdId || !m.islandKey || !m.userId) return new Response('ok');
    const r = await ctx.runMutation(internal.payments.confirmPaid, { holdId: m.holdId, key: m.islandKey, userId: m.userId, name: m.name, sessionId: o.id, paymentIntent, cents: o.amount_total ?? 0 });
    if (r === 'conflict' && paymentIntent) {                                 // paid for an island we can't give: money back
      const done = await stripe().refunds.create({ payment_intent: paymentIntent, reason: 'duplicate' }, { idempotencyKey: `refund-${o.id}` })
        .then(() => true, (e: { code?: string }) => e.code === 'charge_already_refunded');
      console.error(JSON.stringify({ msg: 'paid island not granted', refunded: done, session: o.id, key: m.islandKey }));
      if (!done) return new Response('refund failed', { status: 500 });     // Stripe retries the event, and with it the refund
    }
  } else if (ev.type === 'checkout.session.expired') {
    const holdId = ev.data.object.metadata?.holdId;
    if (holdId && mine(ev.data.object.metadata)) await ctx.runMutation(internal.payments.dropHold, { holdId });
  } else if (ev.type === 'charge.refunded') {                              // only a full refund gives the island back
    const paymentIntent = intentId(ev.data.object.payment_intent);
    if (paymentIntent && ev.data.object.refunded) await ctx.runMutation(internal.payments.refunded, { paymentIntent });
  }
  return new Response('ok');
});
/** Let a hold go (checkout failed or expired); never touches an island that was paid for. */
export const dropHold = internalMutation({
  args: { holdId: v.string() },
  handler: async (ctx, { holdId }) => { const id = ctx.db.normalizeId('islands', holdId); const h = id && await ctx.db.get(id); if (h && h.status === 'pending') await ctx.db.delete(h._id); },
});
