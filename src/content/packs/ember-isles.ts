// The Ember Isles: the forge-keeper of the volcanic islands and her apprentice, and the fish of the warm vents.
// Opens the first time you sail into the ember isles. (The template for region packs: one region, two or three
// people, four or five quests that walk through the region's fish from easy to hard.)
import type { Pack } from '../types';

export const emberIsles: Pack = {
  id: 'ember-isles',
  name: 'The Ember Isles',
  unlock: { region: 'volcanic' },
  characters: [
    { id: 'oda', name: 'Oda', role: 'Forge-keeper of the ember isles' },
    { id: 'pell', name: 'Pell', role: "Oda's apprentice" },
  ],
  quests: [
    {
      id: 'warm-water', by: 'oda', title: 'Warm water', goal: 'Catch 3 fish around the ember isles',
      obj: { catch: 3, region: 'volcanic' }, reward: { coins: 150 },
      intro: ['A boat from Alderhaven? Few come this far. The water here is warm from the vents below.', 'Catch three fish around the isles and I will show you what lives here.'],
      outro: ['You handle the heat well. Pell, come and meet our visitor.'],
    },
    {
      id: 'vent-crabs', by: 'pell', title: 'Vent crabs', goal: 'Catch 2 Vent Crabs',
      hint: 'They live in the warm shallows by the isles.', obj: { catch: 2, species: 'ventcrab' }, reward: { bait: { glow: 3 } },
      intro: ['I need vent crabs for the forge fire. Their shells hold the heat for hours.', 'Bring me two? Here, take some glow lures for the trip back.'],
      outro: ['Two good ones. The forge will burn bright tonight.'],
    },
    {
      id: 'ember-trophy', by: 'oda', title: 'A snapper worth keeping', goal: 'Catch a trophy Ember Snapper',
      hint: 'Bait raises the trophy chance, and so does a storm.', obj: { catch: 1, species: 'embersnap', trophy: true }, reward: { coins: 400 },
      intro: ['Every smith here keeps one big Ember Snapper over the door, for luck.', 'Mine was eaten by a gull. Catch me a trophy one.'],
      outro: ['Look at the colour on it. That goes over the door today.'],
    },
    {
      id: 'night-cinders', by: 'pell', title: 'Sparks in the dark', goal: 'Catch a Cinder Eel at night',
      hint: 'Cinder Eels only rise after dark.', obj: { catch: 1, species: 'cindereel', night: true }, reward: { coins: 600 },
      intro: ['At night the eels come up and glow like sparks. Oda says I am too young to go out for one.', 'Will you go instead? Tell me what it looks like.'],
      outro: ['It glows even now! I am going to draw it before it fades.', 'oda: Well done, both of you.'],
    },
    {
      id: 'black-grouper', by: 'oda', title: 'The dark water', goal: 'Catch a Black Grouper',
      hint: 'They keep to the dark water by the isles, by day.', obj: { catch: 1, species: 'blackgrouper' }, reward: { coins: 800 },
      intro: ['One last thing. Big black groupers hide in the deep water here, and no one has landed one in years.', 'If anyone can, it is you.'],
      outro: ['You did it. The ember isles will tell this story for a long time.', 'pell: Come back soon!'],
    },
  ],
};
