// The Warm Current: a stub, being written.
import type { Pack } from '../types';

export const warmCurrent: Pack = {
  id: 'warm-current',
  name: 'The Warm Current',
  unlock: { region: 'warm' },
  characters: [{ id: 'host', name: 'Host', role: 'Stub' }],
  quests: [{ id: 'stub', by: 'host', title: 'Stub', goal: 'Catch a fish', obj: { catch: 1 }, reward: { coins: 10 }, intro: ['Stub.'], outro: [] }],
};
