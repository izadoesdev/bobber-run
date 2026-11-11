import { describe, expect, test } from 'bun:test';
import { matchesLegacyHash } from '../convex/legacySignIn';

// hashes made by Lucia's Scrypt 3.2, which Convex Auth v1 stored in authAccounts.secret
const HASH = '268fb6bee2c0b8e1a0d5f5d7873ef3f1:d127e332185af4604a2deb2654d56881edc4273fdaa16d3d22e6753363e5a98f7ebce9a552085c8ff4c72c100958609eee4847cd11d17082f1247ce1abed130d';
const SHORT = '85f082dfd5a150b72a6d3c9ba8d08a5f:d5fbb08c86687740e32c8260b58020ac018cffe4d769835f84de571051005f243ba3940845088b4583a1a74712ea11589c807015ce9320fc4b5372c62a381606';

describe('matchesLegacyHash', () => {
  test('accepts the right password', async () => {
    expect(await matchesLegacyHash(HASH, 'Tide-Pool-Password-1')).toBe(true);
    expect(await matchesLegacyHash(SHORT, 'short123')).toBe(true);
  });
  test('refuses a wrong password', async () => {
    expect(await matchesLegacyHash(HASH, 'tide-pool-password-1')).toBe(false);
    expect(await matchesLegacyHash(HASH, '')).toBe(false);
  });
  test('refuses malformed hashes rather than throwing', async () => {
    for (const bad of ['', 'nocolon', 'salt:abcd', `s2:${HASH}`, `${HASH.split(':')[0]}:`]) expect(await matchesLegacyHash(bad, 'Tide-Pool-Password-1')).toBe(false);
  });
});
