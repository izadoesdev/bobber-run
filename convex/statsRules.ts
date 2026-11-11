// How fast the totals a client reports may climb. Kept free of Convex imports so tests/statsRules.test.ts can run it.
// The allowance is a bank that fills with time, up to BANK_MS worth, and is drawn down by what a report counts: reporting
// more often gains nothing, and a report at any moment (the once-a-minute one, or the one just before a purchase) counts.
export const CAUGHT_PER_MIN = 40, EARNED_PER_MIN = 12_000, BANK_MS = 10 * 60_000;
/** What a new player's bank starts with: enough for about 20,000 coins and 66 fish straight away. */
export const START_MS = 100_000;

/**
 * The totals to store after a report, with the new `at`, or null when nothing changes. Totals only ever go up. `s.at`
 * is the time the bank was last empty: `now - s.at` (at most BANK_MS) is the allowance saved up, in ms, and a report
 * that uses part of it moves `at` forward by that part only.
 */
export function reported(s: { caught: number; earned: number; at: number }, caught: number, earned: number, now: number): { caught: number; earned: number; at: number } | null {
  if (!Number.isFinite(caught) || !Number.isFinite(earned)) return null;
  const bank = Math.max(0, Math.min(BANK_MS, now - s.at));
  const next = {
    caught: Math.floor(Math.min(Math.max(s.caught, Math.floor(caught)), s.caught + bank * CAUGHT_PER_MIN / 60_000)),
    earned: Math.floor(Math.min(Math.max(s.earned, Math.floor(earned)), s.earned + bank * EARNED_PER_MIN / 60_000)),
  };
  if (next.caught === s.caught && next.earned === s.earned) return null;
  const used = Math.max((next.caught - s.caught) / CAUGHT_PER_MIN, (next.earned - s.earned) / EARNED_PER_MIN) * 60_000;
  return { ...next, at: now - (bank - used) };
}
