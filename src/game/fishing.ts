// Fishing: casting, bites, strikes, the reel fight, landing a catch, nets/pots/deckhand catches, frenzies and chum.
import { nA } from '../noise';
import { heightAt, schoolsNear } from '../world';
import { WX, biteMul, trophyBonus } from '../weather';
import { SPECIES, activeAt, fmtKg } from '../econ';
import { favBait } from '../species';
import { sfx } from '../audio';
import { SET } from '../prefs';
import { netCatch } from '../net';
import { track, bucket } from '../analytics';
import type { BaitChoice, CatchCard, FightStyle, Fish, FishLine, FishStock, School, Species, TreasureMap } from '../types';
import { G, hit, held } from './state';
import { boatDef, canLand, cap, catchNeed, crewLvl, env, harpoonLvl, isNight, lineMax, logged } from './rules';
import { addCoins, burst, jitter, spawn, toast } from './feedback';
import { saveGame } from './save';
import { schoolActive, takeFish } from './schools';

/** Fight tuning: how hard tension climbs while reeling, and how much surges add. Exposed on BR for tweaking. */
export const TUNE = { k: 1.5, surge: 0.55 };

/** Chance the golden fish of a school is the one that bites, and what it is worth over a trophy. */
const GOLD_BITE = 0.4, GOLD_VALUE = 2.5;
// idle fishing: easy, non-legendary fish land on their own if you leave the line alone
export const idleOk = (sp: Species): boolean => !sp.legend && sp.diff < 0.45;

export const castRange = (): number => 50 + boatDef().L * 0.5;
function nearestWhere(ok: (s: School) => boolean, range: number): School | null {
  const b = G.boat;
  let best: School | null = null, bestD = range;
  for (const s of schoolsNear(b.x, b.y, 90)) {
    if (!ok(s)) continue;
    const d = Math.hypot(s.x - b.x, s.y - b.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
/** The closest biting school within casting range. */
export const nearestSchool = (): School | null => nearestWhere(schoolActive, castRange());

export function cancelFishing(msg?: string): void {
  if (G.fish && msg) toast(msg);
  G.fish = null;
}
export function tryCast(s: School): void {
  const sp = SPECIES[s.sp];
  if (G.hold.length >= cap()) { toast('Your hold is full. Sell your fish at a port', 'bad'); sfx('deny'); return; }
  const need = catchNeed(s.sp);
  if (need) { toast(`${sp.name} ${need}`, 'bad'); sfx('deny'); return; }
  const bait = G.baitSel !== 'none' && G.bait[G.baitSel] > 0 ? G.baitSel : null;
  if (bait) G.bait[bait]--;
  G.fish = {
    st: 'cast', s, t: 0, tx: s.x + jitter(8), ty: s.y + jitter(8), tension: 0, prog: 0, ph: Math.random() * 6, wait: 0, reelT: 0,
    bait, frenzy: !!G.frenzy && G.frenzy.s === s, perfect: false, hint: castHint(sp, bait),
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
  if (Math.hypot(f.tx - b.x, f.ty - b.y) > 80) { cancelFishing('You sailed too far from your bobber, so you reeled in'); return; }
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

function castStage(f: FishLine): void {
  if (f.t < 0.55) return;
  f.st = 'wait'; f.t = 0;
  const rod = G.up.rod, sp = SPECIES[f.s.sp];
  const baitMul = (f.bait === 'glow' && isNight() ? 0.5 : f.bait ? 0.75 : 1) * (f.bait === favBait(sp) ? 0.8 : 1);
  f.wait = Math.max(0.4, 1 - 0.15 * G.dry) * (1.4 + Math.random() * 2.6) * (1 - 0.1 * rod) * (f.frenzy ? 0.4 : 1) * baitMul * biteMul() * (1 - 0.12 * G.up.tackle);
  f.teases = TEASES[sp.fight]().filter(before => before < f.wait - 0.3);
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.9, r0: 1, grow: 5 });
  sfx('plop', 0.5);
}

/** A nibble: the bobber twitches (and jumpers swirl at the surface), but it isn't the bite yet. */
function tease(f: FishLine, sp: Species): void {
  f.teaseT = G.t;
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.6, r0: 1, grow: 3 });
  if (sp.fight === 'jumper') {
    const x = f.tx + jitter(6), y = f.ty + jitter(4);
    spawn({ kind: 'ring', x, y, life: 0.9, r0: 1, grow: 6 });
    burst('dot', x, y, 5, 18, 0.4);
  }
  sfx('plop', 0.22);
}

function waitStage(f: FishLine, dt: number, strike: boolean): void {
  const nibbling = f.teaseT !== undefined && G.t - f.teaseT < 0.8;
  if (strike) {
    toast(nibbling ? 'Just a nibble' : 'Too early');
    f.wait += 1.2; sfx('deny', 0.5); G.dry++;
  }
  if (Math.random() < dt * 0.8) spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.8, r0: 2, grow: 3 });
  const next = f.teases?.[0];
  if (next !== undefined && f.t >= f.wait - next) { f.teases!.shift(); tease(f, SPECIES[f.s.sp]); }
  if (f.t >= f.wait) startBite(f);
}

function startBite(f: FishLine): void {
  const sp = SPECIES[f.s.sp], b = G.boat;
  f.st = 'bite'; f.t = 0; f.win = strikeWindows();
  f.gold = !!f.s.gold && Math.random() < GOLD_BITE;
  if (RUNS.has(sp.fight)) f.run = Math.atan2(f.ty - b.y, f.tx - b.x) + jitter(1.2);
  sfx('bite');
  burst('dot', f.tx, f.ty, 6, 20, 0.4);
}
/** [perfect, any] strike windows in seconds; relaxed strikes and each recent miss widen both. */
function strikeWindows(): [number, number] {
  const rod = G.up.rod;
  const relaxed = (SET.strike === 'relaxed' ? 1.6 : 1) * (1 + 0.2 * Math.min(3, G.dry));   // pity: each miss widens the window
  const perfect = ((G.boatId === 'row' ? 0.32 : 0.2) + 0.03 * rod + 0.05 * Math.max(0, G.up.tackle - 1)) * relaxed;
  return [perfect, (0.75 + 0.12 * rod) * relaxed];
}

function biteStage(f: FishLine, strike: boolean): void {
  const sp = SPECIES[f.s.sp];
  const [perfectWin, biteWin] = f.win ??= strikeWindows();
  const auto = (crewLvl() >= 2 && f.t > 0.42) || (SET.strike === 'auto' && f.t > 0.3);
  if (strike || auto) {
    f.st = 'reel'; f.perfect = f.t < perfectWin; f.t = 0;
    f.tension = f.perfect ? 0.1 : 0.25; f.prog = f.perfect ? 0.25 : 0.08; f.reeling = true; G.dry = 0;
    sfx(f.perfect ? 'perfect' : 'plop');
    hooked(f);
  } else if (f.t > biteWin) {
    if (idleOk(sp)) {                                   // small fish hook themselves
      f.st = 'reel'; f.t = 0; f.tension = 0.15; f.prog = 0.05; f.selfHooked = true; G.dry = 0;
      sfx('plop');
      hooked(f);
    } else {
      toast('It got away');
      track('fish_lost', { species: sp.id, reason: 'missed_strike' });
      f.st = 'wait'; f.t = 0;
      f.wait = (1.5 + Math.random() * 2.5) * Math.max(0.4, 1 - 0.15 * ++G.dry);
    }
  }
}

/** The fish is on: make a perfect strike unmistakable (the reel panel names a golden fish). */
function hooked(f: FishLine): void {
  f.fx = f.tx; f.fy = f.ty;
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

function reelStage(f: FishLine, dt: number, strike: boolean): void {
  const sp = SPECIES[f.s.sp], rod = G.up.rod, diff = sp.diff;
  const pattern = FIGHT[sp.fight], stage = f.stage || 0;
  f.ph += dt * (1.5 + diff * 2.5);
  const assist = SET.reelAssist ? 0.7 : 1;
  const big = sp.legend || sp.rod >= 3, hk = big ? harpoonLvl() : 0;   // the harpoon gun tires big fish faster
  const surge = pattern(f.ph);
  const pull = diff * (0.3 + surge * TUNE.surge * assist) * (1 + 0.1 * stage) * (1 - 0.12 * hk);
  if (SET.reelToggle && strike) { f.reeling = !f.reeling; sfx('move', 0.4); }
  const holding = SET.reelToggle ? !!f.reeling : held(' ');
  const reeling = holding && !(SET.reelAssist && f.jump);   // assist lets go during jumps
  // telegraph: look a moment ahead so the warning shows before the surge lands
  f.surge = surge;
  f.warn = pattern(f.ph + 0.5) > 0.9 && diff > 0.3 && sp.fight !== 'steady';
  if (sp.fight === 'jumper' || sp.fight === 'boss') updateJumps(f, dt, reeling);
  swimFish(f, dt, surge);
  f.reelOn = reeling;
  if (reeling) {
    f.tension += (0.36 + pull * TUNE.k - rod * 0.05) * dt * (SET.reelAssist ? 0.85 : 1);
    f.prog += (0.4 - diff * 0.24 + rod * 0.025) * (1 + 0.12 * G.up.reel) * (1 + 0.25 * hk) * dt * (1 - Math.min(0.6, surge * 0.35));
    if ((f.reelT += dt) > 0.07) { f.reelT = 0; sfx('reel'); }
  } else {
    f.tension += (pull * 0.2 - 0.75 - rod * 0.05) * dt;
    if (idleOk(sp)) { f.prog += (0.06 + 0.05 * (1 - diff)) * dt; f.idle = true; }   // small fish tire themselves out
    else f.prog = Math.max(0, f.prog - 0.035 * dt);
  }
  f.tension = Math.max(0, f.tension);
  if (surge > 1) G.shake = Math.max(G.shake, 0.6);
  if (Math.random() < dt * (3 + surge * 10)) spawn({ kind: 'dot', x: (f.fx ?? f.tx) + jitter(4), y: (f.fy ?? f.ty) + jitter(3), vx: jitter(18), vy: jitter(18), life: 0.35 });
  if (f.tension >= lineMax()) {
    sfx('snap');
    toast(f.jump ? 'It threw the hook' : 'Your line snapped', 'bad');
    track('fish_lost', { species: sp.id, reason: f.jump ? 'threw_hook' : 'snapped' });
    G.fish = null;
  } else if (f.prog >= 1 && sp.fight === 'boss' && stage < 2) {
    f.stage = stage + 1; f.prog = 0.12; f.tension = Math.min(f.tension, 0.4); G.shake = 4;
    sfx('crash', 0.6);
    toast(`Still fighting! ${f.stage + 1} of 3`, 'bad');
  } else if (f.prog >= 1) landHooked(f);
}

// ---------- landing a catch ----------
/** Weight, value and trophy roll; good strikes, bait, frenzies, storms and bad luck streaks help. */
function rollCatch(spIdx: number, f: FishLine | null, small = false): Fish {
  const s = SPECIES[spIdx], gold = !!f?.gold;
  let r = Math.pow(Math.random(), 2.2);
  if (small) {                                          // the deckhand's catch: a small one, about 60% of the usual value, no trophy roll
    r *= 0.4;
    return { sp: spIdx, kg: Math.round((s.kg[0] + (s.kg[1] - s.kg[0]) * r) * 100) / 100, value: Math.max(1, Math.round(s.base * (0.55 + 0.9 * r) * 0.75)), trophy: false, t: G.clock };
  }
  if (f?.perfect) r = Math.min(1, r + 0.1);
  const baitBonus = f?.bait === 'shrimp' ? 0.05 : f?.bait === 'glow' ? 0.12 : 0;
  const chance = Math.min(0.3, 0.04 + G.pity * 0.006) + baitBonus + (f?.frenzy ? 0.1 : 0) + (f?.perfect ? 0.04 : 0) + trophyBonus();
  const trophy = gold || Math.random() < chance;                    // a golden fish is always a trophy, and worth more
  if (trophy) { r = Math.max(r, 0.82 + Math.random() * 0.18); G.pity = 0; }
  else G.pity++;
  const kg = Math.round((s.kg[0] + (s.kg[1] - s.kg[0]) * r) * 100) / 100;
  const fish: Fish = { sp: spIdx, kg, value: Math.max(1, Math.round(s.base * (0.55 + 0.9 * r) * (gold ? GOLD_VALUE : trophy ? 1.8 : 1))), trophy, t: G.clock };
  if (gold) fish.gold = true;
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
function recordCatch(spIdx: number, stock: FishStock, f: FishLine | null, method: 'rod' | 'net' | 'deckhand' | 'pots'): { fish: Fish; first: boolean; record: boolean; firstTrophy: boolean } {
  const sp = SPECIES[spIdx], fish = rollCatch(spIdx, f, method === 'deckhand');
  G.hold.push(fish);
  takeFish(stock);
  if (WX.state === 'storm') G.stats.storm = (G.stats.storm || 0) + 1;
  const prev = G.log[sp.id];
  const first = !prev, record = !!prev && fish.kg > prev.best, firstTrophy = fish.trophy && !prev?.trophy;
  G.log[sp.id] = { n: (prev?.n || 0) + 1, best: Math.max(prev?.best || 0, fish.kg), trophy: !!(prev?.trophy || fish.trophy), at: spotsWith(prev?.at, stock) };
  if (!prev || fish.kg > prev.best) netCatch(sp.id, fish.kg, G.cheated);          // a personal best goes on the world record board
  G.stats.caught++;
  track('fish_caught', { species: sp.id, method, kg_bucket: bucket(fish.kg), trophy: !!fish.trophy, golden: !!fish.gold, legend: !!sp.legend,
    first, perfect: !!f?.perfect, rod: G.up.rod });
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
  const { fish, first, record } = recordCatch(spIdx, f.s, f, 'rod');
  if (fish.gold) f.s.gold = false;
  const bonus = bottleBonus(sp);
  const card: CatchCard = { fish, first, record, perfect: f.perfect, bonus, t: 0 };
  G.card = card;
  sfx(fish.trophy || first ? 'fanfare' : 'catch');
  if (G.pet && Math.random() < 0.35) setTimeout(() => sfx('meow', 0.6), 900);   // the cat approves
  G.catchAnim = { sp: spIdx, t: 0, x: f.fx ?? f.tx, y: f.fy ?? f.ty };
  holdFullNote();
  G.fish = null;
  bonusFromDeckhand(f.s);
  saveGame();
}

export type Catcher = 'NETTED' | 'DECKHAND' | 'POTS';
/** A catch made without the rod: the drift net, crab pots or the deckhand. */
export function landNetted(spIdx: number, stock: FishStock, who: Catcher = 'NETTED'): void {
  const sp = SPECIES[spIdx];
  const { fish, firstTrophy } = recordCatch(spIdx, stock, null, who === 'DECKHAND' ? 'deckhand' : who === 'POTS' ? 'pots' : 'net');
  const by = who === 'DECKHAND' ? 'Your deckhand landed' : who === 'POTS' ? 'Your crab pots hauled' : 'Your drift net caught';
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
export function updateFrenzy(dt: number): void {
  if (WX.state === 'storm') G.nextFrenzy -= dt;         // storms bring frenzies sooner
  if (G.frenzy && Math.random() < dt * 7) {             // fish breaking the surface
    const s = G.frenzy.s, x = s.x + jitter(22), y = s.y + jitter(14);
    spawn({ kind: 'ring', x, y, life: 0.7, r0: 1, grow: 4 });
    burst('dot', x, y, 3, 16, 0.4);
  }
  if (G.frenzy && G.t > G.frenzy.until) {
    G.frenzy = null;
    G.nextFrenzy = G.t + (70 + Math.random() * 50) * (G.up.radio ? 0.65 : 1);
  }
  if (!G.frenzy && G.t > G.nextFrenzy) {
    const b = G.boat;
    const cands = schoolsNear(b.x, b.y, 420).filter(s => {
      const d = Math.hypot(s.x - b.x, s.y - b.y);
      return d > 120 && d < 420 && activeAt(s.sp, env()) && canLand(s.sp) && frenzyOk(s);
    });
    if (cands.length) {
      const s = cands[Math.floor(Math.random() * cands.length)];
      startFrenzy(s, 70);
      toast(`Feeding frenzy! ${SPECIES[s.sp].name} are biting fast. Follow the gulls`, 'good');
      sfx('gulls');
    } else G.nextFrenzy = G.t + 20;
  }
}
export function useChum(): void {
  if (!(G.bait.chum > 0)) { toast('No chum. Buy some at a port', 'bad'); sfx('deny'); return; }
  const b = G.boat, dist = (q: School) => Math.hypot(q.x - b.x, q.y - b.y);
  const s = schoolsNear(b.x, b.y, 170).filter(q => schoolActive(q) && frenzyOk(q)).sort((p, q) => dist(p) - dist(q))[0];
  if (!s) { toast('No school close enough to chum', 'bad'); sfx('deny'); return; }
  G.bait.chum--;
  startFrenzy(s, 45);
  sfx('splash'); sfx('gulls');
  toast(`You threw chum. The ${SPECIES[s.sp].name} are in a feeding frenzy`, 'good');
  for (let i = 0; i < 14; i++) spawn({ kind: 'dot', x: s.x + jitter(20), y: s.y + jitter(14), vx: 0, vy: 0, life: 1.5, foam: true });
}
