import { describe, expect, test } from 'bun:test';
import { islandPrice, isClaimable, priceOfKey } from '../convex/islandRules';
import { signedByStripe } from '../convex/islands';

describe('island prices', () => {
  test('home cells cost $1000 and the floor is $150', () => {
    expect(islandPrice(0, 0)).toBe(1000);
    expect(islandPrice(-1, -1)).toBe(1000);
    expect(islandPrice(500, 500)).toBe(150);
  });
  test('price never rises moving away from home, in $10 steps', () => {
    let last = Infinity;
    for (let i = 0; i < 80; i++) { const p = islandPrice(i, 0); expect(p).toBeLessThanOrEqual(last); expect(p % 10).toBe(0); last = p; }
  });
  test('keys', () => {
    expect(isClaimable('0,0')).toBe(true);
    expect(isClaimable('-12,7')).toBe(true);
    expect(isClaimable('1,2,3')).toBe(false);
    expect(isClaimable('x')).toBe(false);
    expect(priceOfKey('5,0')).toBe(islandPrice(5, 0));
  });
});

// Stripe signs "timestamp.payload" with HMAC-SHA256; only a correctly signed, fresh event may grant an island.
async function sign(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `t=${t},v1=${mac}`;
}
describe('Stripe webhook signature', () => {
  const body = '{"type":"checkout.session.completed"}', secret = 'whsec_test';
  test('accepts a valid signature', async () => expect(await signedByStripe(body, await sign(body, secret), secret)).toBe(true));
  test('rejects a wrong secret', async () => expect(await signedByStripe(body, await sign(body, 'other'), secret)).toBe(false));
  test('rejects a tampered body', async () => expect(await signedByStripe(body + ' ', await sign(body, secret), secret)).toBe(false));
  test('rejects an old timestamp', async () => expect(await signedByStripe(body, await sign(body, secret, Math.floor(Date.now() / 1000) - 3600), secret)).toBe(false));
  test('rejects no header', async () => expect(await signedByStripe(body, null, secret)).toBe(false));
});
