import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('sweep stale sailors and old news', { minutes: 1 }, internal.sea.sweep);
export default crons;
