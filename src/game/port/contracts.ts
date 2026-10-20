// Contracts and dock hands. Each port offers a few delivery jobs a day, worth a detour at every stage. Its dock hand
// gets to know you through the contracts you deliver there: grades I-V add pay at that port and bring gifts that
// aren't coins. A delivery streak adds 5% a step (up to five); abandoning a contract only drops a step.
import { homePort } from '../../world';
import { isRegional } from '../../species';
import { SPECIES, SP, FLEET_PER_MIN } from '../../econ';
import { sfx } from '../../audio';
import { track, bucket } from '../../analytics';
import type { Contract, Port } from '../../types';
import { G } from '../state';
import { canLand, cap, catchNeed, contractSlots, dayNum } from '../rules';
import { addCoins, celebrate, toast } from '../feedback';
import { portById, saveGame } from '../save';
import { money } from '../../config';
import { confirmed, have, type Rows } from './kit';
import { chartable } from './market';

export const chartedPorts = (except: string): Port[] => [...G.found].filter(id => id.startsWith('port:') && id !== except).map(portById);

// ---------- dock hands ----------
const HANDS = ['Tomas', 'Ada', 'Bram', 'Lio', 'Kesi', 'Moss', 'Pip', 'Rhea', 'Sol', 'Juno', 'Otto', 'Fen'];
const GRADES = [0, 2, 5, 9, 14];                       // deliveries at a port to reach grades I..V
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const GRADE_GIFT = ['', 'Shrimp bait and glow lures', 'A fish chart: where a valuable fish lives', 'A third offer, and big orders for big holds', 'Free hull repairs at this port'];
export const dockHand = (p: Port): string => HANDS[[...p.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % HANDS.length];
/** A port's dock-hand grade, 1..5. */
export const dockGrade = (portId: string): number => GRADES.filter(n => (G.docks[portId] ?? 0) >= n).length;
const gradeBonus = (portId: string): number => (dockGrade(portId) - 1) * 0.1;
const streakBonus = (): number => 0.05 * G.streak;
const contractPay = (c: Contract): number => Math.round(c.reward * (1 + 0.15 * G.up.quarter) * (1 + gradeBonus(c.to) + streakBonus()));
/** A delivery at port `id`: the streak grows, and a new grade brings its gift. */
function dockDelivered(id: string): void {
  const before = dockGrade(id);
  G.docks[id] = (G.docks[id] ?? 0) + 1;
  G.streak = Math.min(5, G.streak + 1);
  const g = dockGrade(id);
  if (g === before) return;
  const p = portById(id), who = dockHand(p);
  if (g === 2) { G.bait.shrimp = (G.bait.shrimp || 0) + 5; G.bait.glow = (G.bait.glow || 0) + 2; }
  if (g === 3) {
    const sp = SPECIES.map((_, i) => i).filter(i => chartable(i) && canLand(i) && !G.zones[SPECIES[i].id] && (G.log[SPECIES[i].id]?.n ?? 0) < 5).sort((a, b) => SPECIES[b].base - SPECIES[a].base)[0];
    if (sp !== undefined) { G.zones[SPECIES[sp].id] = true; toast(`${who} marks where ${G.log[SPECIES[sp].id] ? SPECIES[sp].name : 'a valuable fish'} lives on your chart`, 'good'); }
  }
  toast(`${who} at ${p.name} trusts you more: Grade ${ROMAN[g - 1]}. ${GRADE_GIFT[g - 1]}`, 'good');
  celebrate(); track('dock_grade_up', { grade: g });
}

// ---------- offers ----------
/**
 * What a contract adds on top of the fish and the trip, so it stays worth a detour as you grow: about 3-4 minutes of
 * what your best boat earns (its Fleet Office rate stands in for that), nothing extra in a rowboat.
 */
function contractPremium(): number {
  const best = Math.max(...G.owned.map(id => FLEET_PER_MIN[id]));
  return Math.max(0, best - FLEET_PER_MIN.row) * 20;
}
function makeOffer(p: Port): Contract {
  const ports = chartedPorts(p.id);
  const dest = ports.length ? ports[Math.floor(Math.random() * ports.length)] : p;
  // only fish you can already catch, never legends, and fish from far-off waters only once you've logged them;
  // mostly your newest rod tier, some from the one below, rarely the easy ones
  const cands = SPECIES.filter((s, i) => s.w > 0 && canLand(i) && !s.legend && (!isRegional(s) || !!G.log[s.id]));
  const want = (s: (typeof SPECIES)[number]): number => s.w * (s.rod === G.up.rod ? 4 : s.rod === G.up.rod - 1 ? 1.5 : 0.3);
  let v = Math.random() * cands.reduce((a, s) => a + want(s), 0), sp = cands[0];
  for (const s of cands) { v -= want(s); if (v <= 0) { sp = s; break; } }
  // a Grade IV dock hand also passes on big orders: a big hold's worth of a common fish, for a bigger premium
  const bulk = dockGrade(p.id) >= 4 && cap() >= 20 && sp.base < 40 && Math.random() < 0.4;
  const n = bulk ? Math.floor(cap() * 0.4) : Math.min(cap(), sp.base < 12 ? 3 + Math.floor(Math.random() * 3) : sp.base < 40 ? 2 + Math.floor(Math.random() * 2) : 1);   // never more than the hold carries
  const dist = Math.hypot(dest.x - p.x, dest.y - p.y);
  return { id: Math.random().toString(36).slice(2, 8), from: p.id, to: dest.id, toName: dest.name, sp: SP[sp.id], n, day: dayNum(), ...(bulk ? { bulk } : {}),
    reward: Math.round(n * sp.base * (1.7 + Math.random() * 0.6) + dist / 20 + contractPremium() * (bulk ? 1.5 : 1) * (0.75 + Math.random() * 0.5)) };
}
const offerCount = (p: Port): number => dockGrade(p.id) >= 4 ? 3 : 2;
/** Two offers per port (three for a Grade IV dock hand), replaced each new day if nobody took them. */
function offersAt(p: Port): Contract[] {
  const today = dayNum(), was = G.offers[p.id];
  const fresh = (was ?? []).filter(c => c.day === today);
  if (!was || fresh.length < was.length || fresh.length < offerCount(p)) {
    if (was && fresh.length < was.length) track('contract_offers_refreshed', { port: p.id === homePort().id ? 'home' : 'away' });
    while (fresh.length < offerCount(p)) fresh.push(makeOffer(p));
    G.offers[p.id] = fresh;
  }
  return G.offers[p.id];
}

// ---------- taking, delivering, abandoning ----------
function deliver(c: Contract): void {
  let n = c.n;
  G.hold = G.hold.filter(f => !(f.sp === c.sp && n-- > 0));
  const pay = contractPay(c);
  G.active = G.active.filter(a => a !== c);
  addCoins(pay); G.stats.contracts++;
  dockDelivered(c.to);
  track('contract_completed', { species: SPECIES[c.sp].id, fish: c.n, reward_bucket: bucket(pay) });
  sfx('fanfare'); toast(`Contract complete  +$${pay}`, 'good'); celebrate(); saveGame();
}
function abandon(c: Contract): void {
  if (!confirmed('abandon:' + c.id, `Press Abandon again to give up the ${SPECIES[c.sp].name} contract`)) return;
  G.active = G.active.filter(a => a !== c);
  G.streak = Math.max(0, G.streak - 1);                 // a step back, never a reset
  track('contract_abandoned', { species: SPECIES[c.sp].id, fish: c.n, had: have(c.sp) });
  sfx('select'); toast(`You gave up the contract for ${c.toName}`); saveGame();
}
/** Whether a contract's fish fit in the hold alongside the fish the active contracts ask for. */
const fits = (c: Contract): boolean => G.active.reduce((a, o) => a + o.n, 0) + c.n <= cap();
function take(p: Port, c: Contract): void {
  if (G.active.length >= contractSlots()) { toast(`You can only have ${contractSlots()} contracts at once`, 'bad'); sfx('deny'); return; }
  if (!fits(c)) { toast(`Your hold has no room for ${c.n} more contract fish. Deliver or abandon a contract first`, 'bad'); sfx('deny'); return; }
  G.active.push(c);
  track('contract_taken', { species: SPECIES[c.sp].id, fish: c.n, reward_bucket: bucket(contractPay(c)), same_port: c.to === p.id });
  G.offers[p.id] = G.offers[p.id].filter(o => o !== c);
  G.offers[p.id].push(makeOffer(p));
  sfx('select'); toast(`Contract taken: bring ${c.n} ${SPECIES[c.sp].name} to ${c.toName}`); saveGame();
}

// ---------- rows ----------
/** The contracts section of the market: the dock hand, contracts to deliver or give up here, and today's offers. */
export function contractItems(p: Port, items: Rows): void {
  const g = dockGrade(p.id), d = G.docks[p.id] ?? 0, next = GRADES[g];
  items.push({
    kind: 'note', icon: 'anchor', label: `${dockHand(p)}, dock hand · Grade ${ROMAN[g - 1]}`, pips: [g, 5], ok: true, act: () => {},
    sub: `${next !== undefined ? `${next - d} more ${next - d === 1 ? 'delivery' : 'deliveries'} here for Grade ${ROMAN[g]}: ${GRADE_GIFT[g].toLowerCase()}` : 'Your best friend on the coast'}`
      + `${G.streak ? `. Delivery streak ${G.streak}: +${G.streak * 5}%` : ''}`,
    right: `+${Math.round((gradeBonus(p.id) + streakBonus()) * 100)}%`,
  });
  for (const c of G.active) {
    const n = have(c.sp), name = SPECIES[c.sp].name, pay = money(contractPay(c));
    if (c.to === p.id) items.push({
      kind: 'deliver', fish: c.sp, label: `Deliver ${c.n} ${name}`, sub: `You have ${n} of ${c.n}`, right: '+' + pay, ok: true,
      why: n >= c.n ? '' : c.n > cap() ? `Your hold only fits ${cap()} fish, so you can't carry them all` : `Catch ${c.n - n} more ${name}`,
      ...(n >= c.n ? { action: 'Deliver', act: () => deliver(c) } : { action: 'Abandon', act: () => abandon(c) }),
      what: n >= c.n ? '' : `Bring ${c.n} ${name} here to earn ${pay}. If you abandon it, you lose nothing, and the fish it kept are free to sell.`,
    });
  }
  for (const c of G.active) {                             // contracts for other ports can be given up here
    const n = have(c.sp), name = SPECIES[c.sp].name;
    if (c.to !== p.id) items.push({
      kind: 'contract', fish: c.sp, label: `${c.n} ${name} for ${c.toName}`, sub: `You have ${Math.min(n, c.n)} of ${c.n}`, right: 'Taken', ok: true,
      action: 'Abandon', act: () => abandon(c),
      what: `Bring ${c.n} ${name} to ${c.toName} to earn ${money(contractPay(c))}. If you abandon it, you lose nothing and can take another contract.`,
    });
  }
  for (const c of offersAt(p)) {
    const full = G.active.length >= contractSlots(), room = fits(c), name = SPECIES[c.sp].name, need = catchNeed(c.sp);
    items.push({
      kind: 'take', fish: c.sp, label: `${c.bulk ? 'Big order: ' : ''}${c.n} ${name}`, sub: `Bring them to ${c.toName}`, right: money(contractPay(c)), ok: !full && room,
      why: full ? `You already have ${contractSlots()} contracts, the most you can take. A Quartermaster (Outfitter tab) lets you take more` : room ? '' : `Your hold has no room for these and your other contracts`,
      action: 'Take contract', act: () => take(p, c),
      what: `Catch ${c.n} ${name} (${SPECIES[c.sp].where.toLowerCase()}) and bring them to ${c.toName} to earn ${money(contractPay(c))}.`
        + `${need ? ` Landing them ${need}.` : ''} "Sell all" will keep the ${name} you need for it. You have ${G.active.length} of ${contractSlots()} contracts.`,
    });
  }
}
