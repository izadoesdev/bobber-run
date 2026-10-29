export const TREASURY_MIN = 180;
const nonnegative = (n: number): number => Number.isFinite(n) ? Math.max(0, n) : 0;

export function accrueTreasury(balance: number, ratePerMinute: number, seconds: number): number {
  const banked = nonnegative(balance), income = nonnegative(ratePerMinute), elapsed = nonnegative(seconds);
  const room = Math.max(0, income * TREASURY_MIN - banked);
  return banked + Math.min(room, income * elapsed / 60);
}
