// The Rival: Sloane Kettle, who has held Alderhaven's record board for eleven years, and Wendell Hatch, who keeps it. Opens
// once the story is under way. Every quest is a feat of fishing rather than a place or a species: a perfect strike,
// three in a row, a big fish on a rod with nothing to spare, a three-star fight in a storm, and her own record.
import type { Pack } from '../types';

export const rival: Pack = {
  id: 'rival',
  name: 'The Rival',
  unlock: { afterQuest: 6 },
  characters: [
    { id: 'sloane', name: 'Sloane Kettle', role: "Alderhaven's record holder" },
    { id: 'wendell', name: 'Wendell Hatch', role: 'Keeper of the record board' },
  ],
  quests: [
    {
      id: 'clean-strike', by: 'sloane', title: 'A clean strike', goal: 'Land a fish you struck perfectly',
      hint: 'Strike the moment the bobber goes under with a thump, not on a nibble.', obj: { catch: 1, perfect: true }, reward: { coins: 150 },
      intro: ['So you are the new boat everyone is talking about. Anyone can drag a fish in.', 'Strike one clean, the instant it takes. Then we will talk.'],
      outro: ['Hm. Not bad. Not bad at all.'],
    },
    {
      id: 'three-clean', by: 'sloane', title: 'Three in a row', goal: 'Land three fish in a row, each struck perfectly',
      hint: 'A missed strike or a sloppy one starts the count again.', obj: { catch: 3, perfect: true, inARow: true }, reward: { coins: 250, bait: { glow: 3 } },
      intro: ['Once is luck. Do it three times running and I will believe it.'],
      outro: ['Three. Fine. You have hands.', 'wendell: She does not say that to many people.'],
    },
    {
      id: 'light-tackle', by: 'sloane', title: 'Nothing to spare', goal: 'Land a fish of 10 kg or more on a rod with no strength to spare',
      hint: 'Fish the biggest species your rod can just about land. The fight is long; let it run when the rod creaks.', obj: { catch: 1, kg: 10, lightRod: true }, reward: { coins: 600 },
      intro: ['Big rods make big fish easy. Real anglers fish light.', 'Land me something over ten kilos on the lightest rod that can hold it.'],
      outro: ['Ten kilos on that? I did not think you would get it in.'],
    },
    {
      id: 'storm-fight', by: 'wendell', title: 'Weather for it', goal: 'Land a three-star fish in a storm',
      hint: 'Storms bring trophies, and harder fights. Keep the line out of the red.', obj: { catch: 1, stars: 3, weather: 'storm' }, reward: { coins: 800 },
      intro: ['Sloane made her name in the storm of the year the pier washed out.', 'If you want her attention, do what she did: a fish of three stars, landed in a storm.'],
      outro: ['In that weather! I will write it on the board.', 'sloane: Write it small.'],
    },
    {
      id: 'the-record', by: 'sloane', title: 'The record', goal: 'Land a trophy Bluefin Tuna',
      hint: 'Bluefin run in the open ocean, and you will need a big deck under sail to land one.', obj: { catch: 1, species: 'tuna', trophy: true }, reward: { coins: 2000 },
      intro: ['My record is a bluefin. Two hundred kilos, eleven years on that board.', 'Land a trophy bluefin and the board is yours. I will even shake your hand.'],
      outro: ['wendell: A new name on the board, after eleven years.', 'Well. Here is my hand. Next season I am taking it back.'],
    },
  ],
};
