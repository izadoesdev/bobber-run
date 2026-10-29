// The market: prices, selling (keeping fish back for contracts and the harbour), repairs and fish charts.
import { isRunningNow, RUNNING_PRICE } from '../../tides';
import { packSell } from '../../content/engine';
import { SPECIES, UPGRADES, UPGRADE_STEP } from '../../econ';
import { sfx } from '../../audio';
import { track, bucket } from '../../analytics';
import { CREW_RANGE, ONLINE, crewBonus } from '../../online';
import type { Fish, Port } from '../../types';
import { money } from '../../config';
import { G } from '../state';
import { boatDef, cap, fishValue, hpMax } from '../rules';
import { addCoins, toast } from '../feedback';
import { saveGame } from '../save';
import { confirmed, header, spend, type Rows } from './kit';
import { needStatus, nextProject } from './harbour';
import { dockGrade, dockHand } from './contracts';

/** Price multiplier for a species at a port, lowered by recent sales there (`extra` = fish sold ahead in this batch). */
export function priceAt(p: Port, spIdx: number, extra = 0): number {
  const s = (G.sat[p.id]?.[spIdx] || 0) + extra;
  return p.mult[spIdx] * Math.max(0.5, 1 - s * 0.07) * (isRunningNow(SPECIES[spIdx].id) ? RUNNING_PRICE : 1);   // this week's running fish sell for more
}

// ---------- what "Sell all" keeps back ----------
/** Fish set aside for active contracts (the most valuable of each species). Contracts bigger than the hold can't be met, so they keep nothing. */
function contractFish(): Set<Fish> {
  const keep = new Set<Fish>();
  for (const c of G.active) {
    if (c.n > cap()) continue;
    let n = c.n;
    G.hold.filter(f => f.sp === c.sp && !keep.has(f)).sort((a, b) => b.value - a.value).forEach(f => { if (n-- > 0) keep.add(f); });
  }
  return keep;
}
/** Fish the next harbour project asks for. "Any fish" needs are not held back, or an early rowboat could never sell. */
function harbourFish(exclude: Set<Fish>): Set<Fish> {
  const pr = nextProject(), keep = new Set<Fish>();
  if (!pr || 'any' in pr.need) return keep;
  for (const f of needStatus(pr.need).pick) if (!exclude.has(f)) keep.add(f);
  return keep;
}
function reserved(): { all: Set<Fish>; contracts: number; harbour: number } {
  const c = contractFish(), h = harbourFish(c);
  return { all: new Set([...c, ...h]), contracts: c.size, harbour: h.size };
}
/** The fish "Sell all" keeps back: for active contracts and the next harbour project. */
export const keptBack = (): Set<Fish> => reserved().all;

// ---------- selling ----------
/** Other players' boats within crew range of a point. */
export const sailorsNear = (x: number, y: number): number => ONLINE.sailors.filter(s => Math.hypot(s.x - x, s.y - y) < CREW_RANGE).length;
/** Everything a sale is multiplied by besides the port's price: the cook's smoking and the crew bonus for sailors nearby. */
export const saleBonus = (): { cook: number; crew: number; lux: number } => ({ cook: 0.1 * G.up.cook, crew: crewBonus(G.boat.x, G.boat.y), lux: boatDef().luxury ?? 0 });
/** What "Sell all" pays. With `all`, fish kept back for contracts and the harbour are sold too. */
export function saleValue(p: Port, all = false): { tot: number; n: number; kept: number; harbour: number } {
  const r = reserved(), keep = all ? new Set<Fish>() : r.all, sold: Record<number, number> = {}, b = saleBonus(), mul = (1 + b.cook) * (1 + b.crew) * (1 + b.lux);
  let tot = 0, n = 0;
  for (const f of G.hold) {
    if (keep.has(f)) continue;
    tot += Math.round(fishValue(f) * priceAt(p, f.sp, sold[f.sp] || 0) * mul);
    sold[f.sp] = (sold[f.sp] || 0) + 1;
    n++;
  }
  return { tot, n, kept: r.contracts, harbour: r.harbour };
}
/** A full hold where every fish is kept back would leave nothing to sell and no room to fish, so Sell all can sell those too. */
const stuck = (n: number): boolean => n === 0 && G.hold.length >= cap();
export function sell(p: Port): void {
  let all = false, { tot, n } = saleValue(p);
  if (stuck(n)) {
    if (!confirmed('sell-kept', 'All your fish are kept for a contract or a harbour project. Press Sell all again to sell them anyway')) return;
    all = true; ({ tot, n } = saleValue(p, true));
  }
  if (!n) { sfx('deny'); return; }
  const keep = all ? new Set<Fish>() : reserved().all, sat = G.sat[p.id] || (G.sat[p.id] = {});
  const legend = G.hold.find(f => !keep.has(f) && SPECIES[f.sp].legend);
  if (legend && !confirmed('sell-legend', `You have a legendary fish (${SPECIES[legend.sp].name}). Press Sell all again to sell it too`)) return;
  for (const f of G.hold) if (!keep.has(f)) sat[f.sp] = (sat[f.sp] || 0) + 1;
  G.hold = G.hold.filter(f => keep.has(f));
  addCoins(tot); G.stats.sold++; packSell(tot);
  track('catch_sold', { fish: n, value_bucket: bucket(tot), port: p.name, sold_kept: all });
  sfx('coin'); setTimeout(() => sfx('coin', 0.7), 90);
  if (G.mode === 'port' && G.menu.port?.id === p.id) G.menu.sale = { count: n, coins: tot };
  else toast(`Sold ${n} fish for $${tot}`, 'good');
  saveGame();
}

/** Your own island's market pays a third over a fair price and doesn't tire of a species (islandRules: market). */
const REALM_PRICE = 1.3;
/** What selling at your island would pay, and how many fish (kept-back fish stay aboard, as at any port). */
export function realmSaleValue(): { tot: number; n: number } {
  const keep = reserved().all, b = saleBonus(), mul = REALM_PRICE * (1 + b.cook) * (1 + b.crew) * (1 + b.lux);
  let tot = 0, n = 0;
  for (const f of G.hold) if (!keep.has(f)) { tot += Math.round(fishValue(f) * mul); n++; }
  return { tot, n };
}
export function sellAtRealm(name: string): void {
  const { tot, n } = realmSaleValue();
  if (!n) { sfx('deny'); return; }
  const keep = reserved().all;
  G.hold = G.hold.filter(f => keep.has(f));
  addCoins(tot); G.stats.sold++; packSell(tot);
  track('catch_sold', { fish: n, value_bucket: bucket(tot), port: 'realm', sold_kept: false });
  sfx('coin'); setTimeout(() => sfx('coin', 0.7), 90);
  toast(`Sold ${n} fish at ${name}'s market for $${tot}`, 'good'); saveGame();
}

export function sellItems(p: Port, items: Rows, viewHold: () => void): void {
  const sv = saleValue(p), crew = saleBonus().crew;
  header(items, 'SELL');
  const sale = G.menu.sale;
  if (!G.hold.length && sale) {
    const suggestHold = !G.stats.upgrades && !G.up.hold && G.boatId === 'row' && G.owned.length === 1;
    items.push({
      kind: 'sale', icon: 'coin', label: 'Catch sold', sub: `${sale.count} fish sold`, right: '+' + money(sale.coins), ok: true,
      action: suggestHold ? 'View Hold upgrade' : undefined, act: suggestHold ? viewHold : () => {},
      what: suggestHold ? `A larger Hold: ${cap()} fish to ${cap() + UPGRADE_STEP.hold} fish for ${money(UPGRADES.hold.costs[0])}. More room between trips to port, if that suits your next voyage.` : null,
    });
    return;
  }
  items.push({
    kind: 'sell', icon: 'coin', label: 'Sell your catch',
    sub: sv.n ? `${sv.n} fish${sv.kept ? `, ${sv.kept} kept for contracts` : ''}${sv.harbour ? `, ${sv.harbour} kept for a harbour project` : ''}${crew ? `, crew bonus +${Math.round(crew * 100)}%` : ''}` : 'Your hold is empty',
    right: sv.n ? '+' + money(sv.tot) : '', ok: sv.n > 0 || stuck(sv.n),
    why: sv.n ? '' : stuck(sv.n) ? 'Your hold is full, and every fish is kept for a contract or project. Press Sell all twice to sell them anyway' : sv.kept || sv.harbour ? 'Every fish is kept for a contract or a harbour project' : 'Your hold is empty. Go fishing!',
    action: 'Sell all', act: () => sell(p),
  });
}

// ---------- repairs ----------
const REPAIR_PER_HP = 0.3;
/** Repairs are free at a port whose dock hand is Grade V. */
const freeRepairs = (): boolean => !!G.menu.port && dockGrade(G.menu.port.id) >= 5;
const repairCost = (): number => freeRepairs() ? 0 : Math.ceil((hpMax() - G.boat.hp) * REPAIR_PER_HP);
function repair(): void {
  const m = hpMax(), miss = m - G.boat.hp;
  if (miss > 0 && freeRepairs()) { G.boat.hp = m; sfx('select'); toast(`${dockHand(G.menu.port!)} patches your hull for free`); saveGame(); return; }
  if (miss <= 0 || G.coins <= 0) { sfx('deny'); return; }
  const pay = Math.min(Math.ceil(miss * REPAIR_PER_HP), G.coins);   // short of coin: patch what you can afford
  addCoins(-pay);
  G.boat.hp = Math.min(m, G.boat.hp + Math.ceil(pay / REPAIR_PER_HP));
  track('hull_repaired', { cost_bucket: bucket(pay), full: G.boat.hp >= m });
  sfx('select'); toast(G.boat.hp >= m ? 'Hull repaired' : 'You could only afford part of the repair'); saveGame();
}

export function repairItem(items: Rows): void {
  const miss = hpMax() - G.boat.hp, rc = repairCost();
  items.push({
    kind: 'repair', icon: 'repair', label: 'Repair hull', sub: `${G.boat.hp} of ${hpMax()} hull`, cost: rc, right: miss <= 0 ? 'Full' : rc === 0 ? 'Free' : money(rc), ok: miss > 0 && (G.coins > 0 || rc === 0),
    why: miss <= 0 ? 'Your hull is not damaged' : G.coins <= 0 ? 'You have no coins' : '', action: 'Repair', act: repair,
    what: `Repairs your hull for ${money(REPAIR_PER_HP * 100)} per 100 points. If you can't afford it all, you get a partial repair. If your hull reaches 0, your boat sinks and a tug tows you back to port for a small fee.`,
  });
}

// ---------- fish charts ----------
/** A species' fish chart: about 20 times what one sells for (legends and landmark fish aren't charted). */
export const fishChartPrice = (sp: number): number => Math.max(100, Math.round(SPECIES[sp].base * 2) * 10);
export const chartable = (sp: number): boolean => !SPECIES[sp].legend && !SPECIES[sp].special && SPECIES[sp].w > 0;
/** Buy where a species lives: the chart shades its waters from now on. */
export function buyFishChart(sp: number): boolean {
  const s = SPECIES[sp], price = fishChartPrice(sp);
  if (!chartable(sp) || G.zones[s.id] || !spend(price)) return false;
  G.zones[s.id] = true;
  sfx('coin'); toast(G.log[s.id] ? `Bought the ${s.name} chart` : 'Bought a chart of an unknown fish', 'good');
  track('fish_chart_bought', { species: s.id, price_bucket: bucket(price), logged: !!G.log[s.id] });
  saveGame();
  return true;
}
