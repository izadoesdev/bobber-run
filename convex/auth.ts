import { convexAuth } from '@convex-dev/auth/server';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { Password } from '@convex-dev/auth/providers/Password';
import { limits } from './lib';

// Everyone starts as an anonymous guest; a guest can sign up with email and password to keep their save.
// Emails are stored and looked up in lower case, so "Ana@x.com" and "ana@x.com" are the same account.
const EmailPassword = Password({ profile: params => ({ email: String(params.email ?? '').trim().toLowerCase() }) });
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Anonymous, EmailPassword],
  callbacks: {
    // guests cost nothing to make, so cap how many the whole coast can create per window; throwing rolls the sign-up back
    async afterUserCreatedOrUpdated(ctx, { existingUserId, provider }) {
      if (existingUserId || provider.id !== 'anonymous') return;
      if (!(await limits.limit(ctx, 'guests')).ok) throw new Error('The server is busy. Try again in a few minutes');
    },
  },
});
