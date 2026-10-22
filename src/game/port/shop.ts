// The outfitter (upgrades and supplies) and the shipyard (boats and paint).
import { BOATS, UPGRADES, UPGRADE_KEYS, UP_CATS, PAINTS, SUPPLIES, BAIT_KINDS, PROJECTS } from '../../econ';
import { sfx } from '../../audio';
import { track } from '../../analytics';
import { BOAT_MODELS } from '../../models';
import type { BaitKind, BoatDef, Paint, Port, PortRow, UpgradeKey } from '../../types';
import { G } from '../state';
import { boatDef, boatStats, cap, hpMax, projDone } from '../rules';
import { celebrate, markBought, toast } from '../feedback';
import { saveGame } from '../save';
import { money } from '../../config';
import { deny, header, short, spend, type Rows } from './kit';
import { toggleFleet } from './fleet';
import { COLLECTIONS } from '../mastery';

// ---------- buying ----------
function buy(k: UpgradeKey): void {
  const lvl = G.up[k], u = UPGRADES[k];
  if (lvl >= u.costs.length) { deny(); return; }
  const before = hpMax();
  if (!spend(u.costs[lvl])) return;
  G.up[k]++; G.stats.upgrades++;
  if (k === 'hull') G.boat.hp += hpMax() - before;   // new plating comes fully sound
  track('upgrade_bought', { upgrade: k, level: G.up[k], cost: u.costs[lvl] });
  sfx('levelup'); toast(`${u.name(boatDef())} upgraded to level ${G.up[k] + 1}`, 'good'); celebrate(); markBought(k); saveGame();
}
function buySupply(kind: BaitKind): void {
  const it = SUPPLIES[kind];
  if (!spend(it.cost)) return;
  G.bait[kind] = (G.bait[kind] || 0) + it.n;
  if (kind !== 'chum') G.baitSel = kind;
  track('supply_bought', { supply: kind, cost: it.cost });
  sfx('select'); toast(`Bought ${it.n} ${it.name.toLowerCase()}`); markBought(kind); saveGame();
}
function buyPaint(pt: Paint): void {
  if (G.paints.includes(pt.id)) {
    if (G.paint === pt.id) { deny(); return; }
    G.paint = pt.id;
    sfx('select'); toast(`Your boat is now painted ${pt.name.toLowerCase()}`); markBought(pt.id); saveGame();
    return;
  }
  if (pt.earn || !spend(pt.cost)) { if (pt.earn) deny(); return; }   // earned paints are never for sale
  G.paints.push(pt.id); G.paint = pt.id;
  track('paint_bought', { paint: pt.id, cost: pt.cost });
  sfx('levelup'); toast(`Bought ${pt.name.toLowerCase()} paint`, 'good'); celebrate(); markBought(pt.id); saveGame();
}
function buyBoat(bd: BoatDef): void {
  if (G.owned.includes(bd.id)) {
    if (G.boatId === bd.id) { deny(); return; }
    switchBoat(bd);
    track('boat_switched', { boat: bd.id });
    toast(`Now sailing the ${bd.name}`); sfx('select'); markBought(bd.id); saveGame();
    return;
  }
  if (!spend(bd.cost)) return;
  G.owned.push(bd.id); switchBoat(bd);
  track('boat_bought', { boat: bd.id, cost: bd.cost });
  sfx('fanfare'); toast(`You bought the ${bd.name}!`, 'good'); celebrate(); markBought(bd.id); saveGame();
}
/** Change boats, keeping the same share of hull (switching is not a free repair) and dropping fish that no longer fit. */
function switchBoat(bd: BoatDef): void {
  const health = G.boat.hp / hpMax();
  G.boatId = bd.id;
  G.boat.hp = Math.round(hpMax() * Math.min(health, 1));
  while (G.hold.length > cap()) G.hold.pop();
}

// ---------- rows ----------
export function supplyItems(items: Rows): void {
  for (const k of BAIT_KINDS) {
    const it = SUPPLIES[k];
    items.push({
      kind: 'supply', key: k, icon: k, label: `${it.name} ×${it.n}`, sub: `You have ${G.bait[k] || 0}`, cost: it.cost, right: money(it.cost), ok: G.coins >= it.cost,
      why: short(it.cost), action: 'Buy', act: () => buySupply(k), what: it.what + (k === 'chum' ? '' : '. Press B at sea to switch bait'), repeat: true,
    });
  }
}
const DRYDOCK = PROJECTS.find(q => q.id === 'drydock')!;
export function outfitterItems(items: Rows): void {
  for (const cat of UP_CATS) {
    header(items, cat);
    for (const k of UPGRADE_KEYS) {
      const u = UPGRADES[k];
      if (u.cat !== cat) continue;
      const lvl = G.up[k], max = u.costs.length, cost = u.costs[lvl], maxed = lvl >= max;
      const locked = !!u.req && !projDone(u.req);
      items.push({
        kind: 'upgrade', key: k, icon: k, label: u.name(boatDef()), cost: !maxed && !locked ? cost : null, right: locked ? 'Dry dock' : maxed ? 'Max' : money(cost),
        ok: !locked && !maxed && G.coins >= cost, why: locked ? `Fund "${DRYDOCK.name}" first, in the Harbour tab at Alderhaven` : maxed ? 'Fully upgraded' : short(cost),
        action: 'Buy', act: () => buy(k), what: maxed ? null : u.lv[lvl], pips: [lvl, max],
      });
    }
  }
}
function boatRow(p: Port, bd: BoatDef): PortRow {
  const own = G.owned.includes(bd.id), on = G.boatId === bd.id, st = boatStats(bd);
  const base = { kind: 'boat', key: bd.id, boat: bd, label: bd.name, sub: `${st.hold} fish, ${Math.round(st.speed * 100)}% speed, ${st.hp} hull` } as const;
  if (!own && bd.req && !projDone(bd.req)) {
    const pr = PROJECTS.find(q => q.id === bd.req);
    return { ...base, sub: `Unlocked by the "${pr?.name}" project`, cost: null, right: 'Locked', ok: false, why: `Fund "${pr?.name}" first, in the Harbour tab at Alderhaven`, action: 'Buy', act: deny };
  }
  const out = G.fleet[bd.id];
  if (out) return { ...base, sub: `Fishing for you from ${out.portName}`, cost: null, right: 'At sea', ok: true, why: '', action: 'Recall and sail', act: () => { toggleFleet(p, bd); buyBoat(bd); } };
  return {
    ...base, cost: own ? null : bd.cost, right: on ? 'Sailing' : own ? 'Owned' : money(bd.cost), ok: own ? !on : G.coins >= bd.cost,
    why: on ? 'You are sailing this boat' : own ? '' : short(bd.cost), action: own ? 'Sail this boat' : 'Buy', act: () => buyBoat(bd),
  };
}
export function shipyardItems(p: Port, items: Rows): void {
  header(items, 'BOATS');
  for (const bd of BOATS) if (BOAT_MODELS[bd.id]) items.push(boatRow(p, bd));   // ships whose model isn't built yet are hidden
  header(items, 'PAINT');
  for (const pt of PAINTS) {
    const own = G.paints.includes(pt.id), on = G.paint === pt.id;
    if (pt.earn && !own) {                                   // earned, never sold: the row says how, and how far along you are
      const c = COLLECTIONS.find(k => k.paint === pt.id), prog = c ? `${Math.min(c.have(), c.want)}/${c.want}` : '';
      items.push({ kind: 'paint', key: pt.id, paint: pt.id, boat: boatDef(), label: pt.name, sub: prog ? `Earned, not sold · ${prog}` : 'Earned, not sold', cost: null, right: 'Earn it', ok: false, why: pt.earn, action: 'Buy', act: deny,
        what: `${pt.earn} and this paint is yours. Paint only changes how your boat looks.` });
      continue;
    }
    items.push({
      kind: 'paint', key: pt.id, paint: pt.id, boat: boatDef(), label: pt.name, sub: own ? 'Owned' : 'Looks only', cost: own ? null : pt.cost,
      right: on ? 'On' : own ? 'Owned' : money(pt.cost), ok: own ? !on : G.coins >= pt.cost,
      why: on ? 'Your boat already has this paint' : own ? '' : short(pt.cost), action: own ? 'Apply' : 'Buy', act: () => buyPaint(pt),
      what: 'Paint only changes how your boat looks. It goes on whichever boat you sail, and you can switch between paints you own for free.',
    });
  }
}
