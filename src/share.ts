// A shared catch link: /?catch=<speciesId>&v=<variant>&kg=<kg>&at=<x>,<y>&by=<name>. It's read once on load and then
// taken out of the address bar, so a reload or a bookmark doesn't replay it. Everything in it came from a stranger's
// URL, so only a known species, finite numbers and a name that passes the captain-name filter get through.
import { SPECIES, fmtKg } from './species';
import { cleanName } from '../convex/names';
import { G, toast, hasSave } from './game';
import { setWaypoint } from './waypoint';
import { nearestWater } from './world';
import { track } from './analytics';
import { NET } from './net';
import { ONLINE } from './online';
import { followByName } from './ui/sailorcard';

const SHARE_KEYS = new Set(['catch', 'v', 'kg', 'at', 'by', 'sail']);
export interface SharedCatch { species: number; name: string; variant: string; kg: number; at: { x: number; y: number }; by: string | null }

/** A visit link, /?sail=<captain name>: sail to that sailor (it's read and tidied away with the share keys). */
const visitName = (): string | null => { if (typeof location === 'undefined') return null; const n = cleanName(new URLSearchParams(location.search).get('sail') ?? ''); return n.ok ? n.name : null; };
export const VISIT: string | null = visitName();
function read(): SharedCatch | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search), id = q.get('catch');
  if (!id) { if (VISIT) tidy(); return null; }
  const [x, y] = (q.get('at') ?? '').split(',').map(Number), kg = Number(q.get('kg')), variant = (q.get('v') ?? '').slice(0, 24), by = cleanName(q.get('by') ?? '');
  tidy();
  const species = SPECIES.findIndex(s => s.id === id);
  if (species < 0 || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  // real shares carry the bobber's spot; a hand-edited one may point at land, so it moves out to the nearest open water
  return { species, name: SPECIES[species].name, variant, kg: Number.isFinite(kg) && kg > 0 ? kg : 0, at: nearestWater(x, y), by: by.ok ? by.name : null };
}
/** Take the share and visit keys out of the address bar, keeping the rest as typed. */
function tidy(): void {
  const kept = location.search.slice(1).split('&').filter(p => p && !SHARE_KEYS.has(decodeURIComponent(p.split('=')[0])));
  history.replaceState(null, '', location.pathname + (kept.length ? `?${kept.join('&')}` : '') + location.hash);
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

// ---------- visit links: find the named sailor once online, point the way while they're far, follow once in sight ----------
const VISIT_WAIT_MS = 30_000, WAYPOINT_MOVE = 120;
const visit = { since: 0, checked: 0, told: false, done: !VISIT };
export function tickVisit(): void {
  if (visit.done || G.mode !== 'play' || !NET.authed) return;
  const now = performance.now();
  if (now - visit.checked < 1000) return;
  visit.checked = now; visit.since ||= now;
  const name = VISIT!;
  if (followByName(name)) { visit.done = true; toast(`Following ${name}`, 'good'); track('visit_link', { found: 'near' }); return; }
  const far = ONLINE.far.find(f => f.name === name);
  if (far) {
    if (visit.told && !G.waypoint) { visit.done = true; return; }          // the player cleared the waypoint: they've chosen otherwise
    if (!G.waypoint || Math.hypot(G.waypoint.x - far.x, G.waypoint.y - far.y) > WAYPOINT_MOVE) setWaypoint(far.x, far.y);
    if (!visit.told) { visit.told = true; toast(`${name} is out at sea. Your waypoint shows where`, 'good'); track('visit_link', { found: 'far' }); }
    return;
  }
  if (!visit.told && now - visit.since > VISIT_WAIT_MS) { visit.done = true; toast(`${name} isn't sailing right now`); track('visit_link', { found: 'offline' }); }
}
