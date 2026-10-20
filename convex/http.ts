import { httpRouter } from 'convex/server';
import { auth } from './auth';
import { fromRelay } from './chat';
import { onlineFromRelay } from './stats';
import { stripeWebhook } from './islands';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/relay/chat', method: 'POST', handler: fromRelay });
http.route({ path: '/relay/stats', method: 'POST', handler: onlineFromRelay });
http.route({ path: '/stripe/webhook', method: 'POST', handler: stripeWebhook });
export default http;
