// The heavy half of the online layer: the Convex client, Convex Auth and the React bindings it needs (Preact's compat
// layer). net.ts loads this after the first frame and keeps all the state; this file only connects the session.
import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ConvexReactClient, useConvexAuth } from 'convex/react';
import { ConvexAuthProvider, useAuthActions, useAuthToken } from '@convex-dev/auth/react';
import { useSignInAnonymously } from '@convex-dev/auth/methods/anonymous/react';
import { useSignInWithUsernamePassword, useSignUpWithUsernamePassword } from '@convex-dev/auth/methods/username-password/react';
import { api } from '../convex/_generated/api';
import { NET, bridge } from './net';

// Signs in as a guest when nobody is signed in (never during an account switch) and tracks the session.
function Bridge() {
  const { signOut } = useAuthActions(), { isLoading, isAuthenticated } = useConvexAuth(), token = useAuthToken();
  const guest = useSignInAnonymously(api.auth), { signIn } = useSignInWithUsernamePassword(api.auth), { signUp } = useSignUpWithUsernamePassword(api.auth);
  const [wake, setWake] = useState(0);
  const wakeUp = () => setWake(n => n + 1);
  bridge.connected({ signIn, signUp, signOut }, isAuthenticated ? token : null, wakeUp);
  useEffect(() => {
    if (isLoading || isAuthenticated || !bridge.mayStartGuest()) return;
    bridge.guestStarting(true); NET.status = 'connecting';
    guest.signIn()
      .catch(() => { NET.status = 'offline'; setTimeout(wakeUp, 10_000); })   // try again in a while
      .finally(() => bridge.guestStarting(false));
  }, [isLoading, isAuthenticated, wake]);
  useEffect(() => bridge.authChanged(isAuthenticated), [isAuthenticated]);
  return null;
}
/** Open the Convex connection and start the sign-in bridge; returns the client for net.ts to use. */
export function connect(url: string): ConvexReactClient {
  const client = new ConvexReactClient(url);
  const host = document.createElement('div'); host.style.display = 'none'; document.body.appendChild(host);
  render(h(ConvexAuthProvider, { client, api: { refreshSession: api.auth.refreshSession, signOut: api.auth.signOut }, ambientSignIns: [], children: h(Bridge, null) }), host);
  return client;
}
