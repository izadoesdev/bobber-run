// Fishing: casting, bites, strikes, the reel fight, landing a catch, nets/pots/deckhand catches, frenzies and chum.
import { nA } from '../noise';
import { heightAt, schoolsNear } from '../world';
import { WX, biteMul, trophyBonus } from '../weather';
import { SPECIES, SP, activeAt, fmtKg } from '../econ';
import { sfx } from '../audio';
import { SET } from '../prefs';
import { netCatch } from '../net';
import type { CatchCard, FightStyle, Fish, FishLine, FishStock, School, Species, TreasureMap } from '../types';
import { G, hit, held } from './state';
import { boatDef, cap, crewLvl, env, harpoonLvl, isNight, lineMax } from './rules';
import { addCoins, burst, jitter, spawn, toast } from './feedback';
import { saveGame } from './save';

/** Fight tuning: how hard tension climbs while reeling, and how much surges add. Exposed on BR for tweaking. */
export const TUNE = { k: 1.5, surge: 0.55 };

export const schoolActive = (s: School): boolean => s.stock > 0 && activeAt(s.sp, env()) && !((s.spooked ?? 0) > G.t);
// idle fishing: easy, non-legendary fish land on their own if you leave the line alone
export const idleOk = (sp: Species): boolean => !sp.legend && sp.diff < 0.45;

/** The closest biting school within casting range. */
export function nearestSchool(): School | null {
  const b = G.boat;
  let best: School | null = null, bestD = 50 + boatDef().L * 0.5;
  for (const s of schoolsNear(b.x, b.y, 90)) {
    if (!schoolActive(s)) continue;
    const d = Math.hypot(s.x - b.x, s.y - b.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
export function cancelFishing(msg?: string): void {
  if (G.fish && msg) toast(msg);
  G.fish = null;
}
export function tryCast(s: School): void {
  const sp = SPECIES[s.sp];
  if (G.hold.length >= cap()) { toast('Hold full. Sell at a port', 'bad'); sfx('deny'); return; }
  if (sp.rod > G.up.rod) { toast(`${sp.name} needs a level ${sp.rod + 1} rod`, 'bad'); sfx('deny'); return; }
  const bait = G.baitSel !== 'none' && G.bait[G.baitSel] > 0 ? G.baitSel : null;
  if (bait) G.bait[bait]--;
  G.fish = {
    st: 'cast', s, t: 0, tx: s.x + jitter(8), ty: s.y + jitter(8), tension: 0, prog: 0, ph: Math.random() * 6, wait: 0, reelT: 0,
    bait, frenzy: !!G.frenzy && G.frenzy.s === s, perfect: false,
  };
  sfx('cast');
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
  if (Math.hypot(f.tx - b.x, f.ty - b.y) > 80) { cancelFishing('Line too long. You sailed away'); return; }
  const strike = hit(' ');
  if (f.st === 'cast') castStage(f);
  else if (f.st === 'wait') waitStage(f, dt, strike);
  else if (f.st === 'bite') biteStage(f, strike);
  else reelStage(f, dt, strike);
}

function castStage(f: FishLine): void {
  if (f.t < 0.55) return;
  f.st = 'wait'; f.t = 0;
  const rod = G.up.rod;
  const baitMul = f.bait === 'glow' && isNight() ? 0.5 : f.bait ? 0.75 : 1;
  f.wait = Math.max(0.4, 1 - 0.15 * G.dry) * (1.4 + Math.random() * 2.6) * (1 - 0.1 * rod) * (f.frenzy ? 0.4 : 1) * baitMul * biteMul() * (1 - 0.12 * G.up.tackle);
  spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.9, r0: 1, grow: 5 });
  sfx('plop', 0.5);
}

function waitStage(f: FishLine, dt: number, strike: boolean): void {
  if (strike) { toast('Too early. Wait for the bobber to dip'); f.wait += 1.2; sfx('deny', 0.5); G.dry++; }
  if (Math.random() < dt * 0.8) spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 0.8, r0: 2, grow: 3 });
  if (f.t >= f.wait) {
    f.st = 'bite'; f.t = 0;
    sfx('bite');
    burst('dot', f.tx, f.ty, 6, 20, 0.4);
  }
}

function biteStage(f: FishLine, strike: boolean): void {
  const rod = G.up.rod, sp = SPECIES[f.s.sp];
  const relaxed = (SET.strike === 'relaxed' ? 1.6 : 1) * (1 + 0.2 * Math.min(3, G.dry));   // pity: each miss widens the window
  const perfectWin = ((G.boatId === 'row' ? 0.32 : 0.2) + 0.03 * rod + 0.05 * Math.max(0, G.up.tackle - 1)) * relaxed;
  const auto = (crewLvl() >= 2 && f.t > 0.42) || (SET.strike === 'auto' && f.t > 0.3);
  if (auto && SET.strike !== 'auto') toast('Your deckhand sets the hook');
  if (strike || auto) {
    f.st = 'reel'; f.perfect = f.t < perfectWin; f.t = 0;
    f.tension = f.perfect ? 0.1 : 0.25; f.prog = f.perfect ? 0.25 : 0.08; f.reeling = true; G.dry = 0;
    sfx(f.perfect ? 'perfect' : 'plop');
    if (f.perfect) toast('Perfect strike!', 'good');
  } else if (f.t > (0.75 + 0.12 * rod) * relaxed) {
    if (idleOk(sp)) {                                   // small fish hook themselves
      f.st = 'reel'; f.t = 0; f.tension = 0.15; f.prog = 0.05; f.selfHooked = true; G.dry = 0;
      sfx('plop');
    } else {
      toast('It got away. Another bite will come soon');
      f.st = 'wait'; f.t = 0;
      f.wait = (1.5 + Math.random() * 2.5) * Math.max(0.4, 1 - 0.15 * ++G.dry);
    }
  }
}

/** Jumpers and the boss leap now and then; reeling mid-jump strains the line. */
function updateJumps(f: FishLine, dt: number, reeling: boolean): void {
  if (f.jumpT === undefined) f.jumpT = 2 + Math.random() * 2;
  if (f.jump) {
    f.jump.t += dt;
    if (reeling) f.tension += 1.6 * dt;
    if (f.jump.t > 0.75) {                               // splashdown
      f.jump = null;
      spawn({ kind: 'ring', x: f.tx, y: f.ty, life: 1, r0: 2, grow: 7 });
      burst('dot', f.tx, f.ty, 8, 30, 0.5);
      sfx('oar', 1, 0.7);
    }
  } else if ((f.jumpT -= dt) <= 0) {
    f.jump = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
    f.jumpT = 2.2 + Math.random() * 2.2;
    sfx('oar', 0.8, 1.2);
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
  if (Math.random() < dt * (3 + surge * 10)) spawn({ kind: 'dot', x: f.tx + jitter(4), y: f.ty + jitter(3), vx: jitter(18), vy: jitter(18), life: 0.35 });
  if (f.tension >= lineMax()) {
    sfx('snap');
    toast(f.jump ? 'It threw the hook mid-jump!' : 'Line snapped!', 'bad');
    G.fish = null;
  } else if (f.prog >= 1 && sp.fight === 'boss' && stage < 2) {
    f.stage = stage + 1; f.prog = 0.12; f.tension = Math.min(f.tension, 0.4); G.shake = 4;
    sfx('crash', 0.6, 0.5);
    toast(`It is still fighting! Round ${f.stage + 1} of 3`, 'bad');
  } else if (f.prog >= 1) landHooked(f);
}

// ---------- landing a catch ----------
/** Weight, value and trophy roll; good strikes, bait, frenzies, storms and bad luck streaks help. */
function rollCatch(spIdx: number, f: FishLine | null): Fish {
  const s = SPECIES[spIdx];
  let r = Math.pow(Math.random(), 2.2);
  if (f?.perfect) r = Math.min(1, r + 0.1);
  const baitBonus = f?.bait === 'shrimp' ? 0.05 : f?.bait === 'glow' ? 0.12 : 0;
  const chance = Math.min(0.3, 0.04 + G.pity * 0.006) + baitBonus + (f?.frenzy ? 0.1 : 0) + (f?.perfect ? 0.04 : 0) + trophyBonus();
  const trophy = Math.random() < chance;
  if (trophy) { r = Math.max(r, 0.82 + Math.random() * 0.18); G.pity = 0; }
  else G.pity++;
  const kg = Math.round((s.kg[0] + (s.kg[1] - s.kg[0]) * r) * 100) / 100;
  return { sp: spIdx, kg, value: Math.max(1, Math.round(s.base * (0.55 + 0.9 * r) * (trophy ? 1.8 : 1))), trophy, t: G.clock };
}

/** Put a fish in the hold and update stock, logbook, records and stats. Returns what the card shows. */
function recordCatch(spIdx: number, stock: FishStock, f: FishLine | null): { fish: Fish; first: boolean; record: boolean; firstTrophy: boolean } {
  const sp = SPECIES[spIdx], fish = rollCatch(spIdx, f);
  G.hold.push(fish);
  stock.stock--;
  if (stock.stock <= 0) stock.respawn = G.t + (stock.boss ? 1200 : 90);
  if (WX.state === 'storm') G.stats.storm = (G.stats.storm || 0) + 1;
  const prev = G.log[sp.id];
  const first = !prev, record = !!prev && fish.kg > prev.best, firstTrophy = fish.trophy && !prev?.trophy;
  G.log[sp.id] = { n: (prev?.n || 0) + 1, best: Math.max(prev?.best || 0, fish.kg), trophy: !!(prev?.trophy || fish.trophy) };
  if (!prev || fish.kg > prev.best) netCatch(sp.id, fish.kg);          // a personal best goes on the world record board
  G.stats.caught++;
  if (fish.trophy) G.stats.trophies++;
  if (isNight()) G.stats.night++;
  if (f?.frenzy) G.stats.frenzy++;
  return { fish, first, record, firstTrophy };
}

/** Sometimes a bottle comes up with the fish: a treasure map, a few coins, or bait. */
function bottleBonus(sp: Species): string | null {
  if (Math.random() >= 0.12) return null;
  const map = G.maps.length < 2 && Math.random() < 0.4 ? makeMap() : null;
  if (map) { G.maps.push(map); return 'A bottle with a treasure map! Check your chart'; }
  if (Math.random() < 0.6) {
    const c = 6 + Math.floor(Math.random() * (10 + sp.base * 0.4));
    addCoins(c);
    return `Also hooked a bottle with $${c} inside`;
  }
  G.bait.shrimp += 3;
  return 'Also hooked 3 shrimp bait';
}

function holdFullNote(): void {
  if (G.hold.length >= cap()) toast('Hold full. Head to a port to sell', 'good');
}

/** The fish on the line is landed: catch card, bonus, and maybe a deckhand's extra catch. */
function landHooked(f: FishLine): void {
  const spIdx = f.s.sp, sp = SPECIES[spIdx];
  const { fish, first, record } = recordCatch(spIdx, f.s, f);
  const bonus = bottleBonus(sp);
  const card: CatchCard = { fish, first, record, perfect: f.perfect, bonus, t: 0 };
  G.card = card;
  sfx(fish.trophy || first ? 'fanfare' : 'catch');
  if (G.pet && Math.random() < 0.35) setTimeout(() => sfx('meow', 0.6), 900);   // the cat approves
  G.catchAnim = { sp: spIdx, t: 0, x: f.tx, y: f.ty };
  holdFullNote();
  G.fish = null;
  bonusFromDeckhand(spIdx);
  saveGame();
}

export type Catcher = 'NETTED' | 'DECKHAND' | 'POTS';
/** A catch made without the rod: the drift net, crab pots or the deckhand. */
export function landNetted(spIdx: number, stock: FishStock, who: Catcher = 'NETTED'): void {
  const sp = SPECIES[spIdx];
  const { fish, firstTrophy } = recordCatch(spIdx, stock, null);
  if (firstTrophy) toast(`First ${sp.name} trophy!`, 'good');
  const by = who === 'DECKHAND' ? 'Your deckhand landed' : who === 'POTS' ? 'Your crab pots hauled' : 'Netted';
  toast(`${by} ${sp.name}, ${fmtKg(fish.kg)}`);
  sfx('coin', 0.5, 0.8);
  holdFullNote();
  saveGame();
}
/** Stand-in stock for catches that don't deplete a school. */
export const endlessStock = (): FishStock => ({ stock: 99, max: 99 });

/** A deckhand sometimes lands a small extra fish after yours. */
export function bonusFromDeckhand(spIdx: number): void {
  const chance = [0, 0.25, 0.4][crewLvl()];
  if (!chance || Math.random() > chance || G.hold.length >= cap()) return;
  const small = SPECIES[spIdx].rod === 0 ? spIdx : SP.sardine;
  landNetted(small, endlessStock(), 'DECKHAND');
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
  s.spooked = 0;
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
      return d > 120 && d < 420 && activeAt(s.sp, env()) && SPECIES[s.sp].rod <= G.up.rod + 1 && frenzyOk(s);
    });
    if (cands.length) {
      const s = cands[Math.floor(Math.random() * cands.length)];
      startFrenzy(s, 70);
      toast(`Feeding frenzy! Follow the gulls to the ${SPECIES[s.sp].name}`, 'good');
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
  toast(`Chum in the water. The ${SPECIES[s.sp].name} are feeding`, 'good');
  for (let i = 0; i < 14; i++) spawn({ kind: 'dot', x: s.x + jitter(20), y: s.y + jitter(14), vx: 0, vy: 0, life: 1.5, foam: true });
}
