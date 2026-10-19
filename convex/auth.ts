import { convexAuth } from '@convex-dev/auth/server';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { Password } from '@convex-dev/auth/providers/Password';

// Everyone starts as an anonymous guest; a guest can sign up with email and password to keep their save.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers: [Anonymous, Password] });
