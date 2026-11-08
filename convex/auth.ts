import { setupConvexAuth } from '@convex-dev/auth/server';
import { setupAnonymous } from '@convex-dev/auth/methods/anonymous/server';
import { setupUsernamePassword } from '@convex-dev/auth/methods/username-password/server';
import { components, internal } from './_generated/api';

// Everyone starts as an anonymous guest; a guest can sign up with email and password to keep their save.
// The email is the username: the username component compares them without case, so "Ana@x.com" and "ana@x.com" are the same account.
// An hour, not v2's default minute: every refresh re-authenticates the connection, and the relay is handed each new token.
const auth = setupConvexAuth({ component: components.auth, accessTokenTtlSeconds: 3600 });
export const { signOut, refreshSession, isAuthenticated } = auth;

export const { signInAnonymously } = setupAnonymous(auth, { component: components.authAnonymous })
  .attachUserCallbacks({ createUser: internal.users.createGuest });

export const { signUpWithUsernamePassword, signInWithUsernamePassword } = setupUsernamePassword(auth, {
  component: components.authPassword,
  usernameComponent: components.authUsername,
}).attachUserCallbacks({ createUser: internal.users.createAccount });
