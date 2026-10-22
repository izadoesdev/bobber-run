// The Coral Reach: the reef warden who counts its fish each year, and her young nephew, who is sure a shark has
// scared them all away. Opens the first time you sail into the coral shallows. (Clownfish and tang by day,
// lionfish at night, and a reef shark off the edge for a Trawler.)
import type { Pack } from '../types';

export const coralReach: Pack = {
  id: 'coral-reach',
  name: 'The Coral Reach',
  unlock: { region: 'reef' },
  characters: [
    { id: 'mara', name: 'Mara', role: 'Warden of the coral reach' },
    { id: 'tib', name: 'Tib', role: "Mara's nephew, who wants to dive" },
  ],
  quests: [
    {
      id: 'yearly-count', by: 'mara', title: 'The yearly count', goal: 'Catch 4 fish in the coral shallows',
      obj: { catch: 4, region: 'reef' }, reward: { coins: 150 },
      intro: ['Welcome to the coral reach. I am Mara, and I look after the reef.', 'Each year I count its fish. Catch four for me?'],
      outro: ['Four, and all healthy. But the count is low this year.', 'tib: I know why. Something big is out there!'],
    },
    {
      id: 'market-day', by: 'tib', title: 'Market day', goal: 'Sell 400 coins of fish',
      hint: 'Any market will do.', obj: { sell: 400 }, reward: { coins: 300, bait: { shrimp: 5 } },
      intro: ['Mara says I can dive past the shallows when I have a proper mask.', 'Sell some fish at market for me? I will pay you back in bait.'],
      outro: ['Enough for a mask! Here, shrimp bait, like I said.'],
    },
    {
      id: 'big-clown', by: 'mara', title: 'One for the book', goal: 'Catch a trophy Clownfish',
      hint: 'Clownfish bite by day. Shrimp bait raises the trophy chance.', obj: { catch: 1, species: 'clown', trophy: true }, reward: { coins: 450 },
      intro: ['The count needs one big clownfish, measured and written down.', 'Small ones are easy. Find me a trophy.'],
      outro: ['A fine one. Into the book it goes.', 'tib: Told you. The big fish are all gone except this one.'],
    },
    {
      id: 'night-reef', by: 'tib', title: 'Lights in the coral', goal: 'Catch a Lionfish at night',
      hint: 'Lionfish only come out after dark.', obj: { catch: 1, species: 'lionfish', night: true }, reward: { coins: 800 },
      intro: ['Mara never counts at night. I want to see what hides in there.', 'Catch me a lionfish after dark? Mind the spines.'],
      outro: ['The reef is full at night! The fish were never gone.', 'mara: They hide by day. Something out there makes them shy.'],
    },
    {
      id: 'reef-shark', by: 'mara', title: 'The shark at the edge', goal: 'Catch a Reef Shark',
      hint: 'They keep to the deeper water off the coral. You will need a Trawler or bigger.', obj: { catch: 1, species: 'reefshark' }, reward: { coins: 1500 },
      intro: ['Tib was right about one thing. A reef shark patrols the edge.', 'Land it, so I can see how big it has grown.'],
      outro: ['What a fish. A reef with sharks is a healthy reef. The count is good.', 'tib: So the count is good? Really?'],
    },
    {
      id: 'reef-feast', by: 'tib', title: 'A feast for the count', goal: 'Sail to the reef village',
      hint: 'Its jetty is on the coral island nearest home.', obj: { site: 'reef-village', place: 'the reef village' }, reward: { coins: 400, bait: { shrimp: 5 } },
      intro: ['The count is good, so the village is having a feast tonight.', 'Sail over to our village. Mara saved you a seat.'],
      outro: ['You came! Sit down, the fish is nearly ready.', 'mara: Thank you for this year. Come back for the next count.'],
    },
  ],
};
