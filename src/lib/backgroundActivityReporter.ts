import { MachineRegistry } from "@vekrel/client-runtime/connection";
import {
  MachineRpcSubscriptionObserver,
  request,
  type MachineRpcSubscriptionObservation,
} from "@vekrel/client-runtime/rpc";
import {
  type BackgroundScope,
  type ClientActivityReportInput,
  type MachineId,
  WS_METHODS,
} from "@vekrel/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { randomUUID } from "./utils";

const CLIENT_ID_STORAGE_KEY = "t3.backgroundActivity.clientId";
const REPORT_INTERVAL_MS = 25_000;
const LEASE_TTL_MS = 45_000;
const RECENT_INTERACTION_WINDOW_MS = LEASE_TTL_MS;
const BASELINE_SCOPES: ReadonlyArray<BackgroundScope> = [{ type: "provider-status" }];

interface RetainedScope {
  readonly machineId: MachineId;
  readonly scope: BackgroundScope;
  refCount: number;
}

const retainedScopes = new Map<string, RetainedScope>();
const retainedScopeListeners = new Set<() => void>();

function notifyRetainedScopesChanged(): void {
  for (const listener of retainedScopeListeners) {
    try {
      listener();
    } catch {}
  }
}

function stableScopeKey(machineId: MachineId, scope: BackgroundScope): string {
  switch (scope.type) {
    case "server-config":
    case "diagnostics":
      return JSON.stringify([machineId, scope.type]);
    case "provider-status":
      return JSON.stringify([machineId, scope.type, scope.instanceId ?? null]);
    case "vcs-status":
    case "git-refs":
      return JSON.stringify([machineId, scope.type, scope.cwd]);
    case "thread":
      return JSON.stringify([machineId, scope.type, scope.threadId]);
  }
}

function getClientId(): string {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing) return existing;
    const next = randomUUID();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return "ephemeral-browser-client";
  }
}

function resolveClientKind(): ClientActivityReportInput["clientKind"] {
  return window.desktopBridge ? "desktop-renderer" : "web";
}

function wasRecentlyInteracted(lastInteractionAtMs: number, observedAtMs: number): boolean {
  return (
    lastInteractionAtMs <= observedAtMs &&
    observedAtMs - lastInteractionAtMs <= RECENT_INTERACTION_WINDOW_MS
  );
}

function createActivityReport(
  machineId: MachineId,
  lastInteractionAtMs: number,
  observedAtMs: number,
): ClientActivityReportInput {
  const scopes = [...BASELINE_SCOPES];
  for (const entry of retainedScopes.values()) {
    if (entry.machineId === machineId) {
      scopes.push(entry.scope);
    }
  }
  return {
    machineId,
    clientId: getClientId(),
    clientKind: resolveClientKind(),
    visible: document.visibilityState === "visible",
    focused: document.hasFocus(),
    recentlyInteracted: wasRecentlyInteracted(lastInteractionAtMs, observedAtMs),
    appState: document.visibilityState === "visible" ? "active" : "background",
    scopes,
    ttlMs: LEASE_TTL_MS,
    observedAt: DateTime.makeUnsafe(observedAtMs),
  };
}

function scopeForSubscription(
  observation: MachineRpcSubscriptionObservation,
): BackgroundScope | null {
  if (observation.method === WS_METHODS.subscribeResourceTelemetry) {
    return { type: "diagnostics" };
  }
  if (observation.method !== WS_METHODS.subscribeVcsStatus) {
    return null;
  }
  const input = observation.input as { readonly cwd?: unknown; readonly includeRemote?: unknown };
  if (input.includeRemote === false) return null;
  return typeof input.cwd === "string" ? { type: "vcs-status", cwd: input.cwd } : null;
}

function retainBackgroundScope(machineId: MachineId, scope: BackgroundScope): () => void {
  const key = stableScopeKey(machineId, scope);
  const existing = retainedScopes.get(key);
  if (existing) {
    existing.refCount += 1;
  } else {
    retainedScopes.set(key, { machineId, scope, refCount: 1 });
    notifyRetainedScopesChanged();
  }

  return () => {
    const current = retainedScopes.get(key);
    if (!current) return;
    current.refCount -= 1;
    if (current.refCount <= 0) {
      retainedScopes.delete(key);
      notifyRetainedScopesChanged();
    }
  };
}

export function observeBackgroundActivitySubscription(
  observation: MachineRpcSubscriptionObservation,
): Effect.Effect<Effect.Effect<void>> {
  const scope = scopeForSubscription(observation);
  if (scope === null) {
    return Effect.succeed(Effect.void);
  }
  return Effect.sync(() => {
    const release = retainBackgroundScope(observation.machineId as MachineId, scope);
    return Effect.sync(release);
  });
}

export function retainedBackgroundScopes(
  machineId: MachineId,
): ReadonlyArray<BackgroundScope> {
  return Array.from(retainedScopes.values(), (entry) =>
    entry.machineId === machineId ? entry.scope : null,
  ).filter((scope): scope is BackgroundScope => scope !== null);
}

export const layerObserver = Layer.succeed(
  MachineRpcSubscriptionObserver,
  MachineRpcSubscriptionObserver.of({
    observe: observeBackgroundActivitySubscription,
  }),
);

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const registry = yield* MachineRegistry.MachineRegistry;
    const clock = yield* Clock.Clock;
    const reportRequests = yield* Queue.sliding<void>(1);
    const requestReport = () => Queue.offerUnsafe(reportRequests, undefined);
    let lastInteractionAtMs = clock.currentTimeMillisUnsafe();
    const recordInteraction = () => {
      const observedAtMs = clock.currentTimeMillisUnsafe();
      const wasRecent = wasRecentlyInteracted(lastInteractionAtMs, observedAtMs);
      lastInteractionAtMs = observedAtMs;
      if (!wasRecent) {
        requestReport();
      }
    };
    const passiveListenerOptions = { passive: true } as const;

    const report = Effect.gen(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      const entries = yield* SubscriptionRef.get(registry.entries);
      yield* Effect.forEach(
        entries.keys(),
        (machineId) =>
          registry
            .run(
              machineId,
              request(
                WS_METHODS.serverReportClientActivity,
                createActivityReport(machineId, lastInteractionAtMs, observedAtMs),
              ),
            )
            // Not `ignore`: tearing down a machine mid-request interrupts its report,
            // and an interrupt leaking out here would end the reporting loop for good.
            .pipe(Effect.ignoreCause),
        { concurrency: "unbounded", discard: true },
      );
    }).pipe(Effect.withSpan("web.backgroundActivity.report"));

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        retainedScopeListeners.add(requestReport);
        document.addEventListener("visibilitychange", requestReport);
        window.addEventListener("focus", requestReport);
        window.addEventListener("blur", requestReport);
        window.addEventListener("online", requestReport);
        window.addEventListener("pointermove", recordInteraction);
        window.addEventListener("keydown", recordInteraction);
        window.addEventListener("wheel", recordInteraction, passiveListenerOptions);
        window.addEventListener("touchstart", recordInteraction, passiveListenerOptions);
      }),
      () =>
        Effect.sync(() => {
          retainedScopeListeners.delete(requestReport);
          document.removeEventListener("visibilitychange", requestReport);
          window.removeEventListener("focus", requestReport);
          window.removeEventListener("blur", requestReport);
          window.removeEventListener("online", requestReport);
          window.removeEventListener("pointermove", recordInteraction);
          window.removeEventListener("keydown", recordInteraction);
          window.removeEventListener("wheel", recordInteraction);
          window.removeEventListener("touchstart", recordInteraction);
        }),
    );

    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach(() => Effect.sync(requestReport)),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(reportRequests).pipe(
      Stream.debounce("250 millis"),
      Stream.runForEach(() => report),
      Effect.forkScoped,
    );
    yield* Effect.sync(requestReport).pipe(
      Effect.repeat(Schedule.spaced(`${REPORT_INTERVAL_MS} millis`)),
      Effect.forkScoped,
    );
  }),
);
