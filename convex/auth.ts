import { convexAuth } from '@convex-dev/auth/server';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { Password } from '@convex-dev/auth/providers/Password';

// Everyone starts as an anonymous guest; a guest can sign up with email and password to keep their save.
// Emails are stored and looked up in lower case, so "Ana@x.com" and "ana@x.com" are the same account.
const EmailPassword = Password({ profile: params => ({ email: String(params.email ?? '').trim().toLowerCase() }) });
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers: [Anonymous, EmailPassword] });
