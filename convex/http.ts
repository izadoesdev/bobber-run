import { httpRouter } from 'convex/server';
import { auth } from './auth';
import { fromRelay } from './chat';
import { onlineFromRelay } from './stats';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/relay/chat', method: 'POST', handler: fromRelay });
http.route({ path: '/relay/stats', method: 'POST', handler: onlineFromRelay });
export default http;
