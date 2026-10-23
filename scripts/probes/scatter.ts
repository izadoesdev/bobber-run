// How regional the island themes are: of the main islands within 4,500 of home, how many neighbours (within 700) share
// a theme, and a climate family (T temperate, W warm, C cold, V volcanic, M mangrove), and which families clash.
// Run: bun scripts/probes/scatter.ts
import { claimableNear } from '../../src/world';
import { islandTheme } from '../../src/biome';
const FAM: Record<string, string> = { home: 'T', meadow: 'T', blossom: 'T', autumn: 'T', pine: 'T', birch: 'T', bog: 'T', chalk: 'T',
  dunes: 'W', mesa: 'W', bamboo: 'W', atoll: 'W', fjord: 'C', glacier: 'C', basalt: 'V', blacksand: 'V', fungal: 'V', mangrove: 'M' };
const isl = claimableNear(0, 0, 4500).map(c => ({ x: c.x, y: c.y, t: islandTheme(c.x, c.y) }));
let pairs = 0, same = 0, fam = 0; const far = new Map<string, number>();
for (let i = 0; i < isl.length; i++) for (let j = i + 1; j < isl.length; j++) {
  const a = isl[i], b = isl[j]; if (Math.hypot(a.x - b.x, a.y - b.y) > 700) continue;
  pairs++; if (a.t === b.t) same++; if (FAM[a.t] === FAM[b.t]) fam++; else { const k = [FAM[a.t], FAM[b.t]].sort().join(''); far.set(k, (far.get(k) ?? 0) + 1); }
}
const themes = new Map<string, number>(); for (const i of isl) themes.set(i.t, (themes.get(i.t) ?? 0) + 1);
console.log({ islands: isl.length, neighbourPairs: pairs, sameTheme: (same / pairs * 100).toFixed(0) + '%', sameFamily: (fam / pairs * 100).toFixed(0) + '%', clashes: Object.fromEntries(far), themes: Object.fromEntries(themes) });
