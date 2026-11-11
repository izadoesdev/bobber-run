import { AUTH_PREFIX } from './limits';

export default {
  providers: [{
    type: 'customJwt',
    applicationID: 'convex',
    issuer: process.env.CONVEX_SITE_URL!,
    jwks: `${process.env.CONVEX_SITE_URL}${AUTH_PREFIX}/.well-known/jwks.json`,
    algorithm: 'RS256',
  }],
};
