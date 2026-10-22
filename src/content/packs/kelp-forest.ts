// The Kelp Forest: a diver who lost her gran's necklace in the kelp, and the old kelp cutter who knows these waters.
// Opens the first time you sail into the kelp. Five quests, from the rockfish in the shallows to the giant sea bass
// that only comes up at night.
import type { Pack } from '../types';

export const kelpForest: Pack = {
  id: 'kelp-forest',
  name: 'The Kelp Forest',
  unlock: { region: 'kelp' },
  characters: [
    { id: 'mari', name: 'Mari', role: 'Diver of the kelp forest' },
    { id: 'gus', name: 'Gus', role: 'Kelp cutter' },
  ],
  quests: [
    {
      id: 'under-the-kelp', by: 'mari', title: 'Under the kelp', goal: 'Catch 3 fish in the kelp forest',
      obj: { catch: 3, region: 'kelp' }, reward: { coins: 150 },
      intro: ["Hello up there! I lost my gran's necklace in this kelp. A little silver shell on a chain.", 'Fish here for a while? Tell me if you see anything shine.'],
      outro: ['No shine yet. But thank you for looking.', 'gus: Mari never gives up. I am Gus. I cut the kelp around here.'],
    },
    {
      id: 'nibblers', by: 'gus', title: 'Nibblers', goal: 'Catch 2 Opaleye',
      hint: 'Opaleye feed in the kelp shallows by day.', obj: { catch: 2, species: 'opaleye' }, reward: { coins: 250, bait: { shrimp: 5 } },
      intro: ['Opaleye nibble my kelp bare every morning.', 'Catch two and I will give you some shrimp for your trouble.'],
      outro: ['Two less nibblers. Here, the shrimp is yours.'],
    },
    {
      id: 'big-bass', by: 'mari', title: 'Something shiny', goal: 'Catch a trophy Kelp Bass',
      hint: 'Kelp Bass bite by day. Bait raises the trophy chance.', obj: { catch: 1, species: 'kelpbass', trophy: true }, reward: { coins: 450 },
      intro: ['Big kelp bass grab at anything that shines.', 'If one took my shell, it was a big one. Can you catch me a trophy?'],
      outro: ['No shell. Just a very fine fish.', 'gus: That one goes on my wall, then.'],
    },
    {
      id: 'old-wrecks', by: 'gus', title: 'Old wrecks', goal: 'Have 4 wrecks on your chart',
      hint: 'Wrecks lie in open water. Your chart shows them as crosses once found.', obj: { chart: 4, kind: 'wreck' }, reward: { coins: 700 },
      intro: ['Mari thinks the tide took her shell to a wreck. Lost things end up there.', 'Mark four wrecks on your chart, and she can dive them.'],
      outro: ['mari: I dove them all. Old spoons, old coins, no shell.', 'Hm. I have seen the old giant bass at night with something shining by its fin.'],
    },
    {
      id: 'old-giant', by: 'mari', title: 'The old giant', goal: 'Catch a Giant Sea Bass at night',
      hint: 'Giant Sea Bass rise in the kelp at night. Only a Trawler or bigger can land one.', obj: { catch: 1, species: 'seabassgiant', night: true }, reward: { coins: 1500, bait: { glow: 3 } },
      intro: ['Gus says the old giant has something caught on its fin.', 'It only comes up after dark. Will you bring it in for me?'],
      outro: ["My shell! It was tangled on the fin all this time. Gran's necklace is home.", 'gus: Well fished. The kelp forest owes you one.'],
    },
  ],
};
