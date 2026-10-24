import {
  ClientCapabilities,
  PlatformConnectionSource,
  Persistence,
} from "@vekrel/client-runtime/platform";
import {
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionRegistration,
  BearerConnectionTarget,
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
  Connectivity,
  mapRemoteMachineError,
  type PlatformConnectionRegistration,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  sshTargetKey,
  Wakeups,
} from "@vekrel/client-runtime/connection";
import { bootstrapRemoteBearerSession } from "@vekrel/client-runtime/authorization";
import { fetchRemoteMachineDescriptor } from "@vekrel/client-runtime/machine";
import { managedRelayAccountChanges, managedRelaySessionAtom } from "@vekrel/client-runtime/relay";
import { MachineRpcRequestObserver } from "@vekrel/client-runtime/rpc";
import {
  AuthStandardClientScopes,
  type DesktopBridge,
  type DesktopMachineBootstrap,
  type DesktopSshMachineBootstrap,
  type DesktopSshMachineTarget,
  type MachineId,
  PRIMARY_LOCAL_MACHINE_ID,
} from "@vekrel/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import { APP_VERSION } from "../branding";
import { readDesktopPrimaryBearerToken } from "../machines/primary/desktopAuth";
import * as PrimaryMachineHttpLayer from "../machines/primary/httpLayer";
import { readPrimaryMachineTarget, type PrimaryMachineTarget } from "../machines/primary/target";
import { clearComposerDraftsMachine } from "../composerDraftStore";
import { isHostedStaticApp } from "../hostedPairing";
import { isLocalMachineDisabled } from "../localMachine";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { acknowledgeRpcRequest, trackRpcRequestSent } from "../rpc/requestLatencyState";
import {
  desktopLocalConnectionId,
  readDesktopSecondaryBootstrapsResult,
  type DesktopSecondaryBootstrapsRead,
} from "./desktopLocal";
import * as ConnectionStorage from "./storage";
import { clientPresentationMetadata } from "./clientMetadata";

let nextObservedRpcRequestId = 0;

function currentNetworkStatus(): "unknown" | "offline" | "online" {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  return navigator.onLine ? "online" : "offline";
}

const layerConnectivity = Connectivity.layer({
  status: Effect.sync(currentNetworkStatus),
  changes: Stream.callback((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const online = () => Queue.offerUnsafe(queue, "online");
        const offline = () => Queue.offerUnsafe(queue, "offline");
        window.addEventListener("online", online);
        window.addEventListener("offline", offline);
        return { online, offline };
      }),
      ({ online, offline }) =>
        Effect.sync(() => {
          window.removeEventListener("online", online);
          window.removeEventListener("offline", offline);
        }),
    ).pipe(Effect.asVoid),
  ),
});

interface NetworkInformationLike extends EventTarget {
  readonly type?: string;
}

/**
 * `change` also fires for bandwidth and latency estimates on the same network,
 * so only a type change counts.
 */
const networkPathChanges = Stream.callback<"network-changed">((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const connection =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { readonly connection?: NetworkInformationLike }).connection;
      if (connection?.type === undefined) return undefined;
      let previous = connection.type;
      const listener = () => {
        const type = connection.type;
        if (type === undefined || type === previous) return;
        previous = type;
        Queue.offerUnsafe(queue, "network-changed");
      };
      connection.addEventListener("change", listener);
      return { connection, listener };
    }),
    (subscription) =>
      Effect.sync(() =>
        subscription?.connection.removeEventListener("change", subscription.listener),
      ),
  ).pipe(Effect.asVoid),
);

const layerWakeups = Wakeups.layer({
  changes: Stream.mergeAll(
    [
      Stream.callback<"application-active">((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = () => {
              if (document.visibilityState === "visible") {
                Queue.offerUnsafe(queue, "application-active");
              }
            };
            document.addEventListener("visibilitychange", listener);
            return listener;
          }),
          (listener) =>
            Effect.sync(() => {
              document.removeEventListener("visibilitychange", listener);
            }),
        ).pipe(Effect.asVoid),
      ),
      managedRelayAccountChanges(appAtomRegistry).pipe(
        Stream.map(() => "credentials-changed" as const),
      ),
      networkPathChanges,
    ],
    { concurrency: "unbounded" },
  ),
});

function clientMetadata() {
  return clientPresentationMetadata({
    appVersion: APP_VERSION,
    hosted: isHostedStaticApp(),
    identity: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    },
    desktopBridge: window.desktopBridge,
  });
}

function sshPreparationError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.toLowerCase().includes("cancel")) {
    return new ConnectionBlockedError({
      reason: "authentication",
      detail: message,
    });
  }
  return new ConnectionTransientError({
    reason: "remote-unavailable",
    detail: `Could not prepare the SSH machine: ${message}`,
  });
}

// IPC keeps running after its waiter is interrupted. A retry can adopt only
// that interrupted waiter's unfinished setup.
const pendingSshSetups = new Map<
  string,
  { readonly promise: Promise<DesktopSshMachineBootstrap>; signal: AbortSignal }
>();

const ensureDesktopSshMachine = (bridge: DesktopBridge, target: DesktopSshMachineTarget) =>
  Effect.tryPromise({
    try: (signal) => {
      const key = sshTargetKey(target);
      const pending = pendingSshSetups.get(key);
      if (pending?.signal.aborted) {
        pending.signal = signal;
        return pending.promise;
      }
      const setup = {
        promise: bridge.ensureSshMachine(target, { issuePairingToken: true }),
        signal,
      };
      pendingSshSetups.set(key, setup);
      const forget = () => {
        if (pendingSshSetups.get(key) === setup) pendingSshSetups.delete(key);
      };
      setup.promise.then(forget, forget);
      return setup.promise;
    },
    catch: sshPreparationError,
  });

export const provisionDesktopSshMachine = Effect.fn("web.connectionPlatform.ssh.provisionDesktop")(
  function* (
    bridge: DesktopBridge,
    target: DesktopSshMachineTarget,
    expectedMachineId?: MachineId,
  ) {
    const bootstrap = yield* ensureDesktopSshMachine(bridge, target);
    const pairingToken = bootstrap.pairingToken;
    if (pairingToken === null) {
      return yield* new ConnectionBlockedError({
        reason: "authentication",
        detail: "The SSH machine did not issue a pairing credential.",
      });
    }
    const descriptor = yield* Effect.tryPromise({
      try: () => bridge.fetchSshMachineDescriptor(bootstrap.httpBaseUrl),
      catch: sshPreparationError,
    });
    if (expectedMachineId !== undefined && descriptor.machineId !== expectedMachineId) {
      return yield* new ConnectionBlockedError({
        reason: "configuration",
        detail: `That host reaches ${descriptor.label}, a different machine. Add it as its own machine instead.`,
      });
    }
    const access = yield* Effect.tryPromise({
      try: () => bridge.bootstrapSshBearerSession(bootstrap.httpBaseUrl, pairingToken),
      catch: sshPreparationError,
    });
    return {
      machineId: descriptor.machineId,
      label: descriptor.label,
      bootstrap,
      bearerToken: access.access_token,
    };
  },
);

/**
 * Connects a saved SSH machine. A token from an earlier pairing is kept
 * while the host still accepts it with every standard scope, because every
 * pairing adds a session there.
 */
export const prepareDesktopSshMachine = Effect.fn("web.connectionPlatform.ssh.prepareDesktop")(
  function* (
    bridge: DesktopBridge,
    input: {
      readonly target: DesktopSshMachineTarget;
      readonly expectedMachineId: MachineId;
      readonly bearerToken?: string;
    },
  ) {
    const bearerToken = input.bearerToken;
    if (bearerToken !== undefined) {
      const bootstrap = yield* Effect.tryPromise({
        try: () => bridge.ensureSshMachine(input.target, { issuePairingToken: false }),
        catch: sshPreparationError,
      });
      // Stop without sending the saved token, or pairing, when the forward
      // reaches a different machine.
      const descriptor = yield* Effect.tryPromise({
        try: () => bridge.fetchSshMachineDescriptor(bootstrap.httpBaseUrl),
        catch: sshPreparationError,
      });
      if (descriptor.machineId !== input.expectedMachineId) {
        return yield* new ConnectionBlockedError({
          reason: "configuration",
          detail: `That host reaches ${descriptor.label}, a different machine. Add it as its own machine instead.`,
        });
      }
      const session = yield* Effect.tryPromise({
        try: () => bridge.fetchSshSessionState(bootstrap.httpBaseUrl, bearerToken),
        catch: sshPreparationError,
      });
      // Servers never widen a stored grant, so a token from before the standard
      // scopes grew is replaced by pairing again.
      const granted = session.permissions ?? session.scopes ?? [];
      if (
        session.authenticated &&
        AuthStandardClientScopes.every((scope) => granted.includes(scope))
      ) {
        return { bootstrap, bearerToken };
      }
    }
    const provisioned = yield* provisionDesktopSshMachine(
      bridge,
      input.target,
      input.expectedMachineId,
    );
    return { bootstrap: provisioned.bootstrap, bearerToken: provisioned.bearerToken };
  },
);

const ANALYTICS_DEVICE_ID_KEY = "vekrel:analytics-device-id";

// Lives as long as this browser profile's site data. Storage can be blocked, which only drops the id.
const analyticsDevice = {
  id: Effect.try(() => {
    const existing = window.localStorage.getItem(ANALYTICS_DEVICE_ID_KEY);
    if (existing) return existing;
    const created = randomUUID();
    window.localStorage.setItem(ANALYTICS_DEVICE_ID_KEY, created);
    return created;
  }).pipe(Effect.option),
};

const layerCapabilities = Layer.effectContext(
  Effect.sync(() => {
    const presentation = ClientCapabilities.ClientPresentation.of({
      metadata: clientMetadata(),
    });
    const cloudSession = ClientCapabilities.CloudSession.of({
      identity: Effect.sync(() =>
        Option.fromNullishOr(appAtomRegistry.get(managedRelaySessionAtom)),
      ),
      accountToken: Effect.gen(function* () {
        const session = appAtomRegistry.get(managedRelaySessionAtom);
        if (session === null) {
          return yield* new ConnectionBlockedError({
            reason: "authentication",
            detail: "Sign in to Vekrel Connect to connect this machine.",
          });
        }
        const token = yield* session.readToken().pipe(
          Effect.mapError(
            (error) =>
              new ConnectionTransientError({
                reason: "network",
                detail: error.message,
              }),
          ),
        );
        if (token === null) {
          return yield* new ConnectionBlockedError({
            reason: "authentication",
            detail: "The Vekrel Connect session is unavailable.",
          });
        }
        return token;
      }),
    });
    const identity = ClientCapabilities.RelayDeviceIdentity.of({
      deviceId: Effect.succeedNone,
    });
    const primaryAuth = ClientCapabilities.PrimaryMachineAuth.of({
      bearerToken: Effect.tryPromise({
        try: readDesktopPrimaryBearerToken,
        catch: (cause) =>
          new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: `Could not load the desktop primary credential: ${String(cause)}`,
          }),
      }).pipe(Effect.map(Option.fromNullishOr)),
    });
    const ssh = ClientCapabilities.SshMachineGateway.of({
      provision: Effect.fn("web.connectionPlatform.ssh.provision")(
        function* (target, expectedMachineId) {
          const bridge = window.desktopBridge;
          if (bridge === undefined) {
            return yield* new ConnectionBlockedError({
              reason: "unsupported",
              detail: "SSH machines are only available in the desktop app.",
            });
          }
          return yield* provisionDesktopSshMachine(bridge, target, expectedMachineId);
        },
      ),
      prepare: Effect.fn("web.connectionPlatform.ssh.prepare")(function* (input) {
        const bridge = window.desktopBridge;
        if (bridge === undefined) {
          return yield* new ConnectionBlockedError({
            reason: "unsupported",
            detail: "SSH machines are only available in the desktop app.",
          });
        }
        return yield* prepareDesktopSshMachine(bridge, input);
      }),
      disconnect: Effect.fn("web.connectionPlatform.ssh.disconnect")(function* (target) {
        const bridge = window.desktopBridge;
        if (bridge === undefined) {
          return;
        }
        pendingSshSetups.delete(sshTargetKey(target));
        yield* Effect.tryPromise({
          try: () => bridge.disconnectSshMachine(target),
          catch: (cause) =>
            new ConnectionTransientError({
              reason: "remote-unavailable",
              detail: `Could not disconnect the SSH machine: ${String(cause)}`,
            }),
        });
      }),
    });

    return Context.make(ClientCapabilities.CloudSession, cloudSession).pipe(
      Context.add(ClientCapabilities.AnalyticsDevice, analyticsDevice),
      Context.add(ClientCapabilities.PrimaryMachineAuth, primaryAuth),
      Context.add(ClientCapabilities.RelayDeviceIdentity, identity),
      Context.add(ClientCapabilities.ClientPresentation, presentation),
      Context.add(ClientCapabilities.SshMachineGateway, ssh),
    );
  }),
);

const loadPrimaryConnectionRegistration = Effect.fn(
  "web.connectionPlatform.loadPrimaryConnectionRegistration",
)(function* (resolved: PrimaryMachineTarget) {
  const descriptor = yield* fetchRemoteMachineDescriptor({
    httpBaseUrl: resolved.target.httpBaseUrl,
  }).pipe(Effect.provide(PrimaryMachineHttpLayer.layer), Effect.mapError(mapRemoteMachineError));
  return new PrimaryConnectionRegistration({
    target: new PrimaryConnectionTarget({
      machineId: descriptor.machineId,
      label: descriptor.label,
      httpBaseUrl: resolved.target.httpBaseUrl,
      wsBaseUrl: resolved.target.wsBaseUrl,
    }),
  });
});

const loadSecondaryConnectionRegistration = Effect.fn(
  "web.connectionPlatform.loadSecondaryConnectionRegistration",
)(function* (entry: DesktopMachineBootstrap) {
  if (
    entry.httpBaseUrl === null ||
    entry.wsBaseUrl === null ||
    entry.bootstrapToken === undefined
  ) {
    return yield* new ConnectionTransientError({
      reason: "endpoint-unavailable",
      detail: `Desktop-local backend ${entry.id} is not ready yet.`,
    });
  }
  const httpBaseUrl = entry.httpBaseUrl;
  const wsBaseUrl = entry.wsBaseUrl;
  const descriptor = yield* fetchRemoteMachineDescriptor({ httpBaseUrl }).pipe(
    Effect.mapError(mapRemoteMachineError),
  );
  const issuedAtEpochMs = yield* Clock.currentTimeMillis;
  const access = yield* bootstrapRemoteBearerSession({
    httpBaseUrl,
    credential: entry.bootstrapToken,
    scopes: AuthStandardClientScopes,
    clientMetadata: clientMetadata(),
  }).pipe(Effect.mapError(mapRemoteMachineError));
  // Keep the desktop pool's stable backend id in the connection id. The
  // descriptor machine id still scopes projects and RPC state, while the
  // backend id lets desktop-only operations (notably the WSL folder picker)
  // route back to the instance that owns the machine.
  const connectionId = desktopLocalConnectionId(entry.id);
  const label = entry.label || descriptor.label;
  return {
    registration: new BearerConnectionRegistration({
      target: new BearerConnectionTarget({
        machineId: descriptor.machineId,
        label,
        connectionId,
      }),
      profile: new BearerConnectionProfile({
        connectionId,
        machineId: descriptor.machineId,
        label,
        httpBaseUrl,
        wsBaseUrl,
      }),
      credential: new BearerConnectionCredential({ token: access.access_token }),
    }),
    expiresAtEpochMs: secondaryBearerExpiresAtEpochMs(issuedAtEpochMs, access.expires_in),
    refreshAtEpochMs: secondaryBearerRefreshAtEpochMs(issuedAtEpochMs, access.expires_in),
  };
});

// Poll cadence for the desktop bootstrap topology. There is no change event on
// the bridge, so the renderer polls; successful registrations are cached by a
// signature of their endpoint until bearer credentials approach expiry.
const PLATFORM_POLL_INTERVAL = "3 seconds";
const SECONDARY_BEARER_REFRESH_SKEW_MS = 5_000;

function secondaryBearerExpiresAtEpochMs(
  issuedAtEpochMs: number,
  expiresInSeconds: number,
): number {
  return issuedAtEpochMs + Math.max(0, expiresInSeconds * 1_000);
}

function secondaryBearerRefreshAtEpochMs(
  issuedAtEpochMs: number,
  expiresInSeconds: number,
): number {
  return Math.max(
    issuedAtEpochMs,
    secondaryBearerExpiresAtEpochMs(issuedAtEpochMs, expiresInSeconds) -
      SECONDARY_BEARER_REFRESH_SKEW_MS,
  );
}

interface CachedPlatformRegistration {
  readonly signature: string;
  readonly registration: PlatformConnectionRegistration;
  readonly expiresAtEpochMs?: number;
  readonly refreshAtEpochMs?: number;
  readonly bootstrapToken?: string;
}

export type PrimaryMachineTargetRead =
  | {
      readonly _tag: "Success";
      readonly target: PrimaryMachineTarget | null;
    }
  | {
      readonly _tag: "Failure";
      readonly cause: unknown;
    };

function readPrimaryMachineTargetResult(
  readTarget: () => PrimaryMachineTarget | null = readPrimaryMachineTarget,
): PrimaryMachineTargetRead {
  try {
    return { _tag: "Success", target: readTarget() };
  } catch (cause) {
    return { _tag: "Failure", cause };
  }
}

export function primaryRegistrationToRetainAfterTopologyRead(
  previous: ReadonlyMap<string, CachedPlatformRegistration>,
  topologyRead: PrimaryMachineTargetRead,
): CachedPlatformRegistration | undefined {
  return topologyRead._tag === "Failure" ? previous.get(PRIMARY_LOCAL_MACHINE_ID) : undefined;
}

export function canReuseCachedPlatformRegistration(
  cached: CachedPlatformRegistration,
  signature: string,
  nowEpochMs: number,
): boolean {
  return (
    cached.signature === signature &&
    (cached.refreshAtEpochMs === undefined || nowEpochMs < cached.refreshAtEpochMs)
  );
}

export function canRetainCachedPlatformRegistrationAfterRefreshFailure(
  cached: CachedPlatformRegistration,
  signature: string,
  nowEpochMs: number,
): boolean {
  return (
    cached.signature === signature &&
    cached.expiresAtEpochMs !== undefined &&
    nowEpochMs < cached.expiresAtEpochMs
  );
}

const REJECTED_BOOTSTRAP_RETRY_INITIAL_MS = 60_000;
const REJECTED_BOOTSTRAP_RETRY_MAX_MS = 30 * 60_000;

export interface RejectedSecondaryBootstrap {
  readonly signature: string;
  readonly retryAtEpochMs: number;
  readonly delayMs: number;
}

/**
 * A backend that rejected a bootstrap token will usually keep rejecting it, so
 * the poll backs off on that exact signature instead of re-presenting a dead
 * credential every few seconds. It still retries on a capped backoff: a backend
 * that restarts on the same port seeds a fresh grant for the same token, and
 * nothing in the topology says it restarted.
 */
export function isRejectedSecondaryBootstrap(
  rejected: RejectedSecondaryBootstrap | undefined,
  signature: string,
  nowEpochMs: number,
): rejected is RejectedSecondaryBootstrap {
  return (
    rejected !== undefined &&
    rejected.signature === signature &&
    nowEpochMs < rejected.retryAtEpochMs
  );
}

export function nextRejectedSecondaryBootstrap(
  previous: RejectedSecondaryBootstrap | undefined,
  signature: string,
  nowEpochMs: number,
): RejectedSecondaryBootstrap {
  const delayMs =
    previous?.signature === signature
      ? Math.min(previous.delayMs * 2, REJECTED_BOOTSTRAP_RETRY_MAX_MS)
      : REJECTED_BOOTSTRAP_RETRY_INITIAL_MS;
  return { signature, retryAtEpochMs: nowEpochMs + delayMs, delayMs };
}

export function isRejectedBootstrapCredentialError(error: ConnectionAttemptError): boolean {
  return error._tag === "ConnectionBlockedError" && error.reason === "authentication";
}

export function secondaryRegistrationsToRetainAfterTopologyRead(
  previous: ReadonlyMap<string, CachedPlatformRegistration>,
  topologyRead: DesktopSecondaryBootstrapsRead,
  nowEpochMs: number,
): ReadonlyMap<string, CachedPlatformRegistration> {
  if (topologyRead._tag === "Success") {
    return new Map();
  }
  return new Map(
    [...previous].filter(
      ([, cached]) => cached.expiresAtEpochMs !== undefined && nowEpochMs < cached.expiresAtEpochMs,
    ),
  );
}

const layerPlatformConnectionSource = Layer.effect(
  PlatformConnectionSource.PlatformConnectionSource,
  Effect.gen(function* () {
    if (isHostedStaticApp() || isLocalMachineDisabled()) {
      return PlatformConnectionSource.PlatformConnectionSource.of({
        registrations: Stream.empty,
      });
    }
    const cacheRef = yield* Ref.make(new Map<string, CachedPlatformRegistration>());
    const rejectedRef = yield* Ref.make(new Map<string, RejectedSecondaryBootstrap>());

    const buildPlatformRegistrations = Effect.gen(function* () {
      const previous = yield* Ref.get(cacheRef);
      const nowEpochMs = yield* Clock.currentTimeMillis;
      const next = new Map<string, CachedPlatformRegistration>();
      const registrations: Array<PlatformConnectionRegistration> = [];

      const primaryTopologyRead = readPrimaryMachineTargetResult();
      const retainedPrimary = primaryRegistrationToRetainAfterTopologyRead(
        previous,
        primaryTopologyRead,
      );
      if (retainedPrimary !== undefined) {
        next.set(PRIMARY_LOCAL_MACHINE_ID, retainedPrimary);
        registrations.push(retainedPrimary.registration);
      }

      if (primaryTopologyRead._tag === "Failure") {
        yield* Effect.logWarning("Could not read the primary machine topology.", {
          cause: primaryTopologyRead.cause,
        });
      } else if (primaryTopologyRead.target !== null) {
        const primaryTarget = primaryTopologyRead.target;
        const signature = `primary|${primaryTarget.target.httpBaseUrl}|${primaryTarget.target.wsBaseUrl}`;
        const cached = previous.get(PRIMARY_LOCAL_MACHINE_ID);
        if (
          cached !== undefined &&
          canReuseCachedPlatformRegistration(cached, signature, nowEpochMs)
        ) {
          next.set(PRIMARY_LOCAL_MACHINE_ID, cached);
          registrations.push(cached.registration);
        } else {
          const built = yield* loadPrimaryConnectionRegistration(primaryTarget).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not discover the primary machine.", { error }),
            ),
            Effect.option,
          );
          if (Option.isSome(built)) {
            const cacheEntry = { signature, registration: built.value };
            next.set(PRIMARY_LOCAL_MACHINE_ID, cacheEntry);
            registrations.push(built.value);
          }
        }
      }

      const topologyRead = readDesktopSecondaryBootstrapsResult();
      for (const [id, cached] of secondaryRegistrationsToRetainAfterTopologyRead(
        previous,
        topologyRead,
        nowEpochMs,
      )) {
        next.set(id, cached);
        registrations.push(cached.registration);
      }

      if (topologyRead._tag === "Failure") {
        yield* Effect.logWarning("Could not read the desktop-local backend topology.", {
          cause: topologyRead.cause,
        });
      } else {
        const rejected = yield* Ref.get(rejectedRef);
        const nextRejected = new Map<string, RejectedSecondaryBootstrap>();
        for (const bootstrap of topologyRead.bootstraps) {
          // The cached bearer belongs to the endpoint, not to the bootstrap
          // token it was exchanged for: a new token must not drop a live
          // session (its removal also clears the machine's drafts). The
          // token only decides whether a rejected exchange is retried.
          const endpointSignature = `${bootstrap.httpBaseUrl}|${bootstrap.wsBaseUrl}`;
          const signature = `${endpointSignature}|${bootstrap.bootstrapToken ?? ""}`;
          const cached = previous.get(bootstrap.id);
          // A new token from the desktop means something changed (rotation, a
          // restarted backend): exchange it rather than reusing a bearer that
          // may be dead. The old bearer stays registered if that exchange fails.
          if (
            cached !== undefined &&
            cached.bootstrapToken === bootstrap.bootstrapToken &&
            canReuseCachedPlatformRegistration(cached, endpointSignature, nowEpochMs)
          ) {
            next.set(bootstrap.id, cached);
            registrations.push(cached.registration);
            continue;
          }
          const previouslyRejected = rejected.get(bootstrap.id);
          if (isRejectedSecondaryBootstrap(previouslyRejected, signature, nowEpochMs)) {
            nextRejected.set(bootstrap.id, previouslyRejected);
            if (
              cached !== undefined &&
              canRetainCachedPlatformRegistrationAfterRefreshFailure(
                cached,
                endpointSignature,
                nowEpochMs,
              )
            ) {
              next.set(bootstrap.id, cached);
              registrations.push(cached.registration);
            }
            continue;
          }
          const built = yield* loadSecondaryConnectionRegistration(bootstrap).pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Could not connect a desktop-local backend.", {
                id: bootstrap.id,
                error,
              }),
            ),
            Effect.tapError((error) =>
              isRejectedBootstrapCredentialError(error)
                ? // Back off from when the rejection arrived; the exchanges in
                  // this poll can take longer than the first backoff step.
                  Clock.currentTimeMillis.pipe(
                    Effect.map((rejectedAtEpochMs) =>
                      nextRejected.set(
                        bootstrap.id,
                        nextRejectedSecondaryBootstrap(
                          previouslyRejected,
                          signature,
                          rejectedAtEpochMs,
                        ),
                      ),
                    ),
                  )
                : Effect.void,
            ),
            Effect.option,
          );
          if (Option.isSome(built)) {
            const cacheEntry = {
              signature: endpointSignature,
              ...(bootstrap.bootstrapToken === undefined
                ? {}
                : { bootstrapToken: bootstrap.bootstrapToken }),
              ...built.value,
            };
            next.set(bootstrap.id, cacheEntry);
            registrations.push(built.value.registration);
          } else if (
            cached !== undefined &&
            canRetainCachedPlatformRegistrationAfterRefreshFailure(
              cached,
              endpointSignature,
              nowEpochMs,
            )
          ) {
            next.set(bootstrap.id, cached);
            registrations.push(cached.registration);
          }
        }
        yield* Ref.set(rejectedRef, nextRejected);
      }

      yield* Ref.set(cacheRef, next);
      return registrations as ReadonlyArray<PlatformConnectionRegistration>;
    }).pipe(Effect.provide(FetchHttpClient.layer));

    return PlatformConnectionSource.PlatformConnectionSource.of({
      registrations: Stream.tick(PLATFORM_POLL_INTERVAL).pipe(
        Stream.mapEffect(() => buildPlatformRegistrations),
      ),
    });
  }),
);

const layerMachineOwnedDataCleanup = Layer.succeed(
  Persistence.MachineOwnedDataCleanup,
  Persistence.MachineOwnedDataCleanup.of({
    clear: (machineId) =>
      Effect.sync(() => {
        clearComposerDraftsMachine(machineId);
      }),
  }),
);

const layerRpcRequestObserver = Layer.succeed(
  MachineRpcRequestObserver,
  MachineRpcRequestObserver.of({
    observe: ({ machineId, machineLabel, method }) =>
      Effect.sync(() => {
        nextObservedRpcRequestId += 1;
        const requestId = `${machineId}:${nextObservedRpcRequestId}`;
        trackRpcRequestSent(requestId, method, `${method} · ${machineLabel}`);
        return Effect.sync(() => {
          acknowledgeRpcRequest(requestId);
        });
      }),
  }),
);

type ConnectionPlatformLayerSource =
  | typeof ConnectionStorage.layer
  | typeof layerConnectivity
  | typeof layerWakeups
  | typeof layerCapabilities
  | typeof layerPlatformConnectionSource
  | typeof layerMachineOwnedDataCleanup
  | typeof layerRpcRequestObserver;

export const layer: Layer.Layer<
  Layer.Success<ConnectionPlatformLayerSource>,
  Layer.Error<ConnectionPlatformLayerSource>,
  Layer.Services<ConnectionPlatformLayerSource>
> = Layer.mergeAll(
  ConnectionStorage.layer,
  layerConnectivity,
  layerWakeups,
  layerCapabilities,
  layerPlatformConnectionSource,
  layerMachineOwnedDataCleanup,
  layerRpcRequestObserver,
);
