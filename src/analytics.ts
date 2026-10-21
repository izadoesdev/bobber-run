// Databuddy analytics. The tracker records page views, sessions, web vitals, JavaScript errors, interactions and
// outgoing links by itself; the typed events below describe play. Event and property names are snake_case with
// small, fixed value sets, and nothing personal is sent (no emails, captain names or free text).
// Development builds send nothing unless VITE_DATABUDDY_DEV=1.
import { createScript, isScriptInjected, track as dbTrack, trackError as dbTrackError, setGlobalProperties, identify, setTraits, clearProfile, flush } from '@databuddy/sdk';

const CLIENT_ID = import.meta.env.VITE_DATABUDDY_CLIENT_ID || '633246a8-d110-49eb-8b26-83214f977222';
const ON = !import.meta.env.DEV || import.meta.env.VITE_DATABUDDY_DEV === '1';
declare const __BUILD__: string;

type Method = 'rod' | 'net' | 'deckhand' | 'pots';
export type Screen = 'chart' | 'logbook' | 'journal' | 'ship' | 'settings' | 'controls' | 'online' | 'pause';
/** Every custom event and its properties. */
type Events = {
  voyage_started: { kind: 'new' | 'continue'; day: number };
  fish_caught: { species: string; method: Method; kg_bucket: string; trophy: boolean; golden: boolean; legend: boolean; first: boolean; perfect: boolean; rod: number; towed: boolean; got_back: boolean; variant: string; stars: number };
  fish_lost: { species: string; reason: 'snapped' | 'threw_hook' | 'missed_strike' | 'shook_off'; towed?: boolean; remembered?: boolean; again?: boolean };
  species_logged: { species: string; logged: number };
  catch_sold: { fish: number; value_bucket: string; port: string; sold_kept: boolean };
  hull_repaired: { cost_bucket: string; full: boolean };
  upgrade_bought: { upgrade: string; level: number; cost: number };
  supply_bought: { supply: string; cost: number };
  paint_bought: { paint: string; cost: number };
  boat_bought: { boat: string; cost: number };
  boat_switched: { boat: string };
  contract_taken: { species: string; fish: number; reward_bucket: string; same_port: boolean };
  contract_completed: { species: string; fish: number; reward_bucket: string };
  contract_abandoned: { species: string; fish: number; had: number };
  ferry_used: { cost_bucket: string };
  fleet_changed: { boat: string; action: 'sent' | 'recalled'; earned_bucket: string };
  project_funded: { project: string; done: number };
  port_docked: { port: string; home: boolean };
  boat_sunk: { boat: string; tow_cost_bucket: string; storm: boolean };
  quest_completed: { quest: string; index: number };
  finale_reached: { day: number };
  screen_opened: { screen: Screen };
  setting_changed: { setting: string; value: string };
  fullscreen_toggled: { on: boolean };
  zoom_changed: { zoom: number };
  account_signed_up: { kept_save: boolean };
  account_signed_in: { loaded_cloud_save: boolean };
  sign_in_failed: { flow: 'signUp' | 'signIn'; reason: 'rate_limited' | 'no_account' | 'wrong_password' | 'exists' | 'weak_password' | 'network' | 'timeout' };
  signed_out: Record<string, never>;
  account_deleted: Record<string, never>;
  fund_given: { amount_bucket: string };
  greeting_sent: { greeting: number };
  chat_sent: { length_bucket: 'short' | 'medium' | 'long' };
  sailor_card_opened: Record<string, never>;
  sailor_followed: Record<string, never>;
  island_opened: { owned: boolean; mine: boolean };
  island_checkout_started: { price_bucket: string };
  island_checkout_returned: { paid: boolean };
  sign_in_opened: { from: 'title' | 'play' };
  fish_released: { count_bucket: '1-2' | '3-7' | '8+'; how: 'one' | 'small' };
  helper_toggled: { helper: 'deckhand' | 'net' | 'pots'; on: boolean };
  contract_offers_refreshed: { port: string };
  fleet_collected: { earned_bucket: string };
  /** what the fleet earned while the player was away, credited on load */
  fleet_away: { earned_bucket: string };
  fish_chart_bought: { species: string; price_bucket: string; logged: boolean };
  fish_chart_opened: { species: string; how: 'logbook' | 'chart' };
  dock_grade_up: { grade: number };
  share_clicked: { species: string; how: 'native' | 'copy'; stars?: number; variant?: string; why: 'record' | 'first' | 'legend' | 'stars' | 'variant' | 'trophy' };
  /** someone opened the game from a shared catch link */
  share_visit: { species: string; returning: boolean; named: boolean };
  hint_shown: { hint: string; quest: number };
  /** two minutes of sailing with no catch, sale or quest step: where players stall */
  idle_stuck: { quest: number; step: string; mode: string; from_home: string; caught: number };
  first_minutes: { shown_s: string; input_s: string; cast_s: string; catch_s: string; returning: boolean; ended: 'caught' | 'left' };
  progress: { minutes: number; day: number; coins_bucket: string; earned_bucket?: string; species_logged: number; quest: number; projects: number; reason: 'interval' | 'hidden' };
};

/** Rough bands keep money and weight useful to group by without thousands of distinct values. */
export const bucket = (n: number): string =>
  n <= 0 ? '0' : n < 10 ? '1-9' : n < 100 ? '10-99' : n < 1000 ? '100-999' : n < 10_000 ? '1k-9k' : n < 100_000 ? '10k-99k' : '100k+';

let started = false, profiled = false;
export function initAnalytics(): void {
  if (!ON || started || typeof document === 'undefined' || isScriptInjected()) return;
  started = true;
  document.head.appendChild(createScript({
    clientId: CLIENT_ID,
    trackWebVitals: true, trackErrors: true, trackInteractions: true, trackOutgoingLinks: true, trackAttributes: true, trackHashChanges: true,
    enableBatching: true, enableRetries: true, samplingRate: 1,
  }));
  setGlobalProperties({ build: __BUILD__ });
}

export function track<K extends keyof Events>(name: K, props: Events[K]): void {
  if (ON) dbTrack(name, props);
}
/** A game failure worth seeing in Databuddy's error view; `kind` is a fixed label, never a raw message with user data. */
export function trackFailure(kind: string, props: Record<string, string | number | boolean> = {}): void {
  if (ON) dbTrackError(kind, props);
}
/** Properties every later event carries (merged into what is already set). */
export function setContext(ctx: { online: boolean; account: 'guest' | 'email' | 'offline'; pixel_style: string; boat: string }): void {
  if (ON) setGlobalProperties(ctx);
}
/** Signed-up accounts get a profile keyed by their opaque account id, so their sessions join up across devices. */
export function identifyAccount(userId: string, traits: { boat: string; day: number; species_logged: number }): void {
  if (!ON) return;
  identify(userId, { account: 'email', ...traits }); profiled = true;
}
export function updateTraits(traits: { boat: string; day: number; species_logged: number; projects: number }): void {
  if (ON && profiled) setTraits(traits);
}
export function forgetAccount(): void {
  if (ON && profiled) clearProfile();
  profiled = false;
}
/** Send anything queued now (before the page goes away). */
export function flushAnalytics(): void {
  if (ON) void flush();
}
