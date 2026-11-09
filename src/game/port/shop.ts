// The outfitter (upgrades and supplies) and the shipyard (boats and paint).
import { AMMO, SHOTS, type BoughtShot } from '../arms';
import { BOATS, BOAT_PARTS, UPGRADES, UPGRADE_KEYS, UP_CATS, PAINTS, SUPPLIES, BAIT_KINDS, PROJECTS } from '../../econ';
import { sfx } from '../../audio';
import { track } from '../../analytics';
import { BOAT_MODELS } from '../../models';
import type { BaitKind, BoatDef, Paint, Port, PortRow, UpgradeKey } from '../../types';
import { G } from '../state';
import { boatDef, boatStats, cap, gearLvl, hpMax, projDone } from '../rules';
import { celebrate, markBought, toast } from '../feedback';
import { saveGame } from '../save';
import { dirTo, money } from '../../config';
import { homePort } from '../../world';
import { setWaypoint } from '../../waypoint';
import { deny, header, short, spend, type Rows } from './kit';
import { toggleFleet } from './fleet';
import { chartedPorts } from './contracts';
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
  G.bait[kind] += it.n;
  if (kind !== 'chum') G.baitSel = kind;
  track('supply_bought', { supply: kind, cost: it.cost });
  sfx('select'); toast(`Bought ${it.n} ${it.name.toLowerCase()}`); markBought(kind); saveGame();
}
function buyAmmo(kind: BoughtShot): void {
  const box = AMMO[kind];
  if (!spend(box.cost)) return;
  G.ammo[kind] += box.n;
  track('supply_bought', { supply: kind + '_shot', cost: box.cost });
  sfx('select'); toast(`Bought ${box.n} volleys of ${SHOTS[kind].name.toLowerCase()}. Press Z at sea to load it`); markBought(kind); saveGame();
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
  if (G.owned.includes(bd.id)) { boardOwned(bd); return; }
  if (!spend(bd.cost)) return;
  G.owned.push(bd.id); switchBoat(bd, true);
  track('boat_bought', { boat: bd.id, cost: bd.cost });
  sfx('fanfare'); toast(`You bought the ${bd.name}!`, 'good'); celebrate(); markBought(bd.id); saveGame();
}
/** Take another of your boats (at a port's shipyard or your own island's). */
export function boardOwned(bd: BoatDef): void {
  if (!G.owned.includes(bd.id) || G.boatId === bd.id) { deny(); return; }
  switchBoat(bd);
  track('boat_switched', { boat: bd.id });
  toast(`Now sailing the ${bd.name}`); sfx('select'); markBought(bd.id); saveGame();
}
/**
 * Change boats, dropping fish that no longer fit. A new boat comes off the slip sound; each boat you own keeps its own
 * hull as you left it (switching isn't a free repair, and a battered boat stays battered until you take it out again).
 */
function switchBoat(bd: BoatDef, bought = false): void {
  G.hulls[G.boatId] = Math.min(1, G.boat.hp / hpMax());
  G.boatUp[G.boatId] = Object.fromEntries(BOAT_PARTS.map(k => [k, G.up[k]]));   // its fitted parts stay with it
  const parts = G.boatUp[bd.id] ?? {};
  for (const k of BOAT_PARTS) G.up[k] = parts[k] ?? 0;
  delete G.boatUp[bd.id];
  G.boatId = bd.id;
  G.boat.hp = Math.round(hpMax() * (bought ? 1 : G.hulls[bd.id] ?? 1));
  while (G.hold.length > cap()) G.hold.pop();
}

// ---------- rows ----------
export function supplyItems(items: Rows): void {
  for (const k of BAIT_KINDS) {
    const it = SUPPLIES[k];
    items.push({
      kind: 'supply', key: k, icon: k, label: `${it.name} ×${it.n}`, sub: `You have ${G.bait[k]}`, cost: it.cost, right: money(it.cost), ok: G.coins >= it.cost,
      why: short(it.cost), action: 'Buy', act: () => buySupply(k), what: it.what + (k === 'chum' ? '' : '. Press B at sea to switch bait'), repeat: true,
    });
  }
  if (!gearLvl('cannon')) return;                          // shot for the broadside guns, once there are guns to load it in
  for (const k of ['chain', 'grape', 'fire'] as const) {
    const box = AMMO[k], def = SHOTS[k];
    items.push({
      kind: 'supply', key: k, icon: k + 'shot', label: `${def.name} ×${box.n}`, sub: `You have ${G.ammo[k]} volleys`, cost: box.cost, right: money(box.cost), ok: G.coins >= box.cost,
      why: short(box.cost), action: 'Buy', act: () => buyAmmo(k), what: def.about + '. Press Z at sea to load it', repeat: true,
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
        kind: 'upgrade', key: k, icon: k, label: u.name(boatDef()), cost: !maxed && !locked ? cost : null, right: locked ? 'Locked' : maxed ? 'Max' : money(cost),
        sub: locked ? `Fund "${DRYDOCK.name}" at Alderhaven to unlock` : maxed ? 'Fully upgraded' : `Level ${lvl} of ${max}`,
        ok: !locked && !maxed && G.coins >= cost, why: locked ? `Fund "${DRYDOCK.name}" first, in the Harbour tab at Alderhaven` : maxed ? 'Fully upgraded' : short(cost),
        action: 'Buy', act: () => buy(k), what: maxed ? null : u.lv[lvl], pips: [lvl, max],
      });
    }
  }
}
function boatRow(p: Port, bd: BoatDef): PortRow {
  const own = G.owned.includes(bd.id), on = G.boatId === bd.id, st = boatStats(bd);
  const base = { kind: 'boat', key: bd.id, boat: bd, label: bd.name, sub: `${st.hold} fish · ${Math.round(st.speed * 100)}% speed · ${st.hp} hull` } as const;
  if (!own && bd.req && !projDone(bd.req)) {
    const pr = PROJECTS.find(q => q.id === bd.req);
    return { ...base, sub: `Fund "${pr?.name}" at Alderhaven to unlock`, cost: null, right: 'Locked', ok: false, why: `Fund "${pr?.name}" first, in the Harbour tab at Alderhaven`, action: 'Buy', act: deny };
  }
  const out = G.fleet[bd.id];
  if (out) return { ...base, sub: `Fishing for you from ${out.portName}`, cost: null, right: 'At sea', ok: true, why: '', action: 'Recall and sail', act: () => { toggleFleet(p, bd); buyBoat(bd); } };
  return {
    ...base, cost: own ? null : bd.cost, right: on ? 'Sailing' : own ? 'Owned' : money(bd.cost), ok: own ? !on : G.coins >= bd.cost,
    why: on ? 'You are sailing this boat' : own ? '' : short(bd.cost), ...(on ? {} : { action: own ? 'Sail this boat' : 'Buy' }), act: () => buyBoat(bd),
  };
}
/** The charted harbour with a shipyard nearest `p` (Alderhaven always has one). */
export function nearestYard(p: Port): Port {
  const d = (q: Port): number => Math.hypot(q.x - p.x, q.y - p.y);
  return [homePort(), ...chartedPorts(p.id)].filter(q => q.shipyard && q.id !== p.id).sort((a, b) => d(a) - d(b))[0];
}
export function shipyardItems(p: Port, items: Rows): void {
  if (!p.shipyard) {                                         // the tab is at every port, so it can say where to go instead
    const q = nearestYard(p), where = `${Math.round(Math.hypot(q.x - p.x, q.y - p.y) / 10)} m ${dirTo(p.x, p.y, q.x, q.y)}`;
    header(items, 'NO SHIPYARD HERE');
    items.push({
      kind: 'note', icon: 'map', label: `Nearest shipyard: ${q.name}`, sub: where, right: where.split(' ').slice(0, 2).join(' '), ok: true,
      action: 'Mark it on my chart', act: () => { setWaypoint(q.dock.x, q.dock.y); toast(`${q.name}'s shipyard is marked: follow the dots`); },
      what: `Boats and paint are sold only at shipyards. Spot one by the yellow crane over a hull in dock, or the crane badge on its chart mark.`,
    });
    return;
  }
  const shown = BOATS.filter(bd => BOAT_MODELS[bd.id]);       // ships whose model isn't built yet are hidden
  const owned = shown.filter(bd => G.owned.includes(bd.id)), locked = shown.filter(bd => !G.owned.includes(bd.id) && bd.req && !projDone(bd.req));
  const groups: [string, BoatDef[]][] = [['YOUR BOATS', owned], ['FOR SALE', shown.filter(bd => !owned.includes(bd) && !locked.includes(bd))], ['LOCKED', locked]];
  for (const [label, list] of groups) if (list.length) { header(items, label); for (const bd of list) items.push(boatRow(p, bd)); }
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
