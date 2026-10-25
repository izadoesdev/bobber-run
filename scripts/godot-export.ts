// Exports the game's data for the Godot port (godot/data), so the port reads the TypeScript's own tables and models
// instead of keeping copies that could drift: each boat's stats and its voxel model (as the shipyard shows it, with
// no gear fitted). Re-run after changing them: bun scripts/godot-export.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { BOATS } from '../src/econ';
import { decorate, PLAIN, OAR, M } from '../src/models';
import { RGB, EMISSIVE } from '../src/voxel';

const out = new URL('../godot/data/', import.meta.url);
mkdirSync(new URL('boats/', out), { recursive: true });
const hex = (c: readonly number[]): string => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');   // (RGB holds 0..255)

// a voxel model: its box (u along the boat, bow +u; v across, starboard +v; z up), one byte per voxel (0 empty, else
// 1 + an index into the palette), and the palette: each material's shadow, mid and lit colours, and whether it glows
function model(V: ReturnType<typeof decorate>) {
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
writeFileSync(new URL('boats.json', out), JSON.stringify(BOATS.map(({ id, name, speed, accel, turn, L, B, prop, hp }) => ({ id, name, speed, accel, turn, L, B, prop, hp })), null, 1) + '\n');
// the rowboat's oars: oarlock, reach and stroke (OAR), and the colours of shaft, blade, tip, the rower's coat and hands
const mid = (m: number): string => hex(RGB[m][1]), lit = (m: number): string => hex(RGB[m][2]);
writeFileSync(new URL('oars.json', out), JSON.stringify({ ...OAR, shaft: mid(M.oar), blade: lit(M.blade), tip: mid(M.tip), coat: mid(M.coat), skin: lit(M.skin) }, null, 1) + '\n');
console.log(`wrote ${BOATS.length} boat models, their stats and the oars to godot/data`);
