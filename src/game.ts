// Game state and rules: boats, physics/contacts, fishing, frenzies, ports (market, outfitter, shipyard,
// ferry), contracts, goals, day/night, saving. The pieces live in ./game/*; this entry keeps one import path.
export { G, hit } from './game/state';
export {
  boatDef, cap, hpMax, projDone, speedMul, sonarLvl, lampR, lightR, lineMax,
  fishValue, equipment, logged, canLand, catchNeed, deckLvl, deckBoat, DAYLEN, dayFrac, dayNum, darkness, isNight, windAngle, sailEfficiency, toWorld,
  gearLvl, atClock,
} from './game/rules';
export { toast, spawn } from './game/feedback';
export { saveGame, hasSave, savedVoyage, savedSpot, placeAtPort, newGame, loadGame, wipeSave } from './game/save';
export { refreshSolids, physicsStep } from './game/physics';
export { TUNE, castTargets, tryCast } from './game/fishing';
export { schoolActive } from './game/schools';
export {
  priceAt, portTabs, portItems, leavePort, setTab, portMenuInput, buyFishChart, fishChartPrice, chartable, dockGrade, dock, nearestYard,
} from './game/port';
export type { PortTab } from './game/port';
export { update, updateCamera, shipInput, smallFry, releaseSmallFry, toggleHelper, SMALL_FRY } from './game/sailing';
