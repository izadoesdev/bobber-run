// Records what the TypeScript rules give, for the Godot port's parity tests (godot/tests): the lattice hash, the
// seeded PRNG and every main island and its price in a block of cells round home. Re-run after changing any of them:
// bun scripts/godot-fixtures.ts
import { writeFileSync } from 'node:fs';
import { hash, mulberry } from '../src/noise';
import { mainIsland, islandPrice } from '../convex/islandRules';

const hashes: number[][] = [];
for (const [x, y, s] of [[0, 0, 0], [1, 2, 3], [-1, -1, 7], [12345, -6789, 41], [2147483647, -2147483648, 1], [-50000, 49999, 8111], [280, 280, 51]])
  hashes.push([x, y, s, hash(x, y, s)]);
for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j += 3) hashes.push([i * 37, j * 53, i + j, hash(i * 37, j * 53, i + j)]);

// each draw is a 32-bit integer over 2^32: recorded as that integer, so the comparison is exact (a decimal float can
// come back an ulp off through a JSON parser)
const mulberries = [0, 1, 7, 123456789, 4294967295, hash(3, -4, 7)].map(seed => {
  const r = mulberry(seed);
  return [seed, ...Array.from({ length: 8 }, () => r() * 4294967296)];
});

const islands: (number | null)[][] = [];
for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) {
  const m = mainIsland(i, j);
  islands.push(m ? [i, j, m.x, m.y, m.R, m.peak, islandPrice(i, j)] : [i, j, null]);
}

const out = new URL('../godot/tests/fixtures/rules.json', import.meta.url);
writeFileSync(out, JSON.stringify({ hashes, mulberries, islands }) + '\n');
console.log(`wrote ${hashes.length} hashes, ${mulberries.length} PRNG sequences, ${islands.length} cells to godot/tests/fixtures/rules.json`);
