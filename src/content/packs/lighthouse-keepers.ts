// The Lighthouse Keepers: an old keeper whose tower went dark the night Nell left, and the boy she is teaching.
// Opens once the main story has you charting lighthouses. (Night fish drawn to a lamp, the Beaconfish under the
// towers, a storm watch and a Moonfish, with one chart quest; the Coast Survey does the rest of the charting.)
import type { Pack } from '../types';

export const lighthouseKeepers: Pack = {
  id: 'lighthouse-keepers',
  name: 'The Lighthouse Keepers',
  unlock: { afterQuest: 5 },
  characters: [
    { id: 'agnes', name: 'Agnes', role: 'Old lighthouse keeper' },
    { id: 'finn', name: 'Finn', role: "Agnes's apprentice" },
  ],
  quests: [
    {
      id: 'window-lamp', by: 'agnes', title: 'A lamp in the window', goal: 'Catch 2 Blue Crabs',
      hint: 'Blue Crabs come into the shallows at night.', obj: { catch: 2, species: 'crab' }, reward: { coins: 200 },
      intro: ['My tower has been dark since the night Nell left. I still keep a little lamp in the window.', 'At night the crabs climb the rocks toward it. Catch me two for supper?'],
      outro: ['Still kicking. Finn, put the pot on.', 'finn: Again? We had crab yesterday.'],
    },
    {
      id: 'letters', by: 'finn', title: 'Letters to the keepers', goal: 'Have 6 lighthouses on your chart',
      hint: 'Sail close to a lighthouse to chart it.', obj: { chart: 6, kind: 'light' }, reward: { coins: 500 },
      intro: ['Agnes writes letters to the other keepers every week. She never knows which towers still have someone in them.', 'If you chart six, I can at least send them to the right rocks.'],
      outro: ['Six towers. Agnes has already started writing.'],
    },
    {
      id: 'beaconfish', by: 'finn', title: 'Oil for the lamps', goal: 'Catch 2 Beaconfish',
      hint: 'They bite below lighthouses at night, with a level 3 rod.', obj: { catch: 2, species: 'beacon' }, reward: { coins: 900, bait: { glow: 3 } },
      intro: ['The lamps burn Beaconfish oil. They gather under the towers at night, like moths.', 'Agnes wants a store of it, just in case. Will you catch two?'],
      outro: ['They glow even in the bucket! Take these glow lures. Agnes says you earned them.'],
    },
    {
      id: 'storm-watch', by: 'agnes', title: 'The storm watch', goal: 'Catch 2 fish at night in a storm',
      hint: 'Storms come and go. An anchor stops the wind pushing you while you fish.', obj: { catch: 2, night: true, weather: 'storm' }, reward: { coins: 1100 },
      intro: ['Forty years ago, a storm came in the dark and my lamp brought thirty boats home.', 'A keeper should know what it is like out there. Fish through a stormy night for me.'],
      outro: ['Soaked through, but you stayed out. That is all a keeper asks.', 'finn: I would have rowed home after the first wave.'],
    },
    {
      id: 'moonfish', by: 'agnes', title: 'The moon on the water', goal: 'Catch a trophy Moonfish',
      hint: 'Moonfish swim in the open ocean at night, with a level 4 rod. Glow lures raise the trophy chance.', obj: { catch: 1, species: 'opah', trophy: true }, reward: { coins: 1500 },
      intro: ['Keepers say a Moonfish is the moon\'s own lamp, dropped into the sea.', 'My eyes are getting old. I would like to see a big one before I hand Finn the keys.'],
      outro: ['Round and bright as a lamp. Now I can rest.', 'finn: The keys are mine? I will keep the light, Agnes. I promise.'],
    },
  ],
};
