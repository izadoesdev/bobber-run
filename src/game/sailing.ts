// The per-frame update while sailing: timers and particles, sound, discovery, nets, flotsam, prompts and
// the actions the player can take at sea; plus the camera and the ship (hold) screen.
import { W, H, smooth01 } from '../config';
import { realmDockAt, landAtRealm } from '../islands';
import { hAt, homePort, poisNear, schoolsNear, cratesNear, tickHotspots } from '../world';
import { WX, updateWeather } from '../weather';
import { SPECIES, SP, SUPPLIES, BOATS } from '../econ';
import { ONLINE } from '../online';
import { sfx, soundscape, music } from '../audio';
import { SET } from '../prefs';
import { FUNNEL, hasOars } from '../models';
import type { BaitChoice, BoatDef, Crate, Fish, Helper, Poi, School, TreasureMap, WeatherState, Wreck } from '../types';
import { G, hit, nearest } from './state';
import { boatDef, boatSpeed, cap, catchNeed, dayNum, fishValue, gearLvl, hpMax, isNight, logged, netLvl, offWind, potsLvl, SPIN, sailEfficiency, toWorld, windAngle } from './rules';
import { addCoins, burst, celebrate, jitter, spawn, toast } from './feedback';
import { checkGoals } from './goals';
import { placeAtPort, portById, saveGame } from './save';
import { SPOOL, castTargets, endlessStock, hitstop, landNetted, rehomeEscapees, nearestSchool, nextTarget, towStretch, tryCast, updateFishing, updateFrenzy, useChum } from './fishing';
import { schoolActive, schoolDrawR, swimSchools, updateSchools } from './schools';
import { dock, keptBack, updateFleet } from './port';
import { track } from '../analytics';
import { dropCourse, steerCourse } from './autopilot';
import { heliPort, heliReady, stepHeli } from './heli';
import { SPECIAL, specialOf, specialReady, spinFlogging, stepSpecial, useSpecial } from './special';
import { PIRATES, boardPrize, boarder, chaserTarget, coveToRaid, cycleShot, dropKeg, fireBroadside, fireLauncher, fireMortar, hailer, prizeAlongside, railsBearing, raidCove, launcher, launcherTarget, threat, turretOff, updatePirates } from './pirates';
import { TURRET } from './arms';
import { DIG_S, startDig, treasureReach, updateDig } from './treasure';
import { tickWaypoint } from '../waypoint';
import { biomeAt, type BiomeId } from '../biome';
import { nearestEncounter, openEncounter } from './encounters';
// what a crab pot brings up, by the waters it's set in
const POT_CRAB: Partial<Record<BiomeId, number>> = { mangrove: SP.mudcrab, volcanic: SP.ventcrab, cold: SP.snowcrab };

// ---------- landmarks ----------
function discover(p: Poi): void {
  G.found.add(p.id);
  const bounty = p.type === 'light' ? 15 : p.type === 'port' ? 10 : 0;
  if (bounty) addCoins(bounty);
  if (p.type === 'light') G.stats.lights++;
  if (p.type === 'cove') toast(`Added ${p.name} to your chart: a pirates' hideout. Beware their ships`, 'bad', 'sailing');
  else toast(`Added ${p.name} to your chart${bounty ? `  +$${bounty}` : ''}`, 'good', 'sailing');
  sfx('discover'); saveGame();
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
  sfx('coin'); setTimeout(() => sfx('coin', 0.8), 100);
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

function petCat(): void {
  if (G.petT > G.t || !G.pet) return;
  G.petT = G.t + 1.4;
  sfx('purr');
  const b = G.boat;
  for (let i = 0; i < 6; i++) spawn({ kind: 'spark', x: b.x + jitter(6), y: b.y + jitter(4), vx: jitter(8), vy: -10 - Math.random() * 8, life: 1 });
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
    const life = G.stats.caught === 1 || G.card.back ? 7 : 3.2;   // the very first catch, and a fish that got away, get a longer look
    if (G.card.t > life || (G.card.t > 0.6 && hit(' ', 'Enter'))) { G.card = null; G.pressed.delete(' '); }
  }
}
// soundscape follows the boat: speed wash, nearby surf, weather, engine, luffing sails, and the deep ocean far out
/** 0 near home or over shallow water, 1 over the deep ocean well offshore. */
const deepness = (): number => { const b = G.boat, hp = homePort(); return smooth01((-hAt(b.x, b.y) - 0.3) / 0.12) * smooth01((Math.hypot(b.x - hp.x, b.y - hp.y) - 900) / 1500); };
/** How close the nearest biting school is, 0 (none within 80) to 1 (on top of it): its bubbling guides a new captain in. */
function schoolNearness(): number {
  const b = G.boat, s = nearest(schoolsNear(b.x, b.y, 80, soundScratch), schoolActive, 80);
  return s ? 1 - Math.hypot(s.x - b.x, s.y - b.y) / 80 : 0;
}
const soundScratch: School[] = [];
function tickSound(dt: number): void {
  const b = G.boat, bd = boatDef(), playing = G.mode === 'play';
  let shore = 0;
  for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (hAt(b.x + Math.cos(a) * 40, b.y + Math.sin(a) * 40) > -0.05) shore += 0.125; }
  soundscape({
    speed: playing ? boatSpeed() : 0, shore, wind: WX.wind, rain: WX.rain, engine: playing && bd.prop === 'ENGINE', throttle: Math.abs(b.thr),   // the engine spools up and down with the throttle
    luff: playing && bd.prop === 'SAIL' && G.throttle && sailEfficiency() < 0.6 ? 1 : 0, mute: G.mode === 'sunk', port: G.mode === 'port',
    deep: deepness(), calm: SET.calm, school: playing ? schoolNearness() : 0,
  }, dt);
  music(G.musicOn, isNight());
}
const WEATHER_NEWS: Record<WeatherState, string> = {
  storm: 'A storm rolls in. Trophy fish bite more often', rain: 'Rain. Rain Trout come out', cloudy: '', clear: '',
};

let rehomeT = 0;
export function update(dt: number): void {
  G.t += dt;
  tickFeedback(dt);
  if (G.mode !== 'play') dropCourse();             // a course is only for open water: menus, port and sinking end it
  if (G.mode !== 'title') checkGoals();
  updatePirates(dt);
  stepHeli(dt); stepSpecial(dt);
  if (G.mode === 'sunk') {                          // towed home after a pause
    if ((G.sunkT += dt) > 3.4) { placeAtPort(portById(G.lastPort)); G.boat.hp = Math.round(hpMax() * 0.75); G.mode = 'play'; saveGame(); }
    return;
  }
  tickSound(dt);
  swimSchools(dt);
  if (G.mode !== 'title') updateFleet(dt);
  sailorEffects(dt);
  if (G.mode !== 'play') { G.prompt = null; return; }
  G.clock += dt;
  tickHotspots(G.clock, { x: G.cam.x + W / 2, y: G.cam.y + H / 2, r: schoolDrawR() + 60, hooked: G.fish?.s });                         // fish hotspots surface, dive and move with the clock
  if ((rehomeT -= dt) <= 0) { rehomeT = 5; rehomeEscapees(); }   // a fish that got away follows its kind as hotspots move
  updateWeather(dt, s => { if (WEATHER_NEWS[s]) toast(WEATHER_NEWS[s], s === 'storm' ? 'bad' : 'info'); },
    () => setTimeout(() => sfx('thunder'), 200 + Math.random() * 900));
  if (logged() >= 10 && !G.lairTold) { G.lairTold = true; toast('Sailors talk of a giant fish, the Old One. Its lair is now marked on your chart', 'bad'); }
  const speed = boatSpeed();
  if (!hitstop()) updateFishing(dt);
  updateFrenzy(dt);
  autoCatches(dt, speed);
  scanSurroundings();
  G.prompt = promptFor(speed);
  handleActions(dt, speed);
  updateDig(dt, speed);
  steerCourse();
  tickWaypoint();
  wakeAndSmoke(dt, G.boat, boatDef(), speed, !!G.throttle, ownFx);
  if (SPECIAL.boostT > 0 && G.throttle && Math.random() < dt * 40) {     // the throttles wide open: a rooster tail of spray astern
    const b = G.boat, [x, y] = toWorld(-boatDef().L - 2, jitter(2));
    spawn({ kind: 'spout', x, y, z: 0.5, vx: -Math.cos(b.a) * 30 + jitter(6), vy: -Math.sin(b.a) * 30 + jitter(6), vz: 14 + Math.random() * 10, life: 0.5 + Math.random() * 0.3 });
  }
  const pump = [0, 0, 5, 2.5, 1.2][G.up.hull];                  // iron plating and up carry a bilge pump
  if (pump && G.boat.hp < hpMax() && (G.bilgeT += dt) > pump) { G.bilgeT = 0; G.boat.hp++; }   // the pump patches the hull
  if ((G.saveT += dt) > 15) { G.saveT = 0; saveGame(); }
}

// reused query results for the per-frame scans below
const netScratch: School[] = [], poiScratch: Poi[] = [], crateScratch: Crate[] = [];

/** Crab pots and the drift net fill the hold on their own; schools refill, and fast engines scatter them. */
function autoCatches(dt: number, speed: number): void {
  const b = G.boat, bd = boatDef();
  if (potsLvl() > 0 && G.hold.length < cap() && !G.fish && (G.potT += dt) > [0, 240, 150, 60][potsLvl()]) {
    G.potT = 0;
    landNetted(POT_CRAB[biomeAt(b.x, b.y)] ?? SP.crab, endlessStock(), 'POTS');   // the crab of these waters
  }
  updateSchools(speed, dt);
  if (netLvl() > 0 && !G.fish && speed > 3 && speed < 20 && G.hold.length < cap()) {   // the net only works at a slow drift
    const s = schoolsNear(b.x, b.y, 40, netScratch).find(q => schoolActive(q) && SPECIES[q.sp].rod === 0 && Math.hypot(q.x - b.x, q.y - b.y) < 10 + bd.B * 2);
    if (s && (G.netT += dt) > [0, 3.6, 2.9, 2.2][netLvl()]) { G.netT = 0; landNetted(s.sp, s); }
  }
}

const glinted = new Set<string>();
/** Chart landmarks in sight and note what the boat is next to; pick up flotsam on the way. */
function scanSurroundings(): void {
  const b = G.boat, bd = boatDef();
  G.nearPort = null; G.nearWreck = null;
  for (const p of poisNear(b.x, b.y, 220, poiScratch)) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    const sight = (p.type === 'light' ? 140 : p.type === 'port' || p.type === 'cove' ? 150 : 100) * [1, 1.5, 2][G.up.spyglass];
    if (!G.found.has(p.id) && d < sight) discover(p);
    if (p.type === 'port' && Math.hypot(p.end.x - b.x, p.end.y - b.y) < 30 + bd.L) G.nearPort = p;
    if (p.type === 'wreck' && (!G.salvaged.has(p.id) || (G.up.bell > 0 && G.dives[p.id] !== dayNum())) && d < 30 + bd.L * 0.5) G.nearWreck = p;
  }
  G.nearSchool = G.fish || G.card ? null : nearestSchool();
  G.nearEncounter = G.fish || G.card ? null : nearestEncounter();
  for (const s of schoolsNear(b.x, b.y, 60, netScratch)) {          // a golden school glints the first time you come near
    if (s.gold && schoolActive(s) && !glinted.has(s.id) && Math.hypot(s.x - b.x, s.y - b.y) < 60) { glinted.add(s.id); sfx('glint'); }
  }
  G.nearTreasure = G.maps.find(m => Math.hypot(m.x - b.x, m.y - b.y) < treasureReach(m, bd.L)) || null;
  G.nearCove = coveToRaid();
  G.nearPrize = prizeAlongside();
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
      const tow = f.tow && towStretch(f, f.tow) > 0 ? (f.tow.len > SPOOL * 0.85 ? 'It has nearly all your line. Chase it!' : 'It is towing you! Steer after it. Braking tires it, but strains the line') : null;
      if (SET.reelAssist) return tow ?? (G.stats.caught < 3 ? 'Easy reel is reeling for you' : null);   // easy reel minds the line itself
      if (f.jump || f.jumpWarn) return 'It is jumping. Stop reeling!';
      if (f.warn) return 'It is about to pull hard. Stop reeling!';
      if (tow) return tow;
      if (f.taking) return 'It is running and taking line. Reel in when it calms';
      if (G.stats.caught >= 3) return null;      // the reel gauge says the rest once you know it
      if (SET.reelToggle) return 'Press [SPACE] to start or stop reeling';
      return 'Hold [SPACE] to reel. Let go when the rod creaks or the line gets tight';
    }
    if (f.st === 'bite') return f.run !== undefined ? 'It is swimming off with the bait. Strike now! [SPACE]' : 'Strike now! [SPACE]';
    if (f.st === 'wait') {
      if (f.fakeT !== undefined && G.t - f.fakeT < 0.9) return 'A fake-out! Wait for the thump';
      if (f.teaseT !== undefined && G.t - f.teaseT < 0.9) return 'A nibble... wait for the real bite';
      return f.hint ? `Wait for the bobber to dip. ${f.hint}` : G.stats.caught < 3 ? 'Wait for the bobber to dip' : null;
    }
    return null;
  }
  if (G.card) return null;
  if (G.dig) return `Your hand is digging for the chest... ${Math.min(99, Math.round(G.dig.t / DIG_S * 100))}%. Stay close`;
  const isle = realmDockAt(G.boat.x, G.boat.y);
  let use: string | null = null;
  if (G.nearPort) use = speed < 14 ? `[E] Dock at ${G.nearPort.name}${G.nearPort.shipyard ? ' (shipyard)' : ''}` : 'Slow down to dock';
  else if (isle) use = speed < 14 ? `[E] Land at ${isle.name}` : 'Slow down to land';
  else if (G.nearPrize) use = G.nearPrize.mood === 'surrender' ? `[E] Board ${G.nearPrize.name} and take her cargo` : `[E] Grapple ${G.nearPrize.name} and send the boarders over`;
  else if (G.nearCove) use = speed < 14 ? `[E] Raid the pirates' stash at ${G.nearCove.name}` : 'Slow down to raid the stash';
  else if (G.nearTreasure?.buried) use = speed < 10 ? '[E] Send a hand ashore to dig up the treasure' : 'Slow down off the beach to dig for the treasure';
  else if (G.nearTreasure) use = speed < 12 ? '[E] Haul up the treasure chest' : 'Slow down over the X to haul up the treasure';
  else if (G.nearWreck) use = speed < 12 ? `[E] Salvage the ${G.nearWreck.name.replace('Wreck of the ', '')}` : 'Slow down to salvage';
  else if (G.nearEncounter) use = speed < 12 ? `[E] ${G.nearEncounter.kind === 'prop' || G.nearEncounter.kind === 'habitat' || G.nearEncounter.kind === 'plankton' ? 'Inspect' : 'Visit'} ${G.nearEncounter.name}` : 'Slow down to interact';
  const fight = fightLine();
  if (fight) return [fight, use].filter(Boolean).join(' · ');
  if (!use && heliReady() && G.hold.length >= cap() / 2) use = `[K] Fly the catch to ${heliPort().name} by helicopter`;
  if (!use) use = spinnakerLine(speed);
  if (!G.nearSchool) return use;
  const species = SPECIES[G.nearSchool.sp], need = catchNeed(G.nearSchool.sp), list = castTargets();
  const cast = speed < 10 ? `[SPACE] Cast for ${species.name}${need ? `, ${need}` : ''}${list.length > 1 ? ' · [Q] Next creature' : ''}` : 'Stop to fish';
  return [use, cast].filter(Boolean).join(' · ');
}

/** When the spinnaker would help, or is holding her back. */
function spinnakerLine(speed: number): string | null {
  if (specialOf() !== 'spinnaker' || G.fish) return null;
  const rel = offWind(G.boat.a);
  if (spinFlogging(rel)) return '[K] Douse the spinnaker: the wind is too far forward for it';
  return !SPECIAL.spinUp && SPECIAL.cool <= 0 && speed > 10 && rel < 1.2 && WX.wind <= SPIN.strain ? '[K] Hoist the spinnaker: the wind is behind you' : null;
}

/** The fight in a line, the way the gun crews would call it: which rail bears and whether it's loaded, or a ship's hail.
 *  A sail still flying no colours gets no call: whether to fire on her first is yours to think of. */
function fightLine(): string | null {
  const line = threat() || hailer() ? gunLine() : null;
  return PIRATES.me.wounds.burn > 0 ? [line, 'Ablaze! Stop to douse it'].filter(Boolean).join(' · ') : line;
}
function gunLine(): string | null {
  if (boarder()) return 'Boarders! Fire into her, or sail hard to tear the grapples loose';
  if (PIRATES.me.taking) return 'Your boarders are fighting for her deck. Hold her alongside: don\'t sail off';
  const bears = railsBearing(), rails = PIRATES.me.rails, side = (r: number) => r ? 'starboard' : 'port', upper = (s: string) => s[0].toUpperCase() + s.slice(1);
  const ready = [0, 1].find(r => bears[r] && rails[r] <= 0), laying = [0, 1].find(r => bears[r]);
  const off = turretOff(), turret = off === null ? null : PIRATES.me.turret > 0 ? `Turrets loading, ${Math.ceil(PIRATES.me.turret)}s` : Math.abs(off) <= TURRET.lay ? '[R] Fire a salvo' : 'The turrets are training onto her...';
  const l = launcher(), torp = l && PIRATES.me.loaded > 0 && launcherTarget(l.kind) ? `[Y] ${l.kind === 'torpedo' ? 'Fire a torpedo' : l.kind === 'air' ? 'Launch a plane' : 'Launch a missile'}` : null;
  const chase = chaserTarget() && PIRATES.me.chaser <= 0 ? '[R] Fire the bow chaser' : turret ?? torp;
  const guns = ready !== undefined ? `[R] Fire the ${side(ready)} broadside` : chase ?? (laying !== undefined ? `${upper(side(laying))} guns bear, still loading...` : null);
  const h = hailer();
  const armed = gearLvl('cannon') > 0 || boatDef().signature === 'turret' || !!l;
  if (h) return [`${upper(h.name)} hails you${h.warned ? ', last warning' : ''}: stop to pay tribute, or ${armed ? 'fight' : 'run'}`, guns].filter(Boolean).join(' · ');
  if (guns) return guns;
  if (boatDef().signature === 'turret') return 'Bring her within the turrets\' reach';
  if (l && !gearLvl('cannon')) return l.kind === 'air' && PIRATES.planes.length ? 'Your planes are after her. Keep your distance'
    : PIRATES.me.loaded > 0 ? 'Bring her within reach' : `${l.kind === 'torpedo' ? 'Torpedo tubes' : l.kind === 'air' ? 'Planes' : 'Missile cells'} reloading. Keep your distance`;
  const sp = specialOf(), run = sp === 'boost' ? 'Open the throttles' : sp === 'sprint' ? 'Pull together' : null;
  if (!armed) return run && specialReady() ? `Pirates! [K] ${run} and run for it` : 'Pirates! Run for a harbour, or upwind where square sails can\'t follow';
  const loading = rails.filter(r => r > 0).length;
  return loading === 2 ? 'Both broadsides loading. Keep out of her arcs' : loading ? `${upper(side(rails[0] > 0 ? 1 : 0))} guns loaded. Bring her abeam` : 'Guns loaded. Bring her abeam';
}

const BAIT_ORDER: BaitChoice[] = ['none', 'shrimp', 'glow'];
function handleActions(dt: number, speed: number): void {
  const f = G.fish;
  if (G.card) return;

  if (!f && hit('e', 'E', 'Enter')) {
    const isle = realmDockAt(G.boat.x, G.boat.y);
    if (G.nearPort && speed < 14) dock(G.nearPort);
    else if (isle && speed < 14) { sfx('select'); landAtRealm(isle.key); }
    else if (G.nearPrize) boardPrize(G.nearPrize);
    else if (G.nearCove && speed < 14) raidCove(G.nearCove);
    else if (G.nearTreasure?.buried && speed < 10) startDig(G.nearTreasure);
    else if (G.nearTreasure && !G.nearTreasure.buried && speed < 12) haul(G.nearTreasure);
    else if (G.nearWreck && speed < 12) salvage(G.nearWreck);
    else if (G.nearEncounter && speed < 12) openEncounter(G.nearEncounter);
  }
  if (!f && hit('r', 'R')) fireBroadside();
  if (!f && hit('t', 'T')) fireMortar();
  if (!f && hit('y', 'Y')) fireLauncher();
  if (!f && hit('v', 'V')) dropKeg();
  if (!f && hit('k', 'K')) useSpecial();
  if (hit('z', 'Z')) cycleShot();
  if (hit('u', 'U')) { G.musicOn = !G.musicOn; toast(G.musicOn ? 'Music on' : 'Music off'); }
  if (!f && hit(' ') && G.nearSchool && speed < 10) tryCast(G.nearSchool);
  if (!f && hit('q', 'Q')) { nextTarget(); G.nearSchool = nearestSchool(); G.prompt = promptFor(speed); }
  if (hit('c', 'C')) useChum();
  if (G.pet && hit('p', 'P') && !f) petCat();
  if (G.pet && (G.petCd -= dt) < -90 - Math.random() * 120) { G.petCd = 0; sfx('meow', 0.5); }   // the cat speaks up now and then
  if (hit('b', 'B')) {
    G.baitSel = BAIT_ORDER[(BAIT_ORDER.indexOf(G.baitSel) + 1) % 3];
    sfx('move');
    toast(G.baitSel === 'none' ? 'No bait' : `Using ${SUPPLIES[G.baitSel].name.toLowerCase()}, ${G.bait[G.baitSel]} left`);
  }
}

type Hull = { x: number; y: number; a: number; vx: number; vy: number };
/** Wake foam and funnel smoke behind a boat; fx carries its wake and smoke timers between frames. */
function wakeAndSmoke(dt: number, h: Hull, bd: BoatDef, speed: number, fast: boolean, fx: { acc: number; smoke: number }): void {
  const engine = bd.prop === 'ENGINE', c = Math.cos(h.a), s = Math.sin(h.a);
  fx.acc += speed * dt * (engine ? 1.1 : 0.6);
  while (fx.acc >= 1) {
    fx.acc -= 1;
    for (const side of [-1, 1]) {                    // bow waves peel off both sides
      const [x, y] = toWorld(bd.L * 0.75, side * bd.B * 0.8, h);
      spawn({ kind: 'dot', x, y, vx: -s * side * 7 - c * 3, vy: c * side * 7 - s * 3, life: 1.6 + Math.random() * 0.6 });
    }
    const [x, y] = toWorld(-bd.L - 1, jitter(bd.B * 0.7), h);   // and churn behind the stern
    spawn({ kind: 'dot', x, y, vx: 0, vy: 0, life: engine ? 2.2 : 1.4, foam: engine });
  }
  const fn = FUNNEL[bd.id];                          // steam ships puff smoke, faster under way
  if (fn && (fx.smoke -= dt) <= 0) {
    fx.smoke = fast ? 0.09 : 0.28;
    const [x, y] = toWorld(fn[0], fn[1], h);
    spawn({
      kind: 'smoke', x, y, z: fn[2] + 1, vx: h.vx * 0.3 + jitter(3), vy: h.vy * 0.3 + jitter(3), vz: 9 + Math.random() * 5,
      size: 2.2 + Math.random(), dark: bd.id === 'drifter' ? 0.55 : 0.15, life: 2.6 + Math.random() * 1.2,
    });
  }
}
const ownFx = { acc: 0, smoke: 0 };

// ---------- other sailors' boats ----------
// What makes their boats look sailed rather than slid: the same wake as yours (bow waves peeling off, churn behind),
// funnel smoke, a lean into turns and, in a rowboat, the oars' stroke, all from their
// smoothed motion (net.ts). Per sailor, read by the renderer.
export interface SailorFx { acc: number; smoke: number; heel: number; phase: number }
export const SAILOR_FX = new Map<string, SailorFx>();
function sailorEffects(dt: number): void {
  const cx = G.cam.x + W / 2, cy = G.cam.y + H / 2;
  for (const sh of ONLINE.sailors) {
    let f = SAILOR_FX.get(sh.uid);
    if (!f) SAILOR_FX.set(sh.uid, f = { acc: 0, smoke: 0, heel: 0, phase: Math.random() });
    const bd = BOATS.find(b => b.id === sh.id) ?? BOATS[0], c = Math.cos(sh.a), sn = Math.sin(sh.a);
    const speed = Math.hypot(sh.vx, sh.vy), fwd = sh.vx * c + sh.vy * sn;
    f.heel += (Math.max(-0.1, Math.min(0.1, sh.w * fwd * 0.004)) - f.heel) * (1 - Math.exp(-3 * dt));
    if (hasOars(bd.id)) f.phase += dt * 0.75 * Math.min(1, speed / 18);   // a stroke a little over a second at a row
    if (Math.abs(sh.x - cx) > W || Math.abs(sh.y - cy) > H) continue;     // no wake to draw off screen
    wakeAndSmoke(dt, sh, bd, speed, speed > 20, f);
  }
  if (SAILOR_FX.size > ONLINE.sailors.length) for (const id of SAILOR_FX.keys()) if (!ONLINE.sailors.some(sh => sh.uid === id)) SAILOR_FX.delete(id);
}

export function updateCamera(dt: number, bx: number, by: number): void {
  const b = G.boat, lookK = 1 - Math.exp(-2 * dt);
  G.look.x += (b.vx * 0.75 - G.look.x) * lookK;
  G.look.y += (b.vy * 0.75 - G.look.y) * lookK;
  const reach = Math.hypot(G.look.x, G.look.y), most = 0.3 * Math.min(W, H);   // looking ahead, but never so far the boat leaves the view
  if (reach > most) { G.look.x *= most / reach; G.look.y *= most / reach; }
  const tx = bx + G.look.x - W / 2, ty = by + G.look.y - H / 2, k = 1 - Math.exp(-8 * dt);
  G.cam.x += (tx - G.cam.x) * k;
  G.cam.y += (ty - G.cam.y) * k;
}

// ship screen: browse the hold (three to a row), release fish you don't want
/** Fish worth less than this count as small fry for "Release small fish". */
export const SMALL_FRY = 20;
/** The small fish in the hold that nothing needs (contracts and the harbour project keep theirs). */
export function smallFry(): Fish[] {
  const kept = keptBack();
  return G.hold.filter(f => fishValue(f) < SMALL_FRY && !kept.has(f) && !f.trophy && !f.gold);
}
export function releaseSmallFry(): void {
  const fry = new Set(smallFry());
  if (!fry.size) return;
  G.hold = G.hold.filter(f => !fry.has(f));
  G.shipSel = Math.min(G.shipSel, Math.max(0, G.hold.length - 1));
  toast(`Released ${fry.size} small fish`); sfx('splash', 0.6);
  spawn({ kind: 'ring', x: G.boat.x + 14, y: G.boat.y, life: 1, r0: 1, grow: 6 });
  track('fish_released', { count_bucket: fry.size < 3 ? '1-2' : fry.size < 8 ? '3-7' : '8+', how: 'small' });
  saveGame();
}
/** Switch a helper (deckhand, drift net, crab pots) on or off; you keep it either way. */
export function toggleHelper(k: Helper): void {
  if (G.gearOff[k]) delete G.gearOff[k]; else G.gearOff[k] = true;
  sfx('select'); track('helper_toggled', { helper: k, on: !G.gearOff[k] }); saveGame();
}
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
    track('fish_released', { count_bucket: '1-2', how: 'one' });
    spawn({ kind: 'ring', x: G.boat.x + 14, y: G.boat.y, life: 1, r0: 1, grow: 6 });
    saveGame();
  }
}
