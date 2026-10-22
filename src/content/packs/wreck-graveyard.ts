// The Wreck Graveyard: where the currents bring old hulls to rest, past the kelp forest. A salvager who knows them all
// by name, and the eels that live in them. Opens in the kelp forest.
import type { Pack } from '../types';

export const wreckGraveyard: Pack = {
  id: 'wreck-graveyard',
  name: 'The Wreck Graveyard',
  unlock: { region: 'kelp', afterQuest: 6 },
  characters: [
    { id: 'vey', name: 'Captain Vey', role: 'Salvager who knows every wreck' },
  ],
  quests: [
    {
      id: 'graveyard', by: 'vey', title: 'Where ships rest', goal: 'Sail to the Wreck Graveyard',
      hint: 'It lies in the shallows past the kelp forest.', obj: { site: 'legend-wreckGraveyard', place: 'the Wreck Graveyard' }, reward: { coins: 600 },
      intro: ['The currents out past the kelp carry old ships to one place.', 'Sailors call it the graveyard. Go and see it. Mind your hull.'],
      outro: ['You found it and kept your boat. Most do not manage both.'],
    },
    {
      id: 'wreck-list', by: 'vey', title: 'The list', goal: 'Have 6 wrecks on your chart',
      hint: 'Sail close to a wreck to chart it.', obj: { chart: 6, kind: 'wreck' }, reward: { coins: 800, bait: { chum: 3 } },
      intro: ['I keep a list of every wreck on this coast. Help me fill it.', 'Chart six. I will tell you which ships they were.'],
      outro: ['Six. That one was the Merry Gull. That one, the Sour Plum. Fine ships, once.'],
    },
    {
      id: 'wreck-eel', by: 'vey', title: 'Who lives there now', goal: 'Catch a Moray Eel',
      hint: 'Morays live inside sunken wrecks. Fish right next to one.', obj: { catch: 1, species: 'moray' }, reward: { coins: 1200 },
      intro: ['The wrecks are not empty. Eels live in them now.', 'Catch me a moray. I want to know who has my old cabin.'],
      outro: ['Look at those teeth. Fine. It can keep the cabin.'],
    },
  ],
};
