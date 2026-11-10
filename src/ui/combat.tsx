// The fight over the sea (game/pirates.ts, game/arms.ts). Always: your lookout's calls above your boat (what each ship
// is doing as she does it), grappling lines when a ship is lashed alongside, pips at the screen's edge for ships after
// you out of sight (in the colours they fly), and in a fight the gun deck along the bottom: each weapon you fire with
// its key, what it would do now and its reload. With the Battle aids setting on (the default), also your loaded
// broadsides' arcs on the water (gold when a pirate is in one), the lines turrets, a chaser or a torpedo would fire
// along, rings where incoming shot will land (closing as it falls), the mortar's mark on its target, and the mark of
// each pirate your planes are after.
import type { JSX } from 'preact';
import { G, boatDef, gearLvl } from '../game';
import { W, H } from '../config';
import { SET } from '../prefs';
import {
  CALL_S, PIRATES, boardPrize, boarder, chaserTarget, crewReload, cycleShot, dropKeg, fireBroadside, fireMortar, flagOf, hailer, hostile,
  fireLauncher, launcher, launcherTarget, mortarTarget, railsBearing, takeTime, threat, torpedoCourse, turretOff, type Pirate,
} from '../game/pirates';
import { AIR, AWE, BARRAGE, BOARDERS, BROADSIDE, CHASER, KEGS, MISSILE, MORTAR, RAM, SHOTS, SHOT_KINDS, SWIVEL, TORPEDO, TURRET, type BoughtShot } from '../game/arms';
import { shellTime } from '../game/gunnery';
import { RED_FLAG } from '../pirateships';
import { Key, keyed, pin, viewPct } from './parts';

/** Whether a fight is on, or about to be: a pirate after you, or one in reach of your guns. */
const fighting = (): boolean => !!threat() || PIRATES.ships.some(p => hostile(p) && Math.hypot(p.x - G.boat.x, p.y - G.boat.y) < 450);

/** An arc wedge round (x, y) from bearing a0 to a1, out to r, as SVG points in view %. */
function wedge(x: number, y: number, a0: number, a1: number, r0: number, r: number): string {
  const pts: string[] = [], step = (a1 - a0) / 10;
  for (let k = 0; k <= 10; k++) { const a = a0 + step * k, [px, py] = viewPct(x + Math.cos(a) * r, y + Math.sin(a) * r); pts.push(`${px.toFixed(2)},${py.toFixed(2)}`); }
  for (let k = 10; k >= 0; k--) { const a = a0 + step * k, [px, py] = viewPct(x + Math.cos(a) * r0, y + Math.sin(a) * r0); pts.push(`${px.toFixed(2)},${py.toFixed(2)}`); }
  return pts.join(' ');
}
/** A ring of radius r at (x, y), in view % (the view is wider than tall, so it's an ellipse in %). */
function ring(x: number, y: number, r: number, cls: string, key: string): JSX.Element {
  const [px, py] = viewPct(x, y);
  return <ellipse key={key} class={cls} cx={px} cy={py} rx={r / W * 100} ry={r / H * 100} />;
}

export function Combat() {
  if (G.mode !== 'play') return null;
  return <><Ropes /><Pips /><Call />{SET.aids && <Aids />}</>;
}

function Aids() {
  const shapes: JSX.Element[] = [], b = G.boat, me = PIRATES.me, B = BROADSIDE[gearLvl('cannon')], on = fighting();
  // your loaded broadsides' arcs, gold when a pirate is in one
  if (B && on) {
    const bearing = railsBearing(), r0 = boatDef().B / 2 + 2, reach = B.range * SHOTS[me.shot].reach;
    for (const [rail, s] of [[0, -1], [1, 1]] as const) {
      const mid = b.a + s * Math.PI / 2;
      if (me.rails[rail] <= 0) shapes.push(<polygon key={'ra' + rail} class={'arc ' + (bearing[rail] ? 'ready' : 'loaded')} points={wedge(b.x, b.y, mid - B.arc, mid + B.arc, r0, reach)} />);
    }
  }
  // a dreadnought's loaded turrets: a line where their guns point, gold once they're on her
  if (on && boatDef().signature === 'turret' && me.turret <= 0) {
    const a = b.a + me.turretA, off = turretOff(), laid = off !== null && Math.abs(off) <= TURRET.lay;
    shapes.push(<polygon key="tu" class={'arc ' + (laid ? 'ready' : 'loaded')} points={wedge(b.x, b.y, a - 0.03, a + 0.03, 8, TURRET.range)} />);
  }
  // a destroyer's torpedo track: where one fired now would run, gold when it would meet a pirate
  if (on && boatDef().signature === 'torpedo' && me.loaded > 0) {
    const { a, target } = torpedoCourse(), L = boatDef().L;
    shapes.push(<polygon key="tp" class={'arc ' + (target ? 'ready' : 'loaded')} points={wedge(b.x, b.y, a - 0.02, a + 0.02, L, TORPEDO.range)} />);
  }
  // a cutter's loaded bow chaser: a narrow wedge dead ahead
  if (on && boatDef().signature === 'chaser' && me.chaser <= 0) {
    const L = boatDef().L;
    shapes.push(<polygon key="ch" class={'arc ' + (chaserTarget() ? 'ready' : 'loaded')} points={wedge(b.x, b.y, b.a - CHASER.arc, b.a + CHASER.arc, L, CHASER.range)} />);
  }
  // where their shot will fall near you: a ring closing in as it drops (mortar shells: their whole burst)
  for (const ball of PIRATES.balls) {
    if (ball.from !== 'pirate' || Math.hypot(ball.lx - b.x, ball.ly - b.y) > 170) continue;
    const r = ball.splash || 5, k = Math.min(1, ball.t / ball.flight);
    shapes.push(ring(ball.lx, ball.ly, r, 'impact' + (ball.splash ? ' shell' : ''), 'i' + ball.lx + ball.ly));
    shapes.push(ring(ball.lx, ball.ly, r * (1 - k) + 1, 'impact closing', 'c' + ball.lx + ball.ly));
  }
  // the pirates your planes are after
  for (const [k, pl] of PIRATES.planes.entries()) if (pl.target && !pl.home) shapes.push(ring(pl.target.x, pl.target.y, AIR.splash + 6, 'mark', 'pl' + k));
  // your mortar's mark on the pirate it would fire at, where the shell would land
  const M = MORTAR[gearLvl('mortar')];
  if (M && on) {
    const target = mortarTarget();
    if (target) {
      const t = shellTime(Math.hypot(target.x - b.x, target.y - b.y));
      shapes.push(ring(target.x + target.vx * t, target.y + target.vy * t, M.splash, 'mark' + (me.mortar > 0 ? ' dim' : ''), 'mk'));
    }
  }
  return shapes.length > 0 ? <svg class="combat-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{shapes}</svg> : null;
}

/** A pirate's condition as a lookout would call it, beside her name: guns run out at you, holed, listing, ablaze, rigging torn, dismasted, struck. */
export const pirateStatus = (p: Pirate): string => {
  const hull = p.hp / p.max;
  return [
    p.mood === 'surrender' ? 'colours struck' : p.aim.some(a => a >= 0) || p.bowAim >= 0 ? 'guns run out' : '',
    p.kind !== 'sloop' && hull < 0.18 ? 'dismasted' : hull < 0.3 ? 'listing' : hull < 0.6 ? 'holed' : '',
    p.wounds.burn > 0 ? 'ablaze' : '', p.wounds.sails > 0.3 ? 'rigging torn' : '',
  ].filter(Boolean).join(', ');
};

/** The lookout's latest call, over your boat, fading as it's said. */
function Call() {
  const c = PIRATES.call, age = c ? G.t - c.t : Infinity;
  if (!c || age > CALL_S || G.fish || G.card) return null;
  const [x, y] = viewPct(G.boat.x, G.boat.y - boatDef().L - 18);
  return <div class={'crew-call' + (c.pri >= 4 ? ' urgent' : '') + (age > CALL_S - 0.4 ? ' out' : '')} key={c.t} role="status" aria-live="assertive" style={pin(x, y)}>{keyed(c.s)}</div>;
}
/** Grappling lines between your rail and a ship lashed alongside: a raider boarding you, or one your boarders are taking. */
function Ropes() {
  const p = boarder() ?? PIRATES.me.taking?.p;
  if (!p) return null;
  const b = G.boat, c = Math.cos(b.a), s = Math.sin(b.a), lines = [-0.5, 0, 0.5].map(u => {
    const L = boatDef().L * u, [x0, y0] = viewPct(b.x + c * L, b.y + s * L), [x1, y1] = viewPct(p.x + c * L * 1.2, p.y + s * L * 1.2);
    return <line key={u} x1={x0} y1={y0} x2={x1} y2={y1} class="rope" />;
  });
  return <svg class="combat-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{lines}</svg>;
}
/** The colour of the flag a ship flies, for her pip: none (a grey sail), black, or red. */
const flagCol = (p: Pirate): string => { const f = flagOf(p); return f < 0 ? '#c9d1d4' : f === RED_FLAG ? '#cc3a2e' : '#14141a'; };
/** A pip at the screen's edge for each ship after you that's out of sight, pointing her way, in the colours she flies. */
function Pips() {
  const b = G.boat, [bx, by] = viewPct(b.x, b.y), out: JSX.Element[] = [];
  for (const p of PIRATES.ships) {
    if (!(p.mood === 'shadow' || p.mood === 'hail' || p.mood === 'tribute' || p.mood === 'chase' || p.mood === 'engage')) continue;
    const [x, y] = viewPct(p.x, p.y);
    if (x > 3 && x < 97 && y > 6 && y < 94) continue;              // in sight: her own flag says it
    const dx = (x - bx) * W, dy = (y - by) * H, a = Math.atan2(dy, dx);
    const t = Math.min(dx ? ((dx > 0 ? 95 : 5) - bx) * W / dx : Infinity, dy ? ((dy > 0 ? 90 : 12) - by) * H / dy : Infinity);
    const px = bx + dx / W * t, py = by + dy / H * t, far = Math.round(Math.hypot(p.x - b.x, p.y - b.y) / 10);
    out.push(
      <div key={p.id} class="threat-pip" style={pin(px, py)} title={`${p.mood === 'shadow' ? 'A sail' : cap(p.name)}, ${far} m`}>
        <svg viewBox="-10 -10 20 20" style={{ rotate: `${Math.round(a * 180 / Math.PI)}deg` }}><path d="M9 0 L-5 -6 L-2 0 L-5 6 Z" fill={flagCol(p)} stroke="#f6eedc" stroke-width="1.6" stroke-linejoin="round" /></svg>
        <span>{far} m</span>
      </div>,
    );
  }
  return out.length ? <>{out}</> : null;
}
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- the gun deck
/** A weapon you fire yourself, as the gun deck shows it: its key and name, how loaded (0..1), what it would do now
 *  ('Fire!' when it would hit, the seconds left while it loads), whether it would hit now, what pressing it does, and
 *  how it works (its tooltip and its line in the notes, with [KEY] tokens). */
interface Gun { key: string; name: string; k: number; now: string; hot: boolean; act?: () => void; how: string }
const metres = (u: number): string => `${Math.max(1, Math.round(u / 10))} m`;
const deg = (a: number): string => `${Math.round(a * 180 / Math.PI)}°`;
const secs = (s: number): string => `${Math.ceil(s)}s`;
const plain = (s: string): string => s.replace(/\[(\w+)\]/g, '$1');

/** Every weapon you fire yourself, in the order of their keys. */
function guns(): Gun[] {
  const me = PIRATES.me, rf = crewReload(), bd = boatDef(), out: Gun[] = [];
  const B = BROADSIDE[gearLvl('cannon')], M = MORTAR[gearLvl('mortar')], K = KEGS[gearLvl('kegs')], l = launcher();
  /** A gun that loads: `left` seconds of `total` to go, `hot` when it would hit now, `idle` what it says loaded but with nothing to hit. */
  const gun = (key: string, name: string, left: number, total: number, hot: boolean, idle: string, act: () => void, how: string, fire = 'Fire!') =>
    out.push({ key, name, k: 1 - Math.min(1, Math.max(0, left) / total), now: left > 0 ? secs(left) : hot ? fire : idle, hot: left <= 0 && hot, act, how });
  if (B) {
    const bears = railsBearing(), total = B.reload * rf, shot = SHOTS[me.shot];
    const ready = ([0, 1] as const).find(r => bears[r] && me.rails[r] <= 0), left = Math.min(...me.rails);
    gun('r', 'Guns', ready !== undefined ? 0 : left, total, ready !== undefined, 'Abeam', fireBroadside,
      `${B.guns} guns down each side, each side loading on its own (${secs(total)}). They fire square off the beam, out to ${metres(B.range * shot.reach)}: turn until she lies abeam and the arc on the water turns gold, then [R].`);
  }
  if (bd.signature === 'turret') {
    const off = turretOff();
    gun('r', 'Turrets', me.turret, TURRET.reload * rf, off !== null && Math.abs(off) <= TURRET.lay, off === null ? 'No target' : 'Aiming', fireBroadside,
      `${TURRET.at.length} turrets of two big guns train together onto the nearest pirate on any bearing, out to ${metres(TURRET.range)}. When they're on her, [R]: a salvo of ${TURRET.at.length * 2} shells, ${TURRET.dmg} each. A pirate below ${AWE.hull * 100}% of her hull within ${metres(AWE.reach)} strikes or runs from it. Reloads in ${secs(TURRET.reload * rf)}.`);
  }
  if (bd.signature === 'chaser') gun('r', 'Chaser', me.chaser, CHASER.reload * rf, !!chaserTarget(), 'Ahead', fireBroadside,
    `A long gun in the bow, dead ahead (${deg(CHASER.arc)} either way), out to ${metres(CHASER.range)}: point at her and [R]. The same key fires the broadsides: whichever guns bear on her go. Reloads in ${secs(CHASER.reload * rf)}.`);
  if (M) {
    const rockets = bd.signature === 'barrage';
    gun('t', rockets ? 'Rockets' : 'Mortar', me.mortar, M.reload * rf, !!mortarTarget(), `${metres(M.min)}+`, fireMortar, rockets
      ? `A barrage of ${BARRAGE.shells} rockets onto the nearest pirate ${metres(M.min)} to ${metres(M.range)} off, any bearing, spread along her course so turning won't save her. [T]. Reloads in ${secs(M.reload * rf)}.`
      : `A shell lobbed onto the nearest pirate ${metres(M.min)} to ${metres(M.range)} off, any bearing. [T]. Reloads in ${secs(M.reload * rf)}.`);
  }
  if (l) {
    const total = l.reload * rf, hot = me.loaded > 0 && !!launcherTarget(l.kind), aloft = PIRATES.planes.length, air = l.kind === 'air';
    out.push({
      key: 'y', name: l.kind === 'torpedo' ? 'Torpedo' : air ? 'Planes' : 'Missile', k: me.loaded >= l.n ? 1 : me.tubeT / total, hot, act: fireLauncher,
      now: me.loaded > 0 ? hot ? air ? 'Launch!' : 'Fire!' : `${me.loaded}/${l.n}` : air && aloft ? `${aloft} aloft` : secs(total - me.tubeT),
      how: l.kind === 'torpedo'
        ? `Runs straight under the water, out to ${metres(TORPEDO.range)}, and hits for ${TORPEDO.dmg}. Point roughly at her and [Y]: it angles to meet her. ${l.n} tubes, one reloaded every ${secs(total)}.`
        : air ? `[Y] launches a jet after the nearest pirate within ${metres(AIR.range)}, any bearing, over land or sea. It drops ${AIR.bombs} bombs on her, ${AIR.dmg} each, one pass at a time, then flies home and lands to rearm (${secs(total)}). ${l.n} planes: send them all at one ship, or one at each.`
          : `Homes on the nearest pirate within ${metres(MISSILE.range)}, whatever she does, and hits for ${MISSILE.dmg}. [Y]. ${l.n} cells, one reloaded every ${secs(total)}.`,
    });
  }
  if (K) out.push({ key: 'v', name: 'Kegs', k: me.kegs >= K.carry ? 1 : me.kegT / K.every, now: `${me.kegs}`, hot: false, act: dropKeg,
    how: `Powder kegs off your stern with [V]: they blow up when a ship comes close. Drop them in the path of one chasing you. One more every ${K.every}s.` });
  if (B && SHOT_KINDS.some(k => k !== 'round' && G.ammo[k as BoughtShot] > 0)) out.push({
    key: 'z', name: 'Shot', k: 1, now: me.shot === 'round' ? 'Round' : `${SHOTS[me.shot].name.split(' ')[0]} ×${G.ammo[me.shot as BoughtShot]}`, hot: false, act: cycleShot,
    how: `[Z] switches what your guns load. ${SHOT_KINDS.map(k => `${SHOTS[k].name}: ${SHOTS[k].about.toLowerCase()}.`).join(' ')}`,
  });
  const tk = me.taking, near = G.nearPrize && G.nearPrize.mood !== 'surrender' ? G.nearPrize : null;
  if (bd.signature === 'boarders' && (tk || near)) out.push({
    key: 'e', name: 'Board', k: tk ? Math.min(1, tk.t / takeTime(tk.p)) : 1, now: tk ? `${Math.round(Math.min(1, tk.t / takeTime(tk.p)) * 100)}%` : 'Board!', hot: !tk,
    act: near ? () => boardPrize(near) : undefined,
    how: `Alongside a pirate beaten below ${BOARDERS.most * 100}% of her hull, [E] sends your boarders over. Hold her alongside until she strikes; sail off and the grapples tear loose.`,
  });
  return out;
}

/** What else is aboard that needs no key, for the notes: the swivel, armour, the ram. */
function aboard(): string[] {
  const S = SWIVEL[gearLvl('swivel')], bd = boatDef(), ram = gearLvl('ram');
  return [
    S ? `Swivel: fires by itself at anything ahead within ${metres(S.range)}.` : '',
    bd.armour ? `Armour: every hit does ${Math.round(bd.armour * 100)}% less, and fire shot can't set her alight.` : '',
    ram ? `Ram: run bows-on into a ship and she takes ${RAM[ram].out}× the damage, you ${RAM[ram].back}×.` : '',
  ].filter(Boolean);
}

/** Whether the gunnery notes are open. */
let notes = false;
const toggleNotes = (): void => { notes = !notes; };

/**
 * Along the bottom of the screen in a fight: each weapon you fire with its key, what it would do now and a thin bar
 * filling as it loads; gold when it would hit. Click one to fire it, hover for how it works; ? opens notes on them all.
 */
export function GunDeck() {
  if (G.mode !== 'play' || G.fish || G.card || !(fighting() || hailer() || PIRATES.me.taking)) return null;
  const list = guns();
  if (!list.length) return null;
  return (
    <>
      <div class="gundeck" role="toolbar" aria-label="Your weapons">
        {list.map(g => (
          <button key={g.name} type="button" class={'gun' + (g.hot ? ' hot' : '')} title={plain(g.how)} onMouseDown={e => e.preventDefault()} onClick={g.act} aria-label={`${g.name}: ${g.now}`}>
            <Key k={g.key} /><span class="gn">{g.name}</span><span class="gnow">{g.now}</span><i class="gbar"><b style={{ width: `${Math.round(g.k * 100)}%` }} /></i>
          </button>
        ))}
        <button type="button" class={'gun-help' + (notes ? ' open' : '')} title="How your weapons work" onMouseDown={e => e.preventDefault()} onClick={toggleNotes} aria-expanded={notes}>?</button>
      </div>
      {notes && (
        <div class="gun-notes" role="dialog" aria-label="Your weapons">
          <ul>
            {list.map(g => <li key={g.name}><Key k={g.key} /> <b>{g.name}</b>: {keyed(g.how)}</li>)}
            {aboard().map(t => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
