// Display-name filter. Names may only use plain letters, numbers, spaces and a little punctuation.
// Text is folded first (accents stripped, leetspeak like 0/1/3/4/5/7/@/$ mapped) and checked in a few spellings:
// as typed, with repeated letters collapsed ("fuuuck"), and with v->u, ph->f (and for STRONG words l->i) swaps ("fvck", "phuk", "nlgger").
// STRONG words are distinctive enough to block anywhere, even across spaces ("f u c k"). SHORT words would cause
// false positives inside ordinary names (Dickens, Analyst, Assassin), so they block only as a whole word or
// with a crude ending (dickhead, asshole, fags). Collapsing is only used for words without double letters, so
// "Bob" is not mistaken for "boob" and "Knight" not for a slur.
const STRONG = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'nigger', 'nigga', 'nigg', 'faggot', 'whore', 'slut', 'bitch', 'retard', 'nazi', 'hitler',
  'molest', 'wank', 'twat', 'jizz', 'porn', 'penis', 'vagina', 'tranny', 'kike', 'wetback', 'killyourself', 'killurself', 'killyoself', 'paedo'];
const SHORT = ['fag', 'fags', 'rape', 'rapist', 'sex', 'sexy', 'cum', 'anal', 'kys', 'dick', 'dck', 'cock', 'pussy', 'coon', 'spic', 'chink', 'gook',
  'isis', 'ass', 'arse', 'tit', 'tits', 'titty', 'titties', 'cuck', 'bastard', 'slag', 'hoe', 'hoes', 'boob', 'boobs', 'nude', 'nudes', 'adolf', 'heil',
  'pedo', 'nonce'];
const ENDINGS = ['', 's', 'es', 'z', 'y', 'ie', 'ies', 'ed', 'er', 'ers', 'ing', 'head', 'heads', 'hole', 'holes', 'face', 'sucker', 'suckers', 'wad', 'bag', 'phile'];
// real places and words that contain a STRONG word
const ALLOW = ['scunthorpe', 'penistone', 'shiitake', 'shitake', 'cockburn', 'arsenal'];
// staff-like words are reserved anywhere in a name; story characters and the game's own name only as the whole name
const STAFF = ['admin', 'administrator', 'moderator', 'staff', 'official', 'support', 'system', 'developer', 'convex', 'anthropic', 'claude'];
const STORY = ['nell', 'maren', 'tobias', 'ida', 'wren', 'harbourmaster', 'bobberrun', 'mod', 'server'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '+': 't' };
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split('').map(c => LEET[c] ?? c).join('').replace(/[^a-z]/g, '');
const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');
const swaps = (s: string) => [s, s.replace(/v/g, 'u'), s.replace(/ph/g, 'f')];
const swapsL = (s: string) => [...swaps(s), s.replace(/l/g, 'i')];   // l->i only for STRONG words: "Cockle" must not read as "cockie"
const doubled = (s: string) => /(.)\1/.test(s);

const STRONG_C = STRONG.filter(w => !doubled(w) && w.length >= 4);   // collapsing a doubled pattern (nigger -> niger) would block real words
const SHORT_S = new Set(SHORT), SHORT_C = new Set(SHORT.filter(w => !doubled(w)));
const strongIn = (t: string) => STRONG.some(b => t.includes(b)) || STRONG_C.some(b => collapse(t).includes(b));
const shortIs = (w: string) => ENDINGS.some(e => w.endsWith(e) && (SHORT_S.has(w.slice(0, w.length - e.length)) ||
  SHORT_C.has(collapse(w.slice(0, w.length - e.length)))));

const ADJ = ['Salty', 'Sunny', 'Misty', 'Brave', 'Quiet', 'Lucky', 'Rusty', 'Jolly', 'Sleepy', 'Wandering', 'Merry', 'Tidal'];
const NOUN = ['Gull', 'Tern', 'Otter', 'Cod', 'Puffin', 'Heron', 'Seal', 'Skipper', 'Mackerel', 'Barnacle', 'Pelican', 'Kelp'];
/** A friendly guest name, chosen here so a client can't pass off its own text as a generated name. */
export const guestName = (): string => `${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]}`;

export type NameCheck = { ok: true; name: string } | { ok: false; why: string };
export function cleanName(raw: string): NameCheck {
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 18) return { ok: false, why: 'Use 2 to 18 characters' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 '_-]*$/.test(name)) return { ok: false, why: 'Use letters, numbers, spaces, - and _ only' };
  if ((name.match(/[0-9]/g) ?? []).length > 4) return { ok: false, why: 'Use fewer numbers' };
  const words = name.split(/[\s'_-]+/).map(fold).filter(Boolean);
  let joined = fold(name);
  for (const a of ALLOW) joined = joined.split(a).join('');
  const unfriendly = /k\s*k\s*k/i.test(name) ||                     // kkk is checked raw: folding would shrink it
    swapsL(joined).some(strongIn) || words.some(w => swaps(w).some(shortIs)) || swaps(joined).some(shortIs);
  if (unfriendly) return { ok: false, why: 'Please pick a friendlier name' };
  const plain = name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[0-9]+$/, '');
  if (words.some(w => STAFF.includes(w)) || [fold(name), plain].some(j => STAFF.includes(j) || STORY.includes(j)))
    return { ok: false, why: 'That name is reserved' };
  return { ok: true, name };
}
