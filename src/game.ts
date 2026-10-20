// Game state and rules: boats, physics/contacts, fishing, frenzies, ports (market, outfitter, shipyard,
// ferry), contracts, goals, day/night, saving. The pieces live in ./game/*; this entry keeps one import path.
export { G, inp, hit } from './game/state';
export {
  boatDef, cap, hpMax, crewLvl, keelLvl, harpoonLvl, projDone, speedMul, sonarLvl, lightR, netLvl, lineMax, contractSlots,
  fishValue, env, equipment, logged, canLand, catchNeed, deckLvl, deckBoat, DAYLEN, dayFrac, dayNum, darkness, isNight, windAngle, sailEfficiency, boatSpeed, toWorld,
  type Equipment,
} from './game/rules';
export { caption, toast, spawn } from './game/feedback';
export { saveGame, hasSave, savedVoyage, placeAtPort, newGame, loadGame, wipeSave } from './game/save';
export { refreshSolids, physicsStep, sink } from './game/physics';
export { schoolActive, cancelFishing, TUNE, idleOk, bonusFromDeckhand } from './game/fishing';
export {
  priceAt, saleValue, buySupply, have, ferryCost, needStatus, nextProject, fleetTotal, portTabs, portItems, rest, leavePort,
  selectable, setTab, portMenuInput, type PortTab,
} from './game/port';
export { petCat, update, updateCamera, shipInput } from './game/sailing';
