// The Coral Reach: a stub, being written.
import type { Pack } from '../types';

export const coralReach: Pack = {
  id: 'coral-reach',
  name: 'The Coral Reach',
  unlock: { region: 'reef' },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
