// Alderhaven Docks: the people who work the home pier, now that it's mended: a net-mender, a fishmonger and a kid
// who wants to be a captain. Opens once the pier is fixed. (Everyday errands: common fish, a market day, a few
// ports on the chart, a first trophy.)
import type { Pack } from '../types';

export const alderhavenDocks: Pack = {
  id: 'alderhaven-docks',
  name: 'Alderhaven Docks',
  unlock: { afterQuest: 3 },
  characters: [
    { id: 'bram', name: 'Bram', role: 'Net-mender of Alderhaven' },
    { id: 'hilde', name: 'Hilde', role: 'Fishmonger' },
    { id: 'tam', name: 'Tam', role: 'A kid who wants to be a captain' },
  ],
  quests: [
    {
      id: 'new-mesh', by: 'bram', title: 'New mesh', goal: 'Catch 4 Sardines',
      hint: 'Sardines swim in the shallows, at any hour.', obj: { catch: 4, species: 'sardine' }, reward: { bait: { shrimp: 5 } },
      intro: ['The pier is fixed, so my nets have somewhere to dry again. Thank you.', 'I need a few sardines to test the new mesh. Bring me four?'],
      outro: ['Not one slipped through. Here, some shrimp for your hook.'],
    },
    {
      id: 'stall-open', by: 'hilde', title: 'The stall is open', goal: 'Sell $200 of fish',
      obj: { sell: 200 }, reward: { coins: 120 },
      intro: ['I am Hilde. My stall has been empty since the pier sagged.', 'Sell some fish at the market, and people will start coming back.'],
      outro: ['Look at that. A queue, on our little dock.'],
    },
    {
      id: 'captains-wall', by: 'tam', title: "A captain's wall", goal: 'Have 3 ports on your chart',
      hint: 'Ports sit in the coves of the bigger islands.', obj: { chart: 3, kind: 'port' }, reward: { coins: 200 },
      intro: ['When I am a captain, I will know every port on the coast.', 'Can you find three? I will draw them on my wall.'],
      outro: ['Three ports! My wall looks like a real chart now.', 'bram: It looks like a mess of crayon, Tam.'],
    },
    {
      id: 'flounder', by: 'hilde', title: 'Flounder for the stall', goal: 'Catch 3 Flounder',
      hint: 'Flounder lie in sandy shallows by day.', obj: { catch: 3, species: 'flounder' }, reward: { coins: 250 },
      intro: ['Old customers keep asking for flounder. Nell used to bring them in by the basket.', 'Can you catch me three?'],
      outro: ['Flat as a plate and fresh as morning. Just like hers.'],
    },
    {
      id: 'first-trophy', by: 'tam', title: 'A fish for the wall', goal: 'Catch a trophy fish',
      hint: 'Bait raises the trophy chance.', obj: { catch: 1, trophy: true }, reward: { coins: 500, bait: { glow: 2 } },
      intro: ['Real captains have a big fish on the wall. Catch a trophy and tell me how you did it.'],
      outro: ['It is bigger than me! One day I will catch one too.', 'hilde: You will, Tam. Now go home for supper.'],
    },
  ],
};
