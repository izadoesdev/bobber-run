// Display-name filter. Names may only use plain letters, numbers, spaces and a little punctuation.
// Text is folded first (accents stripped, leetspeak like 0/1/3/4/5/7/@/$ mapped, repeated letters collapsed).
// STRONG words are distinctive enough to block anywhere, even across spaces ("f u c k"); SHORT words would
// cause false positives inside ordinary names (Dickens, Analyst, Essex), so they only block as whole words.
const STRONG = ['fuck', 'fuk', 'fck', 'shit', 'cunt', 'nigg', 'niga', 'faggot', 'whore', 'slut', 'bitch', 'retard', 'nazi', 'hitler', 'pedo', 'molest',
  'wank', 'twat', 'jizz', 'porn', 'penis', 'vagina', 'tranny', 'kike', 'wetback', 'killyourself'];
const SHORT = ['fag', 'rape', 'rapist', 'sex', 'cum', 'anal', 'kys', 'dick', 'cock', 'pussy', 'coon', 'spic', 'chink', 'gook', 'isis', 'ass', 'tit', 'tits',
  'cuck', 'bastard', 'slag', 'hoe', 'boob', 'boobs', 'nude', 'nudes', 'sexy'];
const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'official', 'support', 'convex', 'anthropic', 'claude', 'system', 'server',
  'nell', 'maren', 'tobias', 'ida', 'wren', 'harbourmaster', 'bobberrun', 'bobber run'];
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '+': 't' };
const foldWord = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split('').map(c => LEET[c] ?? c).join('')
  .replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
const STRONG_F = STRONG.map(foldWord), SHORT_F = new Set(SHORT.map(foldWord)), RESERVED_F = RESERVED.map(foldWord);

export type NameCheck = { ok: true; name: string } | { ok: false; why: string };
export function cleanName(raw: string): NameCheck {
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 18) return { ok: false, why: 'Use 2 to 18 characters' };
  if (!/^[A-Za-z0-9][A-Za-z0-9 '_-]*$/.test(name)) return { ok: false, why: 'Use letters, numbers, spaces, - and _ only' };
  if ((name.match(/[0-9]/g) ?? []).length > 4) return { ok: false, why: 'Use fewer numbers' };
  const words = name.split(/[\s'_-]+/).map(foldWord).filter(Boolean), joined = foldWord(name);
  if (/k\s*k\s*k/i.test(name) || STRONG_F.some(b => joined.includes(b)) ||   // kkk is checked raw: folding would shrink it to k
      words.some(w => SHORT_F.has(w)) || SHORT_F.has(joined)) return { ok: false, why: 'Please pick a friendlier name' };
  if (RESERVED_F.some(r => joined === r || (joined.startsWith(r) && joined.length <= r.length + 3))) return { ok: false, why: 'That name is reserved' };
  return { ok: true, name };
}
