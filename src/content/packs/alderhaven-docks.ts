// Alderhaven Docks: a stub, being written.
import type { Pack } from '../types';

export const alderhavenDocks: Pack = {
  id: 'alderhaven-docks',
  name: 'Alderhaven Docks',
  unlock: { afterQuest: 3 },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
