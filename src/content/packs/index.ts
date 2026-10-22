// Every content pack in the game. Add a pack by writing it in its own file here and listing it below;
// tests/content.test.ts checks it (ids, characters, species, regions, rewards).
import type { Pack } from '../types';
import { emberIsles } from './ember-isles';
import { coastSurvey } from './coast-survey';
import { stormSeason } from './storm-season';
import { nightMarket } from './night-market';

export const PACKS: Pack[] = [emberIsles, coastSurvey, stormSeason, nightMarket];
