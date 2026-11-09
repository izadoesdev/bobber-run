// Pirates, cannons and buried treasure, run through the real world, physics-free pirate sailing and gunnery:
// where coves go, that shots land where they're aimed, that pirates close in and fire without running aground, that
// your guns sink them and their loot can be hauled in, that they run home when holed, keep out of harbours, plunder
// you when you sink, and that a cove's stash and a buried chest pay out once.
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const AUDIO = [...(await Bun.file(new URL('../src/audio.ts', import.meta.url)).text()).matchAll(/export (?:async )?(?:function|const|let) (\w+)/g)].map(m => m[1]);
mock.module('../src/audio', () => Object.fromEntries(AUDIO.map(n => [n, () => {}])));   // no Web Audio here
const { G } = await import('../src/game/state');
const W = await import('../src/world');
const P = await import('../src/game/pirates');
const T = await import('../src/game/treasure');
const { leadPoint, launch, landingPoint } = await import('../src/game/gunnery');
const A = await import('../src/game/arms');
const { parseSave } = await import('../src/game/saveSchema');
const { dayNum, isNight, windAngle, gearLvl, boatDef } = await import('../src/game/rules');
const { BOATS } = await import('../src/econ');
const { WX } = await import('../src/weather');
const { RED_FLAG } = await import('../src/pirateships');
const { wrapAngle } = await import('../src/config');
const { mulberry } = await import('../src/noise');
import type { Cove, Fish } from '../src/types';

const DT = 1 / 30;
function run(secs: number, each?: () => void): void {
  for (let t = 0; t < secs; t += DT) { G.t += DT; G.clock += DT; each?.(); P.updatePirates(DT); }
}
/** Every cove in the cells around (0, 0) out to `n` cells. */
function coves(n = 18): Cove[] {
  const out: Cove[] = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) for (const p of W.cellPois(i, j)) if (p.type === 'cove') out.push(p);
  return out;
}
const COVES = coves(22);
/** A cove with open water around its anchorage (somewhere to sail and fight). */
const open = (c: Cove): boolean => [0, 1, 2, 3, 4, 5, 6, 7].every(k => W.heightAt(c.anchor.x + Math.cos(c.ang + (k - 3.5) * 0.25) * 220, c.anchor.y + Math.sin(c.ang + (k - 3.5) * 0.25) * 220) < -0.15)
  && !W.poisNear(c.anchor.x, c.anchor.y, 800).some(p => p.type === 'port' && Math.hypot(p.x - c.anchor.x, p.y - c.anchor.y) < 800);   // harbours are safe: fight away from them
const ARENA = COVES.find(open)!;
const at = (c: Cove, d: number, turn = 0) => ({ x: c.anchor.x + Math.cos(c.ang + turn) * d, y: c.anchor.y + Math.sin(c.ang + turn) * d });
function placeBoat(x: number, y: number, a = 0): void { Object.assign(G.boat, { x, y, px: x, py: y, a, vx: 0, vy: 0, w: 0 }); }
const fish = (value: number): Fish => ({ sp: 0, kg: 1, value, trophy: false });
/** A good gunner at your helm: turn to put the nearest fighting pirate abeam, and fire the broadside when it bears. */
function broadsides(): void {
  const t = P.PIRATES.ships.filter(P.hostile).sort((a, b) => Math.hypot(a.x - G.boat.x, a.y - G.boat.y) - Math.hypot(b.x - G.boat.x, b.y - G.boat.y))[0];
  if (t) G.boat.a = Math.atan2(t.y - G.boat.y, t.x - G.boat.x) - Math.PI / 2;
  if (P.cannonTarget()) P.fireBroadside();
}

G.story = { i: 99, base: {}, shown: true } as typeof G.story;          // every region open
/** Keep the fleets of the coves round the arena in port (their stashes freshly raided), so a test's ships fight alone. */
const quietOthers = (): void => { for (const c of COVES) if (c !== ARENA && Math.hypot(c.x - ARENA.x, c.y - ARENA.y) < 3000) G.raids[c.id] = dayNum(); };
const quietArena = (): void => { quietOthers(); G.raids[ARENA.id] = dayNum(); };
beforeEach(() => {
  P.resetPirates();
  Object.assign(G, { mode: 'play', god: false, boatId: 'skiff', hold: [], maps: [], raids: {}, coins: 100, dig: null });
  Object.assign(G.up, { cannon: 0, swivel: 0, mortar: 0, kegs: 0, ram: 0, hull: 0 });
  G.ammo = { chain: 0, grape: 0, fire: 0 };
  G.stats.pirates = 0; G.stats.coves = 0; G.stats.dug = 0;
  G.boat.hp = 140;
});

describe('coves', () => {
  test('lie only in the far waters, never beside a port, with the camp ashore and the anchorage afloat', () => {
    expect(COVES.length).toBeGreaterThan(20);
    for (const c of COVES) {
      expect(Math.hypot(c.x - 280, c.y - 280)).toBeGreaterThan(W.PIRATE_FROM - 200);
      expect(W.heightAt(c.x, c.y)).toBeGreaterThan(0.02);
      expect(W.heightAt(c.anchor.x, c.anchor.y)).toBeLessThan(-0.11);
      const [, i, j] = /cove:(-?\d+),(-?\d+)/.exec(c.id)!.map(Number);
      expect(W.cellPois(i, j).some(p => p.type === 'port')).toBe(false);
    }
    expect(ARENA).toBeDefined();
  });
  test('keep further-out coves stronger', () => {
    const tiers = COVES.map(c => [P.tierOf(c), P.fleetOf(c).length] as const).sort((a, b) => a[0] - b[0]);
    expect(tiers[0][1]).toBeLessThanOrEqual(tiers[tiers.length - 1][1]);
    expect(P.fleetOf(COVES.reduce((a, b) => P.tierOf(a) > P.tierOf(b) ? a : b))).toContain('galleon');
  });
});

describe('gunnery', () => {
  test('a shot led at a moving ship comes down where the ship will be', () => {
    const lp = leadPoint(0, 0, 120, 0, 0, 40);
    const ball = launch([], 'pirate', 0, 0, lp.x, lp.y, 1), land = landingPoint(ball);
    expect(Math.hypot(land.x - 120, land.y - 40 * lp.t)).toBeLessThan(0.5);
  });
});

describe('pirate ships', () => {
  test('close in, come round to a broadside and fire on you, without ever running aground', () => {
    quietArena();
    const start = at(ARENA, 160), me = at(ARENA, 520, 0.3);
    placeBoat(me.x, me.y);
    const p = P.spawnPirate('brig', start.x, start.y, 'gunner');
    let fired = false, worstDepth = -1, moods = new Set<string>(), closest = Infinity;
    run(45, () => {
      worstDepth = Math.max(worstDepth, W.heightAt(p.x, p.y));
      closest = Math.min(closest, Math.hypot(p.x - G.boat.x, p.y - G.boat.y));
      moods.add(p.mood);
      if (P.PIRATES.balls.length) fired = true;
      G.boat.hp = Math.max(G.boat.hp, 60);                               // stay afloat to watch the whole fight
    });
    expect(moods.has('engage')).toBe(true);
    expect(fired).toBe(true);
    expect(G.boat.hp).toBeLessThan(140);
    expect(worstDepth).toBeLessThan(-0.04);
    expect(closest).toBeLessThan(P.KINDS.brig.range);
  });
  test('your cannons sink one, and its floating loot pays out when you sail over it', () => {
    quietArena();
    G.up.cannon = 3;
    const me = at(ARENA, 300), start = at(ARENA, 420, 0.2);
    placeBoat(me.x, me.y);
    const p = P.spawnPirate('sloop', start.x, start.y);
    run(40, () => { G.boat.hp = 140; if (p.mood === 'surrender') P.boardPrize(p); broadsides(); });
    expect(p.mood === 'sinking' || p.mood === 'struck' || !P.PIRATES.ships.includes(p)).toBe(true);
    expect(G.stats.pirates).toBe(1);
    if (p.mood === 'struck') return;                                   // she struck and was boarded instead: no loot afloat
    expect(P.PIRATES.loot.length).toBe(1);
    const loot = P.PIRATES.loot[0], coins = G.coins;
    G.maps = [];
    placeBoat(loot.x, loot.y);
    run(0.2);
    expect(G.coins).toBe(coins + loot.coins);
    expect(G.maps.length).toBe(loot.map ? 1 : 0);
    expect(P.PIRATES.loot.length).toBe(0);
  });
  test('a badly holed ship breaks off and runs for its cove', () => {
    quietArena();
    const me = at(ARENA, 380), start = at(ARENA, 300, 0.25);
    placeBoat(me.x, me.y);
    const p = P.spawnPirate('brig', start.x, start.y);
    p.yields = false;
    run(3, () => { G.boat.hp = 140; });
    p.hp = p.max * 0.2;
    const home = p.cove.anchor, before = Math.hypot(p.x - home.x, p.y - home.y);
    run(12, () => { G.boat.hp = 140; });
    expect(p.mood).toBe('flee');
    expect(Math.hypot(p.x - home.x, p.y - home.y)).toBeLessThan(before);
  });
  test('give up the chase and hold their fire while you lie in a harbour', () => {
    const home = W.homePort();
    placeBoat(home.dock.x, home.dock.y);
    const p = P.spawnPirate('sloop', home.dock.x + 120, home.dock.y + 40);
    run(8);
    expect(p.mood === 'patrol' || p.mood === 'anchored').toBe(true);
    expect(G.boat.hp).toBe(140);
  });
  test('sinking you, take the best half of your hold, and a tug tows you home', () => {
    quietArena();
    placeBoat(at(ARENA, 300).x, at(ARENA, 300).y);
    G.hold = [fish(5), fish(80), fish(10), fish(60)];
    G.boat.hp = 1;
    const start = at(ARENA, 200, 0.3);
    P.spawnPirate('brig', start.x, start.y, 'gunner');
    run(30);
    expect(G.mode).toBe('sunk');
    expect(G.hold.map(f => f.value).sort((a, b) => a - b)).toEqual([5, 10]);
    expect(G.sunkMsg).toContain('pirates took 2');
  });
  test('stay in their coves with pirates switched off', async () => {
    const { SET } = await import('../src/prefs');
    SET.pirates = false;
    placeBoat(at(ARENA, 250).x, at(ARENA, 250).y);
    run(2);
    expect(P.PIRATES.ships.length).toBe(0);
    SET.pirates = true;
    run(1);
    expect(P.PIRATES.ships.filter(p => p.cove.id === ARENA.id).length).toBe(P.fleetOf(ARENA).length);
  });
});

describe('cove stash', () => {
  test('opens once every ship of the cove is sunk, pays once with a map, then lies quiet', () => {
    G.up.cannon = 3;
    quietOthers();
    placeBoat(at(ARENA, 110).x, at(ARENA, 110).y);
    run(1);
    expect(P.stashOpen(ARENA)).toBe(false);
    for (const p of P.PIRATES.ships) if (p.cove.id === ARENA.id) p.hp = 1;
    run(40, () => { G.boat.hp = 140; for (const p of P.PIRATES.ships) if (p.mood === 'surrender') P.boardPrize(p); broadsides(); });
    expect(P.PIRATES.ships.filter(p => p.cove.id === ARENA.id && P.hostile(p)).length).toBe(0);
    placeBoat(ARENA.anchor.x, ARENA.anchor.y);
    expect(P.stashOpen(ARENA)).toBe(true);
    const coins = G.coins;
    P.raidCove(ARENA);
    expect(G.coins).toBeGreaterThan(coins);
    expect(G.stats.coves).toBe(1);
    expect(G.maps.some(m => m.buried)).toBe(true);
    expect(P.stashOpen(ARENA)).toBe(false);
  });
});

describe('buried treasure', () => {
  const spot = T.beachSpot(ARENA.x, ARENA.y, 0, 2500, mulberry(5))!;
  test('lies on dry sand with water a short row out', () => {
    expect(spot).not.toBeNull();
    const h = W.heightAt(spot.x, spot.y);
    expect(h).toBeGreaterThan(0.02);
    expect(h).toBeLessThan(0.3);
  });
  test('comes up after a dig while the boat waits close by, and not if it sails off', () => {
    const m = { id: 'test', x: spot.x, y: spot.y, reward: 300, buried: true as const };
    const water = W.nearestWater(spot.x, spot.y, -0.1);
    G.maps = [m];
    placeBoat(water.x, water.y);
    expect(Math.hypot(water.x - m.x, water.y - m.y)).toBeLessThan(T.treasureReach(m, 16.5));
    T.startDig(m);
    for (let t = 0; t < 1; t += DT) T.updateDig(DT, 0);
    placeBoat(water.x + 400, water.y);                                   // sailed off: the hand comes back
    T.updateDig(DT, 0);
    expect(G.dig).toBeNull();
    expect(G.maps).toContain(m);
    placeBoat(water.x, water.y);
    const coins = G.coins;
    T.startDig(m);
    for (let t = 0; t < T.DIG_S + 0.1; t += DT) T.updateDig(DT, 0);
    expect(G.coins).toBe(coins + 300);
    expect(G.maps).not.toContain(m);
    expect(G.stats.dug).toBe(1);
  });
});

test('raided coves and buried maps survive a save', () => {
  const s = parseSave({ raids: { 'cove:3,4': 7, bad: 'x' }, maps: [{ id: 'a', x: 1, y: 2, reward: 5, buried: true }, { id: 'b', x: 3, y: 4, reward: 6 }], stats: { pirates: 3 } });
  expect(s.raids).toEqual({ 'cove:3,4': 7 });
  expect(s.maps[0].buried).toBe(true);
  expect(s.maps[1].buried).toBeUndefined();
  expect(s.stats.pirates).toBe(3);
});

describe('arms', () => {
  const pirateAt = (kind: Parameters<typeof P.spawnPirate>[0], rel: number, d: number) => {
    quietArena();
    const me = at(ARENA, 300);
    placeBoat(me.x, me.y, 0);
    const p = P.spawnPirate(kind, me.x + Math.cos(rel) * d, me.y + Math.sin(rel) * d);
    Object.assign(p, { x: me.x + Math.cos(rel) * d, y: me.y + Math.sin(rel) * d, vx: 0, vy: 0, a: rel + Math.PI / 2 });
    return p;
  };
  test('the broadside fires only the rail with a pirate in its arc, each rail reloading on its own', () => {
    G.up.cannon = 2;
    pirateAt('brig', Math.PI / 2, 120);                                 // abeam to starboard (+90 degrees off the bow)
    P.fireBroadside();
    expect(P.PIRATES.me.rails[1]).toBeGreaterThan(0);
    expect(P.PIRATES.me.rails[0]).toBe(0);
    expect(P.PIRATES.salvo.length).toBe(2);
  });
  test('nothing fires at a pirate dead ahead, out of both arcs', () => {
    G.up.cannon = 3;
    pirateAt('brig', 0, 120);
    P.fireBroadside();
    expect(P.PIRATES.me.rails).toEqual([0, 0]);
    expect(P.PIRATES.salvo.length).toBe(0);
  });
  test('a pirate runs her guns out before the broadside goes off', () => {
    const p = pirateAt('brig', Math.PI / 2, 120);
    const hold = () => { Object.assign(p, { a: 0, want: 0, w: 0, vx: 0, vy: 0, mood: 'engage', think: 1 }); };   // you abeam on her port rail
    p.reload = [0, 0];
    hold(); run(0.1, hold);
    expect(p.aim.some(a => a > 0)).toBe(true);
    expect(P.PIRATES.salvo.length + P.PIRATES.balls.length).toBe(0);   // a moment's warning
    run(1.5, hold);
    expect(P.PIRATES.salvo.length + P.PIRATES.balls.length).toBeGreaterThan(0);
  });
  test('chain shot tears rigging and slows a ship; fire shot burns her on after the hit', () => {
    const w = A.freshWounds();
    A.wound(w, 'chain'); A.wound(w, 'chain');
    expect(A.speedFactor(w)).toBeLessThan(0.8);
    A.wound(w, 'fire');
    expect(w.burn).toBeGreaterThan(0);
    let burned = 0;
    for (let t = 0; t < 3; t += DT) burned += A.mend(w, DT, false);
    expect(burned).toBeGreaterThan(A.BURN_DPS * 2.5);
    expect(A.SHOTS.grape.pellets).toBeGreaterThan(1);
  });
  test('a hit along the hull from bow or stern rakes for half again; one on the beam does not', () => {
    expect(A.raking(0, 10, 0)).toBe(true);
    expect(A.raking(0, -10, 1)).toBe(true);
    expect(A.raking(0, 0, 10)).toBe(false);
  });
  test('special shot is spent a volley at a time, then the guns go back to round shot', () => {
    G.up.cannon = 1; G.ammo.chain = 1;
    P.PIRATES.me.shot = 'round';
    P.cycleShot();
    expect(P.PIRATES.me.shot).toBe('chain');
    pirateAt('brig', Math.PI / 2, 100);
    P.fireBroadside();
    expect(G.ammo.chain).toBe(0);
    expect(P.PIRATES.salvo.every(s => s.shot === 'chain')).toBe(true);
    P.PIRATES.me.rails = [0, 0];
    P.fireBroadside();
    expect(P.PIRATES.me.shot).toBe('round');
  });
  test('the mortar lobs onto a pirate in its reach (not one too close), and the burst hurts her', () => {
    G.up.mortar = 1;
    const close = pirateAt('sloop', 0.3, 60);
    P.fireMortar();
    expect(P.PIRATES.balls.length).toBe(0);
    P.PIRATES.ships.splice(P.PIRATES.ships.indexOf(close), 1);
    const p = pirateAt('brig', 0.3, 200);
    p.mood = 'surrender';                                               // hove to: a sitting target
    const hp = p.hp;
    p.mood = 'engage'; p.want = p.a; Object.assign(p, { vx: 0, vy: 0 });
    P.fireMortar();
    expect(P.PIRATES.balls.length).toBe(1);
    expect(P.PIRATES.balls[0].splash).toBeGreaterThan(0);
    for (let t = 0; t < 4 && P.PIRATES.balls.length; t += DT) { G.t += DT; P.updatePirates(DT); p.x -= p.vx * DT; p.y -= p.vy * DT; }   // hold her still
    expect(p.hp).toBeLessThan(hp);
  });
  test('a powder keg blows when a pirate sails over it', () => {
    G.up.kegs = 1;
    P.resetPirates();
    quietArena();
    const me = at(ARENA, 300);
    placeBoat(me.x, me.y, 0);
    run(DT);                                                           // the new rack fills
    P.dropKeg();
    expect(P.PIRATES.kegs.length).toBe(1);
    const k = P.PIRATES.kegs[0];
    run(1.5);                                                          // armed
    placeBoat(me.x + 300, me.y, 0);
    const p = P.spawnPirate('sloop', k.x + 30, k.y);
    Object.assign(p, { x: k.x + 6, y: k.y }); const hp = p.hp;
    run(0.2);
    expect(P.PIRATES.kegs.length).toBe(0);
    expect(p.hp).toBeLessThan(hp);
  });
});

describe('pirate captains', () => {
  test("gunners keep off your loaded broadside: they work round to your bow or stern", () => {
    quietArena();
    G.up.cannon = 3;
    // a daylight wind across her way round to your bow or stern (square sails can't beat up to a station upwind)
    for (G.clock = 0; G.clock < 1e5 && (isNight() || Math.abs(Math.sin(windAngle() - ARENA.ang)) > 0.3); G.clock += 37);
    const me = at(ARENA, 280);
    placeBoat(me.x, me.y, ARENA.ang + Math.PI / 2);
    const random = Math.random;
    Math.random = mulberry(1);                                        // her captain's whims, the same each run
    const p = P.spawnPirate('brig', me.x + Math.cos(ARENA.ang) * 150, me.y + Math.sin(ARENA.ang) * 150, 'gunner');
    let along = 0, n = 0;
    const still = () => { G.boat.hp = 140; placeBoat(me.x, me.y, ARENA.ang + Math.PI / 2); };   // you hold still, guns loaded and never firing
    try {
      run(10, still);                                                   // time to work round
      run(30, () => { still(); n++; if (Math.abs(Math.cos(Math.atan2(p.y - me.y, p.x - me.x) - G.boat.a)) > 0.7) along++; });
    } finally { Math.random = random; }
    expect(along / n).toBeGreaterThan(0.62);                           // random placement would be about 0.5 (she tacks to get there)
  });
  test('a crew that sees your shot coming turns away from where it falls', () => {
    quietArena();
    const me = at(ARENA, 300);
    placeBoat(me.x, me.y, 0);
    const p = P.spawnPirate('galleon', me.x + 200, me.y);
    p.mood = 'engage';
    launch(P.PIRATES.balls, 'player', me.x, me.y, p.x + p.vx * 1.5, p.y + p.vy * 1.5, 40, 'round', 16);
    const random = Math.random;
    Math.random = () => 0;
    try { p.think = 0; run(0.1); } finally { Math.random = random; }
    expect(p.dodge).not.toBeNull();
  });
  test('a captain who yields strikes his colours when beaten, and you can board her for her cargo', () => {
    quietArena();
    const me = at(ARENA, 300);
    placeBoat(me.x, me.y, 0);
    const p = P.spawnPirate('brig', me.x + 60, me.y + 40);
    p.yields = true; p.mood = 'engage'; p.hp = p.max * 0.2; p.think = 0;
    run(0.3);
    expect(p.mood).toBe('surrender');
    expect(P.cannonTarget()).toBeNull();                                // you don't fire on a struck ship
    const coins = G.coins;
    P.boardPrize(p);
    expect(G.coins).toBeGreaterThan(coins);
    expect(p.mood).toBe('struck');
    expect(G.stats.pirates).toBe(1);
  });
  test('when the flagship goes down, her battered consorts lose heart', () => {
    quietArena();
    const me = at(ARENA, 300);
    placeBoat(me.x, me.y, 0);
    const flag = P.spawnPirate('galleon', me.x + 150, me.y), mate = P.spawnPirate('brig', me.x - 500, me.y);   // out of your guns' reach
    mate.cove = flag.cove; mate.hp = mate.max * 0.5; mate.yields = false; mate.mood = 'engage';
    flag.hp = 1;
    G.up.cannon = 3;
    run(6, () => { G.boat.hp = 140; G.boat.a = Math.atan2(flag.y - G.boat.y, flag.x - G.boat.x) - Math.PI / 2; if (P.hostile(flag)) P.fireBroadside(); });
    expect(flag.mood === 'sinking' || !P.PIRATES.ships.includes(flag)).toBe(true);
    expect(mate.mood).toBe('flee');
  });
});

describe('the parley', () => {
  test('a ship shadows you under no colours, hails under her black flag, and lying to pays a tribute without a shot', () => {
    quietArena();
    const me = at(ARENA, 380);
    placeBoat(me.x, me.y);
    G.hold = [fish(5), fish(80), fish(10), fish(60), fish(30)];
    const start = at(ARENA, 160, 0.3), p = P.spawnPirate('brig', start.x, start.y, 'gunner', 'shadow');
    p.merciless = false;
    const moods: string[] = [], flags = new Map<string, number>();
    run(60, () => { if (moods.at(-1) !== p.mood) moods.push(p.mood); flags.set(p.mood + (p.mood === 'hail' && p.parley > 0 ? '!' : ''), P.flagOf(p)); });
    expect(moods.slice(0, 4)).toEqual(['shadow', 'hail', 'tribute', 'sated']);
    expect(flags.get('shadow')).toBe(-1);                              // no colours while she watches you
    expect(flags.get('hail!')).toBe(p.flag);                           // her own black flag for the hail
    expect(p.flag).toBeLessThan(RED_FLAG);
    expect(G.hold.map(f => f.value).sort((a, b) => a - b)).toEqual([5, 10, 30]);   // the best third went
    expect(G.boat.hp).toBe(140);
    expect(P.PIRATES.balls.length + P.PIRATES.salvo.length).toBe(0);
  });
  test('refusing brings a harmless shot across your bow, then the red flag and no quarter', () => {
    quietArena();
    const me = at(ARENA, 380);
    placeBoat(me.x, me.y);
    const start = at(ARENA, 250, 0.3), p = P.spawnPirate('brig', start.x, start.y, 'gunner', 'hail');
    p.merciless = false;
    let warnedAt = -1, redAt = -1, hpAtRed = 0;
    for (let t = 0; t < 45 && redAt < 0; t += 0.5) {
      run(0.5, () => { G.boat.vx = 30; G.boat.vy = 0; });              // under way: not heaving to
      if (p.warned && warnedAt < 0) warnedAt = t;
      if (p.mood === 'chase' || p.mood === 'engage') { redAt = t; hpAtRed = G.boat.hp; }
    }
    expect(warnedAt).toBeGreaterThan(0);
    expect(redAt).toBeGreaterThan(warnedAt);
    expect(hpAtRed).toBe(140);                                         // the warning shot hurt no one
    expect(P.flagOf(p)).toBe(RED_FLAG);
  });
  test('firing on a ship mid-parley ends it: no quarter for you from her whole cove', () => {
    quietArena();
    G.up.cannon = 3;
    placeBoat(at(ARENA, 380).x, at(ARENA, 380).y, 0);
    const p = P.spawnPirate('brig', G.boat.x, G.boat.y + 120, 'gunner', 'hail'), mate = P.spawnPirate('sloop', G.boat.x + 400, G.boat.y, 'raider', 'shadow');
    mate.cove = p.cove;
    p.parley = 10;
    P.fireBroadside();
    run(1);
    expect(p.mood === 'chase' || p.mood === 'engage' || p.mood === 'sinking').toBe(true);
    expect(mate.mood === 'chase' || mate.mood === 'engage').toBe(true);
  });
  test('square riggers can\'t point as high as fore-and-aft rigs, and nothing sails into the wind', () => {
    const eye = windAngle() + Math.PI, beam = windAngle() + Math.PI / 2;
    for (const k of ['sloop', 'brig', 'galleon', 'ketch'] as const) {
      expect(P.windFactor(k, eye)).toBeLessThan(0.2);
      expect(P.windFactor(k, beam)).toBe(1);
    }
    expect(P.windFactor('sloop', eye + Math.PI / 4)).toBeGreaterThan(P.windFactor('brig', eye + Math.PI / 4) + 0.3);
  });
  test('a brigantine chasing you upwind beats up to you on tacks instead of pointing into the wind', () => {
    quietArena();
    // a time of day when the wind blows down a wide stretch of open water from you to her, in daylight
    const start = at(ARENA, 200), seaward = (eye: number) => [-120, 0, 120].every(off => Array.from({ length: 26 }, (_, k) => k * 20).every(r =>
      W.heightAt(start.x + Math.cos(eye) * r - Math.sin(eye) * off, start.y + Math.sin(eye) * r + Math.cos(eye) * off) < -0.15));
    for (G.clock = 0; G.clock < 1e5 && (isNight() || !seaward(windAngle() + Math.PI)); G.clock += 37);
    const eye = windAngle() + Math.PI;
    placeBoat(start.x + Math.cos(eye) * 500, start.y + Math.sin(eye) * 500);
    const p = P.spawnPirate('brig', start.x, start.y, 'gunner');
    p.a = eye + 1;                                                     // already close-hauled on one tack
    let inIrons = 0, frames = 0, closest = Infinity;
    run(20, () => {
      G.boat.hp = 140;
      if (p.mood === 'chase') { frames++; if (Math.abs(wrapAngle(p.a - windAngle() - Math.PI)) < 0.5) inIrons++; }
      closest = Math.min(closest, Math.hypot(p.x - G.boat.x, p.y - G.boat.y));
    });
    expect(inIrons / frames).toBeLessThan(0.3);                        // only heading up as she comes about
    expect(closest).toBeLessThan(300);                                 // and still she beats up to you
  });
  test('in a storm the coves\' ships ride it out at anchor', () => {
    quietOthers();
    placeBoat(at(ARENA, 200).x, at(ARENA, 200).y);
    WX.state = 'storm';
    run(6);
    const fleet = P.PIRATES.ships.filter(p => p.cove.id === ARENA.id);
    expect(fleet.length).toBeGreaterThan(0);
    expect(fleet.every(p => p.mood === 'anchored')).toBe(true);
    WX.state = 'clear';
    run(3);
    expect(fleet.some(p => p.mood !== 'anchored')).toBe(true);
  });
});

describe('word on the quay', () => {
  test('a round at the inn tells of the nearest uncharted cove, its ships and its temper, and charts it', async () => {
    const { portItems } = await import('../src/game/port');
    const ports: import('../src/types').Port[] = [];
    for (let j = -22; j <= 22; j++) for (let i = -22; i <= 22; i++) for (const q of W.cellPois(i, j)) if (q.type === 'port') ports.push(q);
    const port = ports.find(q => COVES.some(c => Math.hypot(c.x - q.x, c.y - q.y) < 3000))!;
    G.found = new Set();
    G.menu = { port, tab: 0, sel: 0 };
    G.coins = 100;
    const row = portItems(port).find(it => it.kind === 'rumour');
    expect(row).toBeDefined();
    if (!row || row.kind === 'header') return;
    row.act();
    expect(G.coins).toBe(80);
    const charted = [...G.found].filter(id => id.startsWith('cove:'));
    expect(charted.length).toBe(1);
    const [, i, j] = /cove:(-?\d+),(-?\d+)/.exec(charted[0])!.map(Number), cove = W.cellPois(i, j).find(c => c.id === charted[0]) as Cove;
    expect(P.coveWord(cove).fleet).toMatch(/sloop|brigantine|galleon|ketch/);
    expect(portItems(port).find(it => it.kind === 'rumour')).not.toEqual(row);   // the next round is about another cove
  });
});

describe('each ship fights her own way', () => {
  /** You, still, in open water off the arena; `kind` beside you at bearing `rel` off your bow, `d` away, heading `a`. */
  function setup(kind: Parameters<typeof P.spawnPirate>[0], role: Parameters<typeof P.spawnPirate>[3], rel: number, d: number, a = 0) {
    quietArena();
    const me = at(ARENA, 380);
    placeBoat(me.x, me.y, 0);
    return P.spawnPirate(kind, me.x + Math.cos(rel) * d, me.y + Math.sin(rel) * d, role, 'engage');
  }
  const still = () => { G.boat.hp = 140; Object.assign(G.boat, { vx: 0, vy: 0 }); };
  const runUntil = (done: () => boolean, secs: number, each: () => void) => { for (let t = 0; t < secs && !done(); t += 0.25) run(0.25, each); };
  test('a sloop lying alongside throws her hooks and boards you for the best of your catch', () => {
    const p = setup('sloop', 'raider', Math.PI / 2, 14);
    p.a = 0;
    G.hold = [fish(5), fish(80), fish(10), fish(60)];
    let hooked = false, called = '', hurt = 0;
    run(30, () => { still(); hurt = Math.max(hurt, P.PIRATES.me.wounds.crew); if (p.grapple > 0 && !hooked) { hooked = true; called = P.PIRATES.call?.s ?? ''; } });
    expect(hooked).toBe(true);
    expect(called).toContain('Grappling');
    expect(['sated', 'anchored']).toContain(p.mood);                   // she made off home with it, and leaves you be
    expect(G.hold.map(f => f.value).sort((a, b) => a - b)).toEqual([5, 10, 60]);
    expect(hurt).toBeGreaterThan(0.2);                                 // her boarders cut down some of your crew
  });
  test('boarders are driven off by fire into her, or left behind by sailing hard', () => {
    let p = setup('sloop', 'raider', Math.PI / 2, 14);
    p.a = 0; G.hold = [fish(80)];
    runUntil(() => p.grapple > 0.5, 15, still);
    expect(p.grapple).toBeGreaterThan(0);
    G.up.cannon = 3;
    P.fireBroadside();
    run(1, () => still());
    expect(p.grapple).toBe(0);
    expect(G.hold.length).toBe(1);

    p = setup('sloop', 'raider', Math.PI / 2, 14);
    p.a = 0; G.up.cannon = 0;
    runUntil(() => p.grapple > 0.5, 15, still);
    expect(p.grapple).toBeGreaterThan(0);
    run(3, () => { G.boat.hp = 140; Object.assign(G.boat, { vx: P.BREAK_SPEED + 6, vy: 0 }); });
    expect(p.grapple).toBe(0);
    expect(G.hold.length).toBe(1);
  });
  test('a brawler squares up before she charges, then runs straight on the heading she set', () => {
    const p = setup('brig', 'brawler', 0, 150, Math.PI);
    p.a = Math.PI;
    let aimFor = 0, heading: number | null = null, swerved = 0;
    run(10, () => {
      still();
      if (p.charge?.phase === 'aim') aimFor += DT;
      if (p.charge?.phase === 'go') { heading ??= p.charge.h; swerved = Math.max(swerved, Math.abs(wrapAngle(p.charge.h - heading))); }
    });
    expect(aimFor).toBeGreaterThan(1.4);                               // the lookout's warning
    expect(heading).not.toBeNull();
    expect(swerved).toBe(0);
  });
  test('a galleon runs out a double-shotted broadside slowly, and it hits far harder', () => {
    const p = setup('galleon', 'warship', Math.PI / 2, 140);
    const hold = () => { still(); Object.assign(p, { a: 0, want: 0, w: 0, vx: 0, vy: 0, think: 1 }); };
    p.reload = [0, 0]; p.heavyT = 0;
    hold(); run(0.1, hold);
    expect(Math.max(...p.aim)).toBeGreaterThan(2.5);
    expect(P.PIRATES.call?.s).toContain('double-shotting');
    let dmg = 0, plain = 0;                                            // her shot's damage, and what that shot does from one ball
    run(4, () => { hold(); for (const s of P.PIRATES.salvo) if (s.from === 'pirate' && s.dmg > dmg) { dmg = s.dmg; plain = P.KINDS.galleon.dmg * (1 + 0.6 * p.tier) * A.SHOTS[s.shot].dmg; } });
    expect(dmg).toBeGreaterThan(0);
    expect(dmg / plain).toBeCloseTo(1.8, 2);
  });
  test('a mortar ranges long and short and walks her shells in, until you change course', () => {
    const p = setup('ketch', 'bomber', Math.PI / 2, 220);
    const hold = () => { still(); Object.assign(p, { a: 0, want: 0, w: 0, vx: 0, vy: 0, think: 1 }); };
    const falls: number[] = [], seen = new Set<object>();
    const watch = () => { hold(); for (const b of P.PIRATES.balls) if (b.from === 'pirate' && b.splash && !seen.has(b)) { seen.add(b); falls.push(Math.hypot(b.lx - G.boat.x, b.ly - G.boat.y)); } };
    p.mortarT = 0;
    run(65, watch);
    expect(falls.length).toBeGreaterThanOrEqual(3);
    expect(falls[0]).toBeGreaterThan(falls[1]);
    expect(falls[1]).toBeGreaterThan(falls[2]);
    expect(falls[2]).toBeLessThan(25);
    G.boat.a = 1.2;                                                    // come about
    const before = falls.length;
    run(25, watch);
    expect(falls.length).toBeGreaterThan(before);
    expect(falls[before]).toBeGreaterThan(50);
  });
});

describe('fighting vessels', () => {
  /** A fresh fight: you in `boat`, still; `kind` at bearing `rel` off your bow, `d` away, held where she is (no thinking, no sailing). */
  function duel(boat: typeof G.boatId, kind: Parameters<typeof P.spawnPirate>[0], role: Parameters<typeof P.spawnPirate>[3], rel: number, d: number) {
    P.resetPirates();
    quietArena();
    G.boatId = boat;
    const me = at(ARENA, 380);
    placeBoat(me.x, me.y, 0);
    const p = P.spawnPirate(kind, me.x + Math.cos(rel) * d, me.y + Math.sin(rel) * d, role, 'engage');
    return p;
  }
  test('warships are sold at the shipyard with their guns built in, and a drilled crew reloads faster', () => {
    const war = BOATS.filter(b => b.arms);
    expect(war.map(b => b.id)).toEqual(['cutter', 'patrol', 'gunboat', 'dreadnought', 'destroyer', 'missile', 'carrier']);
    expect(war.filter(b => b.prop === 'SAIL').map(b => b.id)).toEqual(['cutter']);   // only the cutter needs the wind
    for (const b of war) expect(b.signature).toBeDefined();
    expect(new Set(war.map(b => b.signature)).size).toBe(war.length);   // each fights her own way
    for (const b of war) expect(b.hold).toBeLessThan(20);
    const p = duel('cutter', 'brig', 'gunner', Math.PI / 2, 120);
    expect(G.up.cannon).toBe(0);
    expect(gearLvl('cannon')).toBe(1);
    expect(gearLvl('swivel')).toBe(1);
    P.fireBroadside();
    expect(P.PIRATES.me.rails[1]).toBeCloseTo(A.BROADSIDE[1]!.reload * 0.8, 5);
    expect(P.PIRATES.salvo.length).toBeGreaterThan(0);
    expect(p.mood === 'engage' || p.mood === 'chase').toBe(true);
  });
  test('a coast guard cutter takes half again the bounty for a pirate she boards', () => {
    const takings = (boat: typeof G.boatId): number => {
      const p = duel(boat, 'brig', 'gunner', Math.PI / 2, 40);
      p.mood = 'surrender';
      const coins = G.coins, random = Math.random;
      Math.random = () => 0.99;                                         // the same cargo, and no map, each time
      try { P.boardPrize(p); } finally { Math.random = random; }
      return G.coins - coins;
    };
    const skiff = takings('skiff'), patrol = takings('patrol');
    expect(patrol / skiff).toBeCloseTo(1.5, 1);
  });
  test('a galley lays her bow gun on you only while you\'re off her bow, and rows as well into the wind as across it', () => {
    expect(P.windFactor('galley', windAngle() + Math.PI)).toBe(1);
    const p = duel('skiff', 'galley', 'chaser', 0, 200);
    const hold = (a: number) => () => { G.boat.hp = 140; Object.assign(p, { a, want: a, w: 0, vx: 0, vy: 0, think: 1 }); };
    p.bowT = 0;
    run(0.2, hold(Math.PI));                                           // bow-on to you
    expect(p.bowAim).toBeGreaterThan(0);
    expect(P.PIRATES.call?.s).toContain('bow gun');
    let fired = false;
    run(2.5, () => { hold(Math.PI)(); if (P.PIRATES.balls.some(b => b.from === 'pirate')) fired = true; });
    expect(fired).toBe(true);
    P.PIRATES.balls = [];
    p.bowT = 0; p.bowAim = -1;
    run(4, hold(Math.PI / 2));                                         // you on her beam
    expect(P.PIRATES.balls.some(b => b.from === 'pirate')).toBe(false);
  });
  test('a fire ship lights up close and blows up alongside: you burn, and so does any pirate near her', () => {
    const p = duel('skiff', 'fireship', 'fireship', 0, 320), mate = P.spawnPirate('brig', G.boat.x + 30, G.boat.y + 30, 'gunner', 'engage');
    p.a = Math.PI;
    G.boat.hp = 5000;
    const mateHp = mate.hp;
    let lit = false;
    run(25, () => { Object.assign(G.boat, { vx: 0, vy: 0 }); Object.assign(mate, { x: G.boat.x + 30, y: G.boat.y + 30, vx: 0, vy: 0, think: 1 }); if (p.lit >= 0) lit = true; });
    expect(lit).toBe(true);
    expect(p.mood === 'sinking' || !P.PIRATES.ships.includes(p)).toBe(true);
    expect(G.boat.hp).toBeLessThan(5000 - 60);
    expect(P.PIRATES.me.wounds.burn + (G.boat.hp < 5000 ? 1 : 0)).toBeGreaterThan(0);
    expect(mate.hp).toBeLessThan(mateHp);
  });
  test('shot through while she\'s alight, a fire ship goes up where she is, not alongside you', () => {
    const p = duel('patrol', 'fireship', 'fireship', Math.PI / 2, 190), mate = P.spawnPirate('sloop', G.boat.x, G.boat.y + 215, 'raider', 'engage');
    const hold = () => { Object.assign(G.boat, { vx: 0, vy: 0 }); Object.assign(p, { a: -Math.PI / 2, want: -Math.PI / 2, vx: 0, vy: 0 }); Object.assign(mate, { x: p.x + 20, y: p.y + 20, vx: 0, vy: 0, think: 1 }); };
    G.boat.hp = 2000; G.up.cannon = 3;
    run(0.5, hold);
    expect(p.lit).toBeGreaterThanOrEqual(0);
    const mateHp = mate.hp;
    P.fireBroadside();
    run(2, hold);
    expect(p.mood === 'sinking' || !P.PIRATES.ships.includes(p)).toBe(true);
    expect(G.boat.hp).toBe(2000);
    expect(mate.hp).toBeLessThan(mateHp);
    expect(boatDef().id).toBe('patrol');
  });
  test('a cutter\'s bow chaser reaches a pirate dead ahead, beyond any broadside, and only dead ahead', () => {
    duel('cutter', 'brig', 'gunner', 0, 250);
    P.fireBroadside();
    expect(P.PIRATES.balls.filter(b => b.from === 'player').length).toBe(1);
    expect(P.PIRATES.me.chaser).toBeCloseTo(A.CHASER.reload * 0.8, 5);
    expect(P.PIRATES.me.rails).toEqual([0, 0]);
    duel('cutter', 'brig', 'gunner', 0.6, 250);                        // off the bow: outside its arc
    expect(P.chaserTarget()).toBeNull();
    duel('skiff', 'brig', 'gunner', 0, 250);                           // no chaser aboard anything else
    expect(P.chaserTarget()).toBeNull();
  });
  test('a coast guard cutter\'s boarders take a beaten pirate alongside, unless you sail off and tear the grapples out', () => {
    const lay = (boat: typeof G.boatId) => {
      const p = duel(boat, 'sloop', 'gunner', Math.PI / 2, 26);
      p.hp = Math.round(p.max * 0.4);
      return p;
    };
    lay('skiff');
    expect(P.prizeAlongside()).toBeNull();
    const whole = duel('patrol', 'sloop', 'gunner', Math.PI / 2, 26);
    expect(P.prizeAlongside()).toBeNull();                           // she's not beaten enough to try
    expect(whole.mood).toBe('engage');
    const p = lay('patrol'), coins = G.coins;
    expect(P.prizeAlongside()).toBe(p);
    P.boardPrize(p);
    expect(P.PIRATES.me.taking?.p).toBe(p);
    run(P.takeTime(p) + 1.5, () => { G.boat.hp = 1e6; Object.assign(G.boat, { vx: 0, vy: 0 }); });
    expect(p.mood).toBe('struck');
    expect(G.coins).toBeGreaterThan(coins);
    expect(P.PIRATES.me.taking).toBeNull();
    const q = lay('patrol');
    P.boardPrize(q);
    run(2, () => { G.boat.hp = 1e6; G.boat.vx = Math.cos(G.boat.a) * 40; G.boat.vy = Math.sin(G.boat.a) * 40; });
    expect(P.PIRATES.me.taking).toBeNull();
    expect(q.mood).not.toBe('struck');
  });
  test('a rocket gunboat\'s barrage walks three rockets along a ship\'s course', () => {
    const p = duel('gunboat', 'brig', 'gunner', Math.PI / 2, 200);
    Object.assign(p, { a: 0, vx: 20, vy: 0 });
    P.fireMortar();
    const shells = P.PIRATES.balls.filter(b => b.from === 'player' && b.splash);
    expect(shells.length).toBe(A.BARRAGE.shells);
    for (const b of shells) expect(b.dmg).toBeCloseTo(A.MORTAR[2]!.dmg * A.BARRAGE.dmg, 5);
    const xs = shells.map(b => b.lx);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(A.BARRAGE.step);   // spread along her course (east)
  });
  test('a dreadnought\'s turrets train round to a ship on any bearing and fire one salvo, a beaten pirate strikes to it, and her armour turns shot', () => {
    const rel = 2.4, p = duel('dreadnought', 'sloop', 'gunner', rel, 180), b = { x: G.boat.x, y: G.boat.y };
    Object.assign(p, { hp: Math.round(p.max * 0.4), yields: true });
    const hold = () => { G.boat.hp = 1e6; Object.assign(G.boat, { x: b.x, y: b.y, vx: 0, vy: 0, a: 0, w: 0 }); Object.assign(p, { x: b.x + Math.cos(rel) * 180, y: b.y + Math.sin(rel) * 180, vx: 0, vy: 0, think: 1 }); };
    P.fireBroadside();
    expect(P.PIRATES.salvo.length).toBe(0);                           // not laid on her yet
    let salvo = 0, laid = 0, mood = '';
    run(5, () => { hold(); if (!salvo && P.PIRATES.me.turret <= 0) { P.fireBroadside(); salvo = P.PIRATES.salvo.length; laid = P.PIRATES.me.turretA; mood = p.mood; } });
    expect(salvo).toBe(A.TURRET.at.length * 2);
    expect(Math.abs(wrapAngle(laid - rel))).toBeLessThan(A.TURRET.lay + 0.05);
    expect(mood).toBe('surrender');                                  // she strikes as the salvo goes off (and it may sink her yet)
    const whole = duel('dreadnought', 'sloop', 'gunner', 0, 150);    // dead ahead: laid at once, and whole, so she fights on
    P.fireBroadside();
    expect(P.PIRATES.salvo.length).toBe(A.TURRET.at.length * 2);
    expect(whole.mood).toBe('engage');
    const hit = (boat: typeof G.boatId, shot: 'round' | 'fire') => {
      duel(boat, 'brig', 'gunner', Math.PI / 2, 900);
      const me = { x: G.boat.x, y: G.boat.y }, hp = G.boat.hp = 5000;
      launch(P.PIRATES.balls, 'pirate', me.x, me.y + 60, me.x, me.y, 100, shot);
      run(2, () => { Object.assign(G.boat, { x: me.x, y: me.y, vx: 0, vy: 0, a: 0 }); });
      return { taken: hp - G.boat.hp, burn: P.PIRATES.me.wounds.burn };
    };
    const steel = hit('dreadnought', 'round'), plain = hit('patrol', 'round');
    expect(steel.taken / plain.taken).toBeCloseTo(1 - 0.4, 1);
    expect(hit('dreadnought', 'fire').burn).toBe(0);
    expect(hit('patrol', 'fire').burn).toBeGreaterThan(0);
  });
  test('a destroyer\'s torpedo is angled to meet a ship crossing her bow and hits hard; her tubes reload', () => {
    const p = duel('destroyer', 'brig', 'gunner', 0.12, 300), x0 = p.x, y0 = p.y, t0 = G.t;
    const hold = () => { G.boat.hp = 1e6; Object.assign(G.boat, { vx: 0, vy: 0, a: 0, w: 0 }); Object.assign(p, { x: x0, y: y0 + 14 * (G.t - t0), vx: 0, vy: 14, a: Math.PI / 2, think: 1, dodge: null }); };
    run(0.1, hold);
    expect(P.PIRATES.me.loaded).toBe(A.TORPEDO.tubes);
    const hp = p.hp, course = P.torpedoCourse();
    expect(course.target).toBe(p);
    expect(course.a).toBeGreaterThan(0.12);                            // led ahead of her, toward where she's going
    P.fireLauncher();
    expect(P.PIRATES.me.loaded).toBe(A.TORPEDO.tubes - 1);
    run(6, hold);
    expect(hp - p.hp).toBeGreaterThanOrEqual(A.TORPEDO.dmg);
    run(A.TORPEDO.reload * 0.6 + 0.5, hold);
    expect(P.PIRATES.me.loaded).toBe(A.TORPEDO.tubes);
    duel('skiff', 'brig', 'gunner', 0, 300);
    P.fireLauncher();
    expect(P.PIRATES.torps.length).toBe(0);                            // only a destroyer carries them
  });
  test('a pirate who sees a torpedo coming turns end-on to its track', () => {
    const p = duel('destroyer', 'brig', 'gunner', 0, 220);
    p.a = Math.PI / 2;                                                 // broadside-on to it
    run(0.1);
    P.fireLauncher();
    const random = Math.random;
    Math.random = () => 0.01;
    let combed = false;
    try { run(2, () => { G.boat.hp = 1e6; const t = P.PIRATES.torps[0]; if (t && p.dodge && Math.abs(Math.cos(p.dodge.h - t.a)) > 0.95) combed = true; }); } finally { Math.random = random; }
    expect(combed).toBe(true);
  });
  test('a missile cruiser\'s missile homes on a pirate wherever she is, even astern and turning', () => {
    const p = duel('missile', 'brig', 'gunner', Math.PI, 400), c = { x: p.x, y: p.y }, t0 = G.t;
    const hold = () => { G.boat.hp = 1e6; Object.assign(G.boat, { vx: 0, vy: 0, a: 0, w: 0 }); const w = (G.t - t0) * 0.5; Object.assign(p, { x: c.x + Math.sin(w) * 60, y: c.y + (1 - Math.cos(w)) * 60, vx: Math.cos(w) * 30, vy: Math.sin(w) * 30, think: 1 }); };
    run(0.1, hold);
    expect(P.PIRATES.me.loaded).toBe(A.MISSILE.cells);
    const hp = p.hp;
    P.fireLauncher();
    expect(P.PIRATES.missiles.length).toBe(1);
    run(6, hold);
    expect(hp - p.hp).toBeGreaterThanOrEqual(A.MISSILE.dmg);
    expect(P.PIRATES.missiles.length).toBe(0);
    duel('missile', 'brig', 'gunner', 0, A.MISSILE.range + 200);   // nothing in reach: nothing launched
    run(0.1);
    P.fireLauncher();
    expect(P.PIRATES.missiles.length).toBe(0);
  });
  test('a carrier\'s plane flies out to a pirate far past gun range, bombs her, and lands back aboard to rearm', () => {
    const p = duel('carrier', 'brig', 'gunner', 1.2, 700), c = { x: p.x, y: p.y };
    const hold = () => { G.boat.hp = 1e6; Object.assign(G.boat, { vx: 0, vy: 0, w: 0 }); Object.assign(p, { x: c.x, y: c.y, vx: 0, vy: 0, think: 1 }); };
    run(0.1, hold);
    expect(P.PIRATES.me.loaded).toBe(A.AIR.planes);
    const hp = p.hp;
    P.fireLauncher();
    expect(P.PIRATES.planes.length).toBe(1);
    expect(P.PIRATES.me.loaded).toBe(A.AIR.planes - 1);
    let bombed = 0, back = -1;
    run(45, () => { hold(); bombed = Math.max(bombed, hp - p.hp); if (back < 0 && !P.PIRATES.planes.length) back = G.t; });
    expect(bombed).toBeGreaterThanOrEqual(A.AIR.dmg);
    expect(back).toBeGreaterThan(0);                                   // home and landed
    expect(P.PIRATES.me.loaded).toBe(A.AIR.planes);                   // and rearmed
    duel('carrier', 'brig', 'gunner', 0, A.AIR.range + 200);          // nothing in reach: nothing launched
    run(0.1);
    P.fireLauncher();
    expect(P.PIRATES.planes.length).toBe(0);
  });
});
