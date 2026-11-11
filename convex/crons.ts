import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.daily('delete long-idle guests', { hourUTC: 4, minuteUTC: 0 }, internal.cleanup.guests, {});
crons.daily('free islands of long-gone owners', { hourUTC: 4, minuteUTC: 30 }, internal.islands.sweepIdle, {});
crons.daily('check island links again', { hourUTC: 5, minuteUTC: 30 }, internal.islands.recheckLinks, {});
crons.daily('forget old weekly boards', { hourUTC: 5, minuteUTC: 0 }, internal.leaderboard.pruneWeeks, {});
export default crons;
