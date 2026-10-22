// The Crystal Cave: a cave of glassy rock on a far island of the Ember Isles. A rock collector, the heat-loving fish
// of the vents, and a test of clean fishing. Opens in the Ember Isles.
import type { Pack } from '../types';

export const crystalCave: Pack = {
  id: 'crystal-cave',
  name: 'The Crystal Cave',
  unlock: { region: 'volcanic', afterQuest: 8 },
  characters: [
    { id: 'sela', name: 'Sela', role: 'Rock collector of the Ember Isles' },
  ],
  quests: [
    {
      id: 'find-cave', by: 'sela', title: 'Glass in the rock', goal: 'Sail to the Crystal Cave',
      hint: 'It is on an island far out in the Ember Isles.', obj: { site: 'legend-crystalCave', place: 'the Crystal Cave' }, reward: { coins: 700 },
      intro: ['Far out in the Ember Isles there is a cave that shines like glass.', 'I can not get there in my little boat. Will you go?'],
      outro: ['You saw it? Green and blue, all the way down? I knew it.'],
    },
    {
      id: 'vent-eel', by: 'sela', title: 'Hot water', goal: 'Catch a Cinder Eel',
      hint: 'They bite at night in the Ember Isles. You need a strong rod.', obj: { catch: 1, species: 'cindereel' }, reward: { coins: 1200, bait: { chum: 3 } },
      intro: ['The water by the cave is warm from the vents. Eels love it.', 'Catch a cinder eel. I want to see the colour of its skin.'],
      outro: ['It shines like the cave does. They must live there together.'],
    },
    {
      id: 'clean-catches', by: 'sela', title: 'Clean as glass', goal: 'Catch 3 fish of 2 stars or better in the Ember Isles',
      hint: 'Stars come from a good strike and a fight with no strain.', obj: { catch: 3, stars: 2, region: 'volcanic' }, reward: { coins: 1600 },
      intro: ['Crystal breaks if you are rough with it. Fish too, I think.', 'Land three fine catches here, two stars or more.'],
      outro: ['Clean work. Here, take your pay. And this little crystal. It is for luck.'],
    },
  ],
};
