import { getServiceToken } from 'convex/server';

// Yes/no questions for Jev (TypeSafe's evaluation model) through the Convex AI Gateway, which holds the provider key: there is
// no key of ours to set. The gateway needs a paid Convex plan; on the free plan getting a token fails and every answer is null.
// Only callable from actions. shortcut: /alpha/decisions is in alpha and its request format may change; check the docs if it starts returning null.
const ENDPOINT = 'https://ai-gateway.convex.dev/alpha/decisions', MODEL = 'typesafe/jev-1.13';

/**
 * Asks several yes/no questions about `state` in one request; `questions` maps a name to instructions that refer to fields of
 * `state` in backticks. Returns the probability of "yes" per name, or null when the gateway is unavailable, Jev is slow, or it fails.
 */
export async function jevAsk(state: Record<string, unknown>, questions: Record<string, string>, timeoutMs: number): Promise<Record<string, number> | null> {
  try {
    // one deadline for the token and the request: a stalled token would otherwise hold up chat with no fallback
    const signal = AbortSignal.timeout(timeoutMs);
    const token = await Promise.race([getServiceToken('ai-gateway'), new Promise<never>((_, no) => signal.addEventListener('abort', () => no(signal.reason)))]);
    const r = await fetch(ENDPOINT, {
      method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, state, questions: Object.fromEntries(Object.entries(questions).map(([k, instructions]) => [k, { type: 'noul', instructions }])) }),
    });
    if (!r.ok) { console.warn(`Jev answered ${r.status}: ${(await r.text()).slice(0, 200)}`); return null; }
    const answers: Record<string, { noul?: unknown }> = (await r.json()).answers ?? {}, out: Record<string, number> = {};
    for (const k of Object.keys(questions)) { const p = answers[k]?.noul; if (typeof p !== 'number') return null; out[k] = p; }
    return out;
  } catch (e) { console.warn(`Jev is unavailable: ${String(e).slice(0, 200)}`); return null; }
}
/** One yes/no question; callers decide what null means (names are allowed, since the local filter has already run). */
export const jevYes = async (state: Record<string, unknown>, instructions: string, timeoutMs = 4000): Promise<number | null> =>
  (await jevAsk(state, { q: instructions }, timeoutMs))?.q ?? null;
