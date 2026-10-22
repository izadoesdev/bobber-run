// The Mangroves: a stub, being written.
import type { Pack } from '../types';

export const mangroves: Pack = {
  id: 'mangroves',
  name: 'The Mangroves',
  unlock: { region: 'mangrove' },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
