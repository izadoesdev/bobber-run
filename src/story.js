// The story: Nell, Alderhaven's old harbourmaster, vanished the night the lighthouses went dark.
// Sixteen quests in five chapters walk you through the game's systems and end at the Grand Harbour.
import { G, projDone, logged, toast, saveGame } from './game.js';
import { coldness } from './econ.js';
import { sfx } from './audio.js';

export const PEOPLE = {
  maren: { name: 'Maren', role: 'Harbourmaster of Alderhaven' },
  ida: { name: 'Ida', role: 'Chartmaker' },
  tobias: { name: 'Tobias', role: 'Lighthouse keeper' },
  wren: { name: 'Wren', role: 'Naturalist' },
  nell: { name: 'Nell', role: 'Your grandmother' },
  bottle: { name: 'A message in a bottle', role: 'From another sailor' },
};
const S = G => G.stats, ports = () => [...G.found].filter(id => id.startsWith('port:')).length;
// obj(G, base) -> [have, want]; `base` is a snapshot of the stats when the quest began
export const CHAPTERS = ['A borrowed boat', 'The chartmaker', 'Night waters', 'The naturalist', 'The Old One'];
export const QUESTS = [
  { id: 'first-cast', ch: 0, by: 'maren', title: 'First cast', goal: 'Catch 3 fish', obj: (G, b) => [S(G).caught - b.caught, 3], reward: { coins: 20 },
    intro: [['maren', 'So you are Nell\'s grandchild. She would want her rowboat used, not rotting at the quay.'], ['maren', 'Fish swirl just off the pier. Stop over a school, press Space to cast, and catch three.']],
    outro: [['maren', 'Not bad. Nell had that same squint when a bobber dipped.']] },
  { id: 'market-day', ch: 0, by: 'maren', title: 'Market day', goal: 'Sell fish at a port', obj: (G, b) => [Math.min(1, S(G).sold - b.sold), 1], reward: { shrimp: 5 },
    intro: [['maren', 'Coin keeps a boat afloat. Dock with E and sell your catch at the market.']],
    outro: [['maren', 'There. Buy bait, patch your hull, and the sea pays you back.']] },
  { id: 'the-pier', ch: 0, by: 'maren', title: 'Mend the pier', goal: 'Fund "Mend the pier" in Alderhaven', obj: () => [projDone('pier') ? 1 : 0, 1], reward: { coins: 50 },
    intro: [['maren', 'The pier has sagged since the night Nell sailed out and never came back. The lighthouses went dark that same night.'], ['maren', 'Bring coin and five fish to the Harbour tab here in Alderhaven, and we will start putting this town back together.']],
    outro: [['maren', 'Solid planks again. And look, a letter came for you. Ida the chartmaker says she has something of Nell\'s.']] },
  { id: 'new-port', ch: 1, by: 'ida', title: 'A letter from Ida', goal: 'Chart a second port', obj: () => [Math.min(2, ports()), 2], reward: { glow: 2 },
    intro: [['ida', 'Nell left her old sea chart with me years ago. Come and find me at another harbour along the coast.']],
    outro: [['ida', 'There you are. Here is Nell\'s chart. She marked a wreck, and every lighthouse that went dark.']] },
  { id: 'two-lights', ch: 1, by: 'ida', title: 'Dark towers', goal: 'Chart 2 lighthouses', obj: G => [Math.min(2, S(G).lights), 2], reward: { coins: 60 },
    intro: [['ida', 'Sail close to the old lighthouses so they go on your chart. Nell circled them all.']],
    outro: [['ida', 'Cold lamps, all of them. Keepers say they were put out on purpose.']] },
  { id: 'nells-wreck', ch: 1, by: 'ida', title: 'Nell\'s wreck', goal: 'Salvage a wreck', obj: (G, b) => [Math.min(1, S(G).wrecks - b.wrecks), 1], reward: { coins: 80 },
    intro: [['ida', 'Her mark sits over a wreck. Stop beside one and press E to salvage it. Maybe she left something.']],
    outro: [['nell', '(A page from Nell\'s log, wrapped in oilcloth) "The lights went dark so it would sleep. Do not wake it, little fish."'], ['ida', '"It"? Ask Tobias, the old keeper. He knew her better than anyone.']] },
  { id: 'night-catch', ch: 2, by: 'tobias', title: 'By moonlight', goal: 'Catch a fish at night', obj: (G, b) => [Math.min(1, S(G).night - b.night), 1], reward: { glow: 3 },
    intro: [['tobias', 'Nell\'s page, is it. Hm. The dark is not empty, young one. Go and catch something by moonlight.']],
    outro: [['tobias', 'Night fish come up to the light. So does something much bigger.']] },
  { id: 'cold-water', ch: 2, by: 'tobias', title: 'Where the water turns cold', goal: 'Sail north into the cold water', obj: G => [coldness(G.boat.y) > 0.5 ? 1 : 0, 1], reward: { coins: 120 },
    intro: [['tobias', 'Every autumn Nell sailed north, past the last warm current. Go and see the cold water for yourself.']],
    outro: [['tobias', 'Ice on the rigging, and fish you will not find at home. She loved it up here.']] },
  { id: 'market-hall', ch: 2, by: 'maren', title: 'A market for the coast', goal: 'Fund "Raise the fish market"', obj: () => [projDone('market') ? 1 : 0, 1], reward: { coins: 150 },
    intro: [['maren', 'Six kinds of fish on six slabs, and folk from every harbour will come to Alderhaven again.']],
    outro: [['maren', 'The market hall is open. Spare boats can fish for you from the Fleet Office now.']] },
  { id: 'naturalist', ch: 3, by: 'wren', title: 'The naturalist', goal: 'Log 12 species', obj: () => [Math.min(12, logged()), 12], reward: { coins: 200 },
    intro: [['wren', 'Wren, naturalist. I am cataloguing this coast. Nell sent me sketches for years. Help me finish her work.']],
    outro: [['wren', 'Twelve! Your logbook is better than mine already.']] },
  { id: 'trophy', ch: 3, by: 'wren', title: 'A fish worth mounting', goal: 'Catch a trophy fish', obj: (G, b) => [Math.min(1, S(G).trophies - b.trophies), 1], reward: { glow: 3 },
    intro: [['wren', 'Bait and a steady hand bring up trophies. Storms help too, if you are brave.']],
    outro: [['wren', 'A beauty. That one goes on the wall.']] },
  { id: 'dry-dock', ch: 3, by: 'maren', title: 'A dock for real ships', goal: 'Fund "Build the dry dock"', obj: () => [projDone('drydock') ? 1 : 0, 1], reward: { coins: 400 },
    intro: [['maren', 'If you mean to follow Nell\'s trail, you will need a real ship. Build us a dry dock.']],
    outro: [['maren', 'The shipwrights are already arguing over the first keel. Schooner or steam?']] },
  { id: 'ghost', ch: 3, by: 'wren', title: 'The Ghost Carp', goal: 'Catch the Ghost Carp', obj: G => [G.log.ghost ? 1 : 0, 1], reward: { coins: 600 },
    intro: [['wren', 'Nell drew one fish she never caught: a pale carp around far-off wrecks. A rod of level 5 might hold it.']],
    outro: [['wren', 'You did it. She would have laughed out loud.']] },
  { id: 'relight', ch: 4, by: 'tobias', title: 'Light the coast', goal: 'Fund "Light the coast"', obj: () => [projDone('lights') ? 1 : 0, 1], reward: { coins: 800 },
    intro: [['tobias', 'Time I told you. Nell put out the lights to let the Old One sleep. It is not cruel, only lonely.'], ['tobias', 'She meant to come back and make peace with it. Relight the coast. Beaconfish oil burns brightest.']],
    outro: [['tobias', 'Every tower burning again. Out past the reefs, something is stirring. You will see it on your chart.']] },
  { id: 'old-one', ch: 4, by: 'nell', title: 'The Old One', goal: 'Catch the Old One at its lair', obj: G => [G.log.oldone ? 1 : 0, 1], reward: { coins: 1500 },
    intro: [['nell', '(Another page, tucked in the chart) "If you are reading this, the lights are on. Meet it at night, at its lair. Be gentle."']],
    outro: [['tobias', 'You brought it home without a scratch. The whole coast is talking. Maren wants to see you.']] },
  { id: 'homecoming', ch: 4, by: 'maren', title: 'Homecoming', goal: 'Fund "The Grand Harbour"', obj: () => [projDone('grand') ? 1 : 0, 1], reward: { coins: 0 },
    intro: [['maren', 'Let us give Alderhaven a harbour worth coming home to. The Old One can watch over the gate.']],
    outro: [['nell', 'Well, little fish. You found my chart, my lights, and my old friend. I heard there was a festival.'], ['maren', 'Nell! Everyone, Nell is home!']] },
];

const snap = () => ({ ...G.stats });
export const story = () => G.story || (G.story = { i: 0, base: snap(), shown: false });
export const currentQuest = () => QUESTS[story().i] || null;
export function questProgress(q = currentQuest()) { if (!q) return null; const [have, want] = q.obj(G, story().base); return { have: Math.max(0, Math.min(have, want)), want }; }
function give(r) {
  if (r.coins) { G.coins += r.coins; G.earned += r.coins; }
  for (const k of ['shrimp', 'glow', 'chum']) if (r[k]) G.bait[k] = (G.bait[k] || 0) + r[k];
}
// a conversation pauses the game; lines are [speaker, text]
export function talk(lines, then) { if (!lines.length) return then?.(); G.talk = { lines, i: 0, then, back: G.mode === 'talk' ? 'play' : G.mode }; G.mode = 'talk'; sfx('select'); }
export function talkNext(skip = false) {
  const t = G.talk; if (!t) return;
  if (!skip && ++t.i < t.lines.length) { sfx('move'); return; }
  G.talk = null; G.mode = t.back === 'talk' ? 'play' : t.back; t.then?.();
}
// called every frame from the main loop while sailing or in port
export function updateStory() {
  if (G.mode !== 'play' && G.mode !== 'port') return;
  const st = story(), q = currentQuest(); if (!q) return;
  if (!st.shown) { st.shown = true; return talk(q.intro); }
  const pr = questProgress(q); if (pr.have < pr.want) return;
  give(q.reward); st.i++; st.base = snap(); st.shown = true;
  const next = currentQuest(), rw = q.reward;
  toast(`Quest done: ${q.title}${rw.coins ? `  +$${rw.coins}` : ''}`, 'good'); sfx('fanfare'); saveGame();
  talk([...q.outro, ...(next ? next.intro : [])], () => { if (q.id === 'homecoming') G.mode = 'finale'; });   // Nell comes home, then the ending
}
