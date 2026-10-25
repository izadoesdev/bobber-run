// Fishing: casting, bites, strikes, the reel fight, landing a catch, nets/pots/deckhand catches, frenzies and chum.
import { nA } from '../noise';
import { packCatch } from '../content/engine';
import { masteryAfterCatch } from './mastery';
import { hAt, heightAt, homePort, schoolsNear } from '../world';
import { WX, biteMul, trophyBonus } from '../weather';
import { SPECIES, activeAt, fmtKg } from '../econ';
import { favBait, rollVariant, VARIANTS, type VariantId } from '../species';
import { sfx } from '../audio';
import { SET } from '../prefs';
import { netCatch } from '../net';
import { track, bucket } from '../analytics';
import type { BaitChoice, Escapee, FightStyle, Fish, FishLine, FishStock, School, Species, TreasureMap } from '../types';
import { G, boatDist, hit, held, nearest } from './state';
import { boatDef, canLand, cap, catchNeed, crewLvl, dayNum, deckLvl, env, harpoonLvl, isNight, lineMax, logged } from './rules';
import { clamp, dirTo, wrapAngle } from '../config';
import { setWaypoint } from '../waypoint';
import { addCoins, burst, jitter, spawn, toast } from './feedback';
import { placeAtPort, saveGame } from './save';
import { schoolActive, schoolShown, takeFish } from './schools';
import { isRunningNow } from '../tides';
import { biomeAt } from '../biome';

/**
 * Fight tuning, exposed on BR for tweaking. Reeling raises tension by `reel` a second plus `surge` times the fish's
 * surge and power; a slack reel lets it fall by `relax`, and a surge against a slack reel takes back `take` of the catch.
 */
export const TUNE = { reel: 0.22, surge: 0.95, relax: 0.7, take: 0.05 };
/** Seconds after the hook with no surge and the tension held under the amber line; the opening seconds build tension gently. */
const GRACE = 1.5, OPENING = 3;
/** A new captain (fewer catches than this) gets a wider strike window and a later red zone. */
const NEW_CAPTAIN = 10;

/** Chance the golden fish of a school is the one that bites, and what it is worth over a trophy. */
const GOLD_BITE = 0.4, GOLD_VALUE = 2.5;
/** Chance the fish that once broke your line is the one that bites at its school; how many are remembered at once. */
const BACK_BITE = 0.5, MAX_ESCAPED = 4;
/** Seconds of warning (a rod creak, the reel panel flashing) before every surge lands. */
const CUE_S = 0.5;
/** Quality at the hook: below 0.07 three stars, below 0.35 two, else one; and what each is worth. */
const STAR_ROLL = [0.07, 0.35], STAR_VALUE = [1, 1.25, 1.6];
/** The world holds still this long when a fish is hooked, and when a 3-star or legendary one is landed. */
const HITSTOP = 0.1;
export const hitstop = (): boolean => G.t - G.hookT < HITSTOP;

export const castRange = (): number => 50 + boatDef().L * 0.5;
/** A new captain's first few fish can't get away: they hook themselves and the line never snaps. */
const learning = (): boolean => G.stats.caught < 3;

/**
 * A new voyage starts a few boat lengths from a school that bites now, bow pointing at it, so the first cast comes
 * within seconds (no school in reach: at the pier, as before).
 */
export function placeByStarterSchool(anchor?: { x: number; y: number }): void {
  const hp = anchor ?? homePort(), b = G.boat, r = castRange() * 0.5;
  const starter = (s: School): boolean => schoolActive(s) && !s.boss && SPECIES[s.sp].rod === 0 && !SPECIES[s.sp].legend;
  const near = [...schoolsNear(hp.x, hp.y, 700)].filter(starter).sort((p, q) => Math.hypot(p.x - hp.x, p.y - hp.y) - Math.hypot(q.x - hp.x, q.y - hp.y));
  for (const s of near) for (let k = 0; k < 8; k++) {
    const a = Math.atan2(hp.y - s.y, hp.x - s.x) + k * Math.PI / 4, x = s.x + Math.cos(a) * r, y = s.y + Math.sin(a) * r;
    if (heightAt(x, y) > -0.12) continue;                       // open water, clear of the shore
    Object.assign(b, { x, y, px: x, py: y, a: Math.atan2(s.y - y, s.x - x), vx: 0, vy: 0, w: 0 });
    return;
  }
  if (anchor) placeByStarterSchool();                            // nothing biting by the shared spot: start from home
  else placeAtPort(homePort());
}
/**
 * The closest biting school within casting range that this rod and boat can land; failing that the closest at all, so
 * the prompt can say what it needs. A hotspot mixes rod levels, and a catchable fish beside one you can't land comes first.
 */
export function nearestSchool(): School | null {
  const near = schoolsNear(G.boat.x, G.boat.y, 90);
  return nearest(near, s => schoolActive(s) && !catchNeed(s.sp), castRange()) ?? nearest(near, schoolActive, castRange());
}

export function cancelFishing(msg?: string): void {
  if (G.fish && msg) toast(msg);
  G.fish = null;
}
const deny = (msg: string): void => { toast(msg, 'bad'); sfx('deny'); };
export function tryCast(s: School): void {
  const sp = SPECIES[s.sp];
  if (G.hold.length >= cap()) return deny('Your hold is full. Sell your fish at a port');
  const need = catchNeed(s.sp);
  if (need) return deny(`${sp.name} ${need}`);
  const bait = G.baitSel !== 'none' && G.bait[G.baitSel] > 0 ? G.baitSel : null;
  if (bait) G.bait[bait]--;
  G.fish = {
    st: 'cast', s, t: 0, tx: s.x + jitter(8), ty: s.y + jitter(8), tension: 0, prog: 0, ph: Math.random() * 6, wait: 0, reelT: 0,
    bait, frenzy: !!G.frenzy && G.frenzy.s === s, perfect: false, hint: escapeeAt(s) ? `The ${sp.name} that broke your line lives here` : castHint(sp, bait),
  };
  sfx('cast');
}
const BAIT_NAME = { shrimp: 'shrimp bait', glow: 'glow lures' } as const;
/** One short note for the wait: the bait this fish prefers, or the conditions it needs. */
function castHint(sp: Species, bait: BaitChoice | null): string {
  const fav = favBait(sp);
  if (bait !== fav) return `${sp.name} bite faster on ${BAIT_NAME[fav]}`;
  if (sp.weather === 'storm') return `${sp.name} only bite in storms`;
  if (sp.weather === 'rain') return `${sp.name} only bite in the rain`;
  if (sp.time === 'twilight') return `${sp.name} only bite at dusk and dawn`;
  return `${sp.name} love ${BAIT_NAME[fav]}, so they bite sooner`;
}

/** How hard each kind of fish pulls at fight phase `ph` (0 = slack, >1 = a surge). */
const FIGHT: Record<FightStyle, (ph: number) => number> = {
  steady: ph => 0.45 + 0.25 * Math.sin(ph * 0.6),
  darter: ph => Math.pow(Math.max(0, Math.sin(ph * 1.9)), 5) * 2.6 + 0.1,
  generic: ph => Math.max(0, Math.sin(ph) * 1.3 + Math.sin(ph * 2.7 + 1) * 0.6 - 0.2),
  jumper: ph => Math.max(0, Math.sin(ph) * 1.1 + Math.sin(ph * 2.7 + 1) * 0.5 - 0.2),
  erratic: ph => Math.max(0, nA(ph * 0.8, 3.1) * 1.85 + 0.15),
  boss: ph => Math.max(0, nA(ph * 0.7, 9.7) * 1.5 + 0.1),
};

export function updateFishing(dt: number): void {
  const f = G.fish;
  if (!f) return;
  f.t += dt;
  const b = G.boat;
  if (f.st !== 'reel' && Math.hypot(f.tx - b.x, f.ty - b.y) > 80) { cancelFishing('You sailed too far from your bobber, so you reeled in'); return; }   // a hooked fish keeps the line
  const strike = hit(' ');
  if (f.st === 'cast') castStage(f);
  else if (f.st === 'wait') waitStage(f, dt, strike);
  else if (f.st === 'bite') biteStage(f, strike);
  else reelStage(f, dt, strike);
}

// Bite patterns: the nibbles each kind of fish makes first, as seconds before the real bite.
const TEASES: Record<FightStyle, () => number[]> = {
  steady: () => Math.random() < 0.5 ? [1.2] : [1.8, 0.9],   // a nibble or two, then it takes it
  darter: () => [0.85, 0.45],                                // a quick double dip
  generic: () => [1.3],                                      // a nibble, then it runs with the bait
  jumper: () => [1.1],                                       // a swirl at the surface first
  erratic: () => Array.from({ length: Math.floor(Math.random() * 4) }, (_, i) => 0.5 + i * 0.4 + Math.random() * 0.3).reverse(),
  boss: () => [2.4, 1.3],
};
const RUNS: ReadonlySet<FightStyle> = new Set<FightStyle>(['generic', 'boss']);
/** Chance one of the nibbles is a fake-out instead: a big dip, a splash, no thump. */
const FAKE_OUT: Record<FightStyle, number> = { steady: 0.05, darter: 0.2, generic: 0.15, jumper: 0.15, erratic: 0.3, boss: 0.25 };

function castStage(f: FishLine): void {
  if (f.t < 0.55) return;
  f.st = 'wait'; f.t = 0;
  const rod = G.up.rod, sp = SPECIES[f.s.sp];
  const fits = f.bait === favBait(sp), wrong = !!f.bait && !fits;   // the bait it loves comes sooner; the wrong one is picked at
  const baitMul = (f.bait === 'glow' && isNight() ? 0.5 : f.bait ? 0.75 : 1) * (fits ? 0.8 : wrong ? 1.15 : 1);
  f.wait = Math.max(0.4, 1 - 0.15 * G.dry) * (2.5 + Math.random() * 4.5) * (1 - 0.1 * rod) * (f.frenzy ? 0.4 : 1) * baitMul * biteMul() * (1 - 0.12 * G.up.tackle)
    * (isRunningNow(sp.id) ? 0.75 : 1);           // this week's running fish bite sooner
  if (f.s.gold) f.wait *= 0.6;                                  // a golden school bites quickly, and never teases
  const teases = [...TEASES[sp.fight](), ...(wrong || !f.bait ? [0.6 + Math.random() * 0.5] : [])].sort((p, q) => q - p);
  f.teases = f.s.gold ? [] : teases.filter(before => before < f.wait - 0.3);
  f.fake = !f.s.gold && f.teases.length > 0 && Math.random() < FAKE_OUT[sp.fight] ? Math.floor(Math.random() * f.teases.length) : undefined;
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.9, r0: 1, grow: 5 });
  sfx('plop', 0.5);
}

/** A nibble: the bobber twitches (and jumpers swirl at the surface), but it isn't the bite yet. A fake-out dips it
 *  right under, with a splash but no bite's thump. */
function tease(f: FishLine, sp: Species, fake: boolean): void {
  f.teaseT = G.t;
  if (fake) {
    f.fakeT = G.t;
    spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.7, r0: 1, grow: 7 });
    burst('dot', f.tx, f.ty, 8, 22, 0.4);
    sfx('plop', 0.7);
    return;
  }
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.6, r0: 1, grow: 3 });
  if (sp.fight === 'jumper') {
    const x = f.tx + jitter(6), y = f.ty + jitter(4);
    spawn({ kind: 'ring', x, y, life: 0.9, r0: 1, grow: 6 });
    burst('dot', x, y, 5, 18, 0.4);
  }
  sfx('nibble');
}

function waitStage(f: FishLine, dt: number, strike: boolean): void {
  const nibbling = f.teaseT !== undefined && G.t - f.teaseT < 0.8, faked = f.fakeT !== undefined && G.t - f.fakeT < 0.8;
  if (strike) {
    toast(faked ? 'A fake-out! Wait for the thump' : nibbling ? 'Just a nibble' : 'Too early');
    f.wait += faked ? 2 : 1.2; sfx('deny', 0.5); G.dry++;
  }
  if (Math.random() < dt * 0.8) spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.8, r0: 2, grow: 3 });
  const next = f.teases?.[0];
  if (next !== undefined && f.t >= f.wait - next) { tease(f, SPECIES[f.s.sp], f.fake === 0); f.teases!.shift(); f.fake = f.fake ? f.fake - 1 : undefined; }
  if (f.t >= f.wait) startBite(f);
}

function startBite(f: FishLine): void {
  const sp = SPECIES[f.s.sp], b = G.boat;
  f.st = 'bite'; f.t = 0; f.win = strikeWindows(sp);
  const back = escapeeAt(f.s);
  if (back && Math.random() < BACK_BITE) { f.back = back; f.gold = !!back.gold; }
  else f.gold = !!f.s.gold && Math.random() < GOLD_BITE;
  if (RUNS.has(sp.fight)) f.run = Math.atan2(f.ty - b.y, f.tx - b.x) + jitter(1.2);
  sfx('bite');
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.8, r0: 1, grow: 9 });   // the bobber plunges: unmistakable
  burst('dot', f.tx, f.ty, 12, 28, 0.5);
}
/** 0 for a sprat up to 1 for half a tonne: how much a fish's weight makes its fight longer and its surges harder. */
const heft = (kg: number): number => clamp(Math.log10(kg + 1) / Math.log10(500), 0, 1);
/** Seconds of steady reeling a fish takes: a few for a small one, half a minute for a giant; each rod level beyond what
 *  the species needs, the reel and the harpoon shorten it. */
function fightLength(sp: Species, kg: number): number {
  const big = sp.legend || sp.rod >= 3, edge = Math.min(3, Math.max(0, G.up.rod - sp.rod));
  return (3.5 + 27 * heft(kg)) * (1 - 0.08 * edge) / (1 + 0.12 * G.up.reel) / (1 + 0.25 * (big ? harpoonLvl() : 0));
}
/** Does the fight pattern surge (above 0.9) within the next CUE_S, at `rate` of phase per second? */
const surgeWithin = (pattern: (ph: number) => number, ph: number, rate: number, secs: number): boolean =>
  Array.from({ length: 31 }, (_, i) => pattern(ph + rate * secs * i / 30)).some(v => v > 0.9);
/** [perfect, any] strike windows in seconds; relaxed strikes and each recent miss widen both, rarer fish narrow them a little. */
function strikeWindows(sp: Species): [number, number] {
  const rod = G.up.rod, rare = clamp(0.7 + 0.06 * sp.w, 0.75, 1);
  const relaxed = (SET.strike === 'relaxed' ? 1.6 : 1) * (1 + 0.2 * Math.min(3, G.dry)) * rare * (G.stats.caught < NEW_CAPTAIN ? 1.5 : 1);   // pity: each miss widens the window
  const perfect = ((boatDef().prop === 'OARS' ? 0.32 : 0.2) + 0.03 * rod + 0.05 * Math.max(0, G.up.tackle - 1)) * relaxed;
  return [perfect, (0.75 + 0.12 * rod) * relaxed];
}

function biteStage(f: FishLine, strike: boolean): void {
  const sp = SPECIES[f.s.sp];
  const [perfectWin, biteWin] = f.win ??= strikeWindows(sp);
  const auto = (crewLvl() >= 2 && f.t > 0.42) || (SET.strike === 'auto' && f.t > 0.3) || (learning() && f.t > Math.min(0.6, biteWin * 0.6));
  if (strike || auto) {
    f.perfect = f.t < perfectWin; f.reeling = true;
    hooked(f, f.perfect ? 0.1 : 0.25, f.perfect ? 0.2 : 0.08);
  } else if (f.t > biteWin) {
    toast('It got away');
    track('fish_lost', { species: sp.id, reason: 'missed_strike' });
    f.st = 'wait'; f.t = 0;
    f.wait = (2 + Math.random() * 3) * Math.max(0.4, 1 - 0.15 * ++G.dry);
  }
}

/** The fish is on and the fight starts; a perfect strike is made unmistakable (the reel panel names a golden fish). */
function hooked(f: FishLine, tension: number, prog: number): void {
  f.st = 'reel'; f.t = 0; f.tension = tension; f.prog = prog; G.dry = 0; G.hookT = G.t;
  sfx(f.perfect ? 'perfect' : 'plop');
  f.fx = f.tx; f.fy = f.ty;
  const sp = SPECIES[f.s.sp], b = G.boat, r = Math.random();
  // a grace after the hook: the fight holds still through it, from a point where the next CUE_S is calm, so the first
  // surge comes after the grace and is announced like the rest
  for (let k = 0; k < 300 && surgeWithin(FIGHT[sp.fight], f.ph, 1.5 + sp.diff * 2.5, CUE_S); k++) f.ph += 0.05;
  f.grace = GRACE; f.redAt = G.stats.caught < NEW_CAPTAIN ? 0.85 : 0.8;
  // what's on the line shows from the hook: its quality (a perfect strike, or the bait it loves, helps) and any variant,
  // its size, and so how long the fight will be
  f.stars = Math.min(3, (r * (f.bait === favBait(sp) ? 0.8 : 1) < STAR_ROLL[0] ? 3 : r < STAR_ROLL[1] ? 2 : 1) + (f.perfect ? 1 : 0)) as 1 | 2 | 3;
  if (!f.back) f.variant = rollVariant(f.s.sp, { storm: WX.state === 'storm', biome: biomeAt(b.x, b.y), night: isNight() }, Math.random()) ?? undefined;
  Object.assign(f, rollSize(f.s.sp, f));
  f.kg = f.back?.kg ?? kgOf(sp, f.size!, f.variant);
  f.len = fightLength(sp, f.kg) * (1 - 0.35 * sp.diff) * (sp.fight === 'boss' ? 0.45 : 1);   // hard fish surge often, which slows them anyway; the Old One fights three rounds
  if (sp.deck >= 1 || sp.legend) f.tow = { len: clamp(Math.hypot(f.tx - b.x, f.ty - b.y), 20, 50), h: Math.atan2(f.ty - b.y, f.tx - b.x) + jitter(1.6), turnT: 2 + Math.random() * 2 };
  if (f.back) toast(`It's the ${sp.name} that broke your line on day ${f.back.day}!`, 'good');
  if (f.perfect) {
    burst('spark', f.tx, f.ty, 14, 34, 0.8);
    spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 1, r0: 2, grow: 10 });
  }
}

/** Where the hooked fish swims: reeled closer as the catch fills, thrown out by surges, weaving side to side. */
function swimFish(f: FishLine, dt: number, surge: number): void {
  const b = G.boat, dx = f.tx - b.x, dy = f.ty - b.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const along = Math.min(2, surge) * 5 - Math.min(1, f.prog) * d * 0.45, side = Math.sin(f.ph * 0.7) * 5;
  const k = 1 - Math.exp(-3 * dt), x = f.tx + ux * along - uy * side, y = f.ty + uy * along + ux * side;
  f.fx = f.fx === undefined ? x : f.fx + (x - f.fx) * k;
  f.fy = f.fy === undefined ? y : f.fy + (y - f.fy) * k;
}

/** Jumpers and the boss leap now and then; reeling mid-jump strains the line. */
function updateJumps(f: FishLine, dt: number, reeling: boolean): void {
  if (f.jumpT === undefined) f.jumpT = 2 + Math.random() * 2;
  if (f.jump) {
    f.jump.t += dt;
    if (reeling) f.tension += 1.6 * dt;
    if (f.jump.t > 0.75) {                               // splashdown
      f.jump = null;
      const x = f.fx ?? f.tx, y = f.fy ?? f.ty;
      spawn({ kind: 'ring', x, y, life: 1, r0: 2, grow: 7 });
      burst('dot', x, y, 8, 30, 0.5);
      sfx('oar');
    }
  } else if ((f.jumpT -= dt) <= 0) {
    f.jump = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
    f.jumpT = 2.2 + Math.random() * 2.2;
    sfx('oar', 0.8);
  }
  f.jumpWarn = !f.jump && f.jumpT < 0.5;
}

/** Line a towing fish can take before the spool is empty. */
export const SPOOL = 75;
/** How far the line is stretched past what is let out (physics tows the boat while it is positive). */
export const towStretch = (f: FishLine, tow: Tow): number => Math.hypot((f.fx ?? f.tx) - G.boat.x, (f.fy ?? f.ty) - G.boat.y) - tow.len;
type Tow = NonNullable<FishLine['tow']>;
/** 1 for a tarpon up to 2 for a manta: heavier fish run harder and take longer to tire. */
const towHeft = (f: FishLine): number => { const [lo, hi] = SPECIES[f.s.sp].kg; return 1 + Math.min(1, (lo + hi) / 1200); };
/**
 * A sea giant runs through deep water and the line drags the boat after it. When the boat can't keep up (broadside,
 * braking, aground) the reel pays out line and the fish wins a little back; once the spool is empty the strain goes
 * on the line. Towing a boat tires it, and more so with the engine backing, though that strains the line too.
 */
function runWithLine(f: FishLine, tow: Tow, dt: number, surge: number, diff: number, reeling: boolean): void {
  const b = G.boat, heavy = towHeft(f), speed = (3 + 8 * Math.min(1.6, surge)) * (0.6 + 0.4 * diff) * heavy, braking = Math.max(0, -b.thr);
  tow.h += nA(f.ph * 0.25, 5.3) * 1.4 * dt;                                                        // it wanders,
  if ((tow.turnT -= dt) <= 0) { tow.turnT = 3 + Math.random() * 3; tow.h += (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 1.2); }   // breaks off on a new line now and then,
  if (hAt(f.tx + Math.cos(tow.h) * 30, f.ty + Math.sin(tow.h) * 30) > -0.15) tow.h += 2.4 * dt;   // and keeps to deep water
  f.tx += Math.cos(tow.h) * speed * dt; f.ty += Math.sin(tow.h) * speed * dt;
  if (Math.random() < dt * speed * 0.6) spawn({ kind: 'dot', x: (f.fx ?? f.tx) + jitter(3), y: (f.fy ?? f.ty) + jitter(3), vx: -Math.cos(tow.h) * 14 + jitter(6), vy: -Math.sin(tow.h) * 14 + jitter(6), life: 0.6 });
  if (reeling) tow.len = Math.max(15, tow.len - 6 * dt);                                           // reeling takes line back in
  const stretch = towStretch(f, tow);
  if (stretch <= 0) return;
  const give = clamp((stretch - 5) * 0.8, 0, 14) * dt;                                               // the reel's drag holds, then gives
  if (tow.len < SPOOL) { tow.len = Math.min(SPOOL, tow.len + give); f.prog = Math.max(0, f.prog - give * 0.004); }
  else if (!SET.reelAssist) f.tension += stretch * 0.12 * dt;                                      // nothing left to give
  f.prog += Math.min(1, stretch / 6) * 0.03 * (1 + braking) / heavy * dt;
  f.tension += braking * 0.35 * dt;
  const off = Math.abs(wrapAngle(Math.atan2((f.fy ?? f.ty) - b.y, (f.fx ?? f.tx) - b.x) - b.a));
  if (!SET.reelAssist) f.tension += Math.max(0, off - 1.2) * 0.4 * dt;                            // abaft the beam the line drags along the hull (easy reel minds it)
}

export const escapeeAt = (s: School): Escapee | undefined => G.escaped.find(e => e.school === s.id && e.sp === s.sp);
/**
 * Hotspots dive and come back as other fish, so a fish that got away follows its kind: when its school is no longer
 * shown with its species, it moves to the nearest shown school of that species (and its ring on the chart with it).
 */
export function rehomeEscapees(): void {
  for (const e of G.escaped) {
    if (schoolsNear(e.x, e.y, 80).some(s => s.id === e.school && s.sp === e.sp && schoolShown(s))) continue;
    const s = nearest(schoolsNear(e.x, e.y, 1500).filter(q => q.sp === e.sp && !q.boss), schoolShown, 1500);
    if (s) Object.assign(e, { school: s.id, x: Math.round(s.x), y: Math.round(s.y) });
  }
}
/**
 * A fish worth remembering that breaks the line after a real fight (golden, legendary, a sea giant, or a hard fish
 * half landed) stays with its school, wearing your hook, until you land it. One that gets away again grows a little.
 */
function remember(f: FishLine): boolean {
  const sp = SPECIES[f.s.sp];
  if (f.back) { f.back.lost++; f.back.kg = Math.round(f.back.kg * 105) / 100; saveGame(); return true; }
  const worthy = f.gold || sp.legend || sp.deck >= 1 || (sp.diff >= 0.45 && f.prog >= 0.5);
  if (!worthy || f.prog < 0.25 || f.s.boss) return false;
  const kg = Math.round((sp.kg[0] + (sp.kg[1] - sp.kg[0]) * (0.85 + Math.random() * 0.15)) * 100) / 100;
  const keep = G.escaped.filter(e => e.school !== f.s.id).slice(-(MAX_ESCAPED - 1));
  G.escaped = [...keep, { school: f.s.id, x: Math.round(f.s.x), y: Math.round(f.s.y), sp: f.s.sp, kg, ...(f.gold && { gold: true }), day: dayNum(), lost: 1 }];
  if (f.gold) f.s.gold = false;                    // the golden fish is the one that got away now
  saveGame();
  return true;
}

/**
 * Every surge is announced CUE_S ahead (`ahead` is the fight pattern that far along): the rod creaks and the reel
 * flashes. A surge counts as passed once the pull ahead falls well below it, so a wobbling pull is one surge, not many.
 */
function telegraph(f: FishLine, ahead: number, surge: number, dt: number): void {
  f.cue = Math.max(0, (f.cue ?? 0) - dt);
  if (!f.cued && ahead > 0.9) { f.cued = true; f.cue = CUE_S; sfx('creak'); }
  else if (f.cued && ahead < 0.6) f.cued = false;
  f.warn = f.cue > 0 || surge > 0.9;
}

function reelStage(f: FishLine, dt: number, strike: boolean): void {
  const sp = SPECIES[f.s.sp], rod = G.up.rod, diff = sp.diff;
  const pattern = FIGHT[sp.fight], stage = f.stage || 0;
  if (!f.grace) f.ph += dt * (1.5 + diff * 2.5);                  // the fight holds still through the grace
  const surge = pattern(f.ph), easy = SET.reelAssist, big = sp.legend || sp.rod >= 3;
  // how hard it pulls: heavier fish harder, each round of the Old One harder still, a fish that got away before harder
  // (it has learned), the harpoon gun and easy reel softer
  const power = (0.45 + 0.55 * heft(f.kg ?? 1)) * (1 + 0.1 * stage) * (1 - 0.12 * (big ? harpoonLvl() : 0)) * (f.back ? 1.2 : 1) * (easy ? 0.7 : 1);
  if (SET.reelToggle && strike) { f.reeling = !f.reeling; sfx('move', 0.4); }
  f.surge = surge;
  telegraph(f, pattern(f.ph + (1.5 + diff * 2.5) * CUE_S), surge, dt);
  const holding = SET.reelToggle ? !!f.reeling : held(' ');
  const auto = easy && !f.warn && f.tension < lineMax() * 0.5;    // easy reel reels by itself between surges
  const reeling = (holding || auto) && !(easy && f.jump);         // and lets go during jumps
  if (sp.fight === 'jumper' || sp.fight === 'boss') updateJumps(f, dt, reeling);
  if (f.tow) runWithLine(f, f.tow, dt, surge, diff, reeling);
  swimFish(f, dt, surge);
  f.reelOn = reeling;
  f.taking = !reeling && surge > 0.9;
  f.grace = Math.max(0, (f.grace ?? 0) - dt);
  if (reeling) {
    f.tension += (TUNE.reel + TUNE.surge * surge * power - 0.03 * rod) * dt * Math.min(1, 0.6 + 0.4 * f.t / OPENING);   // the opening builds gently
    f.prog += dt / (f.len ?? 6) * (1 - Math.min(0.6, surge * 0.35)) * (easy ? 0.6 : 1);
    if ((f.reelT += dt) > 0.07) { f.reelT = 0; sfx('reel'); }
  } else {
    f.tension -= (TUNE.relax + 0.03 * rod) * dt;
    if (f.taking) f.prog -= (surge - 0.9) * TUNE.take * power * dt;     // it runs against a slack reel and takes line back
  }
  f.tension = clamp(f.tension, 0, lineMax() * (f.grace ? 0.55 : learning() || easy ? 0.9 : Infinity));   // the grace, first fish and easy reel never snap
  if (f.tension > lineMax() * (f.redAt ?? 0.8)) f.strained = true;           // into the red: the catch loses a star
  if (surge > 1) G.shake = Math.max(G.shake, 0.6);
  if (Math.random() < dt * (3 + surge * 10)) spawn({ kind: 'dot', x: (f.fx ?? f.tx) + jitter(4), y: (f.fy ?? f.ty) + jitter(3), vx: jitter(18), vy: jitter(18), life: 0.35 });
  if (f.tension >= lineMax()) {
    sfx('snap');
    const kept = remember(f);
    toast(kept ? `The ${sp.name} got away with your hook. It's still out there, marked on your chart` : f.jump ? 'It threw the hook' : 'Your line snapped', 'bad');
    track('fish_lost', { species: sp.id, reason: f.jump ? 'threw_hook' : 'snapped', towed: !!f.tow, remembered: kept, again: !!f.back });
    G.fish = null;
  } else if (f.prog <= 0 && f.t > 1.5) {
    sfx('snap', 0.5);
    toast('It shook the hook. Reel in when it calms', 'bad');
    track('fish_lost', { species: sp.id, reason: 'shook_off', towed: !!f.tow, remembered: false, again: !!f.back });
    G.fish = null;
  } else if (f.prog >= 1 && sp.fight === 'boss' && stage < 2) {
    f.stage = stage + 1; f.prog = 0.12; f.tension = Math.min(f.tension, 0.4); G.shake = 4;
    sfx('crash', 0.6);
    toast(`Still fighting! ${f.stage + 1} of 3`, 'bad');
  } else if (f.prog >= 1) landHooked(f);
}

// ---------- landing a catch ----------
/** Size (0..1 across the species' range) and the trophy roll; good strikes, bait, frenzies, storms and bad luck streaks help. */
function rollSize(spIdx: number, f: FishLine | null, small = false): { size: number; trophy: boolean } {
  let r = Math.pow(Math.random(), 2.2);
  if (small) return { size: r * 0.4, trophy: false };   // the deckhand's catch: a small one, about 60% of the usual value, no trophy roll
  if (f?.perfect) r = Math.min(1, r + 0.1);
  const baitBonus = (f?.bait === 'shrimp' ? 0.05 : f?.bait === 'glow' ? 0.12 : 0) + (f && f.bait === favBait(SPECIES[spIdx]) ? 0.04 : 0);
  const chance = Math.min(0.3, 0.04 + G.pity * 0.006) + baitBonus + (f?.frenzy ? 0.1 : 0) + (f?.perfect ? 0.04 : 0) + trophyBonus();
  const trophy = !!f?.gold || Math.random() < chance;              // a golden fish is always a trophy, and worth more
  if (trophy) { r = Math.max(r, 0.82 + Math.random() * 0.18); G.pity = 0; }
  else G.pity++;
  return { size: r, trophy };
}
const kgOf = (s: Species, r: number, variant?: string): number =>
  Math.round((s.kg[0] + (s.kg[1] - s.kg[0]) * r) * (variant ? VARIANTS[variant as VariantId].sizeMul : 1) * 100) / 100;
/** Weight and value of a catch, from the size rolled at the hook (or now, for nets and the deckhand). */
function rollCatch(spIdx: number, f: FishLine | null, small = false): Fish {
  const s = SPECIES[spIdx], gold = !!f?.gold;
  if (f?.back) {                                        // the one that got away: the weight it had, and a story worth paying for
    const fish: Fish = { sp: spIdx, kg: f.back.kg, value: Math.round(s.base * 1.45 * (gold ? GOLD_VALUE : 1.8) * 1.3), trophy: true, t: G.clock };
    if (gold) fish.gold = true;
    return withRodMarks(fish, f);
  }
  const { size: r, trophy } = f?.size !== undefined ? { size: f.size, trophy: !!f.trophy } : rollSize(spIdx, f, small);
  const variant = f?.variant, kg = f?.kg ?? kgOf(s, r, variant);
  const value = s.base * (0.55 + 0.9 * r) * (small ? 0.75 : gold ? GOLD_VALUE : trophy ? 1.8 : 1) * STAR_VALUE[(f?.stars ?? 1) - 1];
  const fish: Fish = { sp: spIdx, kg, value: Math.max(1, Math.round(value)), trophy, t: G.clock };
  if (gold) fish.gold = true;
  if (variant) fish.variant = variant;
  return f ? withRodMarks(fish, f) : fish;
}
/** A rod catch keeps its stars and whether the strike was perfect (quests and mastery ask for them). */
function withRodMarks(fish: Fish, f: FishLine): Fish {
  if (f.stars) fish.stars = f.stars;
  if (f.perfect) fish.perfect = true;
  return fish;
}

/** Remember where a species was caught: the school's spot (or the boat's), newest first, a few spots far enough apart. */
const SPOTS = 6, SPOT_GAP = 150;
const isSchool = (s: FishStock): s is School => 'x' in s;
function spotsWith(was: [number, number][] | undefined, stock: FishStock): [number, number][] {
  const p: { x: number; y: number } = isSchool(stock) ? stock : G.boat;
  const here: [number, number] = [Math.round(p.x / 10) * 10, Math.round(p.y / 10) * 10];
  const rest = (was ?? []).filter(([x, y]) => Math.hypot(x - here[0], y - here[1]) >= SPOT_GAP);
  return [here, ...rest].slice(0, SPOTS);
}
/** Put a fish in the hold and update stock, logbook, records and stats. Returns what the card shows. */
function recordCatch(spIdx: number, stock: FishStock, f: FishLine | null, method: Method): { fish: Fish; first: boolean; record: boolean; firstTrophy: boolean } {
  const sp = SPECIES[spIdx], fish = rollCatch(spIdx, f, method === 'deckhand');
  G.hold.push(fish);
  takeFish(stock);
  if (WX.state === 'storm') G.stats.storm = (G.stats.storm || 0) + 1;
  const prev = G.log[sp.id];
  const first = !prev, record = !!prev && fish.kg > prev.best, firstTrophy = fish.trophy && !prev?.trophy;
  const vars = fish.variant && !prev?.vars?.includes(fish.variant) ? [...prev?.vars ?? [], fish.variant] : prev?.vars;
  G.log[sp.id] = { n: (prev?.n || 0) + 1, best: Math.max(prev?.best || 0, fish.kg), trophy: !!(prev?.trophy || fish.trophy), at: spotsWith(prev?.at, stock), ...(vars && { vars }) };
  if (first || record) netCatch(sp.id, fish.kg, G.cheated);          // a personal best goes on the world record board
  masteryAfterCatch(spIdx, prev?.n ?? 0);
  G.stats.caught++;
  packCatch(fish, G.boat.x, G.boat.y, method === 'rod');        // content quests count catches as they land
  track('fish_caught', { species: sp.id, method, kg_bucket: bucket(fish.kg), trophy: !!fish.trophy, golden: !!fish.gold, legend: !!sp.legend,
    first, perfect: !!f?.perfect, rod: G.up.rod, towed: !!f?.tow, got_back: !!f?.back, variant: fish.variant ?? 'none', stars: f?.stars ?? 0 });
  if (first) track('species_logged', { species: sp.id, logged: logged() });
  if (fish.trophy) G.stats.trophies++;
  if (isNight()) G.stats.night++;
  if (f?.frenzy) G.stats.frenzy++;
  return { fish, first, record, firstTrophy };
}

/** Sometimes a bottle comes up with the fish: a treasure map, a few coins, or bait. */
function bottleBonus(sp: Species): string | null {
  if (Math.random() >= 0.12) return null;
  const map = G.maps.length < 2 && Math.random() < 0.4 ? makeMap() : null;
  if (map) { G.maps.push(map); return 'You also found a bottle with a treasure map. It is marked on your chart'; }
  if (Math.random() < 0.6) {
    const c = 6 + Math.floor(Math.random() * (10 + sp.base * 0.4));
    addCoins(c);
    return `You also found a bottle with $${c} inside`;
  }
  G.bait.shrimp += 3;
  return 'You also found 3 shrimp bait';
}

function holdFullNote(): void {
  if (G.hold.length >= cap()) toast('Your hold is full. Sell your fish at a port', 'good');
}

/** The fish on the line is landed: catch card, bonus, and maybe a deckhand's extra catch. */
function landHooked(f: FishLine): void {
  const spIdx = f.s.sp, sp = SPECIES[spIdx];
  f.stars = clamp((f.stars ?? 1) - (f.strained ? 1 : 0), 1, SET.reelAssist ? 2 : 3) as 1 | 2 | 3;   // a fight in the red costs a star; easy reel tops out at two
  const { fish, first, record } = recordCatch(spIdx, f.s, f, 'rod');
  if (f.back) G.escaped = G.escaped.filter(e => e.school !== f.s.id);
  else if (fish.gold) f.s.gold = false;
  G.card = { fish, first, record, perfect: f.perfect, bonus: bottleBonus(sp), t: 0, back: f.back, stars: f.stars };
  const big = f.stars === 3 || !!sp.legend;
  if (big) G.hookT = G.t;                                         // a moment's stillness for a big one
  sfx(big || G.stats.caught === 1 ? 'stinger' : fish.trophy || first ? 'fanfare' : 'catch');
  if (G.pet && Math.random() < 0.35) setTimeout(() => sfx('meow', 0.6), 900);   // the cat approves
  G.catchAnim = { sp: spIdx, t: 0, x: f.fx ?? f.tx, y: f.fy ?? f.ty };
  holdFullNote();
  G.fish = null;
  bonusFromDeckhand(f.s);
  saveGame();
}

type Method = 'rod' | 'net' | 'deckhand' | 'pots';
/** How each catch made without the rod is tracked, and how its toast starts. */
const CATCHERS = { NETTED: ['net', 'Your drift net caught'], DECKHAND: ['deckhand', 'Your deckhand landed'], POTS: ['pots', 'Your crab pots hauled'] } as const;
/** A catch made without the rod: the drift net, crab pots or the deckhand. */
export function landNetted(spIdx: number, stock: FishStock, who: keyof typeof CATCHERS = 'NETTED'): void {
  const sp = SPECIES[spIdx], [method, by] = CATCHERS[who];
  const { fish, firstTrophy } = recordCatch(spIdx, stock, null, method);
  // the drift net works every few seconds, so it only speaks up for a trophy; the deckhand and pots always say so
  if (who !== 'NETTED' || firstTrophy) toast(`${by} ${firstTrophy ? 'a trophy ' : ''}${sp.name}, ${fmtKg(fish.kg)}`, firstTrophy ? 'good' : 'info');
  sfx('coin', 0.5);
  holdFullNote();
  if (who !== 'DECKHAND') saveGame();                   // the deckhand's catch is saved with yours
}
/** Stand-in stock for catches that don't deplete a school. */
export const endlessStock = (): FishStock => ({ stock: 99, max: 99 });

/**
 * A deckhand sometimes lands a second, smaller fish from the school you just fished (about 60% of the value, never a
 * trophy). It leaves the last free slot for your own catch, takes from the school's stock, and skips legends.
 */
export function bonusFromDeckhand(s: School): void {
  const chance = [0, 0.25, 0.4][crewLvl()];
  if (!chance || s.boss || SPECIES[s.sp].legend || s.stock <= 0 || cap() - G.hold.length < 2 || Math.random() > chance) return;
  landNetted(s.sp, s, 'DECKHAND');
}

/** A treasure X on shallow water 500-1400 units away, or null if none found. */
function makeMap(): TreasureMap | null {
  const b = G.boat;
  for (let k = 0; k < 80; k++) {
    const a = Math.random() * 6.283, d = 500 + Math.random() * 900;
    const x = b.x + Math.cos(a) * d, y = b.y + Math.sin(a) * d, h = heightAt(x, y);
    if (h > -0.16 && h < -0.05) return { id: Math.random().toString(36).slice(2, 7), x: Math.round(x), y: Math.round(y), reward: Math.round(150 + d * 0.25 + Math.random() * 150) };
  }
  return null;
}

// ---------- frenzies ----------
const frenzyOk = (s: School): boolean => !s.boss && !SPECIES[s.sp].legend;
function startFrenzy(s: School, seconds: number): void {
  s.stock = Math.max(s.stock, 6);
  s.spooked = 0; s.scatterT = undefined; s.heat = 0;
  G.frenzy = { s, until: G.t + seconds };
}
// A deep bloom: the Flagship's own job. Far out over deep water a school only its deck can land (giant squid,
// sunfish) boils at the surface for a few minutes; the game says where, the chart marks it, and the waypoint's dots
// lead there. Like any frenzy, bites come fast and trophies are likelier.
function deepBloom(): boolean {
  const b = G.boat, cands = schoolsNear(b.x, b.y, 1200).filter(s => {
    const d = boatDist(s);
    return d > 400 && SPECIES[s.sp].deck >= 2 && activeAt(s.sp, env()) && canLand(s.sp) && frenzyOk(s);
  });
  if (!cands.length) return false;
  const s = cands[Math.floor(Math.random() * cands.length)];
  startFrenzy(s, 120);
  if (!G.waypoint) setWaypoint(s.x, s.y);
  toast(`A deep bloom far out: ${SPECIES[s.sp].name} rising, ${Math.round(boatDist(s) / 10)} m ${dirTo(b.x, b.y, s.x, s.y)}`, 'good');
  sfx('gulls');
  return true;
}
export function updateFrenzy(dt: number): void {
  if (WX.state === 'storm') G.nextFrenzy -= dt * 0.5;   // storms bring frenzies sooner
  if (G.frenzy && Math.random() < dt * 7) {             // fish breaking the surface
    const s = G.frenzy.s, x = s.x + jitter(22), y = s.y + jitter(14);
    spawn({ kind: 'ring', x, y, life: 0.7, r0: 1, grow: 4 });
    burst('dot', x, y, 3, 16, 0.4);
  }
  if (G.frenzy && G.t > G.frenzy.until) {
    G.frenzy = null;
    G.nextFrenzy = G.t + (300 + Math.random() * 240) * (G.up.radio ? 0.8 : 1);   // an event: one every 5 to 9 minutes
  }
  if (!G.frenzy && G.t > G.nextFrenzy && deckLvl() >= 2 && Math.random() < 0.5 && deepBloom()) return;
  if (!G.frenzy && G.t > G.nextFrenzy) {
    const cands = schoolsNear(G.boat.x, G.boat.y, 420).filter(s => {
      const d = boatDist(s);
      return d > 120 && d < 420 && activeAt(s.sp, env()) && canLand(s.sp) && frenzyOk(s);
    });
    if (cands.length) {
      const s = cands[Math.floor(Math.random() * cands.length)];
      startFrenzy(s, 40);
      toast(`Feeding frenzy! ${SPECIES[s.sp].name} are biting fast. Follow the gulls`, 'good');
      sfx('gulls');
    } else G.nextFrenzy = G.t + 20;
  }
}
export function useChum(): void {
  if (!(G.bait.chum > 0)) return deny('No chum. Buy some at a port');
  const s = nearest(schoolsNear(G.boat.x, G.boat.y, 170), q => schoolActive(q) && frenzyOk(q));
  if (!s) return deny('No school close enough to chum');
  G.bait.chum--;
  startFrenzy(s, 45);
  sfx('splash'); sfx('gulls');
  toast(`You threw chum. The ${SPECIES[s.sp].name} are in a feeding frenzy`, 'good');
  for (let i = 0; i < 14; i++) spawn({ kind: 'dot', x: s.x + jitter(20), y: s.y + jitter(14), vx: 0, vy: 0, life: 1.5, foam: true });
}
