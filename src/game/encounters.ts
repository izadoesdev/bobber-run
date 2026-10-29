import { biomeAt } from '../biome';
import { seaPropsNear, type SeaProp, type SeaPropKind } from '../seaprops';
import { SPECIES } from '../species';
import { poisNear, regionSites, schoolsNear, hAt } from '../world';
import { setWaypoint } from '../waypoint';
import { sfx } from '../audio';
import { G, boatDist } from './state';
import { boatDef, boatSpeed, canLand, DAYLEN, dayNum, hpMax, isNight } from './rules';
import { addCoins, toast } from './feedback';
import { schoolActive } from './schools';
import { saveGame } from './save';
import { lockedAt } from './regions';

export interface SeaEncounter {
  id: string;
  kind: 'light' | 'village' | 'legend' | 'prop' | 'habitat' | 'plankton';
  name: string;
  about: string;
  x: number; y: number; reach: number;
  prop?: SeaPropKind;
}
interface Supplies { coins?: number; shrimp?: number; glow?: number; heal?: number }
interface PropUse extends Supplies { name: string; about: string; action: string; remove?: true }
export const PROP_USES: Record<SeaPropKind, PropUse> = {
  log: { name: 'Driftwood', about: 'Sound timber can patch your hull instead of going to waste.', action: 'Recover timber', heal: 14, coins: 4, remove: true },
  weedMat: { name: 'Floating seaweed', about: 'Small shrimp shelter in the weed. Gather them for your next cast.', action: 'Gather shrimp', shrimp: 3, remove: true },
  lilyPad: { name: 'Water lilies', about: 'Bait hides beneath these floating leaves.', action: 'Gather bait', shrimp: 2, remove: true },
  steamVent: { name: 'Steam vent', about: 'Warm upwellings carry luminous bait. Take a sample without crossing the rocks.', action: 'Sample the upwelling', glow: 2 },
  whaleBones: { name: 'Whale bones', about: 'A marine survey pays for a sample from this old skeleton.', action: 'Collect a research sample', coins: 28, glow: 1 },
  basalt: { name: 'Basalt columns', about: 'Chart this volcanic outcrop and use it to locate sheltered fishing water.', action: 'Survey the outcrop', coins: 12 },
  seastack: { name: 'Sea stack', about: 'An uncharted reef is a hazard. Survey it for the harbour chartmakers.', action: 'Chart the reef', coins: 12 },
  floeS: { name: 'Small ice floe', about: 'Cold-water samples help the harbour track the northern fish runs.', action: 'Take an ice sample', coins: 8, shrimp: 1 },
  floeM: { name: 'Ice floe', about: 'Survey the ice and collect cold-water bait along its edge.', action: 'Survey the ice', coins: 10, shrimp: 2 },
  floeL: { name: 'Large ice floe', about: 'Its sheltered underside holds bait; its position matters to northern sailors.', action: 'Survey the ice', coins: 12, shrimp: 2 },
  berg: { name: 'Iceberg', about: 'Chartmakers pay for a close survey. Keep your hull clear of the ice.', action: 'Chart the iceberg', coins: 16, glow: 1 },
  iceberg: { name: 'Great iceberg', about: 'Mark this large hazard and bring a sample back for the harbour researchers.', action: 'Survey the iceberg', coins: 20, glow: 1 },
};
const LEGENDS: Record<string, [string, string]> = {
  sunkenTemple: ['Sunken Temple', 'Inspect the submerged chambers and recover a relic for the harbour museum.'],
  stoneCircle: ['Standing Stone Circle', 'Record the tide marks carved into these stones for the coastal survey.'],
  wreckGraveyard: ['Wreck Graveyard', 'Recover a ship’s log from the hulks and record this dangerous reef.'],
  crystalCave: ['Crystal Cave', 'Take a glowing mineral sample from the cave mouth.'],
  whaleFall: ['Whale Fall', 'Study the deep-water life gathering around this ancient skeleton.'],
  iceboundShip: ['Icebound Ship', 'Recover a preserved logbook from the frozen ship.'],
};
const VILLAGES: Record<string, string> = {
  reef: 'Coral Village', kelp: 'Kelp-Coast Village', volcanic: 'Ember Village', mangrove: 'Mangrove Village', cold: 'Northern Village', warm: 'Southern Village',
};
const HABITATS: Record<string, string> = {
  reef: 'Coral reef', kelp: 'Kelp beds', volcanic: 'Volcanic shallows', mangrove: 'Mangrove roots', cold: 'Northern shallows', warm: 'Warm shallows', home: 'Coastal shallows', open: 'Coastal shallows',
};

export const propEncounterId = (prop: Pick<SeaProp, 'kind' | 'x' | 'y'>): string => `prop:${prop.kind}:${prop.x},${prop.y}`;
export const seaPropGathered = (prop: SeaProp): boolean => !!PROP_USES[prop.kind].remove && G.visits[propEncounterId(prop)] !== undefined;

/** Query the actual world objects, so input never invents an interaction at a decorative lookalike. */
export function encountersNear(): SeaEncounter[] {
  const b = G.boat, out: SeaEncounter[] = [], hull = boatDef().L * 0.5;
  for (const p of poisNear(b.x, b.y, 110)) if (p.type === 'light') out.push({
    id: p.id, kind: 'light', name: p.name, x: p.x, y: p.y, reach: 76 + hull,
    about: 'A working lighthouse: the keeper offers daily supplies, repairs, fishing directions, and a safe place to wait for the tide.',
  });
  for (const site of regionSites()) {
    if (boatDist(site) > 95 + hull) continue;
    const [name, about] = site.kind === 'village'
      ? [VILLAGES[site.biome] ?? 'Coastal Village', 'Stop at the jetty for daily bait and hull repairs, local fishing directions, or the region’s stories.']
      : LEGENDS[site.legend ?? ''] ?? ['Coastal Ruins', 'Survey this historic site for the harbour museum.'];
    out.push({ id: site.id, kind: site.kind, name, about, x: site.x, y: site.y, reach: 80 + hull });
  }
  for (const prop of seaPropsNear(b.x, b.y, 65 + hull, [], true)) {
    if (seaPropGathered(prop)) continue;
    const use = PROP_USES[prop.kind];
    out.push({ id: propEncounterId(prop), kind: 'prop', prop: prop.kind, name: use.name, about: use.about,
      x: prop.x, y: prop.y, reach: prop.r + 24 + hull });
  }
  const biome = biomeAt(b.x, b.y);
  if (hAt(b.x, b.y) > -0.3) out.push({ id: `habitat:${biome}`, kind: 'habitat', name: HABITATS[biome],
    about: 'Coral, kelp, roots, and seabed plants shelter bait and local fish. Gather a small supply each game day.', x: b.x, y: b.y, reach: 30 });
  if (G.parts.some(p => p.kind === 'glow' && Math.hypot(p.x - b.x, p.y - b.y) < 35)) out.push({
    id: 'plankton', kind: 'plankton', name: 'Glowing plankton', about: 'Collect a living light sample from your wake to make a glow lure. One sample each game day.', x: b.x, y: b.y, reach: 35,
  });
  return out.filter(encounter => boatDist(encounter) < encounter.reach && !lockedAt(encounter.x, encounter.y));
}

export function nearestEncounter(): SeaEncounter | null {
  const rank = (e: SeaEncounter): number => e.kind === 'habitat' || e.kind === 'plankton' ? 1 : 0;
  return encountersNear().sort((a, b) => rank(a) - rank(b) || boatDist(a) - boatDist(b))[0] ?? null;
}
export function openEncounter(encounter: SeaEncounter): void {
  if (G.mode !== 'play' || G.fish || G.card || boatSpeed() >= 12) return;
  const live = encountersNear().find(e => e.id === encounter.id);
  if (!live) return;
  G.encounter = live; G.mode = 'encounter'; sfx('select');
}
export function closeEncounter(): void { G.encounter = null; G.mode = 'play'; sfx('move'); }

export type EncounterActionId = 'supplies' | 'survey' | 'fish' | 'wait' | 'stories';
export interface EncounterAction { id: EncounterActionId; label: string; detail: string; why?: string }
const daily = (e: SeaEncounter): boolean => ['light', 'village', 'habitat', 'plankton'].includes(e.kind);
function suppliesFor(e: SeaEncounter): Supplies {
  if (e.kind === 'light') return { glow: 2, heal: Math.ceil(hpMax() * 0.2) };
  if (e.kind === 'village') return { shrimp: 3, heal: Math.ceil(hpMax() * 0.15) };
  if (e.kind === 'habitat') return { shrimp: 2 };
  if (e.kind === 'plankton') return { glow: 1 };
  if (e.prop) return PROP_USES[e.prop];
  return { coins: 70, glow: 2 };
}
function supplyText(s: Supplies): string {
  return [s.coins && `$${s.coins}`, s.shrimp && `${s.shrimp} shrimp bait`, s.glow && `${s.glow} glow lure${s.glow > 1 ? 's' : ''}`,
    s.heal && `up to ${s.heal} hull repairs`].filter(Boolean).join(' · ');
}
export function encounterActions(e: SeaEncounter): EncounterAction[] {
  const last = G.visits[e.id], claimed = last !== undefined && (!daily(e) || last === dayNum());
  const isDaily = daily(e);
  const label = e.kind === 'light' ? 'Keeper’s supplies' : e.kind === 'village' ? 'Jetty supplies'
    : e.kind === 'legend' ? 'Recover and record the find' : e.prop ? PROP_USES[e.prop].action : 'Gather a sample';
  const actions: EncounterAction[] = [{ id: isDaily ? 'supplies' : 'survey', label,
    detail: `${supplyText(suppliesFor(e))}. ${isDaily ? 'Once each game day.' : 'One-time reward.'}`,
    why: claimed ? (isDaily ? 'Collected today. Return tomorrow.' : 'Already recorded in your voyage.') : undefined }];
  actions.push({ id: 'fish', label: 'Mark nearby fishing grounds', detail: 'A waypoint to fish that bite now and fit your rod and boat. Learn their habitat on your chart.' });
  if (e.kind === 'light') actions.push({ id: 'wait', label: isNight() ? 'Wait until morning' : 'Wait until nightfall', detail: 'Change the time for day or night fishing. Your boat stays safely here.' });
  if (e.kind === 'village' || e.kind === 'legend') actions.push({ id: 'stories', label: 'Read local stories', detail: 'Open the journal. Starting a side story is always your choice.' });
  return actions;
}

/** Revalidate the open card, proximity, and entitlement before touching any saved progress. */
export function performEncounterAction(id: string, actionId: EncounterActionId): void {
  if (G.mode !== 'encounter' || G.encounter?.id !== id || G.fish || G.card || boatSpeed() >= 12 || boatDist(G.encounter) >= G.encounter.reach) return;
  const encounter = encountersNear().find(e => e.id === id);
  if (!encounter) return;
  const action = encounterActions(encounter).find(a => a.id === actionId);
  if (!action || action.why) return;
  if (actionId === 'stories') { G.journalBack = 'encounter'; G.mode = 'journal'; return; }
  if (actionId === 'fish') { markFishingGrounds(); return; }
  if (actionId === 'wait') {
    const day = Math.floor(G.clock / DAYLEN), night = isNight();
    G.clock = (day + (night ? 1.1 : 0.7)) * DAYLEN;
    toast(night ? 'Morning at the lighthouse. Day fish are stirring.' : 'Nightfall at the lighthouse. Look for Beaconfish below the light.', 'good');
  } else {
    const supplies = suppliesFor(encounter);
    G.visits[id] = dayNum();
    if (supplies.coins) addCoins(supplies.coins);
    G.bait.shrimp += supplies.shrimp ?? 0;
    G.bait.glow += supplies.glow ?? 0;
    G.boat.hp = Math.min(hpMax(), G.boat.hp + (supplies.heal ?? 0));
    toast(`${encounter.name}: ${supplyText(supplies)}`, 'good');
    if (encounter.prop && PROP_USES[encounter.prop].remove) closeEncounter();
  }
  sfx('coin'); saveGame();
}
function markFishingGrounds(): void {
  const schools = schoolsNear(G.boat.x, G.boat.y, 1000).filter(s => schoolActive(s) && canLand(s.sp) && !lockedAt(s.x, s.y));
  const school = schools.sort((a, b) => boatDist(a) - boatDist(b))[0];
  if (!school) { toast('No suitable fish are biting nearby. Try another time of day.'); return; }
  const species = SPECIES[school.sp];
  if (species.w > 0 && !species.legend) G.zones[species.id] = true;
  setWaypoint(school.x, school.y);
  toast(`${species.name} fishing grounds marked on your chart`, 'good');
  saveGame();
}
