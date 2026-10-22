// The Northern Ice: a stub, being written.
import type { Pack } from '../types';

export const northernIce: Pack = {
  id: 'northern-ice',
  name: 'The Northern Ice',
  unlock: { region: 'cold' },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
