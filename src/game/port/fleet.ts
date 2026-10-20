// The fleet office: spare boats fish on their own. A fleet boat earns a fixed, modest rate (well under what you make
// fishing with your best boat), only while you are at sea, and holds at most FLEET_HOLD_MIN minutes of catch until
// collected: idling in port or in a menu earns nothing.
import { BOATS, FLEET_PER_MIN, FLEET_HOLD_MIN } from '../../econ';
import { sfx } from '../../audio';
import { track, bucket } from '../../analytics';
import type { BoatDef, BoatId, Port } from '../../types';
import { G } from '../state';
import { addCoins, toast } from '../feedback';
import { saveGame } from '../save';
import { money } from '../../config';
import { deny, header, type Rows } from './kit';

const fleetPerMin = (bd: BoatDef): number => FLEET_PER_MIN[bd.id];
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
  if (!n) { deny(); return; }
  for (const f of Object.values(G.fleet)) f.earned -= Math.floor(f.earned);   // keep the fractions
  addCoins(n); sfx('coin'); toast(`Collected $${n} from your fleet`, 'good'); track('fleet_collected', { earned_bucket: bucket(n) }); saveGame();
}
export function toggleFleet(p: Port, bd: BoatDef): void {
  const out = G.fleet[bd.id];
  if (out) {
    const n = Math.floor(out.earned);
    if (n) addCoins(n);
    delete G.fleet[bd.id];
    toast(`The ${bd.name} is back in port${n ? ` and brought $${n}` : ''}`);
    track('fleet_changed', { boat: bd.id, action: 'recalled', earned_bucket: bucket(n) });
  } else {
    G.fleet[bd.id] = { port: p.id, portName: p.name, earned: 0 };
    toast(`The ${bd.name} sails out from ${p.name} to fish for you`, 'good');
    track('fleet_changed', { boat: bd.id, action: 'sent', earned_bucket: '0' });
  }
  sfx('select'); saveGame();
}

export function fleetItems(p: Port, items: Rows): void {
  header(items, 'EARNINGS');
  const n = fleetTotal(), out = Object.keys(G.fleet).length;
  const perMin = Object.keys(G.fleet).reduce((a, id) => a + FLEET_PER_MIN[id as BoatId], 0);
  items.push({
    kind: 'collect', icon: 'coin', label: 'Collect fleet earnings', sub: out ? `${out} boat${out > 1 ? 's' : ''} out, ${money(perMin)} a minute in all` : 'No boats out yet', right: n ? '+' + money(n) : '',
    ok: n > 0, why: out ? 'Nothing to collect yet. Fleet boats only earn while you are at sea' : 'Send out a spare boat first (listed below)', action: 'Collect', act: collectFleet,
    what: `Boats you own but are not sailing can fish for you. Each earns a set amount every minute you spend at sea (not in port or menus) and holds up to ${FLEET_HOLD_MIN} minutes of catch until you collect it at any port.`,
  });
  header(items, 'BOATS');
  const spare = BOATS.filter(bd => G.owned.includes(bd.id) && bd.id !== G.boatId);
  if (!spare.length) items.push({ kind: 'note', icon: 'hull', label: 'No spare boats', sub: 'Buy another boat at a shipyard, then send your old one out', ok: false, why: 'Every boat you own is in use', act: deny });
  for (const bd of spare) {
    const f = G.fleet[bd.id], rate = fleetPerMin(bd);
    items.push({
      kind: 'fleet', key: bd.id, boat: bd, label: bd.name, sub: f ? `Fishing for you from ${f.portName}, ${money(Math.floor(f.earned))} earned` : `Would earn ${money(rate)} a minute`,
      right: f ? 'At sea' : 'In port', ok: true, action: f ? 'Recall' : 'Send out', act: () => toggleFleet(p, bd),
      what: f
        ? `Recall the ${bd.name} to bring it back to port with the coins it has earned, so you can sail it again.`
        : `The ${bd.name} fishes on its own for ${money(rate)} every minute you are at sea, holding up to ${money(fleetCap(bd))} (${FLEET_HOLD_MIN} minutes) until you collect.`,
    });
  }
}
