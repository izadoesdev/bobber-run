// Ports: the market, outfitter, shipyard, fleet office, ferry and Alderhaven's harbour projects,
// plus contracts, the inn, harbourmaster gifts, docking and the port menu.
import { homePort, poisNear } from '../world';
import { SPECIES, SP, BOATS, UPGRADES, UPGRADE_KEYS, UP_CATS, PAINTS, SUPPLIES, BAIT_KINDS, PROJECTS, FLEET_PER_MIN, FLEET_HOLD_MIN } from '../econ';
import { sfx } from '../audio';
import { NET, netGive } from '../net';
import { track, bucket } from '../analytics';
import { CREW_RANGE, ONLINE, crewBonus } from '../online';
import { BOAT_MODELS } from '../models';
import type { BaitKind, BoatDef, BoatId, Contract, Fish, NeedStatus, Paint, Point, Port, PortItem, PortRow, Project, ProjectNeed, UpgradeKey } from '../types';
import { G, hit } from './state';
import { boatDef, boatStats, cap, contractSlots, DAYLEN, dayFrac, dayNum, fishValue, hpMax, projDone } from './rules';
import { addCoins, celebrate, markBought, toast, tooPoor } from './feedback';
import { placeAtPort, portById, saveGame } from './save';

// ---------- the market ----------
/** Price multiplier for a species at a port, lowered by recent sales there (`extra` = fish sold ahead in this batch). */
export function priceAt(p: Port, spIdx: number, extra = 0): number {
  const s = (G.sat[p.id]?.[spIdx] || 0) + extra;
  return p.mult[spIdx] * Math.max(0.5, 1 - s * 0.07);
}
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
/**
 * Fish the next harbour project asks for (particular species, trophies or one of each kind).
 * "Any fish" needs are not held back, or an early rowboat could never sell anything.
 */
function harbourFish(exclude: Set<Fish>): Set<Fish> {
  const pr = nextProject(), keep = new Set<Fish>();
  if (!pr || 'any' in pr.need) return keep;
  for (const f of needStatus(pr.need).pick) if (!exclude.has(f)) keep.add(f);
  return keep;
}
/** Everything "Sell all" leaves in the hold, and why. */
function reserved(): { all: Set<Fish>; contracts: number; harbour: number } {
  const c = contractFish(), h = harbourFish(c);
  return { all: new Set([...c, ...h]), contracts: c.size, harbour: h.size };
}
const CONFIRM_S = 4;
/** Asks once, then acts on a second press within a few seconds. */
function confirmed(what: string, ask: string): boolean {
  if (G.confirm && G.confirm.what === what && G.t - G.confirm.t < CONFIRM_S) { G.confirm = null; return true; }
  G.confirm = { what, t: G.t }; toast(ask, 'bad'); sfx('deny');
  return false;
}
/** Other players' boats within crew range of a point. */
export const sailorsNear = (x: number, y: number): number => ONLINE.sailors.filter(s => Math.hypot(s.x - x, s.y - y) < CREW_RANGE).length;
/** Everything a sale is multiplied by besides the port's price: the cook's smoking and the crew bonus for sailors nearby. */
export const saleBonus = (): { cook: number; crew: number } => ({ cook: 0.1 * G.up.cook, crew: crewBonus(G.boat.x, G.boat.y) });
/** What "Sell all" pays. With `all`, fish kept back for contracts and the harbour are sold too. */
export function saleValue(p: Port, all = false): { tot: number; n: number; kept: number; harbour: number } {
  const r = reserved(), keep = all ? new Set<Fish>() : r.all, sold: Record<number, number> = {}, b = saleBonus(), mul = (1 + b.cook) * (1 + b.crew);
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
function sell(p: Port): void {
  let all = false, { tot, n } = saleValue(p);
  if (stuck(n)) {
    if (!confirmed('sell-kept', 'Every fish is kept for a contract or the harbour. Press Sell all again to sell them anyway')) return;
    all = true; ({ tot, n } = saleValue(p, true));
  }
  if (!n) { sfx('deny'); return; }
  const keep = all ? new Set<Fish>() : reserved().all, sat = G.sat[p.id] || (G.sat[p.id] = {});
  const legend = G.hold.find(f => !keep.has(f) && SPECIES[f.sp].legend);
  if (legend && !confirmed('sell-legend', `Your hold has ${SPECIES[legend.sp].name}, a legend. Press Sell all again to sell it`)) return;
  for (const f of G.hold) if (!keep.has(f)) sat[f.sp] = (sat[f.sp] || 0) + 1;
  G.hold = G.hold.filter(f => keep.has(f));
  addCoins(tot); G.stats.sold++;
  track('catch_sold', { fish: n, value_bucket: bucket(tot), port: p.name, sold_kept: all });
  sfx('coin'); setTimeout(() => sfx('coin', 0.7, 1.3), 90);
  toast(`Sold ${n} fish for $${tot}`, 'good'); saveGame();
}
const REPAIR_PER_HP = 0.3;
const repairCost = (): number => Math.ceil((hpMax() - G.boat.hp) * REPAIR_PER_HP);
function repair(): void {
  const m = hpMax(), miss = m - G.boat.hp;
  if (miss <= 0 || G.coins <= 0) { sfx('deny'); return; }
  const pay = Math.min(Math.ceil(miss * REPAIR_PER_HP), G.coins);   // short of coin: patch what you can afford
  addCoins(-pay);
  G.boat.hp = Math.min(m, G.boat.hp + Math.ceil(pay / REPAIR_PER_HP));
  track('hull_repaired', { cost_bucket: bucket(pay), full: G.boat.hp >= m });
  sfx('select'); toast(G.boat.hp >= m ? 'Hull repaired' : 'Patched what you could afford'); saveGame();
}

// ---------- outfitter and shipyard ----------
function buy(k: UpgradeKey): void {
  const lvl = G.up[k], u = UPGRADES[k];
  if (lvl >= u.costs.length) { sfx('deny'); return; }
  const cost = u.costs[lvl];
  if (G.coins < cost) { tooPoor(cost); sfx('deny'); return; }
  const before = hpMax();
  addCoins(-cost); G.up[k]++; G.stats.upgrades++;
  if (k === 'hull') G.boat.hp += hpMax() - before;   // new plating comes fully sound
  track('upgrade_bought', { upgrade: k, level: G.up[k], cost });
  sfx('levelup'); toast(`${u.name(boatDef())} upgraded to level ${G.up[k] + 1}`, 'good'); celebrate(); markBought(k); saveGame();
}
export function buySupply(kind: BaitKind): void {
  const it = SUPPLIES[kind];
  if (G.coins < it.cost) { tooPoor(it.cost); sfx('deny'); return; }
  addCoins(-it.cost);
  G.bait[kind] = (G.bait[kind] || 0) + it.n;
  if (kind !== 'chum') G.baitSel = kind;
  track('supply_bought', { supply: kind, cost: it.cost });
  sfx('select'); toast(`+${it.n} ${it.name.toLowerCase()}`); markBought(kind); saveGame();
}
function buyPaint(pt: Paint): void {
  if (G.paints.includes(pt.id)) {
    if (G.paint === pt.id) { sfx('deny'); return; }
    G.paint = pt.id;
    sfx('select'); toast(`Painted ${pt.name.toLowerCase()}`); markBought(pt.id); saveGame();
    return;
  }
  if (G.coins < pt.cost) { tooPoor(pt.cost); sfx('deny'); return; }
  addCoins(-pt.cost); G.paints.push(pt.id); G.paint = pt.id;
  track('paint_bought', { paint: pt.id, cost: pt.cost });
  sfx('levelup'); toast(`Fresh coat of ${pt.name.toLowerCase()}`, 'good'); celebrate(); markBought(pt.id); saveGame();
}
function buyBoat(bd: BoatDef): void {
  if (G.owned.includes(bd.id)) {
    if (G.boatId === bd.id) { sfx('deny'); return; }
    switchBoat(bd);
    track('boat_switched', { boat: bd.id });
    toast(`Now sailing the ${bd.name}`); sfx('select'); markBought(bd.id); saveGame();
    return;
  }
  if (G.coins < bd.cost) { tooPoor(bd.cost); sfx('deny'); return; }
  addCoins(-bd.cost); G.owned.push(bd.id); switchBoat(bd);
  track('boat_bought', { boat: bd.id, cost: bd.cost });
  sfx('fanfare'); toast(`You bought the ${bd.name}!`, 'good'); celebrate(); markBought(bd.id); saveGame();
}
/** Change boats, keeping the hull at least as healthy (as a fraction) and dropping fish that no longer fit. */
function switchBoat(bd: BoatDef): void {
  const health = G.boat.hp / hpMax();
  G.boatId = bd.id;
  G.boat.hp = Math.round(hpMax() * Math.min(health, 1));   // keep the same share of hull; switching is not a free repair
  while (G.hold.length > cap()) G.hold.pop();
}

// ---------- contracts ----------
const chartedPorts = (except: string): Port[] => [...G.found].filter(id => id.startsWith('port:') && id !== except).map(portById);
function makeOffer(p: Port): Contract {
  const ports = chartedPorts(p.id);
  const dest = ports.length ? ports[Math.floor(Math.random() * ports.length)] : p;
  // only fish you can already catch, and never legends
  const cands = SPECIES.filter(s => s.w > 0 && s.rod <= G.up.rod && !s.legend);
  let total = 0;
  for (const s of cands) total += s.w;
  let v = Math.random() * total, sp = cands[0];
  for (const s of cands) { v -= s.w; if (v <= 0) { sp = s; break; } }
  const n = Math.min(cap(), sp.base < 12 ? 3 + Math.floor(Math.random() * 3) : sp.base < 40 ? 2 + Math.floor(Math.random() * 2) : 1);   // never more than the hold carries
  const dist = Math.hypot(dest.x - p.x, dest.y - p.y);
  return { id: Math.random().toString(36).slice(2, 8), from: p.id, to: dest.id, toName: dest.name, sp: SP[sp.id], n, reward: Math.round(n * sp.base * (1.7 + Math.random() * 0.6) + dist / 20) };
}
function offersAt(p: Port): Contract[] {
  return G.offers[p.id] || (G.offers[p.id] = [makeOffer(p), makeOffer(p)]);
}
/** How many fish of a species are in the hold. */
export const have = (sp: number): number => G.hold.filter(f => f.sp === sp).length;
const contractPay = (c: Contract): number => Math.round(c.reward * (1 + 0.15 * G.up.quarter));
function deliver(c: Contract): void {
  let n = c.n;
  G.hold = G.hold.filter(f => !(f.sp === c.sp && n-- > 0));
  const pay = contractPay(c);
  G.active = G.active.filter(a => a !== c);
  addCoins(pay); G.stats.contracts++;
  track('contract_completed', { species: SPECIES[c.sp].id, fish: c.n, reward_bucket: bucket(pay) });
  sfx('fanfare'); toast(`Contract done  +$${pay}`, 'good'); celebrate(); saveGame();
}
function abandon(c: Contract): void {
  if (!confirmed('abandon:' + c.id, `Press Abandon again to give up the ${SPECIES[c.sp].name} contract`)) return;
  G.active = G.active.filter(a => a !== c);
  track('contract_abandoned', { species: SPECIES[c.sp].id, fish: c.n, had: have(c.sp) });
  sfx('select'); toast(`You gave up the contract for ${c.toName}`); saveGame();
}
/** Fish the active contracts ask for, all together. */
const promised = (): number => G.active.reduce((a, c) => a + c.n, 0);
const fits = (c: Contract): boolean => promised() + c.n <= cap();
function take(p: Port, c: Contract): void {
  if (G.active.length >= contractSlots()) { toast(`You can hold ${contractSlots()} contracts at once`, 'bad'); sfx('deny'); return; }
  if (!fits(c)) { toast(`Your hold can't carry ${c.n} more fish for contracts. Finish or abandon one first`, 'bad'); sfx('deny'); return; }
  G.active.push(c);
  track('contract_taken', { species: SPECIES[c.sp].id, fish: c.n, reward_bucket: bucket(contractPay(c)), same_port: c.to === p.id });
  G.offers[p.id] = G.offers[p.id].filter(o => o !== c);
  G.offers[p.id].push(makeOffer(p));
  sfx('select'); toast(`Contract taken: ${c.n} ${SPECIES[c.sp].name} to ${c.toName}`); saveGame();
}

// ---------- ferry ----------
export const ferryCost = (a: Point, b: Point): number => 8 + Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 28);
function ferry(from: Port, to: Port): void {
  const cost = ferryCost(from, to);
  if (G.coins < cost) { tooPoor(cost); sfx('deny'); return; }
  addCoins(-cost);
  track('ferry_used', { cost_bucket: bucket(cost) });
  G.clock += Math.hypot(from.x - to.x, from.y - to.y) / 6;     // the trip still takes time
  placeAtPort(to);
  G.menu.port = to; G.lastPort = to.id; G.menu.tab = 0; G.menu.sel = 1;
  sfx('dock'); toast(`Ferried to ${to.name}`); saveGame();
}

// ---------- restoring Alderhaven (the long goal) ----------
/** What a project still needs, and which fish in the hold would be donated (cheapest first). */
export function needStatus(nd: ProjectNeed): NeedStatus {
  const cheap = [...G.hold].sort((a, b) => fishValue(a) - fishValue(b));
  if ('any' in nd) {
    const pick = cheap.slice(0, nd.any);
    return { have: pick.length, want: nd.any, label: `${nd.any} fish of any kind`, pick };
  }
  if ('kinds' in nd) {
    const bySpecies = new Map<number, Fish>();
    for (const f of cheap) if (!bySpecies.has(f.sp)) bySpecies.set(f.sp, f);
    const pick = [...bySpecies.values()].slice(0, nd.kinds);
    return { have: pick.length, want: nd.kinds, label: `${nd.kinds} different species`, pick };
  }
  if ('trophy' in nd) {
    const pick = cheap.filter(f => f.trophy).slice(0, nd.trophy);
    return { have: pick.length, want: nd.trophy, label: `${nd.trophy} trophy fish`, pick };
  }
  const i = SP[nd.sp], name = SPECIES[i].name, pick = cheap.filter(f => f.sp === i).slice(0, nd.n);
  return { have: pick.length, want: nd.n, label: nd.n === 1 && name.startsWith('The ') ? name : `${nd.n} ${name}`, pick, sp: i };
}
export const nextProject = (): Project | null => PROJECTS.find(pr => !projDone(pr.id)) || null;
function fundProject(pr: Project): void {
  const st = needStatus(pr.need);
  if (st.have < st.want) { toast(`Bring ${st.label} for this project`, 'bad'); sfx('deny'); return; }
  if (G.coins < pr.cost) { tooPoor(pr.cost); sfx('deny'); return; }
  const gone = new Set(st.pick);
  G.hold = G.hold.filter(f => !gone.has(f));
  addCoins(-pr.cost); G.projects.push(pr.id);
  track('project_funded', { project: pr.id, done: G.projects.length });
  sfx('fanfare'); celebrate(); toast(`${pr.name}: done! ${pr.gives}`, 'good'); markBought(pr.id);
  if (pr.id === 'lights') {                       // every lighthouse near home goes on the chart
    const hp = homePort();
    for (const q of poisNear(hp.x, hp.y, 1800)) if (q.type === 'light') G.found.add(q.id);
  }
  if (pr.id === 'grand') {
    G.finale = true;
    if (G.story?.i !== 15) G.mode = 'finale';    // with the story running, Nell's homecoming plays first
  }
  saveGame();
}

// ---------- the fleet office: spare boats fish on their own ----------
// A fleet boat earns a fixed, modest rate (well under what you make fishing with your best boat), only while you are
// at sea, and holds at most FLEET_HOLD_MIN minutes of catch until collected: idling in port or in a menu earns nothing.
export const fleetPerMin = (bd: BoatDef): number => FLEET_PER_MIN[bd.id];
const fleetCap = (bd: BoatDef): number => fleetPerMin(bd) * FLEET_HOLD_MIN;
export const fleetTotal = (): number => Object.values(G.fleet).reduce((a, f) => a + Math.floor(f.earned), 0);
export function updateFleet(dt: number): void {
  if (G.mode !== 'play') return;
  for (const [id, f] of Object.entries(G.fleet)) {
    const bd = BOATS.find(b => b.id === id);
    if (bd) f.earned = Math.min(fleetCap(bd), f.earned + fleetPerMin(bd) / 60 * dt);
  }
}
function collectFleet(): void {
  const n = fleetTotal();
  if (!n) { sfx('deny'); return; }
  for (const f of Object.values(G.fleet)) f.earned -= Math.floor(f.earned);   // keep the fractions
  addCoins(n); sfx('coin'); toast(`Your fleet brought in $${n}`, 'good'); saveGame();
}
function toggleFleet(p: Port, bd: BoatDef): void {
  const out = G.fleet[bd.id];
  if (out) {
    const n = Math.floor(out.earned);
    if (n) addCoins(n);
    delete G.fleet[bd.id];
    toast(`The ${bd.name} is back at the quay${n ? `, with $${n}` : ''}`);
    track('fleet_changed', { boat: bd.id, action: 'recalled', earned_bucket: bucket(n) });
  } else {
    G.fleet[bd.id] = { port: p.id, portName: p.name, earned: 0 };
    toast(`The ${bd.name} sets out to fish from ${p.name}`, 'good');
    track('fleet_changed', { boat: bd.id, action: 'sent', earned_bucket: '0' });
  }
  sfx('select'); saveGame();
}

// ---------- the inn ----------
const isDaytime = (c: number): boolean => c > 0.04 && c < 0.58;
/** Skip ahead to dusk, or to morning. */
export function rest(): void {
  const c = dayFrac(), base = Math.floor(G.clock / DAYLEN) * DAYLEN, day = isDaytime(c);
  G.clock = day ? base + 0.6 * DAYLEN : base + (c >= 0.58 ? DAYLEN : 0) + 0.06 * DAYLEN;
  sfx('select'); toast(day ? 'You rest at the inn until dusk' : 'You sleep at the inn until morning'); saveGame();
}

// ---------- the port menu ----------
// One row of tabs; each tab is a single list grouped under section headers.
// Every item says what it costs, whether it can be bought, and if not, why.
export type PortTab = 'MARKET' | 'OUTFITTER' | 'SHIPYARD' | 'FLEET' | 'FERRY' | 'HARBOUR';
export function portTabs(p: Port): PortTab[] {
  return ['MARKET', 'OUTFITTER', ...(p.shipyard ? ['SHIPYARD' as const] : []), ...(projDone('market') ? ['FLEET' as const] : []),
    'FERRY', ...(p.id === homePort().id ? ['HARBOUR' as const] : [])];
}
const thousands = new Intl.NumberFormat('en-US');   // toLocaleString builds a formatter per call, and rows redraw every frame
const cash = (n: number): string => '$' + thousands.format(Math.round(n));
const short = (cost: number): string => G.coins < cost ? `You need ${cash(cost - G.coins)} more` : '';
const deny = (): void => sfx('deny');

type Rows = PortItem[];
const header = (items: Rows, label: string): void => { items.push({ kind: 'header', label }); };

function marketItems(p: Port, items: Rows): void {
  const sv = saleValue(p), crew = saleBonus().crew;
  header(items, 'SELL');
  items.push({
    kind: 'sell', icon: 'coin', label: 'Sell your catch',
    sub: sv.n ? `${sv.n} fish${sv.kept ? `, ${sv.kept} kept for contracts` : ''}${sv.harbour ? `, ${sv.harbour} kept for the harbour` : ''}${crew ? `, crew bonus +${Math.round(crew * 100)}%` : ''}` : 'Your hold is empty',
    right: sv.n ? '+' + cash(sv.tot) : '', ok: sv.n > 0 || stuck(sv.n),
    why: sv.n ? '' : stuck(sv.n) ? 'Your hold is full of fish kept back. Press Sell all twice to sell them anyway' : sv.kept || sv.harbour ? 'Every fish is kept back for a contract or the harbour' : 'Your hold is empty. Go fishing!',
    action: 'Sell all', act: () => sell(p),
  });
  header(items, 'CONTRACTS');
  for (const c of G.active) if (c.to === p.id) {
    const n = have(c.sp), name = SPECIES[c.sp].name;
    items.push({
      kind: 'deliver', c, fish: c.sp, label: `Deliver ${c.n} ${name}`, sub: `You have ${n} of ${c.n}`, right: '+' + cash(contractPay(c)), ok: true,
      why: n >= c.n ? '' : c.n > cap() ? `Your hold carries only ${cap()} fish` : `Catch ${c.n - n} more ${name}`,
      ...(n >= c.n ? { action: 'Deliver', act: () => deliver(c) } : { action: 'Abandon', act: () => abandon(c) }),
      what: n >= c.n ? '' : `Deliver ${c.n} ${name} here for ${cash(contractPay(c))}. Abandoning it frees the slot and the fish it keeps back; nothing else is lost.`,
    });
  }
  for (const c of G.active) if (c.to !== p.id) {           // contracts for other ports can be given up here
    const name = SPECIES[c.sp].name, n = have(c.sp);
    items.push({
      kind: 'contract', c, fish: c.sp, label: `${c.n} ${name} for ${c.toName}`, sub: `You have ${Math.min(n, c.n)} of ${c.n}`, right: 'Taken', ok: true,
      action: 'Abandon', act: () => abandon(c),
      what: `Deliver ${c.n} ${name} to ${c.toName} for ${cash(contractPay(c))}. Abandoning it frees the slot; nothing else is lost.`,
    });
  }
  for (const c of offersAt(p)) {
    const full = G.active.length >= contractSlots(), room = fits(c), name = SPECIES[c.sp].name, weak = SPECIES[c.sp].rod > G.up.rod;
    items.push({
      kind: 'take', c, fish: c.sp, label: `${c.n} ${name}`, sub: `Bring them to ${c.toName}`, right: cash(contractPay(c)), ok: !full && room,
      why: full ? `You already hold ${contractSlots()} contracts. The Quartermaster adds more` : room ? '' : `Your hold can't carry these alongside your other contracts`,
      action: 'Take contract', act: () => take(p, c),
      what: `Catch ${c.n} ${name} (${SPECIES[c.sp].where.toLowerCase()}) and bring them to ${c.toName} for ${cash(contractPay(c))}.`
        + `${weak ? ` You need a level ${SPECIES[c.sp].rod + 1} rod for them.` : ''} The best ${name} in your hold are kept back from sale. You hold ${G.active.length} of ${contractSlots()} contracts.`,
    });
  }
  header(items, 'INN');
  const day = isDaytime(dayFrac());
  items.push({
    kind: 'rest', icon: day ? 'lantern' : 'sun', label: day ? 'Rest until dusk' : 'Sleep until morning', sub: day ? 'Night fish come out after dark' : 'Day fish return at dawn',
    right: 'Free', ok: true, action: 'Rest', act: rest,
    what: day ? 'Skip ahead to dusk. Squid, herring, crabs and other night fish only bite after dark.' : 'Sleep until first light, when the day fish return.',
  });
  header(items, 'SUPPLIES');
  const miss = hpMax() - G.boat.hp, rc = repairCost();
  items.push({
    kind: 'repair', icon: 'repair', label: 'Repair hull', sub: `${G.boat.hp} of ${hpMax()} hull`, cost: rc, right: miss > 0 ? cash(rc) : 'Sound', ok: miss > 0 && G.coins > 0,
    why: miss <= 0 ? 'Your hull is in good shape' : G.coins <= 0 ? 'You have no coins' : '', action: 'Repair', act: repair,
    what: `Patches every missing hull point for ${cash(REPAIR_PER_HP * 100)} per 100 points. Short on coin? You get a partial repair. At 0 hull you sink and are towed home.`,
  });
  for (const k of BAIT_KINDS) {
    const it = SUPPLIES[k];
    items.push({
      kind: 'supply', key: k, icon: k, label: `${it.name} ×${it.n}`, sub: `You have ${G.bait[k] || 0}`, cost: it.cost, right: cash(it.cost), ok: G.coins >= it.cost,
      why: short(it.cost), action: 'Buy', act: () => buySupply(k), what: it.what + (k === 'chum' ? '' : '. Press B at sea to switch bait'), repeat: true,
    });
  }
}

const DRYDOCK = PROJECTS.find(q => q.id === 'drydock')!;
function outfitterItems(items: Rows): void {
  for (const cat of UP_CATS) {
    header(items, cat);
    for (const k of UPGRADE_KEYS) {
      const u = UPGRADES[k];
      if (u.cat !== cat) continue;
      const lvl = G.up[k], max = u.costs.length, cost = u.costs[lvl], maxed = lvl >= max;
      const locked = !!u.req && !projDone(u.req);
      items.push({
        kind: 'upgrade', key: k, icon: k, label: u.name(boatDef()), cost: !maxed && !locked ? cost : null, right: locked ? 'Dry dock' : maxed ? 'Max' : cash(cost),
        ok: !locked && !maxed && G.coins >= cost, why: locked ? `${DRYDOCK.name} first (Alderhaven, Harbour tab)` : maxed ? 'Fully upgraded' : short(cost),
        action: 'Buy', act: () => buy(k), what: maxed ? null : u.lv[lvl], now: lvl > 0 ? u.lv[lvl - 1] : 'Not fitted yet', pips: [lvl, max],
      });
    }
  }
}

const pctOf = (n: number): string => Math.round(n * 100) + '%';
function boatRow(p: Port, bd: BoatDef): PortRow {
  const own = G.owned.includes(bd.id), on = G.boatId === bd.id, st = boatStats(bd);
  const base = { kind: 'boat', key: bd.id, boat: bd, label: bd.name, sub: `${st.hold} fish, ${pctOf(st.speed)} speed, ${st.hp} hull` } as const;
  if (!own && bd.req && !projDone(bd.req)) {
    const pr = PROJECTS.find(q => q.id === bd.req);
    return { ...base, sub: `Unlocked by ${pr?.name} (Harbour tab)`, cost: null, right: 'Locked', ok: false, why: `${pr?.name} first (Alderhaven, Harbour tab)`, action: 'Buy', act: deny };
  }
  const out = G.fleet[bd.id];
  if (out) return { ...base, sub: `Fishing out of ${out.portName}`, cost: null, right: 'At sea', ok: true, why: '', action: 'Recall and sail', act: () => { toggleFleet(p, bd); buyBoat(bd); } };
  return {
    ...base, cost: own ? null : bd.cost, right: on ? 'Sailing' : own ? 'Owned' : cash(bd.cost), ok: own ? !on : G.coins >= bd.cost,
    why: on ? 'You are sailing this boat' : own ? '' : short(bd.cost), action: own ? 'Sail this boat' : 'Buy', act: () => buyBoat(bd),
  };
}
function shipyardItems(p: Port, items: Rows): void {
  header(items, 'BOATS');
  for (const bd of BOATS) if (BOAT_MODELS[bd.id]) items.push(boatRow(p, bd));   // ships whose model isn't built yet are hidden
  header(items, 'PAINT');
  for (const pt of PAINTS) {
    const own = G.paints.includes(pt.id), on = G.paint === pt.id;
    items.push({
      kind: 'paint', key: pt.id, pt, paint: pt.id, boat: boatDef(), label: pt.name, sub: own ? 'Owned' : 'Looks only', cost: own ? null : pt.cost,
      right: on ? 'On' : own ? 'Owned' : cash(pt.cost), ok: own ? !on : G.coins >= pt.cost,
      why: on ? 'Your boat wears this paint' : own ? '' : short(pt.cost), action: own ? 'Apply' : 'Buy', act: () => buyPaint(pt),
      what: 'Looks only: paint changes no stats. It goes on whichever boat you sail, and paints you own swap for free.',
    });
  }
}

function fleetItems(p: Port, items: Rows): void {
  header(items, 'EARNINGS');
  const n = fleetTotal(), out = Object.keys(G.fleet).length;
  const perMin = Object.keys(G.fleet).reduce((a, id) => a + FLEET_PER_MIN[id as BoatId], 0);
  items.push({
    kind: 'collect', icon: 'coin', label: 'Collect fleet earnings', sub: out ? `${out} boat${out > 1 ? 's' : ''} out, ${cash(perMin)} a minute in all` : 'No boats out yet', right: n ? '+' + cash(n) : '',
    ok: n > 0, why: out ? 'Nothing to collect yet. Fleet boats only earn while you are at sea' : 'Send a spare boat out below', action: 'Collect', act: collectFleet,
    what: `Boats you own but are not sailing can fish for you. Each earns a set amount every minute you spend at sea (not in port or menus) and holds up to ${FLEET_HOLD_MIN} minutes of catch until you collect it at any port.`,
  });
  header(items, 'BOATS');
  const spare = BOATS.filter(bd => G.owned.includes(bd.id) && bd.id !== G.boatId);
  if (!spare.length) items.push({ kind: 'note', icon: 'hull', label: 'No spare boats', sub: 'Buy another boat at a shipyard, then send your old one out', ok: false, why: 'Every boat you own is in use', act: deny });
  for (const bd of spare) {
    const f = G.fleet[bd.id], rate = fleetPerMin(bd);
    items.push({
      kind: 'fleet', key: bd.id, boat: bd, label: bd.name, sub: f ? `Fishing out of ${f.portName}, ${cash(Math.floor(f.earned))} aboard` : `Would earn ${cash(rate)} a minute`,
      right: f ? 'At sea' : 'In port', ok: true, action: f ? 'Recall' : 'Send out', act: () => toggleFleet(p, bd),
      what: f
        ? `Recalling brings the ${bd.name} back to the quay with what it has aboard, so you can sail it again.`
        : `The ${bd.name} fishes on its own for ${cash(rate)} every minute you are at sea, holding up to ${cash(fleetCap(bd))} (${FLEET_HOLD_MIN} minutes) until you collect.`,
    });
  }
}

const FUND_DAILY = 50_000;   // the server's daily cap per sailor (convex/limits.ts)
let giving = false;          // one gift in flight at a time, so a held button can't spend twice
async function giveToFund(amt: number): Promise<void> {
  if (giving || G.coins < amt || !NET.authed || G.cheated) { sfx('deny'); return; }
  giving = true;
  addCoins(-amt); sfx('coin');
  const r = await netGive(amt, G.cheated);
  giving = false;
  if (r.ok) { toast(`You gave ${cash(amt)} to the coastwide fund. Thank you!`, 'good'); track('fund_given', { amount_bucket: bucket(amt) }); }
  else { addCoins(amt); toast(`${r.why}. Your coins are back`, 'bad'); }
  saveGame();
}
function harbourItems(items: Rows): void {
  header(items, 'RESTORE ALDERHAVEN');
  const next = nextProject();
  for (const pr of PROJECTS) {
    const done = projDone(pr.id), cur = next === pr, st = needStatus(pr.need);
    const why = done ? 'Finished' : !cur ? `Finish "${next?.name}" first` : st.have < st.want ? `Bring ${st.label} (you have ${st.have})` : short(pr.cost);
    items.push({
      kind: 'project', key: pr.id, pr, st, icon: done ? 'star' : cur ? 'repair' : 'map', label: pr.name, sub: done ? pr.gives : `${cash(pr.cost)} and ${st.label}`,
      cost: done ? null : pr.cost, right: done ? 'Done' : cur ? `${st.have}/${st.want}` : 'Later', ok: !done && cur && st.have >= st.want && G.coins >= pr.cost,
      why, action: 'Fund project', act: () => cur && !done ? fundProject(pr) : deny(), what: pr.what,
    });
  }
  if (!NET.on) return;
  header(items, 'COASTWIDE FUND');
  const f = NET.fund;
  for (const amt of [100, 1000, 10000]) items.push({
    kind: 'fund', key: 'fund' + amt, icon: 'coin', label: `Give ${cash(amt)} to the coastwide fund`,
    sub: f ? `${cash(f.total)} of ${cash(f.goal)} from ${f.givers} sailor${f.givers === 1 ? '' : 's'}` : NET.authed ? 'Loading' : 'Connecting to the coast',
    cost: amt, right: cash(amt), ok: NET.authed && !G.cheated && G.coins >= amt,
    why: G.cheated ? 'Saves that used cheats cannot give to the fund' : !NET.authed ? 'You are offline' : short(amt), action: 'Give', act: () => giveToFund(amt),
    what: `A gift for the whole coast: every sailor on every server fills this fund together, and when it is full everyone celebrates. It buys nothing for you. Each sailor can give up to ${cash(FUND_DAILY)} a day; you have given ${cash(f?.mine || 0)} in all.`,
  });
}

function ferryItems(p: Port, items: Rows): void {
  header(items, 'ROUTES');
  const dist = (q: Port): number => Math.hypot(q.x - p.x, q.y - p.y);
  const ports = chartedPorts(p.id).sort((a, b) => dist(a) - dist(b)).slice(0, 8);
  if (!ports.length) items.push({ kind: 'note', icon: 'map', label: 'No routes yet', sub: 'Chart other ports to open ferry routes', ok: false, why: 'Sail out and discover another port first', act: deny });
  for (const q of ports) {
    const cost = ferryCost(p, q);
    items.push({
      kind: 'ferry', q, icon: 'map', label: q.name, sub: `${Math.round(dist(q) / 10)} m away`, cost, right: cash(cost), ok: G.coins >= cost, why: short(cost),
      action: 'Travel', act: () => ferry(p, q), what: 'Skip the trip. Time still passes while you travel.',
    });
  }
}

/** The rows of the current tab at port `p`. */
export function portItems(p: Port): PortItem[] {
  const tab = portTabs(p)[G.menu.tab] || 'MARKET', items: Rows = [];
  switch (tab) {
    case 'MARKET': marketItems(p, items); break;
    case 'OUTFITTER': outfitterItems(items); break;
    case 'SHIPYARD': shipyardItems(p, items); break;
    case 'FLEET': fleetItems(p, items); break;
    case 'HARBOUR': harbourItems(items); break;
    case 'FERRY': ferryItems(p, items); break;
  }
  return items;
}
export const selectable = (it: PortItem): it is PortRow => it.kind !== 'header';

// ---------- docking ----------
// a small welcome from the harbourmaster, once per port per day: [weight, give]
const GIFTS: [number, () => string][] = [
  [40, () => { G.bait.shrimp = (G.bait.shrimp || 0) + 3; return '3 shrimp bait'; }],
  [25, () => { const n = 10 + Math.floor(Math.random() * 21); addCoins(n); return `$${n} for the trip`; }],
  [15, () => { G.bait.glow = (G.bait.glow || 0) + 1; return 'a glow lure'; }],
  [10, () => { G.bait.chum = (G.bait.chum || 0) + 1; return 'a bucket of chum'; }],
  [10, () => { G.boat.hp = Math.min(hpMax(), G.boat.hp + 20); return 'a quick patch on your hull'; }],
];
const CAT_NAMES = ['Biscuit', 'Pickle', 'Barnacle', 'Mackerel', 'Pip', 'Sardine', 'Captain', 'Mittens'];
function harbourGift(p: Port): void {
  if (!G.pet && G.stats.caught >= 3) {
    G.pet = { name: CAT_NAMES[Math.floor(Math.random() * CAT_NAMES.length)] };
    toast(`A stray cat hops aboard. You name it ${G.pet.name}. Press P to pet`, 'good');
    setTimeout(() => sfx('meow'), 300);
  }
  const day = dayNum();
  if (G.gifts[p.id] === day) return;
  G.gifts[p.id] = day;
  let r = Math.random() * 100;
  const [, give] = GIFTS.find(([w]) => (r -= w) < 0) || GIFTS[0];
  toast(`The harbourmaster gives you ${give()}`, 'good');
}
export function dock(p: Port): void {
  G.mode = 'port';
  G.menu = { tab: 0, sel: 1, port: p };   // opens on Market with "Sell your catch" selected
  G.lastPort = p.id; G.fish = null;
  const b = G.boat;
  b.vx = b.vy = b.w = 0;
  sfx('dock');
  track('port_docked', { port: p.name, home: p.id === homePort().id });
  harbourGift(p);
  if (G.active.some(c => c.to === p.id && have(c.sp) >= c.n)) toast('You can deliver a contract here', 'good');
  saveGame();
}
export function leavePort(): void {
  const p = G.menu.port;
  if (!p) return;
  G.mode = 'play';
  placeAtPort(p);
  const b = G.boat;
  b.vx = Math.cos(b.a) * 6; b.vy = Math.sin(b.a) * 6;   // a gentle push off the dock
  sfx('move');
}

// tabs: Left/Right, Q/E, number keys, shoulder buttons or a click. Up/Down walk the list (headers are skipped).
export function setTab(i: number): void {
  const p = G.menu.port;
  if (!p) return;
  const tabs = portTabs(p);
  G.menu.tab = (i + tabs.length) % tabs.length;
  G.menu.sel = Math.max(0, portItems(p).findIndex(selectable));
  sfx('move');
}
let repeatT = 0;
export function portMenuInput(dt = 1 / 60): void {
  const p = G.menu.port, m = G.menu;
  if (!p) return;
  const tabs = portTabs(p), items = portItems(p);
  for (let k = 1; k <= tabs.length; k++) if (hit(String(k))) return setTab(k - 1);
  if (hit('ArrowLeft', 'a', 'A', 'q', 'Q', 'PageUp')) return setTab(m.tab - 1);
  if (hit('ArrowRight', 'd', 'D', 'e', 'E', 'PageDown')) return setTab(m.tab + 1);
  const cur = items[m.sel];
  if (!cur || !selectable(cur)) m.sel = Math.max(0, items.findIndex(selectable));
  const step = (d: number): void => {
    let i = m.sel;
    for (let n = 0; n < items.length; n++) {
      i = (i + d + items.length) % items.length;
      if (selectable(items[i])) { m.sel = i; sfx('move'); return; }
    }
  };
  if (hit('ArrowUp', 'w', 'W')) step(-1);
  if (hit('ArrowDown', 's', 'S')) step(1);
  const it = items[m.sel];
  if (it && selectable(it) && hit(' ', 'Enter')) { void it.act(); repeatT = -0.45; }
  else if (it && selectable(it) && it.repeat && (G.keys[' '] || G.keys.Enter) && (repeatT += dt) > 0.18) { repeatT = 0; void it.act(); }   // hold to keep buying supplies
  if (hit('Escape', 'Backspace')) leavePort();
}
