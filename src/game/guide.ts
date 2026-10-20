// The guide: from the current state, the player's best next step and, when it has one, the place to go.
// The HUD chip, the objective marker, the minimap, the sea chart and the journal all read `guide()`.
// Also the first-session tips: a few gentle notes at the right moments, each shown once.
import { SPECIES, SP, UPGRADES, PROJECTS } from '../econ';
import { cellPois, poisNear, schoolsNear, homePort, LAIR } from '../world';
import { SET } from '../prefs';
import { currentQuest, type Quest, type QuestTarget } from '../story';
import type { Point, Port, Project, ProjectId, School, UpgradeKey } from '../types';
import { G } from './state';
import { boatDef, canLand, cap, hpMax, isNight, dayFrac, DAYLEN, logged } from './rules';
import { needStatus, nextProject } from './port';
import { schoolActive, schoolShown } from './schools';

// The player's setting for the objective marker: `guide` in Settings (lead-owned), on unless set to false.
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
const dist = (p: Point): number => Math.hypot(p.x - G.boat.x, p.y - G.boat.y);
function nearest<T extends Point>(list: Iterable<T>, ok: (p: T) => boolean = () => true): T | null {
  let best: T | null = null, bd = Infinity;
  for (const p of list) {
    if (!ok(p)) continue;
    const d = dist(p);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
/** The nearest charted port. */
export function nearestPort(): Port {
  const ports: Port[] = [];
  for (const id of G.found) {
    const m = /^port:(-?\d+),(-?\d+)$/.exec(id);
    const p = m && cellPois(+m[1], +m[2]).find(q => q.id === id);
    if (p && p.type === 'port') ports.push(p);
  }
  return nearest(ports) || homePort();
}
const SEARCH = 2600;
const castRange = (): number => 50 + boatDef().L * 0.5;
const dockNear = (): number => 30 + boatDef().L;
const canCatch = (s: School): boolean => !s.boss && canLand(s.sp);
/** The nearest school that will bite now and that your rod can land, optionally of a kind. */
function nearestSchool(ok: (s: School) => boolean = () => true, rad = 700): School | null {
  return nearest(schoolsNear(G.boat.x, G.boat.y, rad), s => canCatch(s) && schoolActive(s) && ok(s));
}

// ---------- steps ----------
const at = (text: string, p: Point | null | undefined, icon: string, near: number): Step => p ? { text, at: { x: p.x, y: p.y }, icon, near } : { text, icon, near };
const clock = (s: number): string => s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`;
const fishN = (n: number): string => n === 1 ? '1 fish' : `${n} fish`;
const thousands = new Intl.NumberFormat('en-US');   // toLocaleString builds a formatter per call, and rows redraw every frame
const cash = (n: number): string => '$' + thousands.format(Math.round(n));

function sellStep(): Step {
  const p = nearestPort();
  return at(`Sell your ${fishN(G.hold.length)} at ${p.name}`, p.end, 'coin', dockNear());
}
/** Go fishing for `text`; a full hold means selling first. `ok` narrows the schools worth sailing to. */
function fishStep(text: string, ok?: (s: School) => boolean, rad?: number): Step {
  if (G.hold.length >= cap()) return sellStep();
  const s = nearestSchool(ok, rad);
  return s ? at(text, s, 'rod', castRange()) : { text: `${text}. Look for ripples`, icon: 'rod', near: 0 };
}
function earnStep(amount: number, what: string): Step {
  if (G.hold.length >= cap() || (G.hold.length > 0 && dist(nearestPort().end) < dockNear() * 1.5)) return sellStep();
  return fishStep(`Catch and sell fish to earn ${cash(amount)} more for ${what}`);
}
function buyStep(k: UpgradeKey, what: string): Step {
  const cost = UPGRADES[k].costs[G.up[k]];
  if (cost === undefined) return { text: `Upgrade your ${what}`, icon: k, near: 0 };
  const name = k === 'rod' ? `a level ${G.up.rod + 2} rod` : `a better ${what}`;
  if (G.coins < cost) return earnStep(cost - G.coins, name);
  const p = nearestPort();
  return at(`Buy ${name} at ${p.name} for ${cash(cost)}`, p.end, k, dockNear());
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
    const r = rodFor(sp);
    if (r) return r;
    if (nd.sp === 'beacon') return beaconStep(left);
    return fishStep(`Catch ${left} more ${SPECIES[sp].name}`, s => s.sp === sp, SEARCH / 2);
  }
  return at(`Fund ${name} in the Harbour tab at ${home.name}`, home.end, 'anchor', dockNear());
}
function beaconStep(left: number): Step {
  if (G.hold.length >= cap()) return sellStep();
  const lights = poisNear(G.boat.x, G.boat.y, SEARCH).filter(p => p.type === 'light' && G.found.has(p.id) && p.school);
  const L = nearest(lights), s = L?.school;
  const what = `Catch ${left} more Beaconfish`;
  if (!s) return { text: `${what} below a lighthouse at night`, icon: 'glow', near: 0 };
  if (!isNight()) return at(`${what} below ${L.name} after dark, in ${clock(untilNight())}`, s, 'glow', castRange());
  return at(`${what} below ${L.name}`, s, 'glow', castRange());
}
function lairStep(): Step {
  const r = rodFor(SP.oldone);
  if (r) return r;
  if (!isNight()) return at(`Sail to the Old One's lair. It comes up at night, in ${clock(untilNight())}`, LAIR, 'moon', castRange());
  return at('Catch the Old One at its lair', LAIR, 'moon', castRange());
}

function questStep(q: Quest): Step {
  const t: QuestTarget = q.target, b = G.boat;
  if (typeof t === 'object') {
    const pr = PROJECTS.find(p => p.id === t.project);
    return pr ? projectStep(pr) : { text: q.goal, icon: 'star', near: 0 };
  }
  switch (t) {
    case 'school': return fishStep('Catch fish at the school');
    case 'sell': return G.hold.length ? sellStep() : fishStep('Catch a fish to sell');
    case 'port': {
      const p = nearest(poisNear(b.x, b.y, SEARCH), p => p.type === 'port' && !G.found.has(p.id));
      return p ? at('Sail close to the new port to chart it', p, 'anchor', 60) : { text: 'Explore the coast to find another port', icon: 'anchor', near: 0 };
    }
    case 'light': {
      const p = nearest(poisNear(b.x, b.y, SEARCH), p => p.type === 'light' && !G.found.has(p.id));
      return p ? at('Sail close to the lighthouse to chart it', p, 'lantern', 60) : { text: 'Explore the coast to find lighthouses', icon: 'lantern', near: 0 };
    }
    case 'wreck': {
      const p = nearest(poisNear(b.x, b.y, SEARCH), p => p.type === 'wreck' && !G.salvaged.has(p.id));
      return p ? at('Salvage the wreck', p, 'map', 30 + boatDef().L * 0.5) : { text: 'Explore the coast to find a wreck', icon: 'map', near: 0 };
    }
    case 'night':
      if (!isNight()) return fishStep(`Night falls in ${clock(untilNight())}. Fish until then`);
      return fishStep('Catch a fish while it is night');
    case 'north': return at('Sail north into the cold water', { x: b.x, y: Math.min(b.y - 200, -1950) }, 'arrow', 0);
    case 'species': return speciesStep();
    case 'trophy': return fishStep(G.baitSel === 'none' ? 'Catch a trophy fish. Bait helps' : 'Catch a trophy fish');
    case 'ghost': {
      const r = rodFor(SP.ghost);
      if (r) return r;
      if (G.hold.length >= cap()) return sellStep();
      const w = nearest(poisNear(b.x, b.y, SEARCH), p => p.type === 'wreck' && p.school?.sp === SP.ghost && schoolShown(p.school));
      return w?.school ? at('Fish for the Ghost Carp by the wreck', w.school, 'map', castRange())
        : { text: 'Search far-off wrecks for the Ghost Carp', icon: 'map', near: 0 };
    }
    case 'lair': return lairStep();
  }
}
function speciesStep(): Step {
  const fresh = (s: School): boolean => !G.log[SPECIES[s.sp].id];
  const s = G.hold.length < cap() ? nearestSchool(fresh, 900) : null;
  if (s) return at('Catch a new species for your logbook', s, 'rod', castRange());
  if (G.hold.length >= cap()) return sellStep();
  if (UPGRADES.rod.costs[G.up.rod] !== undefined && G.coins >= UPGRADES.rod.costs[G.up.rod]) return buyStep('rod', 'rod');
  return { text: isNight() ? 'Fish in new places to find new species' : 'Fish in new places, or wait for night', icon: 'rod', near: 0 };
}
// after the story: the next harbour project, else the next upgrade you can afford, else the logbook
const UPGRADE_ORDER: UpgradeKey[] = ['hold', 'rod', 'sonar', 'prop', 'hull', 'reel', 'line', 'tackle', 'ice', 'lantern', 'bilge', 'spyglass', 'sextant'];
function freeStep(): Step {
  const pr = nextProject();
  if (pr) return projectStep(pr);
  if (G.hold.length >= cap()) return sellStep();
  const k = UPGRADE_ORDER.find(k => { const c = UPGRADES[k].costs[G.up[k]]; return c !== undefined && c <= G.coins; });
  if (k) return buyStep(k, UPGRADES[k].name(boatDef()).toLowerCase());
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

const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** "120 m north-east" from the boat, or '' when the place is right here. */
export function whereText(s: Step): string {
  if (!s.at) return '';
  const dx = s.at.x - G.boat.x, dy = s.at.y - G.boat.y, d = Math.hypot(dx, dy);
  if (d < Math.max(s.near, 25)) return '';
  const dir = DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
  return `${Math.max(1, Math.round(d / 10))} m ${dir}`;
}
/** The step with its distance and heading, for the chip and the journal. */
export function stepLine(s: Step = guide()): string {
  const w = whereText(s);
  return w ? `${s.text}, ${w}` : s.text;
}
/** Whether the marker should show: on, a place to show, not fishing, not already there. */
export function markerTarget(s: Step = guide()): Point | null {
  if (!guideOn() || !s.at || G.fish || G.card || G.mode !== 'play') return null;
  return dist(s.at) < s.near ? null : s.at;
}

// ---------- first-session tips ----------
const TIP_KEY = 'bobber-run-tips';
export type TipId = 'hull' | 'night';
// only what no prompt or toast already says: the cast and dock prompts teach fishing and selling, and the weather
// and a full hold get their own toasts
const TIPS: { id: TipId; text: string; when: () => boolean }[] = [
  { id: 'hull', text: 'Rocks and shallow water damage your hull. Repair it at any port', when: () => G.boat.hp < hpMax() * 0.6 },
  { id: 'night', text: 'Night brings out different fish. Glow lures work twice as fast in the dark', when: () => isNight() },
];
const TIP_S = 9, TIP_GAP = 14;
let seen: Partial<Record<TipId, true>> = {};
try { seen = JSON.parse(localStorage.getItem(TIP_KEY) || '{}'); } catch { }
let shown: { id: TipId; text: string; t: number } | null = null, lastT = -99;
/** The tip to show now, if any. Call once a frame while sailing: it notices the moments and remembers what was shown. */
export function tip(): { text: string; fade: boolean } | null {
  if (shown && G.t - shown.t > TIP_S) shown = null;
  if (!shown && G.mode === 'play' && !G.fish && !G.card && G.t - lastT > TIP_GAP) {
    const next = TIPS.find(t => !seen[t.id] && t.when());
    if (next) {
      shown = { id: next.id, text: next.text, t: G.t }; lastT = G.t; seen[next.id] = true;
      try { localStorage.setItem(TIP_KEY, JSON.stringify(seen)); } catch { }
    }
  }
  return shown && { text: shown.text, fade: G.t - shown.t > TIP_S - 0.6 };
}
