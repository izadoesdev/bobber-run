// Arms: the weapons a ship can carry, the shot it fires, and what a hit does. Pure data and small rules, shared by
// your boat and the pirates (game/pirates.ts fires them; gunnery.ts flies the shot).
//   Broadside guns fire from the rail facing the target, inside an arc either side of the beam, each rail on its own
//   reload: put the enemy abeam. A swivel gun on the bow fires by itself at anything ahead. A mortar lobs a shell high
//   over the water onto where a ship will be, with a splash. Powder kegs dropped astern float as mines. An iron ram
//   makes ramming hurt them far more than you. Special shot: chain tears rigging (slower), grape thins the crew
//   (slower reloads), fire sets a ship burning. A hit from dead ahead or astern rakes the ship for half again.
import { wrapAngle } from '../config';

export type ShotKind = 'round' | 'chain' | 'grape' | 'fire';
export type BoughtShot = Exclude<ShotKind, 'round'>;
export const SHOT_KINDS: readonly ShotKind[] = ['round', 'chain', 'grape', 'fire'];
export interface ShotDef {
  name: string;
  /** damage as a share of the gun's, balls a gun throws, and reach as a share of the gun's */
  dmg: number; pellets: number; reach: number;
  /** what each hit adds: torn rigging (0..1), crew down (0..1), seconds ablaze */
  sails: number; crew: number; burn: number;
  about: string;
}
export const SHOTS: Record<ShotKind, ShotDef> = {
  round: { name: 'Round shot', dmg: 1, pellets: 1, reach: 1, sails: 0, crew: 0, burn: 0, about: 'Solid iron balls: full damage to the hull' },
  chain: { name: 'Chain shot', dmg: 0.5, pellets: 1, reach: 0.9, sails: 0.2, crew: 0, burn: 0, about: 'Two balls on a chain that shred rigging: every hit slows the ship' },
  grape: { name: 'Grapeshot', dmg: 0.32, pellets: 5, reach: 0.6, sails: 0, crew: 0.14, burn: 0, about: 'A spray of small shot at close range that thins the crew, so their guns reload slower' },
  fire: { name: 'Fire shot', dmg: 0.6, pellets: 1, reach: 0.85, sails: 0.04, crew: 0, burn: 12, about: 'Heated shot that sets a ship ablaze: it burns on for a while' },
};
/** Shot sold at harbours, a box at a time (round shot is free and never runs out). */
export const AMMO: Record<BoughtShot, { n: number; cost: number }> = { chain: { n: 6, cost: 60 }, grape: { n: 8, cost: 45 }, fire: { n: 4, cost: 90 } };

// Guns are slow and heavy, as they were: a real crew took a minute and a half or more to reload a broadside, so a fight
// was long manoeuvring round a few decisive volleys. Compressed here to seconds, but the shape is the same: a broadside
// takes 8 to 10 s to load, and each one that lands matters.
/** Broadside guns by level: guns a rail, damage a ball, seconds to reload a rail, reach, and the arc either side of the beam. */
export const BROADSIDE = [null, { guns: 1, dmg: 40, reload: 10, range: 170, arc: 0.6 }, { guns: 2, dmg: 42, reload: 9, range: 185, arc: 0.6 },
  { guns: 3, dmg: 48, reload: 8, range: 210, arc: 0.65 }] as const;
/** The bow swivel by level: a light gun that fires by itself at anything inside `arc` of dead ahead. */
export const SWIVEL = [null, { dmg: 12, reload: 4.5, range: 130, arc: 1.2 }, { dmg: 16, reload: 3.5, range: 150, arc: 1.3 }] as const;
/** The mortar by level: a shell lobbed between `min` and `range` that bursts over `splash`. */
export const MORTAR = [null, { dmg: 90, splash: 18, reload: 18, min: 120, range: 300 }, { dmg: 120, splash: 22, reload: 15, min: 110, range: 340 }] as const;
/** Powder kegs by level: how many the boat carries, seconds to make up one more, the blast and how close sets it off. */
export const KEGS = [null, { carry: 2, every: 30, dmg: 90, reach: 16 }, { carry: 4, every: 20, dmg: 120, reach: 18 }] as const;
/** A cutter's bow chaser: a long gun on the foredeck, laid dead ahead, that outranges any broadside. */
export const CHASER = { dmg: 50, reload: 7, range: 300, arc: 0.22 } as const;
/** A privateer's boarders: seconds to carry a pirate's deck, plus `hp` more times the share of her hull still whole
 *  (a beaten ship falls fast), slower with your own men down; and the most of her hull she can have left to try. */
export const BOARDERS = { s: 4, hp: 8, most: 0.6 } as const;
/** A rocket gunboat's barrage: rockets a salvo, how far apart (world units) they fall along the target's course, and each
 *  one's damage as a share of a single shell's. */
export const BARRAGE = { shells: 3, step: 22, dmg: 0.7 } as const;
/** A dreadnought's turrets: three of them, each with two big guns, training together onto any bearing at `traverse`
 *  radians a second and firing as one salvo once laid within `lay` of the target; where they stand along her (shares
 *  of her half-length), damage a gun, seconds to reload, reach. */
export const TURRET = { at: [0.7, 0.43, -0.65], dmg: 38, reload: 8, range: 290, traverse: 0.8, lay: 0.08 } as const;
/** A destroyer's torpedoes: tubes loaded at once, seconds to reload one, the blow, running speed and reach (world
 *  units), and how far either side of her bow (radians) they can be angled to meet a ship. */
export const TORPEDO = { tubes: 2, reload: 12, dmg: 220, speed: 75, range: 440, gyro: 0.3 } as const;
/** A dreadnought's salvo strikes a pirate's heart: one beaten below this share of her hull, in this reach, gives up. */
export const AWE = { hull: 0.5, reach: 450 } as const;
/** A missile cruiser's guided missiles: cells loaded at once, seconds to reload one, the blow, speed (world units a
 *  second), how fast they turn onto their mark (radians a second), and how far they fly. */
export const MISSILE = { cells: 4, reload: 10, dmg: 160, speed: 150, turn: 2.6, range: 700 } as const;
/** A carrier's air wing: planes aboard, seconds to rearm one that has landed (or bring up a spare), how far from her
 *  they'll go after a pirate, their speed and turn (radians a second), the height they fly at, and the bombs each
 *  carries, with each bomb's damage and burst. */
export const AIR = { planes: 3, rearm: 9, range: 1100, speed: 150, turn: 1.8, alt: 34, bombs: 2, dmg: 75, splash: 16 } as const;
/** Ramming damage to the other ship, times this, by Iron Ram level (and the rammer takes this share of the usual). */
export const RAM = [{ out: 1, back: 1 }, { out: 2.5, back: 0.4 }] as const;

/** What a ship has suffered besides its hull: torn rigging and crew down (0..1), and seconds left ablaze. */
export interface Wounds { sails: number; crew: number; burn: number }
export const freshWounds = (): Wounds => ({ sails: 0, crew: 0, burn: 0 });
/** Torn rigging slows a ship (up to a little over half), and a thinned crew reloads slower. */
export const speedFactor = (w: Wounds): number => 1 - 0.55 * w.sails;
export const reloadFactor = (w: Wounds): number => 1 + 0.8 * w.crew;
/** Fire damage a second while ablaze. */
export const BURN_DPS = 3;
/**
 * Time passing for a ship's wounds: a fire burns down (twice as fast for a crew not busy sailing), rigging and crew
 * slowly mend. Returns the fire damage dealt over dt.
 */
export function mend(w: Wounds, dt: number, still: boolean): number {
  const burning = w.burn > 0;
  w.burn = Math.max(0, w.burn - dt * (still ? 2 : 1));
  w.sails = Math.max(0, w.sails - 0.006 * dt);
  w.crew = Math.max(0, w.crew - 0.01 * dt);
  return burning ? BURN_DPS * dt : 0;
}
/** Add a hit's wounds of shot `kind`. */
export function wound(w: Wounds, kind: ShotKind): void {
  const s = SHOTS[kind];
  w.sails = Math.min(1, w.sails + s.sails); w.crew = Math.min(1, w.crew + s.crew); w.burn = Math.max(w.burn, s.burn);
}
/** A shot travelling (vx, vy) along a ship's length, from near dead ahead or astern, rakes her: half again the damage. */
export const raking = (heading: number, vx: number, vy: number): boolean => Math.abs(Math.cos(Math.atan2(vy, vx) - heading)) > Math.cos(0.45);
export const RAKE = 1.5;
/** Whether bearing `bear` lies inside the arc of rail `side` (+1 or -1) of a ship heading `a`. */
export const inRail = (a: number, bear: number, side: 1 | -1, arc: number): boolean => Math.abs(wrapAngle(bear - a - side * Math.PI / 2)) <= arc;
/** Whether bearing `bear` lies inside `arc` of dead ahead of a ship heading `a`. */
export const ahead = (a: number, bear: number, arc: number): boolean => Math.abs(wrapAngle(bear - a)) <= arc;
