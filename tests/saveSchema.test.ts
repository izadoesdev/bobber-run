import { expect, test } from 'bun:test';
import { parseSave } from '../src/game/saveSchema';

// Saves load leniently: wrong types fall back, bad entries drop, good ones survive untouched.
const good = {
  savedAt: 1, world: 2, coins: 1234, earned: 5000, hp: 80, up: { rod: 2, hold: 1 }, bait: { shrimp: 3 }, baitSel: 'glow',
  hold: [{ sp: 3, kg: 1.2, value: 10, trophy: false, t: 5 }], log: { perch: { n: 4, best: 1.1, trophy: true, at: [[10, 20]] } },
  boatId: 'skiff', owned: ['row', 'skiff'], paint: 'seafoam', paints: ['classic', 'seafoam'], found: ['port:0,0'], salvaged: [], lastPort: 'port:0,0',
  x: 12, y: 34, a: 1, stats: { caught: 9 }, story: null, gifts: {}, pet: { name: 'Biscuit' }, projects: ['pier'], fleet: {}, dives: {}, goalsDone: [0, 2],
  maps: [{ id: 'm1', x: 1, y: 2, reward: 50 }], escaped: [{ school: 's1', x: 1, y: 2, sp: 4, kg: 3, day: 2, lost: 1 }], waypoint: { x: 5, y: 6 },
  gearOff: { net: true }, zones: { perch: true }, docks: { 'port:0,0': 3 }, streak: 2, musicOn: false, offers: {}, active: [], pity: 1, clock: 999,
};
test('a valid save comes through unchanged', () => {
  const s = parseSave(good);
  expect(s).toMatchObject({ ...good, stats: { caught: 9 } });
});
test('wrong types fall back to defaults instead of breaking the load', () => {
  const s = parseSave({ coins: 'lots', boatId: 'yacht', owned: [], waypoint: { x: 'a' }, streak: 99, musicOn: 'yes', a: Infinity });
  expect(s).toMatchObject({ coins: 0, boatId: 'row', owned: ['row'], waypoint: null, streak: 5, musicOn: true, a: 0 });
});
test('lists and maps keep the good entries and drop the rest', () => {
  const s = parseSave({ hold: [{ sp: 1, kg: 1, value: 2, trophy: false }, { sp: 'x' }, null, 7], escaped: [{ school: 's', x: 1, y: 1, sp: 1, kg: 1, day: 1, lost: 1 }, { school: 's' }],
    log: { perch: { n: 1, best: 1 }, cod: 'broken' }, owned: ['row', 'submarine'], projects: ['pier', 'moonbase'] });
  expect(s.hold).toHaveLength(1); expect(s.escaped).toHaveLength(1); expect(Object.keys(s.log)).toEqual(['perch']);
  expect(s.owned).toEqual(['row']); expect(s.projects).toEqual(['pier']);
});
test('something that is not a save at all loads as a fresh one', () => {
  for (const raw of [null, 42, 'text', []]) expect(parseSave(raw)).toMatchObject({ coins: 0, hold: [], boatId: 'row', paints: ['classic'] });
});
test('entries keep fields this schema does not list, so data added later is never lost on load', () => {
  const s = parseSave({ hold: [{ sp: 1, kg: 2, value: 3, trophy: true, variant: 'albino', future: 'kept' }], log: { perch: { n: 1, best: 1, vars: ['albino'], later: 7 } } });
  expect(s.hold[0]).toMatchObject({ variant: 'albino', future: 'kept' });
  expect(s.log.perch).toMatchObject({ vars: ['albino'], later: 7 });
});
