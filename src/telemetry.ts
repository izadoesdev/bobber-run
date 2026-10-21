// Watches game state and reports changes to analytics, so menus, story, settings and the network layer don't each
// need their own tracking calls: screens opened, quests finished, the ending, settings and zoom changes, online
// status, boat and the signed-in profile, plus a progress snapshot every ten minutes of play and when the tab is hidden.
import { G, dayNum, logged, hasSave } from './game';
import { homePort } from './world';
import { SET } from './prefs';
import { NET } from './net';
import { QUESTS } from './story';
import { track, bucket, setContext, identifyAccount, updateTraits, forgetAccount, flushAnalytics, type Screen } from './analytics';
import type { Mode } from './types';

const SCREENS: Partial<Record<Mode, Screen>> = {
  map: 'chart', log: 'logbook', journal: 'journal', ship: 'ship', settings: 'settings', controls: 'controls', account: 'online', pause: 'pause',
};
// settings worth segmenting by; volumes and key binds are left out
const WATCHED = ['pixel', 'quality', 'tilt', 'bloom', 'shake', 'ui', 'font', 'contrast', 'calm', 'captions', 'guide', 'strike', 'reelAssist', 'reelToggle'] as const;
const snapshot = () => Object.fromEntries(WATCHED.map(k => [k, String(SET[k])]));
const PROGRESS_EVERY = 600;                     // seconds of play between progress snapshots
// play time of this device's save, kept across reloads so progress.minutes is the save's total (a new voyage resets it)
const PLAYED_KEY = 'bobber-run-played';
const readPlayed = (): number => { try { return Number(localStorage.getItem(PLAYED_KEY)) || 0; } catch { return 0; } };
let sailing = false;                            // a voyage has started this page load (before that, playTime isn't the save's)
const keepPlayed = (): void => { if (sailing) try { localStorage.setItem(PLAYED_KEY, String(Math.round(playTime))); } catch { /* private mode */ } };

let mode: Mode | null = null, quest = -1, settingsSeen = snapshot(), zoomSeen = SET.zoom, zoomAt = 0;
let profileSeen = '', contextSeen = '', playTime = 0, nextProgress = PROGRESS_EVERY, acc = 0;

export function voyageStarted(kind: 'new' | 'continue'): void {
  track('voyage_started', { kind, day: dayNum() });
  quest = G.story?.i ?? -1; playTime = kind === 'new' ? 0 : readPlayed();
  nextProgress = (Math.floor(playTime / PROGRESS_EVERY) + 1) * PROGRESS_EVERY;
  sailing = true; keepPlayed();
}
/** Push the global properties again whenever one of them has changed. */
function syncContext(): void {
  const ctx = { online: NET.status === 'online', account: !NET.on ? 'offline' as const : NET.profile && !NET.profile.guest ? 'email' as const : 'guest' as const,
    pixel_style: SET.pixel, boat: G.boatId };
  const sig = JSON.stringify(ctx);
  if (sig !== contextSeen) { contextSeen = sig; setContext(ctx); }
}
function progress(reason: 'interval' | 'hidden'): void {
  if (G.mode === 'title') return;
  track('progress', { minutes: Math.round(playTime / 60), day: dayNum(), coins_bucket: bucket(G.coins), earned_bucket: bucket(G.earned), species_logged: logged(),
    quest: G.story?.i ?? 0, projects: G.projects.length, reason });
  updateTraits({ boat: G.boatId, day: dayNum(), species_logged: logged(), projects: G.projects.length });
}

// ---------- the first minutes of each page load: how long until the game shows, the first input, cast and catch ----------
// One first_minutes event per page load, sent at the first catch or when the player leaves, whichever comes first.
const secs = (ms: number | null): string => ms === null ? 'never' : ms < 2000 ? '<2' : ms < 5000 ? '2-5' : ms < 10_000 ? '5-10'
  : ms < 30_000 ? '10-30' : ms < 60_000 ? '30-60' : ms < 300_000 ? '1-5m' : '5m+';
const first = { shown: null as number | null, input: null as number | null, cast: null as number | null, caught: null as number | null, base: -1, returning: false, sent: false };
function sendFirst(ended: 'caught' | 'left'): void {
  if (first.sent || first.shown === null) return;
  first.sent = true;
  track('first_minutes', { shown_s: secs(first.shown), input_s: secs(first.input), cast_s: secs(first.cast), catch_s: secs(first.caught), returning: first.returning, ended });
}
/** Per frame: times are from the start of the page load (performance.now()). */
function watchFirst(): void {
  const now = performance.now();
  if (first.shown === null) { first.shown = now; first.returning = hasSave(); }
  if (G.mode === 'play' && first.base < 0) first.base = G.stats.caught;   // after a save loads, so its old catches don't count
  if (first.cast === null && G.fish) first.cast = now;
  if (first.caught === null && first.base >= 0 && G.stats.caught > first.base) { first.caught = now; sendFirst('caught'); }
}

// ---------- where players stall: two minutes of sailing with nothing caught, sold, funded or finished ----------
const STUCK_S = 120;
let stuck = { sig: '', since: 0, sent: false };
function watchStuck(): void {
  if (G.mode !== 'play') return;
  const quest = G.story?.i ?? 0, sig = `${G.stats.caught}|${G.stats.sold}|${quest}|${G.projects.length}`;
  if (sig !== stuck.sig) { stuck = { sig, since: playTime, sent: false }; return; }
  if (stuck.sent || playTime - stuck.since < STUCK_S) return;
  stuck.sent = true;                                      // once per stall; any progress starts a new one
  const b = G.boat, h = homePort();
  track('idle_stuck', { quest, step: QUESTS[quest]?.id ?? 'done', mode: G.fish ? 'fishing' : Math.hypot(b.vx, b.vy) > 2 ? 'sailing' : 'still',
    from_home: bucket(Math.hypot(b.x - h.x, b.y - h.y)), caught: G.stats.caught });
}

/** Called every frame from the main loop; the checks themselves run about once a second. */
export function watchGame(dt: number): void {
  if (!first.sent) watchFirst();
  if (G.mode !== 'title' && G.mode !== 'pause') playTime += dt;
  if (G.mode !== mode) {
    const screen = SCREENS[G.mode];
    if (screen && mode !== null) track('screen_opened', { screen });
    if (G.mode === 'finale') track('finale_reached', { day: dayNum() });
    mode = G.mode;
  }
  if ((acc += dt) < 1) return;
  acc = 0;
  watchStuck();
  // the story only moves forward, so a higher index means the previous quest was finished
  const i = G.story?.i ?? -1;
  if (quest >= 0 && i > quest) for (let q = quest; q < i; q++) if (QUESTS[q]) track('quest_completed', { quest: QUESTS[q].id, index: q });
  if (G.mode !== 'title') quest = i;

  const now = snapshot();
  for (const k of WATCHED) if (now[k] !== settingsSeen[k]) track('setting_changed', { setting: k, value: now[k] });
  settingsSeen = now;
  // zoom is reported once it settles, not for every wheel step
  if (SET.zoom !== zoomSeen) { zoomSeen = SET.zoom; zoomAt = performance.now(); }
  else if (zoomAt && performance.now() - zoomAt > 1500) { track('zoom_changed', { zoom: Math.round(SET.zoom * 100) / 100 }); zoomAt = 0; }

  syncContext();
  const who = NET.profile && !NET.profile.guest ? NET.profile.userId : '';
  if (who !== profileSeen) {
    if (who) identifyAccount(who, { boat: G.boatId, day: dayNum(), species_logged: logged() });
    else if (profileSeen) forgetAccount();
    profileSeen = who;
  }
  keepPlayed();
  if (playTime >= nextProgress) { nextProgress += PROGRESS_EVERY; progress('interval'); }
}

export function initTelemetry(): void {
  syncContext();
  document.addEventListener('fullscreenchange', () => track('fullscreen_toggled', { on: !!document.fullscreenElement }));
  // the tracker sends its own queue when the page goes away; flush so this last snapshot rides along. iOS and in-app
  // browsers often close without a visibilitychange, so pagehide sends it too (once per leave, whichever comes first)
  let leftAt = -1e9;
  const leave = (): void => {
    const now = performance.now();
    if (now - leftAt < 2000) return;
    leftAt = now; sendFirst('left'); progress('hidden'); flushAnalytics();
  };
  const firstInput = (): void => { first.input ??= performance.now(); };
  addEventListener('keydown', firstInput, { once: true, capture: true });
  addEventListener('pointerdown', firstInput, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  addEventListener('pagehide', leave);
}
