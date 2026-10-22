// Nell's Other Voyages: a stub, being written.
import type { Pack } from '../types';
import { QUESTS } from '../../story';

export const nellVoyages: Pack = {
  id: 'nell-voyages',
  name: "Nell's Other Voyages",
  unlock: { afterQuest: QUESTS.length },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
