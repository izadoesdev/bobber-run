// What every port tab shares: rows, section headers, the "you need $N more" line, two-press confirms, paying.
import type { PortItem } from '../../types';
import { sfx } from '../../audio';
import { G } from '../state';
import { addCoins, toast, tooPoor } from '../feedback';
import { money } from '../../config';

export type Rows = PortItem[];
export const header = (items: Rows, label: string): void => { items.push({ kind: 'header', label }); };
export const short = (cost: number): string => G.coins < cost ? `You need ${money(cost - G.coins)} more` : '';
export const deny = (): void => sfx('deny');
/** Pay `cost` if you can; otherwise say how much is missing. */
export function spend(cost: number): boolean {
  if (G.coins < cost) { tooPoor(cost); deny(); return false; }
  addCoins(-cost);
  return true;
}
const CONFIRM_S = 4;
/** Asks once, then acts on a second press within a few seconds. */
export function confirmed(what: string, ask: string): boolean {
  if (G.confirm && G.confirm.what === what && G.t - G.confirm.t < CONFIRM_S) { G.confirm = null; return true; }
  G.confirm = { what, t: G.t }; toast(ask, 'bad'); deny();
  return false;
}
/** How many fish of a species are in the hold. */
export const have = (sp: number): number => G.hold.filter(f => f.sp === sp).length;
