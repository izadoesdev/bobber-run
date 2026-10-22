// The Icebound Ship: an old ship frozen fast in the far north, and the great-granddaughter of its captain, who wants
// to know what happened to it. Ends with the Crystal Squid, a legend of the cold. Opens in the cold north.
import type { Pack } from '../types';

export const iceboundShip: Pack = {
  id: 'icebound-ship',
  name: 'The Icebound Ship',
  unlock: { region: 'cold', afterQuest: 9 },
  characters: [
    { id: 'tove', name: 'Tove', role: "Great-granddaughter of a lost ship's captain" },
  ],
  quests: [
    {
      id: 'find-ship', by: 'tove', title: 'Frozen fast', goal: 'Sail to the Icebound Ship',
      hint: 'It is stuck in the ice, far up in the cold north.', obj: { site: 'legend-iceboundShip', place: 'the Icebound Ship' }, reward: { coins: 800 },
      intro: ['My great-grandfather sailed north and never came back. His ship is still up there, in the ice.', 'Will you find it for me? I have only ever seen a drawing.'],
      outro: ['You saw it! Is the name still on the side? The Northern Star.'],
    },
    {
      id: 'hull-crabs', by: 'tove', title: 'Crabs in the hull', goal: 'Catch 3 Snow Crabs',
      hint: 'Snow crabs walk the cold seabed at night.', obj: { catch: 3, species: 'snowcrab' }, reward: { coins: 1000, bait: { shrimp: 5 } },
      intro: ['His diary says the crew ate snow crab every night.', 'Catch three. I want to taste what he tasted.'],
      outro: ['Sweet and cold. I think I understand why he stayed so long.'],
    },
    {
      id: 'crystal-squid', by: 'tove', title: 'The last page', goal: 'Catch the Crystal Squid',
      hint: 'It bites far out in the cold at night. You need the best rod and a Storm Keel.', obj: { catch: 1, species: 'crystal' }, reward: { coins: 3000 },
      intro: ['The last page of his diary: a squid made of ice, under the ship.', 'He went to catch it. Will you finish what he started?'],
      outro: ['You did it. He would have been so proud.', 'I will tell everyone the Northern Star found its squid at last.'],
    },
  ],
};
