// The Mangroves: the old ferryman of the channels and Wren, a shy kid who collects crab shells and never speaks.
// Opens the first time you sail into the mangroves. Five quests, from the snapper in the roots to the tarpon that
// rolls in the deep channels.
import type { Pack } from '../types';

export const mangroves: Pack = {
  id: 'mangroves',
  name: 'The Mangroves',
  unlock: { region: 'mangrove' },
  characters: [
    { id: 'joss', name: 'Joss', role: 'Ferryman of the mangroves' },
    { id: 'wren', name: 'Wren', role: 'A shy crab collector' },
  ],
  quests: [
    {
      id: 'among-the-roots', by: 'joss', title: 'Among the roots', goal: 'Catch 4 fish in the mangroves',
      obj: { catch: 4, region: 'mangrove' }, reward: { coins: 150 },
      intro: ['Ahoy! I am Joss. I row folk through these channels, rain or shine.', 'Fish among the roots a while. The snapper here are friendly.'],
      outro: ['Good hands. See the kid on the bank? That is Wren. Very shy.', 'wren: Hi. Sorry. Bye.'],
    },
    {
      id: 'mud-crabs', by: 'joss', title: 'A note from Wren', goal: 'Catch 2 Mud Crabs at night',
      hint: 'Mud Crabs come out on the mangrove mud after dark.', obj: { catch: 2, species: 'mudcrab', night: true }, reward: { coins: 250, bait: { glow: 3 } },
      intro: ['Wren left a note on my oar. It says: "Please ask the boat for two mud crabs."', 'They only come out at night. Take some glow lures.'],
      outro: ['wren: Thank you. Their shells are perfect.', 'Two whole words more than I ever got!'],
    },
    {
      id: 'painted-snook', by: 'joss', title: 'The painted snook', goal: 'Catch a trophy Snook',
      hint: 'Snook live in the mangrove channels. Bait raises the trophy chance.', obj: { catch: 1, species: 'snook', trophy: true }, reward: { coins: 450 },
      intro: ['Every ferry here has a big snook painted on the side. Mine has faded away.', 'Bring me a trophy snook to paint from?'],
      outro: ['What a fish. Now who can paint it?', 'wren: Me. I can. I am good at painting.'],
    },
    {
      id: 'ferry-map', by: 'joss', title: 'A map for the ferry', goal: 'Have 5 ports on your chart',
      hint: 'Ports sit in the coves of the bigger islands.', obj: { chart: 5, kind: 'port' }, reward: { coins: 700 },
      intro: ['Wren wants to paint a map inside the ferry, with real ports on it.', 'Chart five ports and Wren can copy them.'],
      outro: ['A fine map. I will miss looking at it.', 'These old arms have one more season of rowing. Then the ferry stops.'],
    },
    {
      id: 'tarpon', by: 'wren', title: 'Ferry luck', goal: 'Catch a Tarpon',
      hint: 'Tarpon roll in the deeper channels off the mangroves. Only a Trawler or bigger can land one.', obj: { catch: 1, species: 'tarpon' }, reward: { coins: 1500 },
      intro: ['The ferry can not stop. Joss says a new ferry hand must bring in a tarpon first.', 'I am too small. Will you catch one for me? Then I will ask him. Out loud.'],
      outro: ['joss: Wren, you want the ferry? With the snook and the map and all?', 'Yes. And you can ride for free.'],
    },
  ],
};
