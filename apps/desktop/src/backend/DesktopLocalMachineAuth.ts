import { bootstrapRemoteBearerSession } from "@vekrel/client-runtime/authorization";
import type { RemoteMachineRequestError } from "@vekrel/client-runtime/rpc";
import { PRIMARY_LOCAL_MACHINE_ID } from "@vekrel/contracts";
import { currentDesktopBootstrapToken } from "@vekrel/shared/desktopBootstrapToken";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/http/HttpClient";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";

const BOOTSTRAP_TRANSIENT_RETRY_TIMEOUT = Duration.seconds(15);
const BOOTSTRAP_TRANSIENT_RETRY_INTERVAL = Duration.millis(500);
const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);

const isTransientBearerBootstrapError = (error: RemoteMachineRequestError): boolean => {
  switch (error._tag) {
    case "RemoteMachineAuthFetchError":
    case "RemoteMachineAuthTimeoutError":
      return true;
    case "RemoteMachineAuthUndeclaredStatusError":
      return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status);
    default:
      return false;
  }
};

export class DesktopLocalMachineAuthBackendNotConfiguredError extends Schema.TaggedError<DesktopLocalMachineAuthBackendNotConfiguredError>()(
  "DesktopLocalMachineAuthBackendNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Local backend is not configured.";
  }
}

export class DesktopLocalMachineAuthSessionBootstrapError extends Schema.TaggedError<DesktopLocalMachineAuthSessionBootstrapError>()(
  "DesktopLocalMachineAuthSessionBootstrapError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to create the local desktop bearer session.";
  }
}

export const DesktopLocalMachineAuthError = Schema.Union([
  DesktopLocalMachineAuthBackendNotConfiguredError,
  DesktopLocalMachineAuthSessionBootstrapError,
]);
export type DesktopLocalMachineAuthError = typeof DesktopLocalMachineAuthError.Type;

export class DesktopLocalMachineAuth extends Context.Service<
  DesktopLocalMachineAuth,
  {
    readonly getBearerToken: Effect.Effect<string, DesktopLocalMachineAuthError>;
  }
>()("@vekrel/desktop/backend/DesktopLocalMachineAuth") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const httpClient = yield* HttpClient.HttpClient;
  const tokenRef = yield* Ref.make(Option.none<string>());
  const mutex = yield* Semaphore.make(1);

  const getBearerToken = mutex
    .withPermits(1)(
      Effect.gen(function* () {
        const cached = yield* Ref.get(tokenRef);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        const instances = yield* pool.list;
        const primary = instances.find((instance) => instance.id === PRIMARY_LOCAL_MACHINE_ID);
        const configOption = primary === undefined ? Option.none() : yield* primary.currentConfig;
        if (Option.isNone(configOption)) {
          return yield* new DesktopLocalMachineAuthBackendNotConfiguredError();
        }
        const config = configOption.value;
        // A backend launched with the desktop secret accepts the current
        // window's token, not the one frozen into its launch config; this
        // exchange can run long after launch (e.g. after a suspend).
        const secret = config.bootstrap.desktopBootstrapSecret;
        const credential =
          secret === undefined
            ? config.bootstrap.desktopBootstrapToken
            : currentDesktopBootstrapToken(secret, yield* Clock.currentTimeMillis);
        if (!credential) {
          return yield* new DesktopLocalMachineAuthBackendNotConfiguredError();
        }
        const session = yield* bootstrapRemoteBearerSession({
          httpBaseUrl: config.httpBaseUrl.href,
          credential,
          clientMetadata: {
            label: "Vekrel Desktop",
            deviceType: "desktop",
          },
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.retry({
            while: isTransientBearerBootstrapError,
            schedule: Schedule.spaced(BOOTSTRAP_TRANSIENT_RETRY_INTERVAL),
          }),
          Effect.timeout(BOOTSTRAP_TRANSIENT_RETRY_TIMEOUT),
          Effect.mapError(
            (cause) =>
              new DesktopLocalMachineAuthSessionBootstrapError({
                cause,
              }),
          ),
        );
        yield* Ref.set(tokenRef, Option.some(session.access_token));
        return session.access_token;
      }),
    )
    .pipe(Effect.withSpan("desktop.localMachineAuth.getBearerToken"));

  return DesktopLocalMachineAuth.of({ getBearerToken });
});

export const layer = Layer.effect(DesktopLocalMachineAuth, make);
