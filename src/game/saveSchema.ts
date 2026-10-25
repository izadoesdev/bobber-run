// What a stored save may contain, checked when it loads (valibot). Saves come from every older version, from other
// devices through the cloud, and can be edited by hand, so loading is lenient: a field of the wrong type falls back to
// its default, and a list or map keeps the entries that make sense and drops the rest. Entries are loose objects:
// fields this file knows are checked and the rest are kept, so a field added to a type later is never lost on load;
// each entry schema is also checked against the game's own type, so a new required field stops compiling here.
import * as v from 'valibot';
import type { GameState, BaitChoice, BoatId, Contract, Escapee, Fish, LogEntry, Pet, ProjectId, Stats, StoryState, TreasureMap } from '../types';

type Schema<T> = v.GenericSchema<unknown, T>;
const num = (d = 0) => v.fallback(v.pipe(v.number(), v.finite()), d);
const int = (d = 0) => v.fallback(v.pipe(v.number(), v.finite(), v.transform(n => Math.trunc(n))), d);
const str = (d = '') => v.fallback(v.string(), d);
const bool = (d = false) => v.fallback(v.boolean(), d);
/**
 * A list keeping only the entries that match `item`; `orElse` stands in when nothing is left (or the key is missing:
 * valibot then uses the fallback directly, without the transform).
 */
const listOf = <T>(item: Schema<T>, orElse: T[] = []) => v.pipe(v.fallback(v.array(v.unknown()), orElse),
  v.transform((xs): T[] => { const ok = xs.flatMap(x => { const r = v.safeParse(item, x); return r.success ? [r.output] : []; }); return ok.length ? ok : orElse; }));
/** A string-keyed map keeping only the values that match `item`. */
const mapOf = <T>(item: Schema<T>) => v.pipe(v.fallback(v.record(v.string(), v.unknown()), {}),
  v.transform(o => Object.fromEntries(Object.entries(o).flatMap(([k, x]) => { const r = v.safeParse(item, x); return r.success ? [[k, r.output] as const] : []; }))));
const point = v.object({ x: v.pipe(v.number(), v.finite()), y: v.pipe(v.number(), v.finite()) });

const fish: Schema<Fish> = v.looseObject({ sp: v.number(), kg: v.number(), value: v.number(), trophy: v.boolean(), t: v.optional(v.number()), gold: v.optional(v.boolean()), variant: v.optional(v.string()), stars: v.optional(v.picklist([1, 2, 3] as const)), perfect: v.optional(v.literal(true)) });
const logEntry: Schema<LogEntry> = v.looseObject({ n: v.number(), best: v.number(), trophy: v.optional(v.boolean()), at: v.optional(v.array(v.tuple([v.number(), v.number()]))), vars: v.optional(v.array(v.string())) });
const stats = v.object({ caught: int(), sold: int(), upgrades: int(), lights: int(), contracts: int(), wrecks: int(), trophies: int(), night: int(), frenzy: int(), treasures: int(), storm: int() }) satisfies Schema<Stats>;
const story: Schema<StoryState> = v.looseObject({ i: v.number(), base: stats, shown: v.boolean() });
const contract: Schema<Contract> = v.looseObject({ id: v.string(), from: v.string(), to: v.string(), toName: v.string(), sp: v.number(), n: v.number(), reward: v.number(), day: v.optional(v.number()), bulk: v.optional(v.boolean()) });
const treasure: Schema<TreasureMap> = v.looseObject({ id: v.string(), x: v.number(), y: v.number(), reward: v.number() });
const escapee: Schema<Escapee> = v.looseObject({ school: v.string(), x: v.number(), y: v.number(), sp: v.number(), kg: v.number(), gold: v.optional(v.boolean()), day: v.number(), lost: v.number() });
const packState = v.object({ i: v.pipe(v.number(), v.integer(), v.minValue(0)), n: v.pipe(v.number(), v.finite()), started: v.boolean() });
const fleetBoat: Schema<GameState['fleet'][string]> = v.looseObject({ port: v.string(), portName: v.string(), earned: v.number() });
const BOATS: BoatId[] = ['row', 'canoe', 'skiff', 'jetski', 'launch', 'trawler', 'speedboat', 'catamaran', 'schooner', 'cruiser', 'drifter', 'research', 'flagship', 'icebreaker', 'yacht', 'motoryacht', 'superyacht'];
const PROJECTS: ProjectId[] = ['pier', 'market', 'drydock', 'lights', 'grand'];

/** A loaded save with every field present and the right type (numbers finite, lists and maps holding valid entries). */
export const saveSchema = v.object({
  savedAt: num(), world: v.optional(v.number()),
  coins: int(), earned: int(), hp: v.optional(v.number()),
  up: mapOf(v.number()), bait: mapOf(v.number()), baitSel: v.fallback(v.picklist(['none', 'shrimp', 'glow'] satisfies BaitChoice[]), 'shrimp'),
  hold: listOf(fish), log: mapOf(logEntry),
  boatId: v.fallback(v.picklist(BOATS), 'row'), owned: listOf<BoatId>(v.picklist(BOATS), ['row']),
  paint: str('classic'), paints: listOf(v.string(), ['classic']),
  found: listOf(v.string()), salvaged: listOf(v.string()), lastPort: v.fallback(v.nullable(v.string()), null),
  x: v.optional(v.number()), y: v.optional(v.number()), a: num(),
  stats: v.fallback(v.partial(stats), {}), story: v.fallback(v.nullable(story), null), gifts: mapOf(v.number()),
  pet: v.fallback(v.nullable(v.object({ name: v.string() }) satisfies Schema<Pet>), null), projects: listOf(v.picklist(PROJECTS)),
  fleet: mapOf(fleetBoat), dives: mapOf(v.number()), goalsDone: listOf(v.number()), cheated: bool(),
  maps: listOf(treasure), escaped: listOf(escapee), packs: mapOf(packState), regionsSeen: listOf(v.string()),
  explored: v.fallback(v.pipe(v.string(), v.maxLength(120_000)), ''), unlocked: listOf(v.string()), waypoint: v.fallback(v.nullable(point), null),
  gearOff: mapOf(v.literal(true)), zones: mapOf(v.literal(true)), docks: mapOf(v.number()), streak: v.pipe(int(), v.transform(n => Math.min(5, Math.max(0, n)))),
  musicOn: bool(true), offers: mapOf(v.array(contract)), active: listOf(contract), pity: int(), clock: v.optional(v.number()),
  treasury: num(), realmRate: num(), hulls: mapOf(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
});
export type ParsedSave = v.InferOutput<typeof saveSchema>;
/** Check a stored save; anything that isn't an object at all loads as an empty one (every field at its default). */
export const parseSave = (raw: unknown): ParsedSave => v.parse(saveSchema, raw && typeof raw === 'object' ? raw : {});
