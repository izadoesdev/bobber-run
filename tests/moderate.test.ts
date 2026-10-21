import { expect, test } from 'bun:test';
import { local } from '../server/moderate';

// The relay's fallback filter, used when Jev can't answer: what other sailors see.
test('profanity through leetspeak, symbols and look-alike letters is masked word by word', () => {
  expect(local('fvck1ng hell').text).toBe('####### hell');
  expect(local('ʃṳ𝒸𝗄 off').text.startsWith('#')).toBe(true);
  for (const t of ['sh!t', 'b!tch', 'c0ck', 'n1gger', 'r3tard']) expect(local(t)).toMatchObject({ filtered: true, text: '#'.repeat([...t].length) });
});
test('ordinary words, mild words and known false positives pass', () => {
  for (const t of ['classic', 'shiitake', 'assassin', 'assist', 'assume', 'analyst', 'Penistone', 'sea bass', 'compass', 'damn it', 'what the hell', 'cocktail', 'nice catch!']) expect(local(t)).toMatchObject({ filtered: false, text: t });
});
test('contact details and self-harm hide the whole message', () => {
  for (const t of ['add me on discord', 'my number is 555 123 4567', 'kys', 'go kill yourself']) expect(local(t)).toMatchObject({ filtered: true, whole: true });
});
