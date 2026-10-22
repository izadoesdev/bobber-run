// Nell's Other Voyages: after the finale, Nell is home and tells you of the places she sailed in the years away,
// and asks you to follow. Opens after the last quest of the main story. (The endgame: far-off legends, a rare
// albino, warm-water trophies and a long list of wrecks, for the biggest rewards in the game.)
import type { Pack } from '../types';

export const nellVoyages: Pack = {
  id: 'nell-voyages',
  name: "Nell's Other Voyages",
  unlock: { afterQuest: 16 },   // QUESTS.length in story.ts: opens once the main story is complete
  characters: [
    { id: 'nell', name: 'Nell', role: 'Your grandmother' },
    { id: 'maren', name: 'Maren', role: 'Harbourmaster of Alderhaven' },
  ],
  quests: [
    {
      id: 'warm-trophies', by: 'nell', title: 'The warm south', goal: 'Catch 3 trophy fish in the warm south',
      hint: 'Sail far south, past the mangroves. Bait and storms raise the trophy chance.', obj: { catch: 3, trophy: true, region: 'warm' }, reward: { coins: 1500 },
      intro: ['My legs are tired, little fish, but my head is still full of the sea. Let me tell you where I went.', 'Far south the water is warm and the fish grow huge. Bring home three trophies from there.'],
      outro: ['Three! I only ever caught one. You have better hands than I did.'],
    },
    {
      id: 'glass-squid', by: 'nell', title: 'Squid like glass', goal: 'Catch a Crystal Squid',
      hint: 'Far cold ocean at night, with a level 5 rod and a Storm Keel.', obj: { catch: 1, species: 'crystal' }, reward: { coins: 2500 },
      intro: ['One winter I sailed so far north the sea froze around my boat.', 'At night, squid rose under the ice, clear as glass. I never caught one.'],
      outro: ['Just as I remember. You can see the stars right through it.'],
    },
    {
      id: 'white-fish', by: 'nell', title: 'The white fish', goal: 'Catch an albino fish',
      hint: 'Any kind of fish can be albino. They come up twice as often at night.', obj: { catch: 1, variant: 'albino' }, reward: { coins: 3000 },
      intro: ['Once, by moonlight, I saw a fish as white as milk. The old sailors say it brings you home.', 'Maybe it did. Find me one, any kind.'],
      outro: ['White as milk. I am home, and so are you.'],
    },
    {
      id: 'golden-mahi', by: 'nell', title: 'A flash of gold', goal: 'Catch a Golden Mahi',
      hint: 'Far warm ocean by day, and rare. You need a level 5 rod.', obj: { catch: 1, species: 'goldmahi' }, reward: { coins: 3500 },
      intro: ['Far out in the warm ocean I saw a mahi made of gold. It jumped once, and was gone.', 'I chased it for a whole summer. Your turn.'],
      outro: ['Gold, all the way to the tail. That summer was worth it after all.'],
    },
    {
      id: 'lost-ships', by: 'nell', title: 'Every ship I passed', goal: 'Have 15 wrecks on your chart',
      hint: 'Wrecks lie in open water. A Sextant marks the uncharted ones.', obj: { chart: 15, kind: 'wreck' }, reward: { coins: 4000 },
      intro: ['When the lights were dark, ships were lost. Some belonged to friends.', 'I said goodnight to every wreck I passed. Chart fifteen, so none are forgotten.'],
      outro: ['Fifteen. Thank you for remembering them with me.'],
    },
    {
      id: 'the-oarfish', by: 'nell', title: 'The one that got away', goal: 'Catch an Oarfish',
      hint: 'Deep ocean in storms, from a Steam Drifter, with a level 5 rod.', obj: { catch: 1, species: 'oarfish' }, reward: { coins: 5000 },
      intro: ['The night I left, I hooked an oarfish in the storm. It was longer than my boat, and it broke my line.', 'I am too old to go after it now. That is why I have you.'],
      outro: ['You caught it. Now I have no more stories, only yours.', 'maren: Then you will just have to sit on the pier and listen to new ones, Nell.'],
    },
  ],
};
