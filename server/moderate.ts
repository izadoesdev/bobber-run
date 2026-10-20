// Roblox-style chat filtering. Jev (TypeSafe's evaluation model, through the Vercel AI Gateway) answers yes/no
// questions about a message in one request: whole-message checks for what Roblox removes entirely (personal
// information, moving the chat off the game, sexual content, hate, threats and self-harm, scams), and one question per
// word so milder words are masked with # the way Roblox does, instead of dropping the message. If Jev is slow or
// unreachable, a small local filter masks the obvious cases instead.
const KEY = process.env.AI_GATEWAY_API_KEY;
const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/evaluate', MODEL = 'typesafe-ai/jev-1.14.0';
const TIMEOUT_MS = 2500, BLOCK_AT = 0.5, MAX_WORDS = 24;

const WHOLE = {
  personal_info: 'Does `msg.text` share or ask for personal information such as a real full name, phone number, home address, email, school, age, or exact location?',
  off_platform: 'Does `msg.text` try to move the conversation off this game, for example social media or Discord handles, links, "add me on", or other apps?',
  sexual: 'Is `msg.text` sexual, sexually suggestive, flirting toward dating, or asking someone for photos or pictures of themselves?',
  hate: 'Does `msg.text` contain slurs or attack people for race, religion, gender, sexuality, disability or nationality?',
  harm: 'Does `msg.text` threaten violence, encourage self-harm or suicide (including "kys"), or describe real-world violence?',
  scam: 'Is `msg.text` a scam, phishing attempt, or offer of free currency or items in exchange for something?',
};
const WORD = (i: number) => `Would Roblox's chat filter for a 13+ player replace the word \`msg.w${i}\` with hashtags when it appears in \`msg.text\`?`;

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
// The local fallback: obvious profanity and slurs per word, and contact details for the whole message.
const LOCAL_WORDS = /^(f+u+c*k+\w*|sh+i+t+\w*|b+i+t+c+h+\w*|c+u+n+t+\w*|n+i+g+\w*|f+a+g+\w*|d+i+c+k+\w*|c+o+c+k+\w*|p+u+s+s+y+\w*|a+s+s+h+o+l+e+\w*|k+y+s+|r+a+p+e+\w*|s+l+u+t+\w*|w+h+o+r+e+\w*|r+e+t+a+r+d+\w*|p+o+r+n+\w*)$/i;
const CONTACT = /(https?:\/\/|www\.|\.com\b|\.gg\b|discord|snap(chat)?|insta(gram)?|tiktok|@\w{3,}|\d[\d\s-]{6,}\d)/i;
function local(text: string): Verdict {
  if (CONTACT.test(text)) return { text: mask(text), filtered: true, whole: true, source: 'local' };
  let filtered = false;
  const out = text.split(/(\s+)/).map(w => { const bare = w.replace(/[^a-z0-9]/gi, '').replace(/[013457@$]/g, c => ({ 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' } as Record<string, string>)[c]);
    if (bare && LOCAL_WORDS.test(bare)) { filtered = true; return mask(w); } return w; }).join('');
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
  if (Object.keys(WHOLE).some(k => (a[k]?.probability ?? 0) >= BLOCK_AT)) return { text: mask(text), filtered: true, whole: true, source: 'jev' };
  let i = 0, filtered = false;
  const out = text.split(/(\s+)/).map(tok => {
    if (!tok.trim()) return tok;
    const p = i < MAX_WORDS ? a[`w${i}`]?.probability ?? 0 : 0; i++;
    if (p >= BLOCK_AT) { filtered = true; return mask(tok); }
    return tok;
  }).join('');
  return { text: out, filtered, whole: false, source: 'jev' };
}
