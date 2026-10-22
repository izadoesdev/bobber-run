// The Whale Fall: where a great whale came to rest on the sea floor, and a whole world of fish grew up around it.
// A quiet watcher of whales asks you to see it and to count what lives there. Opens out on the open sea.
import type { Pack } from '../types';

export const whaleFall: Pack = {
  id: 'whale-fall',
  name: 'The Whale Fall',
  unlock: { region: 'open', afterQuest: 9 },
  characters: [
    { id: 'oona', name: 'Oona', role: 'Whale watcher' },
  ],
  quests: [
    {
      id: 'find-fall', by: 'oona', title: 'Where the whale rests', goal: 'Sail to the Whale Fall',
      hint: 'It lies in the shallows far out on the open sea.', obj: { site: 'legend-whaleFall', place: 'the Whale Fall' }, reward: { coins: 700 },
      intro: ['Long ago an old whale came to rest on the sea floor, out on the open sea.', 'I never found the place. Will you look for it?'],
      outro: ['The bones are still there? Then she is still feeding the sea.'],
    },
    {
      id: 'fall-grouper', by: 'oona', title: 'Big neighbours', goal: 'Catch a Goliath Grouper',
      hint: 'Goliaths live around wrecks. You need a Trawler or bigger.', obj: { catch: 1, species: 'goliath' }, reward: { coins: 1400 },
      intro: ['Big fish live around a whale fall. The biggest is the goliath grouper.', 'Catch one. I want to see how big they grow out there.'],
      outro: ['As big as a door! The whale feeds them well.'],
    },
    {
      id: 'fall-manta', by: 'oona', title: 'Wings in the water', goal: 'Catch a Manta Ray',
      hint: 'Mantas glide through deep open water by day. You need a Trawler or bigger.', obj: { catch: 1, species: 'manta' }, reward: { coins: 1800, bait: { glow: 3 } },
      intro: ['Last one. Mantas fly over the bones, like birds over a field.', 'Catch a manta and my count is done.'],
      outro: ['Done. A whole world, all from one whale.', 'Thank you for being my eyes out there.'],
    },
  ],
};
