import { expect, test } from 'bun:test';
import { hotspotsNear, schoolsNear, tickHotspots } from '../src/world';
import { schoolLook } from '../src/species';

test('different schools in a newly surfaced hotspot have separate swimming space', () => {
  tickHotspots(120);
  let pairs = 0;
  for (const hotspot of hotspotsNear(1200, 1200, 2200)) {
    const schools = hotspot.schools.filter(s => s.stock > 0);
    for (let i = 0; i < schools.length; i++) for (let j = i + 1; j < schools.length; j++) {
      const a = schools[i], b = schools[j];
      pairs++;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(schoolLook(a.sp).radius + schoolLook(b.sp).radius + 16);
    }
  }
  expect(pairs).toBeGreaterThan(4);
});

test('a clock jump cannot replace a school while the player is looking at or fishing it', () => {
  tickHotspots(120);
  const school = schoolsNear(1800, 1200, 2000).find(s => s.id.startsWith('h:') && s.stock > 0 && !s.spooked);
  if (!school) throw new Error('No surfaced school');
  const before = { sp: school.sp, x: school.x, y: school.y, stock: school.stock };
  tickHotspots(3720, { x: school.x, y: school.y, r: 200, hooked: school });
  expect({ sp: school.sp, x: school.x, y: school.y, stock: school.stock }).toEqual(before);
  expect(school.spooked).toBeUndefined();
  tickHotspots(120);
});
