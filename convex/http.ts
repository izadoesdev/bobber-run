import { httpRouter } from 'convex/server';
import { auth } from './auth';
import { fromRelay } from './chat';

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({ path: '/relay/chat', method: 'POST', handler: fromRelay });
export default http;
