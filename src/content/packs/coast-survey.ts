// The Coast Survey: a surveyor from the north mapping the coast, who pays for every place you chart.
// Opens once the main story has you charting lighthouses.
import type { Pack } from '../types';

export const coastSurvey: Pack = {
  id: 'coast-survey',
  name: 'The Coast Survey',
  unlock: { afterQuest: 4 },
  characters: [{ id: 'sena', name: 'Sena', role: 'Surveyor from the north' }],
  quests: [
    {
      id: 'four-lights', by: 'sena', title: 'Lights on the map', goal: 'Have 4 lighthouses on your chart',
      hint: 'Sail close to a lighthouse to chart it.', obj: { chart: 4, kind: 'light' }, reward: { coins: 200 },
      intro: ['I am drawing a new map of this whole coast, and I could use a sharp pair of eyes.', 'Chart four lighthouses and I will pay you for your trouble.'],
      outro: ['Four lights. My map is starting to look like a map.'],
    },
    {
      id: 'four-ports', by: 'sena', title: 'Harbours of the coast', goal: 'Have 4 ports on your chart',
      hint: 'Ports sit in the coves of the bigger islands.', obj: { chart: 4, kind: 'port' }, reward: { coins: 300 },
      intro: ['Next, the harbours. A map without its ports is no use to anyone.'],
      outro: ['Good. Sailors will thank us for this.'],
    },
    {
      id: 'three-wrecks', by: 'sena', title: 'Mark the wrecks', goal: 'Have 3 wrecks on your chart',
      hint: 'Wrecks lie in open water. Your chart shows them as crosses once found.', obj: { chart: 3, kind: 'wreck' }, reward: { coins: 300 },
      intro: ['Wrecks are dangers, but also stories. Find three and I will mark them.'],
      outro: ['Three wrecks. I wonder who sailed them.'],
    },
    {
      id: 'cold-water', by: 'sena', title: 'Where the water turns cold', goal: 'Catch a fish in the cold northern water',
      obj: { catch: 1, region: 'cold' }, reward: { coins: 400 },
      intro: ['My home is far north, where the water turns cold. Catch me something from there, for old times.'],
      outro: ['That smell takes me right back home. Thank you.'],
    },
    {
      id: 'eight-lights', by: 'sena', title: 'Every light on the coast', goal: 'Have 8 lighthouses on your chart',
      obj: { chart: 8, kind: 'light' }, reward: { coins: 600 },
      intro: ['One last push. Eight lighthouses, and my map is finished.'],
      outro: ['Done. The finest map of this coast ever drawn, and half of it is yours.'],
    },
  ],
};
