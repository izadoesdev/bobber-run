// The pirate ships' models agree with the game: each hull is as long and wide as the hit tests think (SHIP_DIMS), its
// gunports are where broadsides are fired from, battle damage is the same every time and only gets worse, and a
// dismasted ship has nothing left aloft of its mainmast.
import { describe, expect, test } from 'bun:test';
import { RED_FLAG, SHIP_DIMS, pirateVox, type PirateHull, type ShipLook } from '../src/pirateships';
import type { Vox } from '../src/voxel';
import { M } from '../src/models';

const KINDS = Object.keys(SHIP_DIMS) as PirateHull[];
const look = (kind: PirateHull, more: Partial<ShipLook> = {}): ShipLook => ({ kind, scheme: 0, flag: 0, torn: 0, scorch: 0, dismasted: false, white: false, ...more });
const solid = (V: Vox): number => V.d.reduce((n, m) => n + (m ? 1 : 0), 0);
/** Each hull's gunwale height: the hull's extent is measured below it (bowsprits, booms and sails reach further, and aren't hull). */
const HZ: Record<PirateHull, number> = { sloop: 5, ketch: 6, brig: 8, galleon: 10, galley: 4 };
/** The hull's extent along u and v up to layer `below` (a galley's oars reach out past it, and aren't hull). */
function hullExtent(V: Vox, below: number): { L: number; B: number } {
  let u0 = Infinity, u1 = -Infinity, v1 = 0;
  V.each((u, v, z, m) => { if (z <= below && z >= 1 && m !== M.oar && m !== M.plank2) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v1 = Math.max(v1, Math.abs(v)); } });
  return { L: (u1 - u0) / 2, B: v1 };
}

describe('pirate ship models', () => {
  for (const kind of KINDS) test(`the ${kind}'s hull matches its size in the game`, () => {
    const { L, B } = hullExtent(pirateVox(look(kind)), HZ[kind]), d = SHIP_DIMS[kind];
    expect(Math.abs(L - d.L)).toBeLessThan(2.5);
    expect(Math.abs(B - d.B)).toBeLessThan(1.6);
  });
  test('every broadside gun has an open gunport each side where its shot comes from', () => {
    for (const kind of KINDS) {
      const V = pirateVox(look(kind));
      for (const u of SHIP_DIMS[kind].ports) for (const side of [-1, 1]) {
        let port = false;
        for (let v = 1; v < V.nv && !port; v++) for (let z = 2; z < 12 && !port; z++) if (V.get(u, side * v, z) && V.get(u + 1, side * v, z) === V.get(u, side * v, z) && V.get(u, side * v, z + 2) !== V.get(u, side * v, z)) port = true;
        expect(port, `${kind} port at ${u}`).toBe(true);
      }
    }
  });
  test('battle damage is the same every time, and only gets worse', () => {
    for (const kind of KINDS) {
      const whole = solid(pirateVox(look(kind))), holed = pirateVox(look(kind, { torn: 1, scorch: 1 })), worse = solid(pirateVox(look(kind, { torn: 2, scorch: 2 })));
      expect(Array.from(holed.d)).toEqual(Array.from(pirateVox(look(kind, { torn: 1, scorch: 1 })).d));
      expect(solid(holed)).toBeLessThan(whole);
      expect(worse).toBeLessThan(solid(holed));
    }
  });
  test('a ship flying no colours has no flag at her masthead; her black flag and the red one are the same size', () => {
    for (const kind of KINDS) {
      const none = solid(pirateVox(look(kind, { flag: -1 }))), black = solid(pirateVox(look(kind, { flag: 0 }))), red = solid(pirateVox(look(kind, { flag: RED_FLAG })));
      expect(none).toBeLessThan(black);
      expect(red).toBe(black);
    }
  });
  test('a dismasted ship has nothing left above the break round her mainmast', () => {
    for (const kind of ['brig', 'galleon', 'ketch'] as const) {
      const d = SHIP_DIMS[kind], V = pirateVox(look(kind, { dismasted: true }));
      let aloft = 0;
      V.each((u, _v, z) => { if (z > d.snap + 1 && Math.abs(u - d.mast) <= 1) aloft++; });
      expect(aloft, kind).toBe(0);
    }
  });
});
