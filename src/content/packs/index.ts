// Every content pack in the game. Add a pack by writing it in its own file here and listing it below;
// tests/content.test.ts checks it (ids, characters, species, regions, rewards).
import type { Pack } from '../types';
import { emberIsles } from './ember-isles';
import { coastSurvey } from './coast-survey';
import { stormSeason } from './storm-season';
import { nightMarket } from './night-market';
import { alderhavenDocks } from './alderhaven-docks';
import { coralReach } from './coral-reach';
import { warmCurrent } from './warm-current';
import { kelpForest } from './kelp-forest';
import { mangroves } from './mangroves';
import { northernIce } from './northern-ice';
import { lighthouseKeepers } from './lighthouse-keepers';
import { nellVoyages } from './nell-voyages';
import { rival } from './rival';

export const PACKS: Pack[] = [emberIsles, coastSurvey, stormSeason, nightMarket, alderhavenDocks, coralReach, warmCurrent, kelpForest, mangroves, northernIce, lighthouseKeepers, nellVoyages, rival];
