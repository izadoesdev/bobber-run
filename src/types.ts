// Core domain types shared across the game: the state object `G`, its parts, and the static game data.
// Type-only module: importing it never pulls in runtime code.

// ---------- small shared shapes ----------
export interface Point { x: number; y: number }
export type ToastKind = 'info' | 'good' | 'bad';

/** Every screen the game can be on. `G.mode` drives input routing and which UI is drawn. */
export type Mode =
  | 'title' | 'play' | 'port' | 'map' | 'log' | 'ship' | 'pause' | 'settings' | 'controls'
  | 'sunk' | 'finale' | 'cheat' | 'talk' | 'journal' | 'account' | 'emote' | 'leaders' | 'island';

export type WeatherState = 'clear' | 'cloudy' | 'rain' | 'storm';
/** Conditions a species checks before it bites (see `activeAt` in econ). */
export interface Env { night: boolean; twilight: boolean; weather: WeatherState }

// ---------- static data (econ.ts, species.ts, fishart.ts) ----------
export type Region = 'any' | 'temperate' | 'cold' | 'warm';
export type TimeOfDay = 'any' | 'day' | 'night' | 'twilight';
/** 'rain' means rain or storm. */
export type WeatherNeed = 'any' | 'rain' | 'storm';
/** Landmark-bound species only spawn at wrecks or lighthouses. */
export type Landmark = 'wreck' | 'light';
export type FightStyle = 'steady' | 'darter' | 'generic' | 'jumper' | 'erratic' | 'boss';
export type FishShape =
  | 'slim' | 'perch' | 'long' | 'flat' | 'tuna' | 'bill' | 'round' | 'squid'
  | 'glow' | 'levi' | 'crab' | 'eel' | 'puffer' | 'angel' | 'carp';

export interface Species {
  id: string;
  name: string;
  /** base sale value in coins */
  base: number;
  /** [min, max] weight */
  kg: [number, number];
  /** rod upgrade level needed (0 = starting rod) */
  rod: number;
  /** deck size needed to land it (0 = any boat; see BoatDef.deck) */
  deck: number;
  /** spawn weight */
  w: number;
  time: TimeOfDay;
  shape: FishShape;
  /** palette: top, mid, belly, fin */
  c: [string, string, string, string];
  fight: FightStyle;
  /** where to find it, as shown in the logbook */
  where: string;
  /** whether a school of it can spawn at height h, distance d from home */
  zone: (h: number, d: number) => boolean;
  region: Region;
  weather: WeatherNeed;
  special: Landmark | null;
  legend?: boolean;
  /** fight difficulty 0..0.95, derived from rod level and value */
  diff: number;
}

/** Gear that catches on its own, and can be switched off. */
export type Helper = 'deckhand' | 'net' | 'pots';
export type BoatId = 'row' | 'skiff' | 'launch' | 'trawler' | 'schooner' | 'drifter' | 'flagship';
type Propulsion = 'OARS' | 'SAIL' | 'ENGINE';
export interface BoatDef {
  id: BoatId;
  name: string;
  cost: number;
  speed: number;
  accel: number;
  turn: number;
  /** fish slots */
  hold: number;
  hp: number;
  /** hull half-length and half-beam in world units */
  L: number;
  B: number;
  prop: Propulsion;
  /** built-in gear levels, counted like the matching upgrade */
  sonar: number;
  net: number;
  crew?: number;
  keel?: number;
  harpoon?: number;
  /** deck size: 1 lands the sea giants (Trawler and up), 2 the very largest (Flagship) */
  deck?: number;
  what: string;
  /** project that unlocks it at the shipyard */
  req?: ProjectId;
}

export type ProjectId = 'pier' | 'market' | 'drydock' | 'lights' | 'grand';
/** What a project wants donated: fish of any kind, distinct species, trophies, or a particular species. */
export type ProjectNeed = { any: number } | { kinds: number } | { trophy: number } | { sp: string; n: number };
export interface Project { id: ProjectId; name: string; cost: number; need: ProjectNeed; gives: string; what: string }

export type UpgradeKey =
  | 'prop' | 'hull' | 'hold' | 'bilge' | 'anchor' | 'net' | 'rod' | 'reel' | 'line' | 'tackle' | 'ice'
  | 'sonar' | 'lantern' | 'spyglass' | 'sextant' | 'radio' | 'deckhand' | 'cook' | 'quarter'
  | 'pots' | 'keel' | 'harpoon' | 'bell';
export type UpgradeCategory = 'VESSEL' | 'TACKLE' | 'NAVIGATION' | 'CREW';
export interface Upgrade {
  /** display name; the propulsion upgrade is named after the current boat's drive */
  name: (b: BoatDef) => string;
  cat: UpgradeCategory;
  costs: number[];
  /** what each level does, one entry per cost */
  lv: string[];
  req?: ProjectId;
}

export type BaitKind = 'shrimp' | 'glow' | 'chum';
/** Chum is thrown, not fished with, so it can't be the selected bait. */
export type BaitChoice = 'none' | Exclude<BaitKind, 'chum'>;
export interface Supply { name: string; n: number; cost: number; what: string }
export interface Paint { id: string; name: string; cost: number; ramp?: [string, string, string]; /** paints that are earned, never sold: how (game/mastery.ts grants them) */ earn?: string }

// ---------- world (world.ts) ----------
interface SegmentSolid { kind: 'seg'; ax: number; ay: number; bx: number; by: number; r: number }
interface CircleSolid { kind: 'circ'; x: number; y: number; r: number }
export type Solid = SegmentSolid | CircleSolid;

/** Anything a catch is drawn from: a school, or the stand-in stock used by nets, pots and the deckhand. */
export interface FishStock { stock: number; max: number; respawn?: number; boss?: boolean }
export interface School extends FishStock {
  id: string;
  x: number;
  y: number;
  /** species index into SPECIES */
  sp: number;
  respawn: number;
  ph: number;
  /** game time until which the school won't bite */
  spooked?: number;
}

interface PoiBase { id: string; name: string; x: number; y: number; school?: School }
export interface Port extends PoiBase {
  type: 'port';
  dir: number;
  ang: number;
  /** pier tip, and where a docked boat floats */
  end: Point;
  dock: Point;
  /** price multiplier by species index */
  mult: Record<number, number>;
  shipyard: boolean;
  solid: SegmentSolid;
}
export interface Lighthouse extends PoiBase { type: 'light'; beam: number; solid?: undefined }
export interface Wreck extends PoiBase { type: 'wreck'; dir: number; loot: number; solid: CircleSolid }
export type Poi = Port | Lighthouse | Wreck;

export interface Crate { id: string; x: number; y: number; value: number; taken: boolean; respawn: number; ph: number }

// ---------- state pieces ----------
export interface Boat {
  x: number; y: number;
  /** heading (radians, 0 = +x) and angular velocity */
  a: number; w: number;
  vx: number; vy: number;
  /** previous physics step's pose, for render interpolation */
  px: number; py: number; pa: number;
  /** oar stroke phases (rowboat only) */
  phaseL: number; phaseR: number;
  hp: number;
  /** the helm (-1 hard left .. 1 hard right) and throttle (-1 astern .. 1 ahead), easing towards the controls */
  helm: number; thr: number;
  /** how far the hull heels (roll) and trims (pitch, bow up), swinging on springs */
  heel: Sway; trim: Sway;
}
/** An angle that swings towards a target and overshoots a little, like a hull settling in the water. */
export interface Sway { x: number; v: number }

/** A caught fish in the hold. */
export interface Fish {
  sp: number;
  kg: number;
  value: number;
  trophy: boolean;
  /** game clock when it was caught */
  t?: number;
  /** the golden fish of its school */
  gold?: boolean;
  /** a variant of its species (a VariantId from species.ts) */
  variant?: string;
  /** rod catches: its quality, and whether it was struck perfectly */
  stars?: 1 | 2 | 3;
  perfect?: true;
}

type LineStage = 'cast' | 'wait' | 'bite' | 'reel';
/** The line while fishing (`G.fish`). Optional fields appear once the fight starts. */
export interface FishLine {
  st: LineStage;
  s: School;
  /** time in the current stage */
  t: number;
  /** bobber position */
  tx: number; ty: number;
  tension: number;
  prog: number;
  /** fight-pattern phase */
  ph: number;
  /** time until a bite */
  wait: number;
  reelT: number;
  bait: BaitChoice | null;
  frenzy: boolean;
  perfect: boolean;
  reeling?: boolean;
  reelOn?: boolean;
  /** boss fights go three rounds */
  stage?: number;
  /** nibbles still to come before the bite, as seconds before it; and the game time of the last one */
  teases?: number[];
  teaseT?: number;
  /** a short note shown while waiting: bait preference or the conditions this fish needs */
  hint?: string | null;
  /** strike windows for this bite, in seconds: perfect, then any strike */
  win?: [number, number];
  /** generic fish and the boss run with the bait: the bobber slides along this heading */
  run?: number;
  /** the golden fish of its school took the bait */
  gold?: boolean;
  /** the hooked fish's position, pulled closer as you reel and thrown out by its surges */
  fx?: number;
  fy?: number;
  surge?: number;
  warn?: boolean;
  jumpT?: number;
  jump?: { t: number; dir: -1 | 1 } | null;
  jumpWarn?: boolean;
  /** a sea giant or legend tows the boat: how much line is out, and the heading it runs on */
  tow?: { len: number; h: number; turnT: number };
  /** the remembered fish that once broke your line took the bait */
  back?: Escapee;
  /** quality, rolled at the hook and shown while reeling */
  stars?: 1 | 2 | 3;
  /** a variant of its species (a VariantId from species.ts), rolled at the hook */
  variant?: string;
  /** seconds left in the telegraph before the next surge; 0 or undefined when none is coming */
  cue?: number;
  /** the line went into the red this fight (the catch loses a star) */
  strained?: boolean;
  /** the next surge has been announced and hasn't passed yet */
  cued?: boolean;
  /** the fish, rolled at the hook: its size (0..1 across the species' range), weight, and whether it's a trophy */
  size?: number; kg?: number; trophy?: boolean;
  /** seconds of steady reeling the fight takes, from the fish's weight and how far the rod outclasses it */
  len?: number;
  /** seconds left of the grace after the hook (no surge, tension held under the amber line), and where the red zone
   *  starts as a share of the line's strength (later for new captains) */
  grace?: number; redAt?: number;
  /** the fish is taking line back (surging against a slack reel): the catch slips, and at nothing it shakes the hook */
  taking?: boolean;
  /** which of the nibbles still to come is a fake-out (a big dip that isn't the take), and when the last one was */
  fake?: number; fakeT?: number;
}
/** A fish that broke your line after a real fight: it stays with its school, wearing your hook, until you land it. */
export interface Escapee {
  /** the school it lives with, and where that school is (for the chart) */
  school: string; x: number; y: number;
  sp: number; kg: number; gold?: boolean;
  /** the game day it first got away, and how many times it has */
  day: number; lost: number;
}

export type ParticleKind = 'ring' | 'dot' | 'spark' | 'debris' | 'spout' | 'glow' | 'smoke';
interface Particle {
  kind: ParticleKind;
  x: number; y: number;
  /** remaining and starting lifetime */
  life: number; max: number;
  vx?: number; vy?: number;
  z?: number; vz?: number;
  /** rings: starting radius and growth over the lifetime */
  r0?: number; grow?: number;
  /** dots: draw as a bigger foam blob */
  foam?: boolean;
  size?: number;
  /** smoke: 0 white .. 1 black */
  dark?: number;
}
/** What callers pass to `spawn`; `max` is filled in from `life`. */
export type ParticleSpec = Omit<Particle, 'max'>;

export interface Toast { s: string; kind: ToastKind; t: number }
interface Caption { s: string; t: number }
interface Floater { s: string; t: number; kind: 'good' | 'bad' }

export interface Contract {
  id: string; from: string; to: string; toName: string; sp: number; n: number; reward: number;
  /** the game day it was offered; unclaimed offers are replaced each new day */
  day?: number;
  /** a big order: many of a common fish, for a big hold (from a Grade IV dock hand) */
  bulk?: boolean;
}
export interface TreasureMap { id: string; x: number; y: number; reward: number }
export interface LogEntry {
  n: number; best: number; trophy?: boolean;
  /** where you've caught it: up to 6 spots (rounded world positions), newest first, at least 150 units apart */
  at?: [number, number][];
  /** the variants of this species you've caught (VariantIds) */
  vars?: string[];
}
interface FleetBoat { port: string; portName: string; earned: number }
interface Frenzy { s: School; until: number }
export interface CatchCard { fish: Fish; first: boolean; record: boolean; perfect: boolean; bonus: string | null; t: number; back?: Escapee; stars?: 1 | 2 | 3 }
interface CatchAnim { sp: number; t: number; x: number; y: number }
export interface Pet { name: string }

export interface Stats {
  caught: number; sold: number; upgrades: number; lights: number; contracts: number;
  wrecks: number; trophies: number; night: number; frenzy: number; treasures: number; storm: number;
}

export type Speaker = 'maren' | 'ida' | 'tobias' | 'wren' | 'nell';
export type TalkLine = [Speaker, string];
export interface Talk { lines: TalkLine[]; i: number; then?: () => void; back: Mode }
/** Story progress; `base` snapshots the stats when the current quest began. */
export interface StoryState { i: number; base: Stats; shown: boolean }

interface PortMenu { tab: number; sel: number; port: Port | null }
interface MapView {
  x: number; y: number; zoom: number;
  /** the species whose zone and catch spots the chart is showing (index into SPECIES), if any */
  zoneSp?: number | null;
}
export interface NetForm {
  name: string | null; email: string; pass: string; show: boolean; mode: 'signUp' | 'signIn';
  /** the account the form was last shown for; a change clears a half-typed name */
  uid?: string | null;
  /** when "Delete account" was first pressed (ms); a second press within a few seconds deletes */
  delAt?: number;
}

// ---------- port menu rows (portItems) ----------
export interface NeedStatus { have: number; want: number; label: string; pick: Fish[]; sp?: number }
type PortItemKind =
  | 'sell' | 'deliver' | 'take' | 'rest' | 'repair' | 'supply' | 'upgrade' | 'boat' | 'paint'
  | 'collect' | 'fleet' | 'note' | 'project' | 'fund' | 'ferry' | 'contract' | 'island';
interface PortHeader { kind: 'header'; label: string }
export interface PortRow {
  kind: PortItemKind;
  label: string;
  sub?: string;
  /** right-hand price or status */
  right?: string;
  ok: boolean;
  /** why it can't be bought right now ('' when it can) */
  why?: string;
  action?: string;
  act: () => void | Promise<void>;
  what?: string | null;
  icon?: string;
  cost?: number | null;
  key?: string;
  /** holding the button keeps buying */
  repeat?: boolean;
  fish?: number;
  boat?: BoatDef;
  paint?: string;
  pr?: Project;
  st?: NeedStatus;
  q?: Port;
  /** upgrades: [level, max] */
  pips?: [number, number];
}
export type PortItem = PortHeader | PortRow;

// ---------- the game state ----------
/** Progress that goes into the save game. */
interface Progress {
  coins: number;
  /** lifetime earnings (cheats and refunds don't count) */
  earned: number;
  boatId: BoatId;
  owned: BoatId[];
  up: Record<UpgradeKey, number>;
  paint: string;
  paints: string[];
  bait: Record<BaitKind, number>;
  baitSel: BaitChoice;
  hold: Fish[];
  log: Record<string, LogEntry>;
  /** charted POI ids */
  found: Set<string>;
  salvaged: Set<string>;
  lastPort: string | null;
  stats: Stats;
  story: StoryState | null;
  /** port id -> day number of the last harbourmaster gift */
  gifts: Record<string, number>;
  pet: Pet | null;
  projects: ProjectId[];
  /** boat id -> a spare boat fishing on its own */
  fleet: Record<string, FleetBoat>;
  /** wreck id -> day number of the last diving-bell dive */
  dives: Record<string, number>;
  goalsDone: number[];
  maps: TreasureMap[];
  /** fish that broke your line and are still out there */
  escaped: Escapee[];
  /** progress through each content pack (src/content), and the regions sailed into so far (packs can open on one) */
  packs: Record<string, import('./content/types').PackState>; regionsSeen: string[];
  /** the fog of war lifted so far (encoded by game/explore.ts), and the regions the player has opened */
  explored: string; unlocked: string[];
  /** a spot the player marked on the chart: a line to it on the minimap and chart, cleared on arrival */
  waypoint: Point | null;
  /** helpers the player switched off (they still own them): the deckhand, the drift net, the crab pots */
  gearOff: Partial<Record<Helper, true>>;
  /** species ids whose fish chart you bought: the chart shades where they live */
  zones: Record<string, true>;
  /** contracts delivered at each port (port id -> count): its dock hand's grade grows with them */
  docks: Record<string, number>;
  /** contracts delivered in a row (0-5): each adds 5% to contract pay; abandoning one only drops a step */
  streak: number;
  /** your islands' income waiting to be collected (at any of them), and what they bring in a minute, last known */
  treasury: number; realmRate: number;
  musicOn: boolean;
  /** port id -> contracts on offer there */
  offers: Record<string, Contract[]>;
  active: Contract[];
  /** catches since the last trophy; raises the trophy chance */
  pity: number;
  /** game clock in seconds; a day is DAYLEN */
  clock: number;
}

/** The voyage being simulated right now (not saved). */
interface Voyage {
  mode: Mode;
  /** seconds since start, including menus */
  t: number;
  boat: Boat;
  /** coin counter easing towards `coins` */
  coinsShown: number;
  /** port id -> species index -> market saturation */
  sat: Record<string, Record<number, number>>;
  /** missed strikes in a row; widens the strike window */
  dry: number;
  fish: FishLine | null;
  frenzy: Frenzy | null;
  nextFrenzy: number;
  /** 1 while throttle or reverse is held */
  throttle: number;
  lairTold: boolean;
  sunkT: number;
  sunkMsg: string;
}

/** Countdowns and accumulators for periodic effects. */
interface Timers {
  crashCd: number; spookCd: number; petCd: number; petT: number;
  wakeAcc: number; idleRing: number; smokeT: number; bilgeT: number;
  saveT: number; netT: number; potT: number;
}

/** Transient feedback drawn over the world. */
interface Feedback {
  toasts: Toast[];
  captions: Caption[];
  floaters: Floater[];
  parts: Particle[];
  card: CatchCard | null;
  /** game time of the last hook, or of landing a 3-star or legendary fish (for the hitstop, camera nudge and splash) */
  hookT: number;
  catchAnim: CatchAnim | null;
  /** last purchase, for a flash on the bought row */
  bought: { id: string; t: number } | null;
  /** a two-press confirmation in progress (selling a legend, abandoning a contract) and when it was asked */
  confirm: { what: string; t: number } | null;
  myEmote: { i: number; t: number } | null;
}

interface CameraState {
  cam: Point;
  /** look-ahead offset in the direction of travel */
  look: Point;
  shake: number; shakeX: number; shakeY: number;
}

interface InputState {
  /** keys held now, and keys pressed this frame */
  keys: Record<string, boolean>;
  pressed: Set<string>;
  /** last input came from a gamepad */
  pad: boolean;
}

/** What the boat is next to this frame, and the hint shown for it. */
interface Surroundings {
  prompt: string | null;
  nearPort: Port | null;
  nearWreck: Wreck | null;
  nearSchool: School | null;
  nearTreasure: TreasureMap | null;
}

/** Menu cursors and where each screen returns to. */
interface Screens {
  menu: PortMenu;
  map: MapView;
  talk: Talk | null;
  shipSel: number; logSel: number; titleSel: number; pauseSel: number;
  /** the "erase your save?" question on the title: -1 closed, 0 keep the save (the default), 1 start over */
  newConfirm: number;
  setSel: number; ctlSel: number; emoteSel: number;
  /** settings/controls return here */
  back: Mode;
  accountBack: Mode; journalBack: Mode; cheatBack: Mode; leadersBack: Mode;
  /** the island the island card is showing, and where closing it returns */
  islandKey: string | null; islandBack: Mode;
  /** which leaderboard tab is showing */
  leaderTab: number;
  /** online players must pick their own captain name before sailing on */
  needName: boolean;
  cheatBuf: string; cheatErr: boolean;
  /** action id waiting for a new key on the controls screen */
  rebinding: string | null;
  netForm: NetForm | null;
  netMsg: { msg: string; bad: boolean } | null;
}

// god: the unbreakable-hull cheat is on; cheated: this save has used a cheat (so it stays off world records)
export interface GameState extends Progress, Voyage, Timers, Feedback, CameraState, InputState, Surroundings, Screens { god: boolean; cheated: boolean }
