// Online state shared with the renderer and the game, with no Convex imports (net.ts fills it in).
/** Another player's boat, interpolated for drawing. */
export interface Sailor {
  uid: string; id: string; name: string; paint: string;
  x: number; y: number; a: number; vx: number; vy: number;
  online: true; emote: number | null; emoteAt: number;
}
/** A chat line as everyone sees it (already filtered by the relay). `id` is the sailor's uid, or 'me'. */
export interface ChatLine { id: string; name: string; text: string; at: number; admin?: boolean }
/** Everyone else in the world for the map, about once a second from the relay. */
export interface FarSailor { uid: string; name: string; x: number; y: number }
export const ONLINE: { sailors: Sailor[]; chat: Map<string, { text: string; at: number }>; log: ChatLine[]; note: string | null; roster: string[]; total: number; far: FarSailor[] } = {
  sailors: [], chat: new Map(), log: [], note: null, roster: [], total: 0, far: [],
};

// sailors muted on this device, by captain name (names are unique enough here, and survive reconnects)
const MUTE_KEY = 'bobber-run-muted';
const muted = new Set<string>((() => { try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '[]') as string[]; } catch { return []; } })());
export const isMuted = (name: string): boolean => muted.has(name);
export function toggleMute(name: string): boolean {
  if (muted.has(name)) muted.delete(name); else muted.add(name);
  try { localStorage.setItem(MUTE_KEY, JSON.stringify([...muted])); } catch { /* private mode */ }
  if (muted.has(name)) ONLINE.log = ONLINE.log.filter(l => l.name !== name);
  return muted.has(name);
}
/** A filtered line arrived: keep it in the log and as that sailor's speech bubble. Game lines (id 'sys') have no bubble. */
export function heard(line: ChatLine): void {
  if (line.id !== 'me' && line.id !== 'sys' && isMuted(line.name)) return;
  ONLINE.log = [...ONLINE.log.slice(-49), line];
  if (line.id === 'sys') return;
  const now = Date.now();
  for (const [id, c] of ONLINE.chat) if (now - c.at > 60_000) ONLINE.chat.delete(id);   // relay ids change on every reconnect
  ONLINE.chat.set(line.id, { text: line.text, at: now });
}

/** Fishing alongside other sailors pays: +5% per sailor within CREW_RANGE, up to +15%. */
export const CREW_RANGE = 140;
export function crewBonus(x: number, y: number): number {
  let n = 0;
  for (const s of ONLINE.sailors) if (Math.hypot(s.x - x, s.y - y) < CREW_RANGE) n++;
  return Math.min(0.15, n * 0.05);
}
