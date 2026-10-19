// Online state shared with the renderer and game, with no Convex imports (net.js fills it in).
// sailors: [{ id, name, boat, paint, x, y, a, vx, vy }] interpolated other players; bottles: [{ id, x, y, msg, name }]
export const ONLINE = { sailors: [], bottles: [] };
// LIFE.ships plus other players' boats, in the same shape the renderer draws
export const shipsAndSailors = ships => ONLINE.sailors.length ? (ships || []).concat(ONLINE.sailors) : (ships || []);
