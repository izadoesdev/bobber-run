import { envVar } from './lib';

// Yes/no questions for Jev (TypeSafe's evaluation model) through the Vercel AI Gateway. `instructions` refers to
// fields of `state` in backticks. Returns the probability of "yes", or null when no key is set, Jev is slow, or it
// fails; callers decide what null means (names and links are allowed, since the local filter has already run).
export async function jevYes(state: Record<string, unknown>, instructions: string, timeoutMs = 4000): Promise<number | null> {
  const key = envVar('AI_GATEWAY_API_KEY');
  if (!key) return null;
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/evaluate', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'typesafe-ai/jev-1.14.0', state, questions: { q: { type: 'boolean', instructions } } }),
    });
    const p = r.ok ? (await r.json()).answers?.q?.probability : undefined;
    return typeof p === 'number' ? p : null;
  } catch { return null; }
}
