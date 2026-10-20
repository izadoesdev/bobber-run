import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('sweep stale sailors and old news', { minutes: 1 }, internal.sea.sweep);
crons.daily('delete long-idle guests', { hourUTC: 4, minuteUTC: 0 }, internal.cleanup.guests, {});
crons.daily('free islands of long-gone owners', { hourUTC: 4, minuteUTC: 30 }, internal.islands.sweepIdle, {});
export default crons;
