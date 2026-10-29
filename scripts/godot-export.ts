// Exports the game's data for the Godot port (godot/data), so the port reads the TypeScript's own tables and models
// instead of keeping copies that could drift: each boat's stats and its voxel model (as the shipyard shows it, with
// no gear fitted), the rowboat's oars, the harbours, the trees, rocks and bushes that grow on the islands, the fish
// species, and the outfitter's upgrades. Re-run after changing them: bun scripts/godot-export.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { BOATS, UPGRADES, UPGRADE_KEYS, UPGRADE_STEP, UP_CATS } from '../src/econ';
import { decorate, PLAIN, OAR, M } from '../src/models';
import { RGB, EMISSIVE, type Vox } from '../src/voxel';
import { TREE_BUILD, TREE_KINDS, fishVox } from '../src/gl/meshes';
import { HARBOURS } from '../src/landmarks';
import { SPECIES, HABITAT, schoolLook } from '../src/species';

const out = new URL('../godot/data/', import.meta.url);
mkdirSync(new URL('boats/', out), { recursive: true });
mkdirSync(new URL('trees/', out), { recursive: true });
mkdirSync(new URL('fish/', out), { recursive: true });
mkdirSync(new URL('harbours/', out), { recursive: true });
const hex = (c: readonly number[]): string => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');   // (RGB holds 0..255)

// a voxel model: its box (u along the boat, bow +u; v across, starboard +v; z up), one byte per voxel (0 empty, else
// 1 + an index into the palette), and the palette: each material's shadow, mid and lit colours, and whether it glows
function model(V: Vox) {
  const index = new Map<number, number>(), palette: { ramp: string[]; glow: boolean }[] = [];
  const cells = new Uint8Array(V.d.length);
  V.d.forEach((m, k) => {
    if (!m) return;
    if (!index.has(m)) { index.set(m, palette.length); palette.push({ ramp: RGB[m].map(hex), glow: EMISSIVE.has(m) }); }
    cells[k] = index.get(m)! + 1;
  });
  if (palette.length > 255) throw new Error('more than 255 materials in one model');
  return { u0: V.u0, v0: V.v0, nu: V.nu, nv: V.nv, nz: V.nz, palette, cells: Buffer.from(cells).toString('base64') };
}

for (const b of BOATS) writeFileSync(new URL(`boats/${b.id}.json`, out), JSON.stringify(model(decorate(b.id, PLAIN))) + '\n');
// the stats the sailing needs, as the game has them
writeFileSync(new URL('boats.json', out), JSON.stringify(BOATS.map(({ id, name, speed, accel, turn, L, B, prop, hp, hold, deck }) => ({ id, name, speed, accel, turn, L, B, prop, hp, hold, deck: deck ?? 0 })), null, 1) + '\n');
// the harbours: each design's model, the pier along +u from where it meets the land (0 is Alderhaven's)
HARBOURS.forEach((build, k) => writeFileSync(new URL(`harbours/${k}.json`, out), JSON.stringify(model(build())) + '\n'));
// trees, rocks and bushes, each kind's model
for (const k of TREE_KINDS) writeFileSync(new URL(`trees/${k}.json`, out), JSON.stringify(model(TREE_BUILD[k]())) + '\n');
// fish: each species' table entry, how its school looks, its fish model, and where it lives. Its waters are a function
// of the sea's depth h and the distance d from home (Species.zone), sampled on a grid into a bitmap, exact to the grid:
// bit (i, j) is zone(ZONE.h0 + i * ZONE.dh, j * ZONE.dd)
const ZONE = { h0: -0.8, dh: 0.01, nh: 91, dd: 100, nd: 81 };
const species = SPECIES.map((s, n) => {
  const bits = new Uint8Array(Math.ceil(ZONE.nh * ZONE.nd / 8));
  for (let j = 0; j < ZONE.nd; j++) for (let i = 0; i < ZONE.nh; i++) if (s.zone(ZONE.h0 + i * ZONE.dh, j * ZONE.dd)) bits[(j * ZONE.nh + i) >> 3] |= 1 << ((j * ZONE.nh + i) & 7);
  writeFileSync(new URL(`fish/${s.id}.json`, out), JSON.stringify(model(fishVox(n))) + '\n');
  const { zone: _, diff, ...rest } = s;
  return { ...rest, diff, habitat: HABITAT[s.id] ?? null, look: schoolLook(n), zone: Buffer.from(bits).toString('base64') };   // habitat: the biome it lives in only
});
writeFileSync(new URL('species.json', out), JSON.stringify({ zoneGrid: ZONE, species }) + '\n');
// the rowboat's oars: oarlock, reach and stroke (OAR), and the colours of shaft, blade, tip, the rower's coat and hands
const mid = (m: number): string => hex(RGB[m][1]), lit = (m: number): string => hex(RGB[m][2]);
writeFileSync(new URL('oars.json', out), JSON.stringify({ ...OAR, shaft: mid(M.oar), blade: lit(M.blade), tip: mid(M.tip), coat: mid(M.coat), skin: lit(M.skin) }, null, 1) + '\n');
// the outfitter's upgrades in shop order: each one's name (by the boat's drive, for the one named after it), shop
// category, costs, what each level does, and the harbour project it waits on; and what a level of each adds
const names = (k: keyof typeof UPGRADES) => Object.fromEntries(['OARS', 'SAIL', 'ENGINE'].map(prop => [prop, UPGRADES[k].name(BOATS.find(b => b.prop === prop)!)]));
const upgrades = UPGRADE_KEYS.map(key => { const { cat, costs, lv, req } = UPGRADES[key]; return { key, names: names(key), cat, costs, lv, req: req ?? null }; });
writeFileSync(new URL('upgrades.json', out), JSON.stringify({ step: UPGRADE_STEP, cats: UP_CATS, upgrades }, null, 1) + '\n');
console.log(`wrote ${BOATS.length} boats, the oars, ${TREE_KINDS.length} trees and ${SPECIES.length} species to godot/data`);
