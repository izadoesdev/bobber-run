import { REPORT_MIN_MS } from './limits';

// How fast the totals a client reports may climb. Kept free of Convex imports so tests/statsRules.test.ts can run it.
export const CAUGHT_PER_MIN = 40, EARNED_PER_MIN = 12_000, SLACK_CAUGHT = 60, SLACK_EARNED = 20_000;

/**
 * The totals to store after a report, or null to ignore it. Totals only ever go up, by at most the slack plus a
 * per-minute rate (idle time banks at most 10 minutes). A report sooner than REPORT_MIN_MS after the last one counted
 * is ignored: the slack is per report, so without the gap a caller could bank it over and over.
 */
export function reported(s: { caught: number; earned: number; at: number }, caught: number, earned: number, now: number): { caught: number; earned: number } | null {
  if (!Number.isFinite(caught) || !Number.isFinite(earned) || now - s.at < REPORT_MIN_MS) return null;
  const mins = Math.min(10, (now - s.at) / 60_000);
  const next = {
    caught: Math.floor(Math.min(Math.max(s.caught, Math.floor(caught)), s.caught + SLACK_CAUGHT + mins * CAUGHT_PER_MIN)),
    earned: Math.floor(Math.min(Math.max(s.earned, Math.floor(earned)), s.earned + SLACK_EARNED + mins * EARNED_PER_MIN)),
  };
  return next.caught === s.caught && next.earned === s.earned ? null : next;
}
