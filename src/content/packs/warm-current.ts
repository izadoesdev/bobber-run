// The Warm Current: a fruit trader who sails the southern seas with her parrot, and an old fisherman who bets her
// those waters aren't worth the trip. Opens the first time you sail into the warm south. (Puffers in the shallows,
// duskfin at twilight, and a trophy mahi-mahi to settle the bet.)
import type { Pack } from '../types';

export const warmCurrent: Pack = {
  id: 'warm-current',
  name: 'The Warm Current',
  unlock: { region: 'warm' },
  characters: [
    { id: 'ines', name: 'Ines', role: 'Fruit trader on the warm current' },
    { id: 'pip', name: 'Pip', role: "Ines's parrot" },
    { id: 'kofi', name: 'Kofi', role: 'An old fisherman of the south' },
  ],
  quests: [
    {
      id: 'worth-the-trip', by: 'ines', title: 'Worth the trip', goal: 'Catch 4 fish in the southern seas',
      obj: { catch: 4, region: 'warm' }, reward: { coins: 150 },
      intro: ['Hello there! I am Ines. I sail the warm current with a hold full of fruit, and Pip.', 'Catch a few fish here. You will see why I come.'],
      outro: ['See? Warm water, full nets. Someone told me the south was fished out.', 'pip: Fished out! Fished out!'],
    },
    {
      id: 'puff', by: 'pip', title: 'Puff! Puff!', goal: 'Catch 2 Pufferfish',
      hint: 'They live in the warm shallows, day or night.', obj: { catch: 2, species: 'puffer' }, reward: { coins: 200, bait: { shrimp: 5 } },
      intro: ['Puff! Puff!', 'ines: He wants to see a pufferfish. Bring two? Take some shrimp bait after.'],
      outro: ['Puff! Puff! Puff!', 'ines: He will talk about this for weeks.'],
    },
    {
      id: 'kofi-bet', by: 'kofi', title: "Kofi's bet", goal: 'Sell 600 coins of fish',
      hint: 'Any market will do.', obj: { sell: 600 }, reward: { coins: 400 },
      intro: ['So you are the one helping Ines. I am Kofi. I say these waters are not worth the sail.', 'Sell six hundred coins of fish, and I will say I was wrong.'],
      outro: ['Hm. Not bad. But the best fish come at dusk, and you have not seen them.'],
    },
    {
      id: 'dusk-run', by: 'kofi', title: 'Between day and night', goal: 'Catch a Duskfin in the southern seas',
      hint: 'Duskfin only bite at dusk and dawn, in open water.', obj: { catch: 1, species: 'duskfin', region: 'warm' }, reward: { coins: 700, bait: { glow: 3 } },
      intro: ['My brother and I fished for duskfin here every evening. Then he moved north.', 'Catch one for me? I have not seen one in years.'],
      outro: ['Just how I remember them. Thank you.', 'ines: You could sail with us, Kofi. We have room.'],
    },
    {
      id: 'big-mahi', by: 'ines', title: 'The big one', goal: 'Catch a trophy Mahi-mahi',
      hint: 'Mahi-mahi run in warm open water by day. Bait raises the trophy chance.', obj: { catch: 1, species: 'mahi', trophy: true }, reward: { coins: 1500 },
      intro: ['Kofi says he will join us if we land a big mahi-mahi.', 'One last catch, then. Make it a trophy.'],
      outro: ['Look at those colours! Now Kofi has to keep his word.', 'kofi: All right, all right. I am coming with you.'],
    },
  ],
};
