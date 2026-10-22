// Storm Season: a storm chaser who only fishes in the worst weather, and teaches you to do the same.
// Opens once the main story has you fishing at night.
import type { Pack } from '../types';

export const stormSeason: Pack = {
  id: 'storm-season',
  name: 'Storm Season',
  unlock: { afterQuest: 7 },
  characters: [{ id: 'rook', name: 'Rook', role: 'Storm chaser' }],
  quests: [
    {
      id: 'first-rain', by: 'rook', title: 'Out in the rain', goal: 'Catch 3 fish in the rain',
      hint: 'Rain comes and goes. Watch the sky.', obj: { catch: 3, weather: 'rain' }, reward: { bait: { shrimp: 5 } },
      intro: ['Most sailors run for port when it rains. That is when the best fish come up.', 'Catch three in the rain and you will see what I mean.'],
      outro: ['Wet, but worth it. Here, have some bait.'],
    },
    {
      id: 'rain-trout', by: 'rook', title: 'Rain Trout', goal: 'Catch a Rain Trout',
      hint: 'They swim in the shallows, and only bite when it rains.', obj: { catch: 1, species: 'rtrout' }, reward: { coins: 250 },
      intro: ['Rain Trout only show themselves in the rain. Bring me one.'],
      outro: ['A beauty. The colours fade once it is dry, so look now.'],
    },
    {
      id: 'storm-five', by: 'rook', title: 'Into the storm', goal: 'Catch 5 fish in a storm',
      hint: 'An anchor keeps the wind from pushing you while you fish.', obj: { catch: 5, weather: 'storm' }, reward: { coins: 400 },
      intro: ['Now a real storm. Five fish. Keep your hull patched.'],
      outro: ['You did not run. Good.'],
    },
    {
      id: 'storm-trophy', by: 'rook', title: 'A storm trophy', goal: 'Catch a trophy fish in a storm',
      hint: 'Storms make trophies more likely.', obj: { catch: 1, trophy: true, weather: 'storm' }, reward: { coins: 600 },
      intro: ['Storms stir up the big ones. Bring me a trophy caught in one.'],
      outro: ['That one goes on my wall, next to my first.'],
    },
    {
      id: 'thunder-eel', by: 'rook', title: 'The Thunder Eel', goal: 'Catch a Thunder Eel',
      hint: 'They live in open water and only rise in storms.', obj: { catch: 1, species: 'stormeel' }, reward: { coins: 900 },
      intro: ['In the worst storms, eels rise that crackle like lightning. I have chased one for ten years.', 'Maybe you will have better luck.'],
      outro: ['You landed a Thunder Eel. I can retire happy now. Well, almost.'],
    },
  ],
};
