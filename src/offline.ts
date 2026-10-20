/** `?offline` in the address keeps the game fully offline (for tests, or anyone who wants to play alone). */
export const FORCED_OFFLINE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('offline');
