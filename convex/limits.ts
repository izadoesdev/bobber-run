// Server-side sanity limits. MAX_KG is generous (about 2.2x each species' largest normal weight,
// covering trophies) and catches above it are ignored. Generated from src/econ.js SPECIES.
export const MAX_KG: Record<string, number> = {"anchovy":1,"sardine":1,"mullet":7,"flounder":5,"mackerel":4,"herring":2,"crab":2,"squid":5,"rtrout":9,"cod":18,"duskfin":5,"lantern":2,"stormeel":44,"tuna":550,"opah":132,"marlin":881,"swordfish":771,"perch":3,"bass":9,"halibut":56,"salmon":27,"char":14,"pollock":22,"wolffish":40,"monkfish":88,"puffer":5,"parrot":14,"angel":3,"barracuda":44,"mahi":56,"sailfish":199,"moray":33,"grouper":132,"beacon":7,"ghost":66,"oarfish":550,"crystal":66,"goldmahi":88,"oldone":1981};
export const LEGENDS: Record<string, string> = { ghost: 'the Ghost Carp', oarfish: 'an Oarfish', crystal: 'a Crystal Squid', goldmahi: 'a Golden Mahi', oldone: 'the Old One' };
export const SEA_CAP = 30;              // sailors per sea; more players open more seas so nobody is crowded
export const SEAS = 64;
export const MOVE_MIN_MS = 450;         // ignore position writes faster than this
export const NAME_MIN_MS = 30_000;      // one name change every 30 s
export const EMOTE_MIN_MS = 1_500;
export const CATCH_MIN_MS = 2_500;     // record submissions closer together than this are ignored
export const FUND_DAILY = 50_000;       // most a player can give in a day
