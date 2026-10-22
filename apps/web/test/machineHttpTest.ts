import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  AuthSessionId,
  MachineAuthenticatedAuth,
  MachineAuthenticatedPrincipal,
  MachineHttpApi,
  type AuthBrowserSessionRequest,
  type AuthBrowserSessionResult,
  type AuthCreatePairingCredentialInput,
  type AuthMachineScope,
  type AuthPairingCredentialResult,
  type AuthSessionState,
  type ExecutionMachineDescriptor,
  type MachineAuthInvalidError,
} from "@vekrel/contracts";
import * as DateTime from "effect/DateTime";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { HttpApiTest } from "effect/http-api";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import { PrimaryMachineHttpClient } from "../src/machines/primary/httpClient";
import { __setPrimaryHttpRunnerForTests } from "../src/lib/runtime";

type BrowserSessionHandler = (
  payload: AuthBrowserSessionRequest,
) => Effect.Effect<AuthBrowserSessionResult, MachineAuthInvalidError>;

interface MachineHttpTestScenario {
  readonly descriptor?: () => Effect.Effect<ExecutionMachineDescriptor>;
  readonly session?: () => Effect.Effect<AuthSessionState>;
  readonly browserSession?: BrowserSessionHandler;
  readonly pairingCredential?: (
    payload: AuthCreatePairingCredentialInput,
  ) => Effect.Effect<AuthPairingCredentialResult>;
}

export interface MachineHttpTestCalls {
  descriptor: number;
  session: number;
  browserSession: Array<AuthBrowserSessionRequest>;
  pairingCredential: Array<AuthCreatePairingCredentialInput>;
}

const unexpectedEndpoint = (endpoint: string) =>
  Effect.die(new Error(`Unexpected machine HTTP endpoint: ${endpoint}`));

const authenticatedAuth: Context.Service.Shape<typeof MachineAuthenticatedAuth> = (
  httpEffect,
) =>
  httpEffect.pipe(
    Effect.provideService(MachineAuthenticatedPrincipal, {
      sessionId: AuthSessionId.make("test-session"),
      subject: "test-client",
      method: "browser-session-cookie",
      scopes: new Set<AuthMachineScope>(),
      expiresAt: DateTime.makeUnsafe("2026-05-01T12:00:00.000Z"),
    }),
  );

export async function installMachineHttpTest(scenario: MachineHttpTestScenario) {
  const calls: MachineHttpTestCalls = {
    descriptor: 0,
    session: 0,
    browserSession: [],
    pairingCredential: [],
  };

  const client = await Effect.runPromise(
    HttpApiTest.groups(MachineHttpApi, ["metadata", "auth"]).pipe(
      Effect.provide([
        NodeHttpServer.layerHttpServices,
        HttpApiBuilder.group(MachineHttpApi, "metadata", (handlers) =>
          handlers.handle(
            "descriptor",
            Effect.fn("test.machine.metadata.descriptor")(function* () {
              calls.descriptor += 1;
              return yield* scenario.descriptor?.() ?? unexpectedEndpoint("metadata.descriptor");
            }),
          ),
        ),
        HttpApiBuilder.group(MachineHttpApi, "auth", (handlers) =>
          handlers
            .handle(
              "session",
              Effect.fn("test.machine.auth.session")(function* () {
                calls.session += 1;
                return yield* scenario.session?.() ?? unexpectedEndpoint("auth.session");
              }),
            )
            .handle(
              "browserSession",
              Effect.fn("test.machine.auth.browserSession")(function* ({ payload }) {
                calls.browserSession.push(payload);
                return yield* (
                  scenario.browserSession?.(payload) ?? unexpectedEndpoint("auth.browserSession")
                );
              }),
            )
            .handle("token", () => unexpectedEndpoint("auth.token"))
            .handle("webSocketTicket", () => unexpectedEndpoint("auth.webSocketTicket"))
            .handle(
              "pairingCredential",
              Effect.fn("test.machine.auth.pairingCredential")(function* ({ payload }) {
                calls.pairingCredential.push(payload);
                return yield* (
                  scenario.pairingCredential?.(payload) ??
                    unexpectedEndpoint("auth.pairingCredential")
                );
              }),
            )
            .handle("pairingLinks", () => unexpectedEndpoint("auth.pairingLinks"))
            .handle("revokePairingLink", () => unexpectedEndpoint("auth.revokePairingLink"))
            .handle("clients", () => unexpectedEndpoint("auth.clients"))
            .handle("revokeClient", () => unexpectedEndpoint("auth.revokeClient"))
            .handle("revokeOtherClients", () => unexpectedEndpoint("auth.revokeOtherClients")),
        ),
      ]),
      Effect.provideService(MachineAuthenticatedAuth, authenticatedAuth),
      Effect.scoped,
    ),
  );

  const runtime = ManagedRuntime.make(Layer.succeed(PrimaryMachineHttpClient, client));
  __setPrimaryHttpRunnerForTests((effect) => runtime.runPromise(effect));

  return {
    calls,
    async dispose() {
      __setPrimaryHttpRunnerForTests();
      await runtime.dispose();
    },
  };
}
