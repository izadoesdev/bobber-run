// Server-side sanity limits. MAX_KG is generous (about 2.2x each species' largest normal weight,
// covering trophies) and catches above it are ignored. Generated from src/econ.js SPECIES.
export const MAX_KG: Record<string, number> = {"anchovy":1,"sardine":1,"mullet":7,"flounder":5,"mackerel":4,"herring":2,"crab":2,"squid":5,"rtrout":9,"cod":18,"duskfin":5,"lantern":2,"stormeel":44,"tuna":550,"opah":132,"marlin":881,"swordfish":771,"perch":3,"bass":9,"halibut":56,"salmon":27,"char":14,"pollock":22,"wolffish":40,"monkfish":88,"puffer":5,"parrot":14,"angel":3,"barracuda":44,"mahi":56,"sailfish":199,"moray":33,"grouper":132,"beacon":7,"ghost":66,"oarfish":550,"crystal":66,"goldmahi":88,"oldone":1981,"manta":2860,"goliath":792,"gsquid":605,"sunfish":2200};
/** Display names for news items, generated from src/species.ts. */
export const SPECIES_NAMES: Record<string, string> = {"anchovy":"Anchovy","sardine":"Sardine","mullet":"Mullet","flounder":"Flounder","mackerel":"Mackerel","herring":"Herring","crab":"Blue Crab","squid":"Squid","rtrout":"Rain Trout","cod":"Cod","duskfin":"Duskfin","lantern":"Lanternfish","stormeel":"Thunder Eel","tuna":"Bluefin Tuna","opah":"Moonfish","marlin":"Marlin","swordfish":"Swordfish","perch":"Perch","bass":"Sea Bass","halibut":"Halibut","salmon":"Salmon","char":"Arctic Char","pollock":"Pollock","wolffish":"Wolffish","monkfish":"Monkfish","puffer":"Pufferfish","parrot":"Parrotfish","angel":"Angelfish","barracuda":"Barracuda","mahi":"Mahi-mahi","sailfish":"Sailfish","moray":"Moray Eel","grouper":"Grouper","beacon":"Beaconfish","ghost":"Ghost Carp","oarfish":"Oarfish","crystal":"Crystal Squid","goldmahi":"Golden Mahi","oldone":"The Old One","manta":"Manta Ray","goliath":"Goliath Grouper","gsquid":"Giant Squid","sunfish":"Ocean Sunfish"};
export const LEGENDS: Record<string, string> = { ghost: 'the Ghost Carp', oarfish: 'an Oarfish', crystal: 'a Crystal Squid', goldmahi: 'a Golden Mahi', oldone: 'the Old One' };
export const NEAR_MAX = 40;             // most boats sea.near returns per map cell (the Convex fallback; the relay has its own range)
export const SEAS = 64;                 // rows from before the shared sea may carry 1..63; the sweep still clears them
export const MOVE_MIN_MS = 300;         // ignore position writes faster than this (clients send about twice a second while moving)
export const NAME_MIN_MS = 10_000;      // one name change every 10 s
export const EMOTE_MIN_MS = 1_500;
export const CATCH_MIN_MS = 2_500;     // record submissions closer together than this are ignored
export const FUND_DAILY = 50_000;       // most a player can give in a day
export const FUND_DAILY_ALL = 250_000;  // most the whole coast can give in a day, so fresh guests can't fill it at once
export const FUND_KEYS = ['grand-harbour'];
// Guests are free and unlimited, so a brand-new guest can't post records, news or fund gifts yet.
export const GUEST_TRUST_MS = 15 * 60_000;
export const NEWS_MIN_MS = 20_000;      // at most one coastwide news item this often
export const GUESTS_PER_WINDOW = 300;   // new guest accounts per window, across everyone
export const GUEST_WINDOW_MS = 10 * 60_000;
export const GUEST_IDLE_MS = 30 * 86_400_000;   // guests unseen this long are deleted
export const SAVE_MIN_MS = 2_000;    // the client uploads at most every 4 s
export const MAX_SAVE_CHARS = 200_000;
