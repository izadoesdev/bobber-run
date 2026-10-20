// The per-frame update while sailing: timers and particles, sound, discovery, nets, flotsam, prompts and
// the actions the player can take at sea; plus the camera and the ship (hold) screen.
import { W, H } from '../config';
import { hAt, homePort, poisNear, schoolsNear, cratesNear } from '../world';
import { WX, updateWeather } from '../weather';
import { SPECIES, SP, SUPPLIES } from '../econ';
import { sfx, soundscape, music } from '../audio';
import { SET } from '../prefs';
import { FUNNEL } from '../models';
import type { BaitChoice, Crate, Poi, School, TreasureMap, WeatherState, Wreck } from '../types';
import { G, hit } from './state';
import { boatDef, boatSpeed, cap, catchNeed, dayNum, hpMax, isNight, logged, netLvl, sailEff, toWorld, windAngle } from './rules';
import { addCoins, burst, celebrate, jitter, spawn, toast } from './feedback';
import { checkGoals } from './goals';
import { placeAtPort, portById, saveGame } from './save';
import { endlessStock, idleOk, landNetted, nearestSchool, schoolActive, tryCast, updateFishing, updateFrenzy, useChum } from './fishing';
import { swimSchools, updateSchools } from './schools';
import { dock, updateFleet } from './port';
import { dropCourse, steerCourse } from './autopilot';

// ---------- landmarks ----------
function discover(p: Poi): void {
  G.found.add(p.id);
  const bounty = p.type === 'light' ? 15 : p.type === 'port' ? 10 : 0;
  if (bounty) addCoins(bounty);
  if (p.type === 'light') G.stats.lights++;
  toast(`Added ${p.name} to your chart${bounty ? `  +$${bounty}` : ''}`, 'good'); sfx('discover'); saveGame();
}
function salvage(p: Wreck): void {
  if (G.salvaged.has(p.id)) {                      // the diving bell: one more dive per wreck per day
    G.dives[p.id] = dayNum();
    const loot = Math.round(p.loot * 0.6 * (G.up.bell >= 2 ? 2 : 1));
    addCoins(loot);
    toast(`Your diving bell found $${loot} more in the wreck`, 'good'); sfx('coin'); saveGame();
    return;
  }
  G.salvaged.add(p.id); addCoins(p.loot); G.stats.wrecks++;
  const extra = Math.random() < 0.5;
  if (extra) G.bait.glow += 2;
  toast(`You salvaged $${p.loot}${extra ? ' and 2 glow lures' : ''} from the wreck`, 'good');
  sfx('coin'); setTimeout(() => sfx('coin', 0.8, 1.2), 100);
  burst('spark', p.x, p.y, 16, 40, 0.8);
  saveGame();
}
function haul(m: TreasureMap): void {
  G.maps = G.maps.filter(q => q !== m); G.stats.treasures++; addCoins(m.reward);
  const lures = Math.random() < 0.5;
  if (lures) G.bait.glow += 3;
  toast(`Treasure! +$${m.reward}${lures ? ' and 3 glow lures' : ''}`, 'good'); sfx('fanfare'); celebrate(); G.shake = 2;
  burst('spark', m.x, m.y, 20, 50, 1);
  saveGame();
}
function pickUp(c: Crate): void {
  c.taken = true; c.respawn = G.t + 240;
  if (Math.random() < 0.3) { G.bait.shrimp += 2; toast('You picked up floating cargo: 2 shrimp bait'); }
  else { addCoins(c.value); toast(`You picked up floating cargo  +$${c.value}`, 'good'); }
  sfx('coin');
  burst('debris', c.x, c.y, 10, 30, 0.8);
}

export function petCat(): void {
  if (G.petT > G.t || !G.pet) return;
  G.petT = G.t + 1.4;
  sfx('purr');
  const b = G.boat;
  for (let i = 0; i < 6; i++) spawn({ kind: 'spark', x: b.x + jitter(6), y: b.y + jitter(4), vx: jitter(8), vy: -10 - Math.random() * 8, life: 1 });
  if (Math.random() < 0.3) toast(`${G.pet.name} purrs`);
}

// ---------- every frame ----------
function tickFeedback(dt: number): void {
  for (const list of [G.toasts, G.captions, G.floaters]) for (let i = list.length - 1; i >= 0; i--) if ((list[i].t -= dt) <= 0) list.splice(i, 1);
  // particles move, fade and are dropped in one pass that keeps the survivors in order (no splicing)
  const parts = G.parts, wa = windAngle(), ws = 3 + WX.wind * 14, windX = Math.cos(wa) * ws, windY = Math.sin(wa) * ws;
  const smokeK = Math.exp(-1.2 * dt), riseK = Math.exp(-0.6 * dt), dragK = Math.exp(-3 * dt);
  let kept = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === 'smoke') {                       // smoke keeps rising and drifts downwind
      const { vx = 0, vy = 0, vz = 0 } = p;
      p.x += (vx + windX) * dt; p.y += (vy + windY) * dt; p.z = (p.z ?? 0) + vz * dt;
      p.vx = vx * smokeK; p.vy = vy * smokeK; p.vz = vz * riseK;
    } else if (p.vx !== undefined && p.vy !== undefined) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= dragK; p.vy *= dragK;
      if (p.kind === 'spout') p.vy += 40 * dt;      // falling spray
      if (p.vz) p.z = (p.z ?? 0) + p.vz * dt;
    }
    if ((p.life -= dt) > 0) parts[kept++] = p;
  }
  parts.length = kept;
  const dc = G.coins - G.coinsShown;
  G.coinsShown += Math.abs(dc) < 1 ? dc : Math.sign(dc) * Math.max(1, Math.abs(dc) * 6 * dt);
  G.crashCd -= dt; G.spookCd -= dt;
  G.shake *= Math.exp(-7 * dt);
  G.shakeX = G.shake > 0.05 ? jitter(G.shake) : 0;
  G.shakeY = G.shake > 0.05 ? jitter(G.shake) : 0;
  for (const id in G.sat) for (const s in G.sat[id]) G.sat[id][s] = Math.max(0, G.sat[id][s] - dt * 0.02);   // markets recover
  if (G.catchAnim && (G.catchAnim.t += dt) > 0.7) G.catchAnim = null;
  if (G.card) {
    G.card.t += dt;
    if (G.card.t > 3.2 || (G.card.t > 0.4 && hit(' ', 'Enter'))) { G.card = null; G.pressed.delete(' '); }
  }
}
// soundscape follows the boat: speed wash, nearby surf, weather, engine, luffing sails, and the deep ocean far out
const smooth01 = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** 0 near home or over shallow water, 1 over the deep ocean well offshore. */
const deepness = (): number => { const b = G.boat, hp = homePort(); return smooth01((-hAt(b.x, b.y) - 0.3) / 0.12) * smooth01((Math.hypot(b.x - hp.x, b.y - hp.y) - 900) / 1500); };
function tickSound(dt: number): void {
  const b = G.boat, bd = boatDef(), playing = G.mode === 'play';
  let shore = 0;
  for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (hAt(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40) > -0.05) shore += 0.125; }
  soundscape({
    speed: playing ? boatSpeed() : 0, shore, wind: WX.wind, rain: WX.rain, engine: playing && bd.prop === 'ENGINE', throttle: G.throttle ? 1 : 0,
    luff: playing && bd.prop === 'SAIL' && G.throttle && sailEff(b.a) < 0.6 ? 1 : 0, mute: G.mode === 'sunk', port: G.mode === 'port',
    deep: deepness(), calm: SET.calm,
  }, dt);
  music(dt, G.musicOn, isNight());
}
const WEATHER_NEWS: Record<WeatherState, string> = {
  storm: 'A storm is here. The wind pushes your boat, but trophy fish are more likely', rain: 'It is raining. Bites come a little slower, but Rain Trout come out', cloudy: 'It is getting cloudy', clear: 'The sky is clear again',
};

export function update(dt: number): void {
  G.t += dt;
  tickFeedback(dt);
  if (G.mode !== 'play') dropCourse();             // a course is only for open water: menus, port and sinking end it
  if (G.mode !== 'title') checkGoals();
  if (G.mode === 'sunk') {                          // towed home after a pause
    if ((G.sunkT += dt) > 3.4) { placeAtPort(portById(G.lastPort)); G.boat.hp = Math.round(hpMax() * 0.75); G.mode = 'play'; saveGame(); }
    return;
  }
  tickSound(dt);
  swimSchools(dt);
  if (G.mode !== 'title') updateFleet(dt);
  if (G.mode !== 'play') { G.prompt = null; return; }
  G.clock += dt;
  updateWeather(dt, s => toast(WEATHER_NEWS[s], s === 'storm' ? 'bad' : 'info'),
    () => setTimeout(() => sfx('thunder', 1, 0.8 + Math.random() * 0.4), 200 + Math.random() * 900));
  if (logged() >= 10 && !G.lairTold) { G.lairTold = true; toast('Sailors talk of a giant fish, the Old One. Its lair is now marked on your chart', 'bad'); }
  const speed = boatSpeed();
  updateFishing(dt);
  updateFrenzy(dt);
  autoCatches(dt, speed);
  scanSurroundings();
  G.prompt = promptFor(speed);
  handleActions(dt, speed);
  steerCourse();
  boatEffects(dt, speed);
  if (G.up.bilge > 0 && G.boat.hp < hpMax() && (G.bilgeT += dt) > [0, 4, 1.4][G.up.bilge]) { G.bilgeT = 0; G.boat.hp++; }   // the pump patches the hull
  if ((G.saveT += dt) > 15) { G.saveT = 0; saveGame(); }
}

// reused query results for the per-frame scans below
const netScratch: School[] = [], poiScratch: Poi[] = [], crateScratch: Crate[] = [];

/** Crab pots and the drift net fill the hold on their own; schools refill, and fast engines scatter them. */
function autoCatches(dt: number, speed: number): void {
  const b = G.boat, bd = boatDef();
  if (G.up.pots > 0 && G.hold.length < cap() && !G.fish && (G.potT += dt) > [0, 240, 150, 60][G.up.pots]) {
    G.potT = 0;
    landNetted(SP.crab, endlessStock(), 'POTS');
  }
  updateSchools(speed, dt);
  if (netLvl() > 0 && !G.fish && speed > 3 && speed < 20 && G.hold.length < cap()) {   // the net only works at a slow drift
    const s = schoolsNear(b.x, b.y, 40, netScratch).find(q => schoolActive(q) && SPECIES[q.sp].rod === 0 && Math.hypot(q.x - b.x, q.y - b.y) < 10 + bd.B * 2);
    if (s && (G.netT += dt) > [0, 3.6, 2.9, 2.2][netLvl()]) { G.netT = 0; landNetted(s.sp, s); }
  }
}

/** Chart landmarks in sight and note what the boat is next to; pick up flotsam on the way. */
function scanSurroundings(): void {
  const b = G.boat, bd = boatDef();
  G.nearPort = null; G.nearWreck = null;
  for (const p of poisNear(b.x, b.y, 220, poiScratch)) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const sight = (p.type === 'light' ? 140 : p.type === 'port' ? 150 : 100) * [1, 1.5, 2][G.up.spyglass];
    if (!G.found.has(p.id) && d < sight) discover(p);
    if (p.type === 'port' && Math.hypot(p.end.x - b.x, p.end.y - b.y) < 30 + bd.L) G.nearPort = p;
    if (p.type === 'wreck' && (!G.salvaged.has(p.id) || (G.up.bell > 0 && G.dives[p.id] !== dayNum())) && d < 30 + bd.L * 0.5) G.nearWreck = p;
  }
  G.nearSchool = G.fish ? null : nearestSchool();
  G.nearTreasure = G.maps.find(m => Math.hypot(m.x - b.x, m.y - b.y) < 16 + bd.L * 0.6) || null;
  for (const c of cratesNear(b.x, b.y, 120, crateScratch)) {
    if (c.taken) { if (G.t > c.respawn) c.taken = false; continue; }
    if (Math.hypot(c.x - b.x, c.y - b.y) < 8 + bd.B) pickUp(c);
  }
}

/** The hint for what the player can do right now. */
function promptFor(speed: number): string | null {
  const f = G.fish;
  if (f) {
    if (f.st === 'reel') {
      if (f.jump || f.jumpWarn) return 'It is jumping. Stop reeling!';
      if (f.warn) return 'It is about to pull hard. Stop reeling!';
      if (SET.reelToggle) return 'Press [SPACE] to start or stop reeling';
      if (idleOk(SPECIES[f.s.sp]) && !f.reelOn) return 'It will tire itself out. Hold [SPACE] to reel faster';
      return 'Hold [SPACE] to reel. Let go when the line gets tight, or it snaps';
    }
    if (f.st === 'bite') return f.run !== undefined ? 'It is swimming off with the bait. Strike now! [SPACE]' : 'Strike now! [SPACE]';
    if (f.st === 'wait') {
      if (f.teaseT !== undefined && G.t - f.teaseT < 0.9) return 'A nibble... wait for the real bite';
      return f.hint ? `Wait for the bobber to dip. ${f.hint}` : 'Wait for the bobber to dip';
    }
    return null;
  }
  if (G.nearPort) return speed < 14 ? `[E] Dock at ${G.nearPort.name}` : 'Slow down to dock';
  if (G.nearTreasure) return speed < 12 ? '[E] Haul up the treasure chest' : 'Slow down over the X to haul up the treasure';
  if (G.nearWreck) return speed < 12 ? `[E] Salvage the ${G.nearWreck.name.replace('Wreck of the ', '')}` : 'Slow down to salvage';
  if (G.nearSchool) {
    const s = SPECIES[G.nearSchool.sp];
    const need = catchNeed(G.nearSchool.sp);
    return speed < 10 ? `[SPACE] Cast for ${s.name}${need ? `, ${need}` : ''}` : 'Stop to fish';
  }
  return null;
}

const BAIT_ORDER: BaitChoice[] = ['none', 'shrimp', 'glow'];
function handleActions(dt: number, speed: number): void {
  const f = G.fish;

  if (hit('e', 'E', 'Enter')) {
    if (G.nearPort && speed < 14) dock(G.nearPort);
    else if (G.nearTreasure && speed < 12) haul(G.nearTreasure);
    else if (G.nearWreck && speed < 12) salvage(G.nearWreck);
  }
  if (hit('u', 'U')) { G.musicOn = !G.musicOn; toast(G.musicOn ? 'Music on' : 'Music off'); }
  if (!f && !G.card && hit(' ') && G.nearSchool && speed < 10) tryCast(G.nearSchool);
  if (hit('c', 'C')) useChum();
  if (G.pet && hit('p', 'P') && !f) petCat();
  if (G.pet && (G.petCd -= dt) < -90 - Math.random() * 120) { G.petCd = 0; sfx('meow', 0.5); }   // the cat speaks up now and then
  if (hit('b', 'B')) {
    G.baitSel = BAIT_ORDER[(BAIT_ORDER.indexOf(G.baitSel) + 1) % 3];
    sfx('move');
    toast(G.baitSel === 'none' ? 'No bait' : `Using ${SUPPLIES[G.baitSel].name.toLowerCase()}, ${G.bait[G.baitSel]} left`);
  }
}

/** Wake foam, funnel smoke and idle ripples around the boat. */
function boatEffects(dt: number, speed: number): void {
  const b = G.boat, bd = boatDef(), engine = bd.prop === 'ENGINE';
  const c = Math.cos(b.a), s = Math.sin(b.a);
  G.wakeAcc += speed * dt * (engine ? 1.1 : 0.6);
  while (G.wakeAcc >= 1) {
    G.wakeAcc -= 1;
    for (const side of [-1, 1]) {                    // bow waves peel off both sides
      const [x, y] = toWorld(bd.L * 0.75, side * bd.B * 0.8);
      spawn({ kind: 'dot', x, y, vx: -s * side * 7 - c * 3, vy: c * side * 7 - s * 3, life: 1.6 + Math.random() * 0.6 });
    }
    const [x, y] = toWorld(-bd.L - 1, jitter(bd.B * 0.7));   // and churn behind the stern
    spawn({ kind: 'dot', x, y, vx: 0, vy: 0, life: engine ? 2.2 : 1.4, foam: engine });
  }
  const fn = FUNNEL[bd.id];                          // steam ships puff smoke, faster under way
  if (fn && (G.smokeT -= dt) <= 0) {
    G.smokeT = G.throttle ? 0.09 : 0.28;
    const [x, y] = toWorld(fn[0], fn[1]);
    spawn({
      kind: 'smoke', x, y, z: fn[2] + 1, vx: b.vx * 0.3 + jitter(3), vy: b.vy * 0.3 + jitter(3), vz: 9 + Math.random() * 5,
      size: 2.2 + Math.random(), dark: bd.id === 'drifter' ? 0.55 : 0.15, life: 2.6 + Math.random() * 1.2,
    });
  }
  if ((G.idleRing -= dt) <= 0) {
    G.idleRing = 1.8 + Math.random();
    if (speed < 4) spawn({ kind: 'ring', x: b.x, y: b.y, life: 1.6, r0: bd.L - 1, grow: 5 });
  }
}

export function updateCamera(dt: number, bx: number, by: number): void {
  const b = G.boat, lookK = 1 - Math.exp(-2 * dt);
  G.look.x += (b.vx * 0.75 - G.look.x) * lookK;
  G.look.y += (b.vy * 0.75 - G.look.y) * lookK;
  const tx = bx + G.look.x - W / 2, ty = by + G.look.y - H / 2, k = 1 - Math.exp(-8 * dt);
  G.cam.x += (tx - G.cam.x) * k;
  G.cam.y += (ty - G.cam.y) * k;
}

// ship screen: browse the hold (three to a row), release fish you don't want
export function shipInput(): void {
  const n = G.hold.length, last = Math.max(0, n - 1);
  if (hit('ArrowLeft', 'a', 'A')) G.shipSel = Math.max(0, G.shipSel - 1);
  if (hit('ArrowRight', 'd', 'D')) G.shipSel = Math.min(last, G.shipSel + 1);
  if (hit('ArrowUp', 'w', 'W')) G.shipSel = Math.max(0, G.shipSel - 3);
  if (hit('ArrowDown', 's', 'S')) G.shipSel = Math.min(last, G.shipSel + 3);
  if (hit('x', 'X', 'Delete', 'Backspace') && n) {
    const [f] = G.hold.splice(Math.min(G.shipSel, n - 1), 1);
    G.shipSel = Math.min(G.shipSel, G.hold.length - 1);
    toast(`Released the ${SPECIES[f.sp].name}`); sfx('splash', 0.6);
    spawn({ kind: 'ring', x: G.boat.x + 14, y: G.boat.y, life: 1, r0: 1, grow: 6 });
    saveGame();
  }
}
