// A shared catch link: /?catch=<speciesId>&v=<variant>&kg=<kg>&at=<x>,<y>&by=<name>. It's read once on load and then
// taken out of the address bar, so a reload or a bookmark doesn't replay it. Everything in it came from a stranger's
// URL, so only a known species, finite numbers and a name that passes the captain-name filter get through.
import { SPECIES, fmtKg } from './species';
import { cleanName } from '../convex/names';
import { G, toast, hasSave } from './game';
import { setWaypoint } from './waypoint';
import { nearestWater } from './world';
import { track } from './analytics';

const SHARE_KEYS = new Set(['catch', 'v', 'kg', 'at', 'by']);
export interface SharedCatch { species: number; name: string; variant: string; kg: number; at: { x: number; y: number }; by: string | null }

function read(): SharedCatch | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search), id = q.get('catch');
  if (!id) return null;
  const [x, y] = (q.get('at') ?? '').split(',').map(Number), kg = Number(q.get('kg')), variant = (q.get('v') ?? '').slice(0, 24), by = cleanName(q.get('by') ?? '');
  const kept = location.search.slice(1).split('&').filter(p => p && !SHARE_KEYS.has(decodeURIComponent(p.split('=')[0])));   // the rest, as typed
  history.replaceState(null, '', location.pathname + (kept.length ? `?${kept.join('&')}` : '') + location.hash);
  const species = SPECIES.findIndex(s => s.id === id);
  if (species < 0 || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  // real shares carry the bobber's spot; a hand-edited one may point at land, so it moves out to the nearest open water
  return { species, name: SPECIES[species].name, variant, kg: Number.isFinite(kg) && kg > 0 ? kg : 0, at: nearestWater(x, y), by: by.ok ? by.name : null };
}
/** The catch this visit was shared from, if the page opened on a share link. */
export const SHARED: SharedCatch | null = read();

let applied = false;
/**
 * Once the voyage is under way: point a waypoint at the shared spot and say whose catch it was. (A first-time visitor
 * already starts near it; see main.ts.) Called every frame until it has run.
 */
export function applySharedCatch(): void {
  if (applied || !SHARED || G.mode !== 'play') return;
  applied = true;
  const s = SHARED, b = G.boat, near = Math.hypot(s.at.x - b.x, s.at.y - b.y) < 150;
  if (!near) setWaypoint(s.at.x, s.at.y);
  toast(`${s.by ?? 'A sailor'} landed a ${s.name}${s.kg ? ` of ${fmtKg(s.kg)}` : ''} ${near ? 'right here' : 'out there. Your waypoint marks the spot'}`, 'good');
  track('share_visit', { species: SPECIES[s.species].id, returning: hasSave(), named: !!s.by });
}
