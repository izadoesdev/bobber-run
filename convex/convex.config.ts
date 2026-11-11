import { defineApp } from 'convex/server';
import { v } from 'convex/values';
import auth from '@convex-dev/auth/convex.config.js';
import anonymous from '@convex-dev/auth/components/anonymous/convex.config.js';
import password from '@convex-dev/auth/components/password/convex.config.js';
import username from '@convex-dev/auth/components/username/convex.config.js';
import rateLimiter from '@convex-dev/rate-limiter/convex.config.js';
import { AUTH_PREFIX } from './limits';

const app = defineApp({ env: { AUTH_PRIVATE_KEY: v.string(), AUTH_JWKS: v.string() } });
app.use(auth, { httpPrefix: AUTH_PREFIX, env: { AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY, AUTH_JWKS: app.env.AUTH_JWKS } });
app.use(anonymous);
app.use(password);
app.use(username);
app.use(rateLimiter);
export default app;
