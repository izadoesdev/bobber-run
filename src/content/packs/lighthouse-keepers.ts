// The Lighthouse Keepers: a stub, being written.
import type { Pack } from '../types';

export const lighthouseKeepers: Pack = {
  id: 'lighthouse-keepers',
  name: 'The Lighthouse Keepers',
  unlock: { afterQuest: 5 },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
