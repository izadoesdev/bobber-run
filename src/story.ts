// The story: Nell, Alderhaven's old harbourmaster, vanished the night the lighthouses went dark.
// Sixteen quests in five chapters walk you through the game's systems and end at the Grand Harbour.
import { G, projDone, logged, toast, saveGame } from './game';
import { coldness, BAIT_KINDS, PROJECTS } from './econ';
import { sfx } from './audio';
import type { BaitKind, GameState, ProjectId, Speaker, Stats, StoryState, TalkLine } from './types';

export interface Person { name: string; role: string }
/**
 * What the guide (game/guide.ts) points the player at for a quest: a kind of place or catch, or a harbour project.
 * school: any catchable school; sell: a port to sell at; port/light: the nearest uncharted one; wreck: an unsalvaged wreck;
 * night: a school that bites at night; north: the cold water; species: a school not in the logbook yet; trophy: a school
 * to fish for a trophy; ghost: the Ghost Carp's far-off wreck; lair: the Old One.
 */
export type QuestTarget =
  | 'school' | 'sell' | 'port' | 'light' | 'wreck' | 'night' | 'north' | 'species' | 'trophy' | 'ghost' | 'lair' | { project: ProjectId };
export interface Quest {
  id: string;
  /** chapter index into CHAPTERS */
  ch: number;
  by: Speaker;
  title: string;
  goal: string;
  /** [have, want]; `base` is a snapshot of the stats when the quest began */
  obj: (g: GameState, base: Stats) => [number, number];
  /** where the guide points while this quest runs */
  target: QuestTarget;
  /** a short extra note for the journal, when the goal alone doesn't say how */
  hint?: string;
  reward: { coins?: number } & Partial<Record<BaitKind, number>>;
  intro: TalkLine[];
  outro: TalkLine[];
}

export const PEOPLE: Record<Speaker, Person> = {
  maren: { name: 'Maren', role: 'Harbourmaster of Alderhaven' },
  ida: { name: 'Ida', role: 'Chartmaker' },
  tobias: { name: 'Tobias', role: 'Lighthouse keeper' },
  wren: { name: 'Wren', role: 'Naturalist' },
  nell: { name: 'Nell', role: 'Your grandmother' },
};
const S = (g: GameState): Stats => g.stats;
// the pier's fish count, in words, straight from the project data so the dialogue can't drift from it
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const pierNeed = PROJECTS.find(p => p.id === 'pier')!.need, pierFish = 'any' in pierNeed ? pierNeed.any : 4;
const pierFishText = `${WORDS[pierFish] ?? pierFish} fish`;
const ports = (): number => [...G.found].filter(id => id.startsWith('port:')).length;
export const CHAPTERS = ['A borrowed boat', 'The chartmaker', 'Night waters', 'The naturalist', 'The Old One'];
export const QUESTS: Quest[] = [
  { id: 'first-cast', ch: 0, by: 'maren', title: 'First cast', goal: 'Catch a fish', obj: (g, b) => [Math.min(1, S(g).caught - b.caught), 1], target: 'school', hint: 'Stop over the ripples and press Space to cast. When the bobber dips, press Space again.', reward: { coins: 20 },
    intro: [['maren', 'So you are Nell\'s grandchild. Welcome to Alderhaven. Her old rowboat is yours now, and she would want you to use it.'], ['maren', 'See the ripples just off the pier? That is a school of fish. Stop over it, press Space to cast, and catch one.']],
    outro: [['maren', 'Well done. You fish just like Nell did.']] },
  { id: 'market-day', ch: 0, by: 'maren', title: 'Market day', goal: 'Sell fish at a port', obj: (g, b) => [Math.min(1, S(g).sold - b.sold), 1], target: 'sell', hint: 'Slow down next to a pier, press E to dock, then choose "Sell your catch" in the Market tab.', reward: { shrimp: 5 },
    intro: [['maren', 'Now sell your fish for coins. Sail up to the pier, press E to dock, and sell them at the market.']],
    outro: [['maren', 'Good. Spend your coins on bait, repairs and better gear, and you will catch more.']] },
  { id: 'the-pier', ch: 0, by: 'maren', title: 'Mend the pier', goal: 'Fund "Mend the pier" in Alderhaven', obj: () => [projDone('pier') ? 1 : 0, 1], target: { project: 'pier' }, hint: 'Fund it in the Harbour tab at Alderhaven. Save up the coins first, then come back with the fish in your hold.', reward: { coins: 50 },
    intro: [['maren', 'The pier has sagged since the night Nell sailed out and never came back. The lighthouses went dark that same night.'], ['maren', `Let us fix it. Bring coins and ${pierFishText} to the Harbour tab here in Alderhaven, and we will start rebuilding the town.`]],
    outro: [['maren', 'The pier is fixed. And a letter came for you: Ida, the chartmaker, has something that belonged to Nell.']] },
  { id: 'new-port', ch: 1, by: 'ida', title: 'A letter from Ida', goal: 'Find and chart a second port', obj: () => [Math.min(2, ports()), 2], target: 'port', hint: 'Ports are on the larger islands. Sail close to one to add it to your chart.', reward: { glow: 2 },
    intro: [['ida', 'Nell left her old sea chart with me years ago. I live at another port along the coast. Come and find me.']],
    outro: [['ida', 'There you are. Here is Nell\'s chart. She marked a wreck, and every lighthouse that went dark.']] },
  { id: 'two-lights', ch: 1, by: 'ida', title: 'Dark towers', goal: 'Chart 2 lighthouses', obj: g => [Math.min(2, S(g).lights), 2], target: 'light', reward: { coins: 60 },
    intro: [['ida', 'Nell circled every lighthouse on her chart. Sail close to two of them to add them to yours.']],
    outro: [['ida', 'Their lamps are all dark. The keepers say someone put them out on purpose.']] },
  { id: 'nells-wreck', ch: 1, by: 'ida', title: 'Nell\'s wreck', goal: 'Salvage a wreck', obj: (g, b) => [Math.min(1, S(g).wrecks - b.wrecks), 1], target: 'wreck', hint: 'Wrecks show as crosses on your chart. Stop beside one and press E.', reward: { coins: 80 },
    intro: [['ida', 'Nell also marked a wreck. Stop beside a wreck and press E to salvage it. Maybe she left something there.']],
    outro: [['nell', '(A page from Nell\'s log, wrapped in oilcloth) "The lights went dark so it would sleep. Do not wake it, little fish."'], ['ida', '"It"? Ask Tobias, the old lighthouse keeper. He knew Nell better than anyone.']] },
  { id: 'night-catch', ch: 2, by: 'tobias', title: 'By moonlight', goal: 'Catch a fish at night', obj: (g, b) => [Math.min(1, S(g).night - b.night), 1], target: 'night', hint: 'Night comes near the end of each day. With glow lures, fish bite twice as fast in the dark.', reward: { glow: 3 },
    intro: [['tobias', 'So you found Nell\'s page. Hm. There is more out there at night than you think, young one. Go and catch a fish after dark.']],
    outro: [['tobias', 'Some fish only come up at night. So does something much bigger.']] },
  { id: 'cold-water', ch: 2, by: 'tobias', title: 'Where the water turns cold', goal: 'Sail north into the cold water', obj: g => [coldness(g.boat.y) > 0.5 ? 1 : 0, 1], target: 'north', hint: 'Keep sailing north (up on your chart) until the water turns icy.', reward: { coins: 120 },
    intro: [['tobias', 'Every autumn Nell sailed north, to where the water turns cold. Go and see it for yourself.']],
    outro: [['tobias', 'Up north there are fish you will never find near home. Nell loved it there.']] },
  { id: 'market-hall', ch: 2, by: 'maren', title: 'A market for the coast', goal: 'Fund "Raise the fish market"', obj: () => [projDone('market') ? 1 : 0, 1], target: { project: 'market' }, reward: { coins: 150 },
    intro: [['maren', 'Next, a fish market. Bring the coins and six different kinds of fish to the Harbour tab, and people from every port will come to Alderhaven again.']],
    outro: [['maren', 'The market hall is open. Ports now have a Fleet tab too: boats you own but are not sailing can fish for you there.']] },
  { id: 'naturalist', ch: 3, by: 'wren', title: 'The naturalist', goal: 'Log 12 species', obj: () => [Math.min(12, logged()), 12], target: 'species', hint: 'Different fish come out at night, in rain, near wrecks and far from home.', reward: { coins: 200 },
    intro: [['wren', 'I am Wren. I study the fish of this coast, and Nell sent me her sketches for years. Help me finish her work: log twelve species.']],
    outro: [['wren', 'Twelve! Your logbook is better than mine already.']] },
  { id: 'trophy', ch: 3, by: 'wren', title: 'A fish worth mounting', goal: 'Catch a trophy fish', obj: (g, b) => [Math.min(1, S(g).trophies - b.trophies), 1], target: 'trophy', hint: 'Bait raises the trophy chance, and storms raise it more.', reward: { glow: 3 },
    intro: [['wren', 'Now catch a trophy: an extra-large fish. Bait gives you a better chance, and so do storms, if you are brave.']],
    outro: [['wren', 'A beauty. That one goes on the wall.']] },
  { id: 'dry-dock', ch: 3, by: 'maren', title: 'A dock for real ships', goal: 'Fund "Build the dry dock"', obj: () => [projDone('drydock') ? 1 : 0, 1], target: { project: 'drydock' }, hint: 'It needs three trophy fish. Keep them in your hold instead of selling them.', reward: { coins: 400 },
    intro: [['maren', 'To follow Nell\'s trail, you will need a bigger ship. Fund a dry dock and our shipwrights can build one.']],
    outro: [['maren', 'The dry dock is open. Our shipwrights can build a Schooner or a Steam Drifter now.']] },
  { id: 'ghost', ch: 3, by: 'wren', title: 'The Ghost Carp', goal: 'Catch the Ghost Carp', obj: g => [g.log.ghost ? 1 : 0, 1], target: 'ghost', hint: 'It needs a level 5 rod, and keeps to wrecks far from Alderhaven.', reward: { coins: 600 },
    intro: [['wren', 'Nell drew one fish she never caught: a pale carp that lives near wrecks far from here. You will need a level 5 rod to land it.']],
    outro: [['wren', 'You did it. Nell would have laughed out loud.']] },
  { id: 'relight', ch: 4, by: 'tobias', title: 'Light the coast', goal: 'Fund "Light the coast"', obj: () => [projDone('lights') ? 1 : 0, 1], target: { project: 'lights' }, hint: 'Beaconfish bite below lighthouses at night, with a level 3 rod.', reward: { coins: 800 },
    intro: [['tobias', 'It is time I told you. Nell put out the lights so the Old One, the oldest fish in the sea, would sleep. It means no harm. It is only lonely.'], ['tobias', 'She meant to come back and make friends with it. Help me light the lighthouses again. They burn Beaconfish oil, so bring Beaconfish.']],
    outro: [['tobias', 'Every lighthouse is lit again. Far out at sea, something is waking up. You will see it on your chart.']] },
  { id: 'old-one', ch: 4, by: 'nell', title: 'The Old One', goal: 'Catch the Old One at its lair', obj: g => [g.log.oldone ? 1 : 0, 1], target: 'lair', hint: 'Its lair is marked on your chart. It only rises at night.', reward: { coins: 1500 },
    intro: [['nell', '(Another page from Nell, tucked inside the chart) "If you are reading this, the lights are on again. Go to its lair at night and catch it. Be gentle."']],
    outro: [['tobias', 'You brought it home without a scratch. The whole coast is talking. Maren wants to see you.']] },
  { id: 'homecoming', ch: 4, by: 'maren', title: 'Homecoming', goal: 'Fund "The Grand Harbour"', obj: () => [projDone('grand') ? 1 : 0, 1], target: { project: 'grand' }, reward: { coins: 0 },
    intro: [['maren', 'One last project: the Grand Harbour. Fund it in the Harbour tab, and the Old One can watch over the harbour gate.']],
    outro: [['nell', 'Hello, little fish. It is me, Nell. You found my chart, lit my lighthouses and made friends with the Old One. I heard there was a festival.'], ['maren', 'Nell! Everyone, Nell is home!']] },
];

const snap = (): Stats => ({ ...G.stats });
export const story = (): StoryState => G.story || (G.story = { i: 0, base: snap(), shown: false });
export const currentQuest = (): Quest | null => QUESTS[story().i] || null;
export function questProgress(q: Quest | null = currentQuest()): { have: number; want: number } | null {
  if (!q) return null;
  const [have, want] = q.obj(G, story().base);
  return { have: Math.max(0, Math.min(have, want)), want };
}
function give(r: Quest['reward']): void {
  if (r.coins) { G.coins += r.coins; G.earned += r.coins; }
  for (const k of BAIT_KINDS) { const n = r[k]; if (n) G.bait[k] = (G.bait[k] || 0) + n; }
}
// a conversation pauses the game; lines are [speaker, text]
function talk(lines: TalkLine[], then?: () => void): void {
  if (!lines.length) { then?.(); return; }
  G.talk = { lines, i: 0, then, back: G.mode === 'talk' ? 'play' : G.mode };
  G.mode = 'talk';
  sfx('select');
}
export function talkNext(skip = false): void {
  const t = G.talk;
  if (!t) return;
  if (!skip && ++t.i < t.lines.length) { sfx('move'); return; }
  G.talk = null;
  G.mode = t.back === 'talk' ? 'play' : t.back;
  t.then?.();
}
// called every frame from the main loop while sailing or in port
export function updateStory(): void {
  if (G.mode !== 'play' && G.mode !== 'port') return;
  const st = story(), q = currentQuest();
  if (!q) return;
  if (!st.shown) { st.shown = true; talk(q.intro); return; }
  const pr = questProgress(q);
  if (!pr || pr.have < pr.want) return;
  give(q.reward);
  st.i++; st.base = snap(); st.shown = true;
  const next = currentQuest(), coins = q.reward.coins;
  toast(`Quest complete: ${q.title}${coins ? `  +$${coins}` : ''}`, 'good'); sfx('fanfare'); saveGame();
  talk([...q.outro, ...(next ? next.intro : [])], () => { if (q.id === 'homecoming') G.mode = 'finale'; });   // Nell comes home, then the ending
}
