// The Sunken Temple: stone steps under the warm shallows far south-west, with a bell that rings when the sea moves.
// A diver asks you to find it, then to fish it the old way: one clean strike at a time. Opens in the coral reach.
import type { Pack } from '../types';

export const sunkenTemple: Pack = {
  id: 'sunken-temple',
  name: 'The Sunken Temple',
  unlock: { region: 'reef', afterQuest: 7 },
  characters: [
    { id: 'ama', name: 'Ama', role: 'A diver who looks for old places' },
  ],
  quests: [
    {
      id: 'find-temple', by: 'ama', title: 'Steps under the sea', goal: 'Sail to the Sunken Temple',
      hint: 'It lies in shallow water, far past the coral reach.', obj: { site: 'legend-sunkenTemple', place: 'the Sunken Temple' }, reward: { coins: 600 },
      intro: ['Somewhere past the reef there are stone steps under the water. A temple.', 'I have looked for years. Will you sail out and look with me?'],
      outro: ['There! The steps go down and down. We found it.'],
    },
    {
      id: 'temple-keeper', by: 'ama', title: 'The keeper', goal: 'Catch a Reef Octopus',
      hint: 'Octopus come out in the coral shallows at night.', obj: { catch: 1, species: 'octopus' }, reward: { coins: 900, bait: { shrimp: 5 } },
      intro: ['Something lives in the temple door. Eight arms, and it does not like me.', 'Catch an octopus so I can see what we are dealing with.'],
      outro: ['So that is the keeper. Clever thing. I will bring it a crab next time.'],
    },
    {
      id: 'temple-bell', by: 'ama', title: 'The old way', goal: 'Land 3 fish after a perfect strike',
      hint: 'Strike while the sweep crosses the bright wedge on the dial.', obj: { catch: 3, perfect: true }, reward: { coins: 1500 },
      intro: ['The carvings show fishers with one hand up, striking at the right moment.', 'Land three fish with a perfect strike. That is how they fished here.'],
      outro: ['Did you hear that? The bell rang under the water.', 'I think the temple liked it. I know I did.'],
    },
  ],
};
