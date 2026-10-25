// Ports: one row of tabs, each a single list grouped under section headers. Every row says what it costs, whether it
// can be bought, and if not, why. This file holds the tabs, the inn, the ferry, the islands list, docking and the
// menu's keys; the market, contracts, shop, fleet office and harbour live beside it.
import { homePort, claimableNear, claimableAt } from '../../world';
import { ISLANDS, REALM, realmTitle, watchExtra, islandPrice } from '../../islands';
import { SPECIES } from '../../econ';
import { sfx } from '../../audio';
import { NET } from '../../net';
import { track, bucket } from '../../analytics';
import type { Point, Port, PortItem, PortRow } from '../../types';
import { G, hit } from '../state';
import { DAYLEN, dayFrac, projDone } from '../rules';
import { celebrate, toast } from '../feedback';
import { placeAtPort, saveGame } from '../save';
import { dirTo, money } from '../../config';
import { deny, have, header, short, spend, type Rows } from './kit';
import { repairItem, saleValue, sell, sellItems } from './market';
import { chartedPorts, contractItems } from './contracts';
import { outfitterItems, shipyardItems, supplyItems } from './shop';
import { fleetItems } from './fleet';
import { harbourGift, harbourItems } from './harbour';

export { priceAt, keptBack, saleBonus, sailorsNear, buyFishChart, fishChartPrice, chartable } from './market';
export { dockGrade } from './contracts';
export { fleetTotal, updateFleet } from './fleet';
export { needStatus, nextProject } from './harbour';

// ---------- the inn ----------
const isDaytime = (c: number): boolean => c > 0.04 && c < 0.58;
/** Skip ahead to dusk, or to morning. */
function rest(): void {
  const c = dayFrac(), base = Math.floor(G.clock / DAYLEN) * DAYLEN, day = isDaytime(c);
  G.clock = day ? base + 0.6 * DAYLEN : base + (c >= 0.58 ? DAYLEN : 0) + 0.06 * DAYLEN;
  sfx('select'); toast(day ? 'You rest at the inn until dusk' : 'You sleep at the inn until morning'); saveGame();
}
function innItem(items: Rows): void {
  const day = isDaytime(dayFrac());
  items.push({
    kind: 'rest', icon: day ? 'lantern' : 'sun', label: day ? 'Rest until dusk' : 'Sleep until morning', sub: day ? 'Night fish come out after dark' : 'Day fish return at dawn',
    right: 'Free', ok: true, action: 'Rest', act: rest,
    what: day ? 'Skip ahead to dusk. Squid, herring, crabs and other night fish only bite after dark.' : 'Sleep until first light, when the day fish return.',
  });
}

// ---------- the ferry ----------
const ferryCost = (a: Point, b: Point): number => 8 + Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 28);
function ferry(from: Port, to: Port): void {
  const cost = ferryCost(from, to);
  if (!spend(cost)) return;
  track('ferry_used', { cost_bucket: bucket(cost) });
  G.clock += Math.hypot(from.x - to.x, from.y - to.y) / 6;     // the trip still takes time
  placeAtPort(to);
  G.menu.port = to; G.lastPort = to.id; G.menu.tab = 0; G.menu.sel = 1;
  sfx('dock'); toast(`You took the ferry to ${to.name}`); saveGame();
}
function ferryItems(p: Port, items: Rows): void {
  header(items, 'ROUTES');
  const dist = (q: Port): number => Math.hypot(q.x - p.x, q.y - p.y);
  const ports = chartedPorts(p.id).sort((a, b) => dist(a) - dist(b)).slice(0, 8);
  if (!ports.length) items.push({ kind: 'note', icon: 'map', label: 'No routes yet', sub: 'Find other ports to open ferry routes', ok: false, why: 'Sail out and discover another port first', act: deny });
  for (const q of ports) {
    const cost = ferryCost(p, q);
    items.push({
      kind: 'ferry', q, icon: 'map', label: q.name, sub: `${Math.round(dist(q) / 10)} m away`, cost, right: money(cost), ok: G.coins >= cost, why: short(cost),
      action: 'Travel', act: () => ferry(p, q), what: 'Travel there at once instead of sailing. The time of day still moves on as if you had sailed.',
    });
  }
}

// ---------- islands ----------
const openIsland = (key: string): void => { G.islandKey = key; G.islandBack = 'port'; G.mode = 'island'; sfx('select'); };
/** Your islands, then the nearest islands to this port: owner or "Unclaimed", price, how far and which way. */
function islandItems(p: Port, items: Rows): void {
  const near = claimableNear(p.x, p.y, 3400).map(c => ({ c, d: Math.hypot(c.x - p.x, c.y - p.y) })).sort((a, b) => a.d - b.d).slice(0, 14);
  watchExtra(near.map(n => n.c.key));
  const row = (c: { key: string; x: number; y: number; i: number; j: number }, d: number) => {
    const r = ISLANDS.get(c.key), where = `${Math.round(d / 10)} m ${dirTo(p.x, p.y, c.x, c.y)}`;
    items.push({
      kind: 'island', icon: 'anchor', label: r ? r.name : 'Unclaimed island', sub: r ? (r.mine ? `Your island · ${where}` : `Held by ${r.title ? r.title + ' ' : ''}${r.owner} · ${where}`) : where,
      right: r ? (r.mine ? 'Yours' : 'Held') : money(islandPrice(c.i, c.j) ?? 0), ok: true, action: r ? (r.mine ? 'Manage' : 'View') : NET.profile?.admin ? 'Claim' : 'Buy',
      act: () => openIsland(c.key),
    });
  };
  const mine = REALM.islands;
  if (mine.length) {
    header(items, `YOUR ISLANDS${realmTitle() ? ' · ' + realmTitle()!.toUpperCase() : ''}`);
    for (const r of mine) { const c = claimableAt(r.key); if (c) row(c, Math.hypot(c.x - p.x, c.y - p.y)); }
  }
  header(items, 'ISLANDS NEARBY');
  for (const { c, d } of near) if (!ISLANDS.get(c.key)?.mine) row(c, d);
}

// ---------- the menu ----------
type PortTab = 'MARKET' | 'OUTFITTER' | 'SHIPYARD' | 'FLEET' | 'FERRY' | 'ISLANDS' | 'HARBOUR';
export function portTabs(p: Port): PortTab[] {
  return ['MARKET', 'OUTFITTER', ...(p.shipyard ? ['SHIPYARD' as const] : []), ...(projDone('market') ? ['FLEET' as const] : []),
    'FERRY', ...(NET.on ? ['ISLANDS' as const] : []), ...(p.id === homePort().id ? ['HARBOUR' as const] : [])];
}
function marketItems(p: Port, items: Rows): void {
  sellItems(p, items);
  header(items, 'CONTRACTS');
  contractItems(p, items);
  header(items, 'INN');
  innItem(items);
  header(items, 'SUPPLIES');
  repairItem(items);
  supplyItems(items);
}
const TABS: Record<PortTab, (p: Port, items: Rows) => void> = {
  MARKET: marketItems, OUTFITTER: (_, items) => outfitterItems(items), SHIPYARD: shipyardItems, FLEET: fleetItems,
  FERRY: ferryItems, ISLANDS: islandItems, HARBOUR: (_, items) => harbourItems(items),
};
/** The rows of the current tab at port `p`. */
export function portItems(p: Port): PortItem[] {
  const items: Rows = [];
  TABS[portTabs(p)[G.menu.tab] || 'MARKET'](p, items);
  return items;
}
const selectable = (it: PortItem): it is PortRow => it.kind !== 'header';

// ---------- docking ----------
export function dock(p: Port): void {
  G.mode = 'port';
  G.menu = { tab: 0, sel: 1, port: p };   // opens on Market with "Sell your catch" selected
  G.lastPort = p.id; G.fish = null;
  const b = G.boat;
  b.vx = b.vy = b.w = b.helm = b.thr = 0;
  sfx('dock');
  track('port_docked', { port: p.name, home: p.id === homePort().id });
  harbourGift(p);
  if (G.active.some(c => c.to === p.id && have(c.sp) >= c.n)) toast('You can deliver a contract here', 'good');
  // the very first time you dock with fish, the harbour buys them on the spot: one less thing to learn
  if (!G.stats.sold && saleValue(p).n > 0 && !G.hold.some(f => SPECIES[f.sp].legend)) { sell(p); celebrate(); }
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
