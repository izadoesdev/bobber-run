// The guide: from the current state, the player's best next step and, when it has one, the place to go.
// The HUD chip, the objective marker, the minimap, the sea chart and the journal all read `guide()`.
// Also the first-session tips: a few gentle notes at the right moments, each shown once.
import { SPECIES, SP, UPGRADES, PROJECTS, BOATS } from '../econ';
import { poisNear, schoolsNear, homePort, LAIR } from '../world';
import { lockedAt } from './regions';
import { SET } from '../prefs';
import { currentQuest, type Quest } from '../story';
import type { BoatDef, Poi, Point, Port, Project, ProjectId, School, UpgradeKey } from '../types';
import { G, boatDist, nearest } from './state';
import { boatDef, canLand, cap, hpMax, isNight, dayFrac, DAYLEN, logged, projDone } from './rules';
import { needStatus, nextProject } from './port';
import { castRange } from './fishing';
import { portById } from './save';
import { schoolActive, schoolShown } from './schools';
import { dirTo, money } from '../config';

/** Whether the objective marker is on (the `guide` setting). */
export const guideOn = (): boolean => SET.guide;

export interface Step {
  /** what to do, short and in sentence case */
  text: string;
  /** where to do it */
  at?: Point;
  /** icon key for the marker */
  icon: string;
  /** within this distance the game's own prompt takes over, so the marker steps aside */
  near: number;
}

// ---------- places ----------
const chartedPorts = (): Port[] => [...G.found].filter(id => id.startsWith('port:')).map(portById);
/** The nearest charted port. */
const nearestPort = (): Port => nearest(chartedPorts().filter(p => !lockedAt(p.x, p.y))) || homePort();
const SEARCH = 2600;
/** The nearest landmark within SEARCH that passes `ok`. */
// the guide never points into a region that isn't open yet: rough water would turn the boat back
const poiNear = (ok: (p: Poi) => boolean): Poi | null => nearest(poisNear(G.boat.x, G.boat.y, SEARCH), p => ok(p) && !lockedAt(p.x, p.y));
const full = (): boolean => G.hold.length >= cap();
const dockNear = (): number => 30 + boatDef().L;
const canCatch = (s: School): boolean => !s.boss && canLand(s.sp);
/** The nearest school that will bite now and that your rod can land, optionally of a kind. */
function nearestSchool(ok: (s: School) => boolean = () => true, rad = 700): School | null {
  return nearest(schoolsNear(G.boat.x, G.boat.y, rad), s => canCatch(s) && schoolActive(s) && !lockedAt(s.x, s.y) && ok(s));
}

// ---------- steps ----------
const at = (text: string, p: Point | null | undefined, icon: string, near: number): Step => p ? { text, at: { x: p.x, y: p.y }, icon, near } : { text, icon, near };
const clock = (s: number): string => s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;
const fishN = (n: number): string => n === 1 ? '1 fish' : `${n} fish`;
/** A step at `p`, or when there is none, the `lost` text with nowhere to point. */
const seek = (p: Point | null | undefined, text: string, lost: string, icon: string, near: number): Step => p ? at(text, p, icon, near) : { text: lost, icon, near: 0 };

function sellStep(): Step {
  const p = nearestPort();
  return at(`Sell your ${fishN(G.hold.length)} at ${p.name}`, p.end, 'coin', dockNear());
}
/** Go fishing for `text`; a full hold means selling first. `ok` narrows the schools worth sailing to. */
function fishStep(text: string, ok?: (s: School) => boolean, rad?: number): Step {
  return full() ? sellStep() : seek(nearestSchool(ok, rad), text, `${text}. Look for ripples`, 'rod', castRange());
}
function earnStep(amount: number, what: string): Step {
  if (full() || (G.hold.length > 0 && boatDist(nearestPort().end) < dockNear() * 1.5)) return sellStep();
  return fishStep(`Catch and sell fish to earn ${money(amount)} more for ${what}`);
}
function buyStep(k: UpgradeKey, what: string): Step {
  const cost = UPGRADES[k].costs[G.up[k]];
  if (cost === undefined) return { text: `Upgrade your ${what}`, icon: k, near: 0 };
  const name = k === 'rod' ? `a level ${G.up.rod + 2} rod` : `a better ${what}`;
  if (G.coins < cost) return earnStep(cost - G.coins, name);
  const p = nearestPort();
  return at(`Buy ${name} at ${p.name} for ${money(cost)}`, p.end, k, dockNear());
}
/** A catch that needs a stronger rod sends you to the outfitter first. */
const rodFor = (sp: number): Step | null => SPECIES[sp].rod > G.up.rod ? buyStep('rod', 'rod') : null;
const untilNight = (): number => ((0.64 - dayFrac() + 1) % 1) * DAYLEN;

const SHORT: Record<ProjectId, string> = { pier: 'the pier', market: 'the market', drydock: 'the dry dock', lights: 'the lights', grand: 'the Grand Harbour' };
/** A harbour project: room in the hold, then the coin, then the fish it wants, then back to Alderhaven. */
function projectStep(pr: Project): Step {
  const nd = pr.need, st = needStatus(nd), name = SHORT[pr.id], home = homePort();
  if (!('sp' in nd) && st.want > cap()) return buyStep('hold', 'hold');
  if (G.coins < pr.cost) return earnStep(pr.cost - G.coins, name);
  const left = st.want - st.have;
  if (left > 0) {
    if ('any' in nd) return fishStep(`Catch ${left} more fish for ${name}`);
    if ('kinds' in nd) return fishStep(`Catch ${left} more kind${left > 1 ? 's' : ''} of fish for ${name}`, s => !G.hold.some(f => f.sp === s.sp));
    if ('trophy' in nd) return fishStep(`Catch ${left} more trophy fish for ${name}`);
    if (nd.sp === 'oldone') return lairStep();
    const sp = SP[nd.sp];
    return rodFor(sp) ?? (nd.sp === 'beacon' ? beaconStep(left) : fishStep(`Catch ${left} more ${SPECIES[sp].name}`, s => s.sp === sp, SEARCH / 2));
  }
  return at(`Fund ${name} in the Harbour tab at ${home.name}`, home.end, 'anchor', dockNear());
}
function beaconStep(left: number): Step {
  if (full()) return sellStep();
  const L = poiNear(p => p.type === 'light' && G.found.has(p.id) && !!p.school), what = `Catch ${left} more Beaconfish`;
  if (!L?.school) return { text: `${what} below a lighthouse at night`, icon: 'glow', near: 0 };
  return at(`${what} below ${L.name}${isNight() ? '' : ` after dark, in ${clock(untilNight())}`}`, L.school, 'glow', castRange());
}
function lairStep(): Step {
  return rodFor(SP.oldone) ?? at(isNight() ? 'Catch the Old One at its lair'
    : `Sail to the Old One's lair. It comes up at night, in ${clock(untilNight())}`, LAIR, 'moon', castRange());
}

function questStep(q: Quest): Step {
  const t = q.target, b = G.boat;
  if (typeof t === 'object') {
    const pr = PROJECTS.find(p => p.id === t.project);
    return pr ? projectStep(pr) : { text: q.goal, icon: 'star', near: 0 };
  }
  switch (t) {
    case 'school': return fishStep('Catch fish at the school');
    case 'sell': return G.hold.length ? sellStep() : fishStep('Catch a fish to sell');
    case 'port': return seek(poiNear(p => p.type === 'port' && !G.found.has(p.id)), 'Sail close to the new port to chart it', 'Explore the coast to find another port', 'anchor', 60);
    case 'light': return seek(poiNear(p => p.type === 'light' && !G.found.has(p.id)), 'Sail close to the lighthouse to chart it', 'Explore the coast to find lighthouses', 'lantern', 60);
    case 'wreck': return seek(poiNear(p => p.type === 'wreck' && !G.salvaged.has(p.id)), 'Salvage the wreck', 'Explore the coast to find a wreck', 'map', 30 + boatDef().L * 0.5);
    case 'night': return fishStep(isNight() ? 'Catch a fish while it is night' : `Night falls in ${clock(untilNight())}. Fish until then`);
    case 'north': return at('Sail north into the cold water', { x: b.x, y: Math.min(b.y - 200, -1950) }, 'arrow', 0);
    case 'species': return speciesStep();
    case 'trophy': return fishStep(G.baitSel === 'none' ? 'Catch a trophy fish. Bait helps' : 'Catch a trophy fish');
    case 'ghost': {
      const r = rodFor(SP.ghost);
      if (r) return r;
      if (full()) return sellStep();
      const w = poiNear(p => p.type === 'wreck' && p.school?.sp === SP.ghost && schoolShown(p.school));
      return seek(w?.school, 'Fish for the Ghost Carp by the wreck', 'Search far-off wrecks for the Ghost Carp', 'map', castRange());
    }
    case 'lair': return lairStep();
  }
}
function speciesStep(): Step {
  const fresh = (s: School): boolean => !G.log[SPECIES[s.sp].id];
  if (full()) return sellStep();
  const s = nearestSchool(fresh, 900), rodCost = UPGRADES.rod.costs[G.up.rod];
  if (s) return at('Catch a new species for your logbook', s, 'rod', castRange());
  if (rodCost !== undefined && G.coins >= rodCost) return buyStep('rod', 'rod');
  return { text: isNight() ? 'Fish in new places to find new species' : 'Fish in new places, or wait for night', icon: 'rod', near: 0 };
}
// after the story: the next harbour project, else the next upgrade you can afford, else the logbook
// the money upgrades first, then the ones you feel, then the dry dock's (they need the dry dock project)
const UPGRADE_ORDER: UpgradeKey[] = ['hold', 'rod', 'cook', 'ice', 'sonar', 'prop', 'reel', 'line', 'tackle', 'harpoon', 'hull', 'radio', 'lantern', 'spyglass', 'sextant'];
/** The next boat you can buy (its project done), cheapest first. */
const nextBoat = (): BoatDef | undefined => BOATS.find(b => !G.owned.includes(b.id) && (!b.req || projDone(b.req)));
/** Buy the next boat at a shipyard, or earn toward it. The bigger ships open sea giants (Trawler) and the very largest (Flagship). */
function boatStep(b: BoatDef): Step {
  if (G.coins < b.cost) return earnStep(b.cost - G.coins, `the ${b.name}`);
  const p = nearest(chartedPorts(), p => !!p.shipyard) || homePort();
  return at(`Buy the ${b.name} at ${p.name}'s shipyard for ${money(b.cost)}`, p.end, 'anchor', dockNear());
}
function freeStep(): Step {
  const pr = nextProject();
  if (pr) return projectStep(pr);
  if (full()) return sellStep();
  const k = UPGRADE_ORDER.find(k => { const u = UPGRADES[k], c = u.costs[G.up[k]]; return c !== undefined && c <= G.coins && (!u.req || projDone(u.req)); });
  if (k) return buyStep(k, UPGRADES[k].name(boatDef()).toLowerCase());
  const b = nextBoat();
  if (b) return boatStep(b);
  return logged() < SPECIES.length ? speciesStep() : fishStep('Break your own records');
}

/** The best next step right now: a weak hull first, then the story quest, then the harbour and your boat. */
function decide(): Step {
  if (G.boat.hp < hpMax() * 0.35) {
    const p = nearestPort();
    return at(G.coins > 0 ? `Repair your hull at ${p.name}` : `Your hull is weak. Avoid rocks on the way to ${p.name}`, p.end, 'repair', dockNear());
  }
  const q = currentQuest();
  return q ? questStep(q) : freeStep();
}
// the HUD asks every frame; the answer is worked out a few times a second, or at once when something it depends on changes
let cache: Step | null = null, cacheKey = '';
export function guide(): Step {
  const k = `${Math.floor(G.t * 4)}|${G.story?.i}|${G.hold.length}|${G.coins}|${G.found.size}|${G.salvaged.size}|${G.boatId}|${G.projects.length}`;
  if (!cache || k !== cacheKey) { cache = decide(); cacheKey = k; }
  return cache;
}

/** "120 m north-east" from the boat, or '' when the place is right here. */
export function whereText(s: Step): string {
  if (!s.at) return '';
  const d = boatDist(s.at);
  if (d < Math.max(s.near, 25)) return '';
  return `${Math.max(1, Math.round(d / 10))} m ${dirTo(G.boat.x, G.boat.y, s.at.x, s.at.y)}`;
}
/** The step with its distance and heading, for the chip and the journal. */
export function stepLine(s: Step = guide()): string {
  const w = whereText(s);
  return w ? `${s.text}, ${w}` : s.text;
}
/** Whether the marker should show: on, a place to show, not fishing, not already there. */
export function markerTarget(s: Step = guide()): Point | null {
  if (!guideOn() || !s.at || G.fish || G.card || G.mode !== 'play') return null;
  return boatDist(s.at) < s.near ? null : s.at;
}

// ---------- first-session tips ----------
const TIP_KEY = 'bobber-run-tips';
type TipId = 'hull' | 'night';
// only what no prompt or toast already says: the cast and dock prompts teach fishing and selling, and the weather
// and a full hold get their own toasts
const TIPS: { id: TipId; text: string; when: () => boolean }[] = [
  { id: 'hull', text: 'Rocks scrape your hull. Any port can repair it', when: () => G.boat.hp < hpMax() * 0.6 },
  { id: 'night', text: 'Night fish are out. Glow lures bite twice as fast', when: () => isNight() },
];
const TIP_S = 9, TIP_GAP = 14;
let seen: Partial<Record<TipId, true>> = {};
try { seen = JSON.parse(localStorage.getItem(TIP_KEY) || '{}'); } catch { }
let shown: { id: TipId; text: string; t: number } | null = null, lastT = -99;
/** The tip to show now, if any. Call once a frame while sailing: it notices the moments and remembers what was shown. */
export function tip(): { text: string; fade: boolean } | null {
  if (shown && G.t - shown.t > TIP_S) shown = null;
  if (!shown && G.mode === 'play' && !G.fish && !G.card && G.stats.caught > 0 && G.t - lastT > TIP_GAP) {   // none in the wordless first minute
    const next = TIPS.find(t => !seen[t.id] && t.when());
    if (next) {
      shown = { id: next.id, text: next.text, t: G.t }; lastT = G.t; seen[next.id] = true;
      try { localStorage.setItem(TIP_KEY, JSON.stringify(seen)); } catch { }
    }
  }
  return shown && { text: shown.text, fade: G.t - shown.t > TIP_S - 0.6 };
}
