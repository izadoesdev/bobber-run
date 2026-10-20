import { describe, expect, test } from 'bun:test';
import { cleanName } from '../convex/names';

// Names real players use must pass; obvious abuse and disguised spellings must not.
const fair = ['Captain Kipper', 'Bob', 'Knight', 'Night Owl', 'Torpedo', 'Scunthorpe', 'Penistone', 'Sussex', 'Dickens', 'Analyst', 'Therapist',
  'Assassin Bug', 'Cockle Picker', 'Classy Cod', 'Titanic Tom', 'Idaho', 'Nelson', 'Mod Squad', 'Shiitake', 'Arsenal Fan'];
const bad = ['Sh1t Lord', 'f u c k e r', 'FUUUCK', 'b1tch', 'Big Dick', 'Dickhead', 'Asshole', 'Cocksucker', 'Fvck', 'Phuk', 'Nlgger', 'Kill Urself',
  'KKK Klan', 'Admin', 'Adm1n', 'St4ff', 'Nell', 'Tech Support'];

describe('cleanName', () => {
  test.each(fair)('allows %p', n => expect(cleanName(n).ok).toBe(true));
  test.each(bad)('refuses %p', n => expect(cleanName(n).ok).toBe(false));
  test('length limit follows max', () => {
    expect(cleanName('A'.repeat(19)).ok).toBe(false);
    expect(cleanName('Long Island Name Here', 24).ok).toBe(true);
  });
});
