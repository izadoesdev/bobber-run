// Invalid fields fall back to defaults; collections retain valid entries.
import * as v from 'valibot';
import { BOATS, PROJECTS, SPECIES, UPGRADES } from '../econ';
import type { PackState } from '../content/types';
import type { GameState, BaitChoice, BoatId, Contract, Escapee, Fish, LogEntry, Pet, Stats, StoryState, TreasureMap, UpgradeKey } from '../types';

type Schema<T> = v.GenericSchema<unknown, T>;
const finite = v.pipe(v.number(), v.finite());
const nonnegative = v.pipe(finite, v.minValue(0));
const num = (fallback = 0) => v.fallback(finite, fallback);
const int = (fallback = 0) => v.fallback(v.pipe(finite, v.transform(Math.trunc)), fallback);
const str = (fallback = '') => v.fallback(v.string(), fallback);
const bool = (fallback = false) => v.fallback(v.boolean(), fallback);

const listOf = <T>(item: Schema<T>, fallback: T[] = []) => v.pipe(
  v.fallback(v.array(v.unknown()), fallback),
  v.transform((entries): T[] => {
    const valid = entries.flatMap(entry => {
      const result = v.safeParse(item, entry);
      return result.success ? [result.output] : [];
    });
    return valid.length ? valid : fallback;
  }),
);
const mapOf = <T>(item: Schema<T>) => v.pipe(
  v.fallback(v.record(v.string(), v.unknown()), {}),
  v.transform(entries => Object.fromEntries(Object.entries(entries).flatMap(([key, entry]) => {
    const result = v.safeParse(item, entry);
    return result.success ? [[key, result.output] as const] : [];
  }))),
);
const speciesIndex = v.pipe(finite, v.integer(), v.minValue(0), v.maxValue(SPECIES.length - 1));
const point = v.object({ x: finite, y: finite });
const upgradeLevels = v.pipe(mapOf(finite), v.transform(levels => Object.fromEntries(Object.entries(levels).flatMap(([key, level]) => {
  if (!Object.hasOwn(UPGRADES, key)) return [];
  const max = UPGRADES[key as UpgradeKey].costs.length;
  return [[key, Math.max(0, Math.min(max, Math.trunc(level)))]];
}))));

const fish: Schema<Fish> = v.looseObject({ sp: speciesIndex, kg: nonnegative, value: nonnegative, trophy: v.boolean(), t: v.optional(v.number()), gold: v.optional(v.boolean()), variant: v.optional(v.string()), stars: v.optional(v.picklist([1, 2, 3] as const)), perfect: v.optional(v.literal(true)) });
const logEntry: Schema<LogEntry> = v.looseObject({ n: v.number(), best: v.number(), trophy: v.optional(v.boolean()), at: v.optional(v.array(v.tuple([v.number(), v.number()]))), vars: v.optional(v.array(v.string())) });
const stats = v.object({ caught: int(), sold: int(), upgrades: int(), lights: int(), contracts: int(), wrecks: int(), trophies: int(), night: int(), frenzy: int(), treasures: int(), storm: int() }) satisfies Schema<Stats>;
const story: Schema<StoryState> = v.looseObject({ i: v.number(), base: stats, shown: v.boolean() });
const contract: Schema<Contract> = v.looseObject({ id: v.string(), from: v.string(), to: v.string(), toName: v.string(), sp: speciesIndex, n: v.pipe(nonnegative, v.integer()), reward: nonnegative, day: v.optional(v.number()), bulk: v.optional(v.boolean()) });
const treasure: Schema<TreasureMap> = v.looseObject({ id: v.string(), x: v.number(), y: v.number(), reward: v.number() });
const escapee: Schema<Escapee> = v.looseObject({ school: v.string(), x: finite, y: finite, sp: speciesIndex, kg: nonnegative, gold: v.optional(v.boolean()), day: v.number(), lost: v.number() });
const packState = v.object({ i: v.pipe(v.number(), v.integer(), v.minValue(0)), n: nonnegative, started: v.boolean(),
  status: v.optional(v.picklist(['active', 'paused'])) }) satisfies Schema<PackState>;
const fleetBoat: Schema<GameState['fleet'][string]> = v.looseObject({ port: v.string(), portName: v.string(), earned: v.number() });
const BOAT_IDS = BOATS.map(b => b.id), PROJECT_IDS = PROJECTS.map(p => p.id);
const boatIds = new Set<string>(BOAT_IDS);
const boatMapOf = <T>(item: Schema<T>) => v.pipe(mapOf(item), v.transform(entries =>
  Object.fromEntries(Object.entries(entries).filter(([id]) => boatIds.has(id))),
));

export const saveSchema = v.object({
  savedAt: num(), world: v.optional(v.number()),
  coins: int(), earned: int(), hp: v.optional(v.number()),
  up: upgradeLevels, bait: mapOf(nonnegative), baitSel: v.fallback(v.picklist(['none', 'shrimp', 'glow'] satisfies BaitChoice[]), 'shrimp'),
  hold: listOf(fish), log: mapOf(logEntry),
  boatId: v.fallback(v.picklist(BOAT_IDS), 'row'), owned: listOf<BoatId>(v.picklist(BOAT_IDS), ['row']),
  paint: str('classic'), paints: listOf(v.string(), ['classic']),
  found: listOf(v.string()), salvaged: listOf(v.string()), lastPort: v.fallback(v.nullable(v.string()), null),
  x: v.optional(v.number()), y: v.optional(v.number()), a: num(),
  stats: v.fallback(v.partial(stats), {}), story: v.fallback(v.nullable(story), null), gifts: mapOf(v.number()),
  pet: v.fallback(v.nullable(v.object({ name: v.string() }) satisfies Schema<Pet>), null), projects: listOf(v.picklist(PROJECT_IDS)),
  fleet: boatMapOf(fleetBoat), dives: mapOf(v.number()), visits: mapOf(v.pipe(nonnegative, v.integer())), goalsDone: listOf(v.number()), cheated: bool(),
  maps: listOf(treasure), escaped: listOf(escapee), packs: mapOf(packState), regionsSeen: listOf(v.string()),
  explored: v.fallback(v.pipe(v.string(), v.maxLength(120_000)), ''), unlocked: listOf(v.string()), waypoint: v.fallback(v.nullable(point), null),
  gearOff: mapOf(v.literal(true)), zones: mapOf(v.literal(true)), docks: mapOf(v.number()), streak: v.pipe(int(), v.transform(n => Math.min(5, Math.max(0, n)))),
  musicOn: bool(true), offers: mapOf(v.array(contract)), active: listOf(contract), pity: int(), clock: v.optional(v.number()),
  treasury: v.pipe(num(), v.transform(n => Math.max(0, n))), realmRate: v.pipe(num(), v.transform(n => Math.max(0, n))), hulls: boatMapOf(v.pipe(v.number(), v.minValue(0), v.maxValue(1))), boatUp: boatMapOf(upgradeLevels),
});
export type ParsedSave = v.InferOutput<typeof saveSchema>;
export const parseSave = (raw: unknown): ParsedSave => v.parse(saveSchema, raw && typeof raw === 'object' ? raw : {});
