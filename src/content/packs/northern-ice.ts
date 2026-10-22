// The Northern Ice: a stubborn old trawler skipper who says the north is fished out, and the grandson who disagrees.
// Opens the first time you sail into the cold north. Five quests, from the polar cod under the floes to the monkfish
// that bites only in the dark.
import type { Pack } from '../types';

export const northernIce: Pack = {
  id: 'northern-ice',
  name: 'The Northern Ice',
  unlock: { region: 'cold' },
  characters: [
    { id: 'hilde', name: 'Hilde', role: 'Skipper of an old trawler' },
    { id: 'nils', name: 'Nils', role: "Hilde's grandson" },
  ],
  quests: [
    {
      id: 'still-fish', by: 'nils', title: 'Still fish here', goal: 'Catch 4 fish in the cold north',
      obj: { catch: 4, region: 'cold' }, reward: { coins: 150 },
      intro: ['Gran says there are no fish left up north. She wants to sell the boat.', 'I think she is wrong. Catch four here and help me prove it?'],
      outro: ['Four! See, Gran?', 'hilde: Hmph. Luck. Anyone can catch polar cod.'],
    },
    {
      id: 'real-fish', by: 'hilde', title: 'Real fish', goal: 'Catch 3 Arctic Char',
      hint: 'Arctic Char keep to the cold northern shallows.', obj: { catch: 3, species: 'char' }, reward: { coins: 250, bait: { shrimp: 5 } },
      intro: ['Fine. Bring me three Arctic Char. Real fish, not luck.', 'Here is some shrimp. Do not waste it.'],
      outro: ['...They are good char. Fine.', 'nils: She is smiling. She never smiles.'],
    },
    {
      id: 'old-record', by: 'nils', title: "Gran's record", goal: 'Catch a trophy Wolffish',
      hint: 'Wolffish live in cold deep water. Bait raises the trophy chance.', obj: { catch: 1, species: 'wolffish', trophy: true }, reward: { coins: 450 },
      intro: ['Gran once landed the biggest wolffish in the north. She still talks about it.', 'Catch a trophy one. Let us see her face.'],
      outro: ['hilde: That is bigger than mine.', 'hilde: Do not tell anyone.'],
    },
    {
      id: 'new-nets', by: 'hilde', title: 'New nets', goal: 'Sell 500 coins of fish',
      hint: 'Any market will do.', obj: { sell: 500 }, reward: { coins: 700 },
      intro: ['All right. The fish are here. The nets are not. They are full of holes.', 'Sell 500 coins of fish and I will buy new ones. Then we talk.'],
      outro: ['New nets. Now, the truth. The fish were never the trouble.', 'My eyes are poor after dark now. That is why I wanted to sell.'],
    },
    {
      id: 'night-eyes', by: 'nils', title: 'Eyes in the dark', goal: 'Catch a Monkfish at night',
      hint: 'Monkfish only bite at night, in cold deep water.', obj: { catch: 1, species: 'monkfish', night: true }, reward: { coins: 1500, bait: { glow: 3 } },
      intro: ['Gran can not see at night, but I can. Monkfish only bite after dark.', 'Catch one while I watch the water. Then she will know I can be her eyes.'],
      outro: ['hilde: A monkfish, in the dark. All right, Nils. You steer at night, I steer by day.', 'We keep the boat!'],
    },
    {
      id: 'show-the-boat', by: 'nils', title: 'Show the boat', goal: 'Sail to the cold village',
      hint: 'The village is on an island in the cold north.', obj: { site: 'cold-village', place: 'the cold village' }, reward: { coins: 500, bait: { glow: 3 } },
      intro: ['Gran wants the whole village to see the boat.', 'Lead the way. I will be right behind you.'],
      outro: ['hilde: There. Everyone saw it.', 'Gran is smiling. She never smiles.'],
    },
  ],
};
