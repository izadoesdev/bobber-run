import { httpRouter } from 'convex/server';
import { fromRelay } from './chat';
import { onlineFromRelay } from './stats';

const http = httpRouter();
http.route({ path: '/relay/chat', method: 'POST', handler: fromRelay });
http.route({ path: '/relay/stats', method: 'POST', handler: onlineFromRelay });
export default http;
