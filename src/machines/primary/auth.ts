import type {
  AuthBrowserSessionResult,
  AuthClientMetadata,
  AuthMachineScope,
  AuthGrantScope,
  AuthPairingCredentialResult,
  ServerAuthSessionMethod,
  AuthSessionId,
  AuthSessionState,
} from "@vekrel/contracts";
import { MachineHttpCommonError, PRIMARY_LOCAL_MACHINE_ID } from "@vekrel/contracts";
import type { MachineHttpCommonError as MachineHttpCommonErrorType } from "@vekrel/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClientError } from "effect/http";

import {
  getPairingTokenFromUrl,
  stripPairingTokenFromUrl as stripPairingTokenUrl,
} from "../../pairingUrl";

import { PrimaryMachineHttpClient } from "./httpClient";
import { runPrimaryHttp } from "../../lib/runtime";

const PrimaryMachineRequestOperation = Schema.Literals([
  "fetch-session-state",
  "exchange-bootstrap-credential",
  "fetch-machine-descriptor",
  "create-pairing-credential",
  "list-pairing-links",
  "revoke-pairing-link",
  "list-client-sessions",
  "revoke-client-session",
  "revoke-other-client-sessions",
]);
type PrimaryMachineRequestOperation = typeof PrimaryMachineRequestOperation.Type;

export class PrimaryMachineRequestError extends Schema.TaggedError<PrimaryMachineRequestError>()(
  "PrimaryMachineRequestError",
  {
    operation: PrimaryMachineRequestOperation,
    status: Schema.Number,
    pairingLinkId: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static fromCause(input: {
    readonly operation: PrimaryMachineRequestOperation;
    readonly cause: unknown;
    readonly pairingLinkId?: string;
    readonly sessionId?: string;
  }): PrimaryMachineRequestError {
    const status = readHttpApiStatus(input.cause) ?? 500;
    return new PrimaryMachineRequestError({
      operation: input.operation,
      status,
      ...(input.pairingLinkId !== undefined ? { pairingLinkId: input.pairingLinkId } : {}),
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      cause: input.cause,
    });
  }

  override get message(): string {
    return `Primary machine request failed during ${this.operation} (HTTP ${this.status}).`;
  }
}

const isPrimaryMachineRequestError = Schema.is(PrimaryMachineRequestError);

export class PrimaryMachinePairingCredentialRejectedError extends Schema.TaggedError<PrimaryMachinePairingCredentialRejectedError>()(
  "PrimaryMachinePairingCredentialRejectedError",
  {
    providedLength: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Invalid pairing token. Check the token and try again.";
  }
}

export class PrimaryMachineAuthSessionTimeoutError extends Schema.TaggedError<PrimaryMachineAuthSessionTimeoutError>()(
  "PrimaryMachineAuthSessionTimeoutError",
  {
    timeoutMs: Schema.Number,
    elapsedMs: Schema.Number,
  },
) {
  override get message(): string {
    return "Timed out waiting for authenticated session after bootstrap.";
  }
}

export class PrimaryMachinePairingCredentialRequiredError extends Schema.TaggedError<PrimaryMachinePairingCredentialRequiredError>()(
  "PrimaryMachinePairingCredentialRequiredError",
  {
    providedLength: Schema.Number,
  },
) {
  override get message(): string {
    return "Enter a pairing token to continue.";
  }
}

const isMachineHttpCommonError = Schema.is(MachineHttpCommonError);

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly scopes: ReadonlyArray<AuthMachineScope>;
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthMachineScope>;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
let resolvedAuthenticatedGateState: ServerAuthGateState | null = null;
let explicitPairingRequested = false;
const AUTH_SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const AUTH_SESSION_ESTABLISH_STEP_MS = 100;

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href));
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  const next = stripPairingTokenUrl(url);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null;
  }
  stripPairingTokenFromUrl();
  return token;
}

function getDesktopBootstrapCredential(): string | null {
  // Both backends share the same bootstrap token (DesktopBackendConfiguration
  // mints one tokenRef and feeds it to both resolvers), so picking the
  // primary entry is fine even when the WSL backend is also registered.
  const bootstraps = window.desktopBridge?.getLocalMachineBootstraps() ?? [];
  const primary = bootstraps.find((entry) => entry.id === PRIMARY_LOCAL_MACHINE_ID);
  return typeof primary?.bootstrapToken === "string" && primary.bootstrapToken.length > 0
    ? primary.bootstrapToken
    : null;
}

export async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientBootstrap(async () => {
    try {
      return await runPrimaryHttp(
        PrimaryMachineHttpClient.pipe(
          Effect.flatMap((client) => client.auth.session({ headers: {} })),
        ),
      );
    } catch (error) {
      throw PrimaryMachineRequestError.fromCause({
        operation: "fetch-session-state",
        cause: error,
      });
    }
  });
}

function readHttpApiStatus(error: unknown): number | null {
  if (isMachineHttpCommonError(error)) {
    return readMachineHttpErrorStatus(error);
  }
  return HttpClientError.isHttpClientError(error) && error.response !== undefined
    ? error.response.status
    : null;
}

function readMachineHttpErrorStatus(error: MachineHttpCommonErrorType): number {
  switch (error._tag) {
    case "MachineRequestInvalidError":
      return 400;
    case "MachineAuthInvalidError":
      return 401;
    case "MachineScopeRequiredError":
    case "MachineOperationForbiddenError":
      return 403;
    case "MachineResourceNotFoundError":
      return 404;
    case "MachineInternalError":
      return 500;
  }
}

async function exchangeBootstrapCredential(credential: string): Promise<AuthBrowserSessionResult> {
  return retryTransientBootstrap(async () => {
    try {
      return await runPrimaryHttp(
        PrimaryMachineHttpClient.pipe(
          Effect.flatMap((client) => client.auth.browserSession({ payload: { credential } })),
        ),
      );
    } catch (error) {
      if (
        isMachineHttpCommonError(error) &&
        error._tag === "MachineAuthInvalidError" &&
        error.reason === "invalid_credential"
      ) {
        throw new PrimaryMachinePairingCredentialRejectedError({
          providedLength: credential.length,
          cause: error,
        });
      }
      throw PrimaryMachineRequestError.fromCause({
        operation: "exchange-bootstrap-credential",
        cause: error,
      });
    }
  });
}

async function waitForAuthenticatedSessionAfterBootstrap(): Promise<AuthSessionState> {
  const startedAt = Date.now();

  while (true) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= AUTH_SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new PrimaryMachineAuthSessionTimeoutError({
        timeoutMs: AUTH_SESSION_ESTABLISH_TIMEOUT_MS,
        elapsedMs,
      });
    }

    await waitForBootstrapRetry(AUTH_SESSION_ESTABLISH_STEP_MS);
  }
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
const BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;
const BOOTSTRAP_RETRY_STEP_MS = 500;

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isTransientBootstrapError(error: unknown): boolean {
  if (isPrimaryMachineRequestError(error)) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

async function bootstrapServerAuth(urlCredential: string | null): Promise<ServerAuthGateState> {
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated && !urlCredential) {
    return { status: "authenticated" };
  }

  const bootstrapCredential = urlCredential ?? getDesktopBootstrapCredential();
  if (!bootstrapCredential) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
    };
  }

  try {
    await exchangeBootstrapCredential(bootstrapCredential);
    await waitForAuthenticatedSessionAfterBootstrap();
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

export async function submitServerAuthCredential(credential: string): Promise<void> {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new PrimaryMachinePairingCredentialRequiredError({
      providedLength: credential.length,
    });
  }

  resolvedAuthenticatedGateState = null;
  await exchangeBootstrapCredential(trimmedCredential);
  await waitForAuthenticatedSessionAfterBootstrap();
  resolvedAuthenticatedGateState = { status: "authenticated" };
  bootstrapPromise = null;
  explicitPairingRequested = false;
  stripPairingTokenFromUrl();
}

export async function createServerPairingCredential(input?: {
  readonly label?: string;
  readonly scopes?: ReadonlyArray<AuthGrantScope>;
}): Promise<AuthPairingCredentialResult> {
  const trimmedLabel = input?.label?.trim();
  try {
    return await runPrimaryHttp(
      PrimaryMachineHttpClient.pipe(
        Effect.flatMap((client) =>
          client.auth.pairingCredential({
            headers: {},
            payload: {
              ...(trimmedLabel ? { label: trimmedLabel } : {}),
              ...(input?.scopes ? { scopes: input.scopes } : {}),
            },
          }),
        ),
      ),
    );
  } catch (error) {
    throw PrimaryMachineRequestError.fromCause({
      operation: "create-pairing-credential",
      cause: error,
    });
  }
}

export async function revokeServerPairingLink(id: string): Promise<void> {
  try {
    await runPrimaryHttp(
      PrimaryMachineHttpClient.pipe(
        Effect.flatMap((client) => client.auth.revokePairingLink({ headers: {}, payload: { id } })),
      ),
    );
  } catch (error) {
    throw PrimaryMachineRequestError.fromCause({
      operation: "revoke-pairing-link",
      pairingLinkId: id,
      cause: error,
    });
  }
}

export async function revokeServerClientSession(sessionId: AuthSessionId): Promise<void> {
  try {
    await runPrimaryHttp(
      PrimaryMachineHttpClient.pipe(
        Effect.flatMap((client) =>
          client.auth.revokeClient({ headers: {}, payload: { sessionId } }),
        ),
      ),
    );
  } catch (error) {
    throw PrimaryMachineRequestError.fromCause({
      operation: "revoke-client-session",
      sessionId,
      cause: error,
    });
  }
}

export async function revokeOtherServerClientSessions(): Promise<number> {
  try {
    const result = await runPrimaryHttp(
      PrimaryMachineHttpClient.pipe(
        Effect.flatMap((client) => client.auth.revokeOtherClients({ headers: {} })),
      ),
    );
    return result.revokedCount;
  } catch (error) {
    throw PrimaryMachineRequestError.fromCause({
      operation: "revoke-other-client-sessions",
      cause: error,
    });
  }
}

export async function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  // An explicit pairing link replaces this browser's grant, even when the
  // current cookie or a cached gate already authenticates it. Keep that intent
  // after stripping the token, which causes the router to load this gate again.
  if (window.location.pathname.replace(/\/+$/, "") !== "/pair") {
    explicitPairingRequested = false;
  } else if (peekPairingTokenFromUrl()) {
    explicitPairingRequested = true;
  }
  if (explicitPairingRequested) {
    const currentSession = await fetchSessionState();
    return { status: "requires-auth", auth: currentSession.auth };
  }

  const urlCredential = takePairingTokenFromUrl();
  const previousPromise = bootstrapPromise;
  if (urlCredential) {
    resolvedAuthenticatedGateState = null;
  } else {
    if (previousPromise) {
      return previousPromise;
    }

    if (resolvedAuthenticatedGateState?.status === "authenticated") {
      return resolvedAuthenticatedGateState;
    }
  }

  const nextPromise = previousPromise
    ? previousPromise
        .catch(() => undefined)
        .then(() => {
          resolvedAuthenticatedGateState = null;
          return bootstrapServerAuth(urlCredential);
        })
    : bootstrapServerAuth(urlCredential);
  bootstrapPromise = nextPromise;
  return nextPromise
    .then((result) => {
      if (bootstrapPromise === nextPromise && result.status === "authenticated") {
        resolvedAuthenticatedGateState = result;
      }
      return result;
    })
    .finally(() => {
      if (bootstrapPromise === nextPromise) {
        bootstrapPromise = null;
      }
    });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  resolvedAuthenticatedGateState = null;
  explicitPairingRequested = false;
}
