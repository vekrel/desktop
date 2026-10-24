import {
  AccountClientId,
  beginSignIn,
  createAccountSession,
  type AccountSession,
  type PendingSignIn,
} from "@vekrel/client-runtime/account-auth";
import { decodeRelayJwt } from "@vekrel/shared/relayJwt";
import { useSyncExternalStore } from "react";

import { resolveCloudPublicConfig } from "../../cloud/publicConfig";

/**
 * The browser's Vekrel account, over the relay (`@vekrel/client-runtime/account-auth`). The
 * access token lives only in memory; the refresh token is the relay's HttpOnly cookie, so a
 * reload signs back in with one `/oauth/token` call.
 */
export interface AccountAuthState {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
  readonly userId: string | null;
  readonly email: string | null;
}

const SIGNED_OUT: AccountAuthState = {
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  email: null,
};
const PENDING_SIGN_IN_KEY = "vekrel:account:pending-sign-in";
const CHANNEL_NAME = "vekrel-account";
const CALLBACK_PATH = "/auth/callback";

let state: AccountAuthState = { ...SIGNED_OUT, isLoaded: false };
const listeners = new Set<() => void>();
let session: AccountSession | null = null;
let channel: BroadcastChannel | null = null;

function setState(next: AccountAuthState): void {
  if (
    next.isLoaded === state.isLoaded &&
    next.userId === state.userId &&
    next.email === state.email
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

function stateFromToken(token: string | null): AccountAuthState {
  if (!token) return SIGNED_OUT;
  const claims = decodeRelayJwt(token);
  const userId = typeof claims.sub === "string" ? claims.sub : null;
  const email = typeof claims.email === "string" ? claims.email : null;
  return userId ? { isLoaded: true, isSignedIn: true, userId, email } : SIGNED_OUT;
}

function relayUrl(): string {
  const url = resolveCloudPublicConfig().relayUrl;
  if (!url) throw new Error("VITE_VEKREL_RELAY_URL is not configured.");
  return url;
}

function newSession(): AccountSession {
  const created = createAccountSession({
    relayUrl: relayUrl(),
    clientId: AccountClientId.web,
    // A session another tab's announcement replaced must not sign this tab out.
    onSignedOut: () => {
      if (session === created) setState(SIGNED_OUT);
    },
  });
  return created;
}

/** Reads the relay cookie once; a relay that cannot be reached reads as signed out. */
async function load(target: AccountSession): Promise<void> {
  const token = await target.getAccessToken().catch(() => null);
  if (session === target) setState(stateFromToken(token));
}

function ensureSession(): AccountSession {
  if (session) return session;
  session = newSession();
  void load(session);
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    // Another tab signed in or out: a fresh session re-reads the shared cookie. Without this a
    // tab that saw a refusal stays signed out until reload.
    channel.onmessage = () => {
      session = newSession();
      void load(session);
    };
  }
  return session;
}

function announce(): void {
  channel?.postMessage("changed");
}

/** An access token for relay calls, or `null` when signed out. */
export async function getAccountToken(): Promise<string | null> {
  const target = ensureSession();
  const token = await target.getAccessToken();
  if (session === target) setState(stateFromToken(token));
  return token;
}

function callbackUri(): string {
  return `${window.location.origin}${CALLBACK_PATH}`;
}

/** Sends the tab to the relay's sign-in page; `/auth/callback` brings it back to `returnTo`. */
export function startAccountSignIn(returnTo: string = window.location.href): void {
  const { url, pending } = beginSignIn({
    relayUrl: relayUrl(),
    clientId: AccountClientId.web,
    redirectUri: callbackUri(),
  });
  sessionStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ pending, returnTo }));
  window.location.assign(url);
}

/**
 * Finishes a sign-in on `/auth/callback` and returns where to go next. The pending sign-in is
 * single use: it is removed before the exchange, so a reload of the callback cannot replay it.
 */
export async function completeAccountSignIn(callbackUrl: string): Promise<string> {
  // Code and state leave the address bar (history, referrers) before anything else can fail.
  window.history.replaceState(window.history.state, "", CALLBACK_PATH);
  const raw = sessionStorage.getItem(PENDING_SIGN_IN_KEY);
  sessionStorage.removeItem(PENDING_SIGN_IN_KEY);
  const saved = raw
    ? (JSON.parse(raw) as { readonly pending: PendingSignIn; readonly returnTo: string })
    : null;
  if (!saved) throw new Error("This sign-in was not started in this tab. Sign in again.");
  const target = ensureSession();
  await target.completeSignIn(callbackUrl, saved.pending);
  setState(stateFromToken(await target.getAccessToken()));
  announce();
  const returnTo = new URL(saved.returnTo, window.location.origin);
  const path = `${returnTo.pathname}${returnTo.search}${returnTo.hash}`;
  // Only ever return to this app: same origin, and not a protocol-relative path ("//", "/\\").
  return returnTo.origin === window.location.origin && /^\/(?![/\\])/u.test(path) ? path : "/";
}

/** Revokes the relay session (cookie) and forgets the access token. */
export async function signOutAccount(): Promise<void> {
  const target = ensureSession();
  setState(SIGNED_OUT);
  await target.signOut();
  announce();
}

export function getAccountAuthState(): AccountAuthState {
  return state;
}

function subscribe(listener: () => void): () => void {
  ensureSession();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The account state plus a token reader, for components and the relay session. */
export function useAuth(): AccountAuthState & {
  readonly getToken: typeof getAccountToken;
} {
  const current = useSyncExternalStore(subscribe, getAccountAuthState);
  return { ...current, getToken: getAccountToken };
}
