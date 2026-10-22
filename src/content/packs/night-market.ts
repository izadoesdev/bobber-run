// The Night Market: a trader who sells only after dark, and her lamp boy, who need night fish for their stall.
// Opens once the main story has you fishing at night.
import type { Pack } from '../types';

export const nightMarket: Pack = {
  id: 'night-market',
  name: 'The Night Market',
  unlock: { afterQuest: 7 },
  characters: [
    { id: 'mira', name: 'Mira', role: 'Night market trader' },
    { id: 'jun', name: 'Jun', role: "Mira's lamp boy" },
  ],
  quests: [
    {
      id: 'night-four', by: 'mira', title: 'After dark', goal: 'Catch 4 fish at night',
      obj: { catch: 4, night: true }, reward: { coins: 150 },
      intro: ['My stall only opens after dark, and night fish sell best. Bring me four.'],
      outro: ['Fresh and still cold. My first customers will love these.'],
    },
    {
      id: 'herring', by: 'jun', title: 'Silver herring', goal: 'Catch 2 Herring',
      hint: 'Herring swim in open water at night.', obj: { catch: 2, species: 'herring' }, reward: { bait: { glow: 3 } },
      intro: ['Mira says herring shine under my lamp like coins. Can you catch two?'],
      outro: ['They do shine! Here, take some glow lures.'],
    },
    {
      id: 'squid', by: 'mira', title: 'Squid for the grill', goal: 'Catch a Squid',
      hint: 'Squid come up in deep water away from home, at night.', obj: { catch: 1, species: 'squid' }, reward: { coins: 300 },
      intro: ['Grilled squid is what brings the crowds. Find me one.'],
      outro: ['Now the whole market will smell of it. Perfect.'],
    },
    {
      id: 'busy-night', by: 'mira', title: 'A busy night', goal: 'Sell $1,500 of fish',
      obj: { sell: 1500 }, reward: { coins: 400 },
      intro: ['The market is growing. Sell plenty of fish and the coast will know us.'],
      outro: ['That was our best night yet.', 'jun: My lamp ran out of oil!'],
    },
    {
      id: 'lanternfish', by: 'jun', title: 'A light of my own', goal: 'Catch a Lanternfish',
      hint: 'Lanternfish glow in deep water at night.', obj: { catch: 1, species: 'lantern' }, reward: { coins: 700 },
      intro: ['If I had a Lanternfish, I would never need oil again. Please?'],
      outro: ['It glows brighter than my lamp ever did. Thank you!', 'mira: Look at him smile. You are welcome at our stall any night.'],
    },
  ],
};
