// Roblox-style chat filtering. Jev (TypeSafe's evaluation model, through the Vercel AI Gateway) answers yes/no
// questions about a message in one request: whole-message checks for what Roblox removes entirely (personal
// information, moving the chat off the game, sexual content, hate, threats and self-harm, scams), and one question per
// word so milder words are masked with # the way Roblox does, instead of dropping the message. If Jev is slow or
// unreachable, a small local filter masks the obvious cases instead.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

const KEY = process.env.AI_GATEWAY_API_KEY;
const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate', MODEL = 'typesafe-ai/jev-1.14.0';
// a little more relaxed than Roblox's under-13 filter: mild words and friendly teasing pass, but personal info and
// moving off the game are still caught early
const TIMEOUT_MS = 2500, MAX_WORDS = 24, WORD_AT = 0.65;
const WHOLE_AT: Record<string, number> = { personal_info: 0.5, off_platform: 0.5, sexual: 0.55, hate: 0.55, harm: 0.6, scam: 0.6 };

const WHOLE = {
  personal_info: 'Does `msg.text` share or ask for personal information such as a real full name, phone number, home address, email, school, age, or exact location?',
  off_platform: 'Does `msg.text` try to move the conversation off this game, for example social media or Discord handles, links, "add me on", or other apps?',
  sexual: 'Is `msg.text` sexual, sexually suggestive, flirting toward dating, or asking someone for photos or pictures of themselves?',
  hate: 'Does `msg.text` contain slurs or attack people for race, religion, gender, sexuality, disability or nationality?',
  harm: 'Does `msg.text` threaten violence, encourage self-harm or suicide (including "kys"), or describe real-world violence?',
  scam: 'Is `msg.text` a scam, phishing attempt, or offer of free currency or items in exchange for something?',
};
const WORD = (i: number) => `Is the word \`msg.w${i}\` in \`msg.text\` strong profanity, a slur, or a sexual word that a 13+ chat filter would hide? Mild words like damn, hell, crap, wtf, stupid or idiot are fine.`;

export type Verdict = { text: string; filtered: boolean; whole: boolean; source: 'jev' | 'local' };

type Answers = Record<string, { type: string; probability: number }>;
async function ask(state: Record<string, unknown>, questions: Record<string, { type: 'boolean'; instructions: string }>): Promise<Answers | null> {
  if (!KEY) return null;
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (!r.ok) return null;
    return (await r.json()).answers ?? null;
  } catch { return null; }
}

const mask = (w: string) => w.replace(/[^\s]/g, '#');
// The local fallback, when Jev can't answer: obscenity's English list catches profanity and slurs through leetspeak,
// spacing tricks and look-alike letters; the whole word is masked, as Roblox does. Contact details, and telling
// someone to hurt themselves, hide the whole message.
const PROFANITY = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers, whitelistedTerms: ['shiitake', 'shitake', 'penistone', 'scunthorpe', 'assassin', 'assess', 'assist', 'assum', 'dickens', 'analyst', 'cumin'] });
const CONTACT = /(https?:\/\/|www\.|\.com\b|\.gg\b|discord|snap(chat)?|insta(gram)?|tiktok|@\w{3,}|\d[\d\s-]{6,}\d)/i;
const SELF_HARM = /\bk+\s*y+\s*s+\b|\bkill\s+(your|ur)\s*self/i;
export function local(text: string): Verdict {
  if (CONTACT.test(text) || SELF_HARM.test(text)) return { text: mask(text), filtered: true, whole: true, source: 'local' };
  const hit = new Set<number>();
  for (const m of PROFANITY.getAllMatches(text)) for (let i = m.startIndex; i <= m.endIndex; i++) hit.add(i);
  let at = 0, filtered = false;
  const out = text.split(/(\s+)/).map(w => {
    const start = at; at += w.length;
    if (!w.trim() || ![...w].some((_, k) => hit.has(start + k))) return w;
    filtered = true; return mask(w);
  }).join('');
  return { text: out, filtered, whole: false, source: 'local' };
}

/** What other players see for a chat message, and whether anything was filtered. */
export async function filterChat(text: string): Promise<Verdict> {
  const words = text.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  const state = { msg: { text, ...Object.fromEntries(words.map((w, i) => [`w${i}`, w])) } };
  const questions: Record<string, { type: 'boolean'; instructions: string }> = {};
  for (const [k, q] of Object.entries(WHOLE)) questions[k] = { type: 'boolean', instructions: q };
  words.forEach((_, i) => { questions[`w${i}`] = { type: 'boolean', instructions: WORD(i) }; });
  const a = await ask(state, questions);
  if (!a) return local(text);
  if (Object.keys(WHOLE).some(k => (a[k]?.probability ?? 0) >= WHOLE_AT[k])) return { text: mask(text), filtered: true, whole: true, source: 'jev' };
  let i = 0, filtered = false;
  const out = text.split(/(\s+)/).map(tok => {
    if (!tok.trim()) return tok;
    const p = i < MAX_WORDS ? a[`w${i}`]?.probability ?? 0 : 0; i++;
    if (p >= WORD_AT) { filtered = true; return mask(tok); }
    return tok;
  }).join('');
  return { text: out, filtered, whole: false, source: 'jev' };
}
