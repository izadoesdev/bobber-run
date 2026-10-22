// The Stone Circle: an old ring of standing stones on an island near home, and the storyteller who swears the fish
// gather round it at night. Opens once you have charted a second port. Short, and early: it sends a new player out
// of sight of Alderhaven for the first time.
import type { Pack } from '../types';

export const stoneCircle: Pack = {
  id: 'stone-circle',
  name: 'The Stone Circle',
  unlock: { afterQuest: 4 },
  characters: [
    { id: 'bram', name: 'Old Bram', role: 'Storyteller of Alderhaven' },
  ],
  quests: [
    {
      id: 'the-stones', by: 'bram', title: 'The old stones', goal: 'Sail to the Stone Circle',
      hint: 'It stands inland on an island not far from home. Sail close to its shore.', obj: { site: 'legend-stoneCircle', r: 180, place: 'the Stone Circle' }, reward: { coins: 250 },
      intro: ['Want a story? Not far from here, a ring of old stones stands on an island.', 'Nobody knows who put them there. Go and see them for me. My legs are too old.'],
      outro: ['Still standing? Good. They were old when my gran was young.'],
    },
    {
      id: 'stone-night', by: 'bram', title: 'Fish by starlight', goal: 'Catch 3 fish at night',
      hint: 'Night falls every few minutes. Glow bait helps in the dark.', obj: { catch: 3, night: true }, reward: { coins: 400, bait: { glow: 3 } },
      intro: ['They say the fish come to the stones at night, to look at the stars.', 'Catch three after dark and tell me if it is true.'],
      outro: ['Three! Then the story is true. I will tell it better now.'],
    },
    {
      id: 'stone-lantern', by: 'bram', title: 'A light under the water', goal: 'Catch a Lanternfish',
      hint: 'Lanternfish bite at night, in deep water.', obj: { catch: 1, species: 'lantern' }, reward: { coins: 700 },
      intro: ['The end of the story: one fish carries its own light, to find the stones in the dark.', 'A lanternfish. Bring me one and I will believe all of it.'],
      outro: ['It glows! Just like the story said.', 'Thank you. Now I have a new story to tell. It is about you.'],
    },
  ],
};
