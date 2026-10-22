import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/http";
import {
  MachineCloudEndpointUnavailableError,
  type MachineCloudLinkStateResult,
  MachineHttpBadRequestError,
  MachineHttpConflictError,
  MachineHttpForbiddenError,
  MachineHttpInternalServerError,
  MachineHttpUnauthorizedError,
  MachineId,
  WS_METHODS,
} from "@vekrel/contracts";
import {
  type RelayMachineLinkResponse,
  type RelayManagedEndpointProviderKind,
} from "@vekrel/contracts/relay";
import { MachineRegistry } from "@vekrel/client-runtime/connection";
import { request, runStream } from "@vekrel/client-runtime/rpc";
import { makeMachineHttpApiClient } from "@vekrel/client-runtime/rpc";
import { ManagedRelay, relayRequestFailureDetail } from "@vekrel/client-runtime/relay";

import * as PrimaryMachineHttpLayer from "../machines/primary/httpLayer";
import { resolveCloudPublicConfig } from "./publicConfig";
import {
  finishRelayClientInstall,
  reportRelayClientInstallProgress,
  requestRelayClientInstallConfirmation,
} from "./relayClientInstallDialog";

function relayUrl(): string | null {
  return resolveCloudPublicConfig().relayUrl;
}

export class CloudMachineLinkError extends Data.TaggedError("CloudMachineLinkError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly traceId?: string;
}> {}

const relayClientRpcError = (message: string) => (cause: unknown) =>
  new CloudMachineLinkError({
    message,
    cause,
  });

const ensureRelayClientAvailable = Effect.fn("linkMachine.ensureRelayClientAvailable")(
  function* (
    machineId: MachineId,
  ): Effect.fn.Return<void, CloudMachineLinkError, MachineRegistry.MachineRegistry> {
    const registry = yield* MachineRegistry.MachineRegistry;
    const status = yield* registry
      .run(machineId, request(WS_METHODS.cloudGetRelayClientStatus, {}))
      .pipe(Effect.mapError(relayClientRpcError("Could not check relay client availability.")));
    if (status.status === "available") return;
    if (status.status === "unsupported") {
      return yield* new CloudMachineLinkError({
        message: `Vekrel cannot install the relay client automatically on ${status.platform}-${status.arch}.`,
      });
    }

    const confirmed = yield* Effect.tryPromise({
      try: () => requestRelayClientInstallConfirmation(status.version),
      catch: relayClientRpcError("Could not confirm relay client installation."),
    });
    if (!confirmed) {
      return yield* new CloudMachineLinkError({
        message: "Relay client installation was cancelled.",
      });
    }

    const installed = yield* registry
      .runStream(
        machineId,
        runStream(WS_METHODS.cloudInstallRelayClient, {}).pipe(
          Stream.tap((event) => Effect.sync(() => reportRelayClientInstallProgress(event))),
        ),
      )
      .pipe(
        Stream.runLast,
        Effect.mapError(relayClientRpcError("Could not install the relay client.")),
        Effect.ensuring(Effect.sync(finishRelayClientInstall)),
      );
    if (Option.isNone(installed) || installed.value.type !== "complete") {
      return yield* new CloudMachineLinkError({
        message: "The relay client install completed without a final status.",
      });
    }
    const installedStatus = installed.value.status;
    if (installedStatus.status !== "available") {
      return yield* new CloudMachineLinkError({
        message:
          installedStatus.status === "unsupported"
            ? `Vekrel cannot install the relay client automatically on ${installedStatus.platform}-${installedStatus.arch}.`
            : "The relay client is still unavailable after installation.",
      });
    }
  },
);

const isMachineCloudApiError = Schema.is(
  Schema.Union([
    MachineHttpBadRequestError,
    MachineHttpUnauthorizedError,
    MachineHttpForbiddenError,
    MachineHttpConflictError,
    MachineHttpInternalServerError,
    MachineCloudEndpointUnavailableError,
  ]),
);

function decodedRelayClientError(message: string) {
  return (cause: ManagedRelay.ManagedRelayClientError) => {
    const failed = cause._tag === "ManagedRelayRequestFailedError" ? cause : undefined;
    const traceId = failed?.traceId;
    const detail = failed ? relayRequestFailureDetail(failed) : null;
    return new CloudMachineLinkError({
      message: detail ? `${message}: ${detail}` : message,
      cause,
      ...(traceId ? { traceId } : {}),
    });
  };
}

function findMachineCloudApiError(cause: unknown): { readonly message: string } | null {
  if (isMachineCloudApiError(cause)) {
    return cause;
  }
  if (typeof cause !== "object" || cause === null) {
    return null;
  }
  return "cause" in cause ? findMachineCloudApiError(cause.cause) : null;
}

const machineApiError = (message: string) => (cause: unknown) => {
  const machineError = findMachineCloudApiError(cause);
  return new CloudMachineLinkError({
    message: machineError
      ? `${message.replace(/[.:]$/, "")}: ${machineError.message}`
      : message,
    cause,
  });
};

function endpointOrigin(httpBaseUrl: string) {
  const url = new URL(httpBaseUrl);
  return {
    localHttpHost: "127.0.0.1",
    localHttpPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

const MANAGED_ENDPOINT_PROVIDER_KIND =
  "cloudflare_tunnel" satisfies RelayManagedEndpointProviderKind;

function ensureLinkedMachineMatches(input: {
  readonly expectedMachineId: string;
  readonly expectedProviderKind: RelayManagedEndpointProviderKind;
  readonly link: RelayMachineLinkResponse;
}): Effect.Effect<void, CloudMachineLinkError> {
  if (input.link.machineId !== input.expectedMachineId) {
    return new CloudMachineLinkError({
      message: "Relay returned credentials for a different machine.",
    });
  }
  if (input.link.endpoint.providerKind !== input.expectedProviderKind) {
    return new CloudMachineLinkError({
      message: "Relay returned credentials for a different endpoint provider.",
    });
  }
  return Effect.void;
}

export interface CloudLinkTarget {
  readonly machineId: string;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type CloudLinkState = MachineCloudLinkStateResult;

export const readPrimaryCloudLinkState: (input: {
  readonly target: CloudLinkTarget;
}) => Effect.Effect<CloudLinkState | null, CloudMachineLinkError, HttpClient.HttpClient> =
  Effect.fn("linkMachine.readPrimaryCloudLinkState")(function* (input: {
    readonly target: CloudLinkTarget;
  }) {
    const client = yield* makeMachineHttpApiClient(input.target.httpBaseUrl);
    return yield* client.connect
      .linkState({ headers: {} })
      .pipe(Effect.mapError(machineApiError("Could not read machine cloud link state.")));
  }, Effect.provide(PrimaryMachineHttpLayer.layer));

export const updatePrimaryCloudPreferences: (input: {
  readonly target: CloudLinkTarget;
  readonly publishAgentActivity: boolean;
  readonly holdWebhooksWhileOffline?: boolean;
}) => Effect.Effect<CloudLinkState, CloudMachineLinkError, HttpClient.HttpClient> = Effect.fn(
  "linkMachine.updatePrimaryCloudPreferences",
)(function* (input: {
  readonly target: CloudLinkTarget;
  readonly publishAgentActivity: boolean;
  readonly holdWebhooksWhileOffline?: boolean;
}) {
  const client = yield* makeMachineHttpApiClient(input.target.httpBaseUrl);
  const { target: _target, ...payload } = input;
  return yield* client.connect
    .preferences({
      headers: {},
      payload,
    })
    .pipe(Effect.mapError(machineApiError("Could not update machine cloud preferences.")));
}, Effect.provide(PrimaryMachineHttpLayer.layer));

export const unlinkPrimaryMachineFromCloud: (input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string | null;
}) => Effect.Effect<
  void,
  CloudMachineLinkError,
  HttpClient.HttpClient | ManagedRelay.ManagedRelayClient
> = Effect.fn("linkMachine.unlinkPrimaryMachineFromCloud")(function* (input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string | null;
}) {
  const client = yield* makeMachineHttpApiClient(input.target.httpBaseUrl);
  yield* client.connect
    .unlink({ headers: {} })
    .pipe(Effect.mapError(machineApiError("Could not unlink the machine from cloud.")));

  const configuredRelayUrl = relayUrl();
  if (configuredRelayUrl && input.clerkToken) {
    const relayClient = yield* ManagedRelay.ManagedRelayClient;
    yield* relayClient
      .unlinkMachine({
        clerkToken: input.clerkToken,
        machineId: MachineId.make(input.target.machineId),
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not revoke cloud machine link after local unlink.", {
            cause,
          }),
        ),
      );
  }
}, Effect.provide(PrimaryMachineHttpLayer.layer));

export type CloudLinkMode = "managed" | "publish_only";

const PUBLISH_ONLY_PROVIDER_KIND = "manual" satisfies RelayManagedEndpointProviderKind;

export const linkPrimaryMachineToCloud: (input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string;
  readonly mode?: CloudLinkMode;
}) => Effect.Effect<
  void,
  CloudMachineLinkError,
  MachineRegistry.MachineRegistry | HttpClient.HttpClient | ManagedRelay.ManagedRelayClient
> = Effect.fn("linkMachine.linkPrimaryMachineToCloud")(function* (input: {
  readonly target: CloudLinkTarget;
  readonly clerkToken: string;
  readonly mode?: CloudLinkMode;
}) {
  const configuredRelayUrl = relayUrl();
  if (!configuredRelayUrl) {
    return yield* new CloudMachineLinkError({
      message: "VEKREL_RELAY_URL is not configured.",
    });
  }
  const managedTunnelsEnabled = (input.mode ?? "managed") === "managed";
  const providerKind = managedTunnelsEnabled
    ? MANAGED_ENDPOINT_PROVIDER_KIND
    : PUBLISH_ONLY_PROVIDER_KIND;
  const relayClient = yield* ManagedRelay.ManagedRelayClient;
  const machineClient = yield* makeMachineHttpApiClient(input.target.httpBaseUrl);
  if (managedTunnelsEnabled) {
    yield* ensureRelayClientAvailable(MachineId.make(input.target.machineId));
  }

  const challenge = yield* relayClient
    .createMachineLinkChallenge({
      clerkToken: input.clerkToken,
      payload: {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled,
      },
    })
    .pipe(
      Effect.mapError(
        decodedRelayClientError(
          `${configuredRelayUrl}/v1/client/machine-link-challenges failed`,
        ),
      ),
    );
  const proof = yield* machineClient.connect
    .linkProof({
      headers: {},
      payload: {
        challenge: challenge.challenge,
        relayIssuer: configuredRelayUrl,
        endpoint: {
          httpBaseUrl: input.target.httpBaseUrl,
          wsBaseUrl: input.target.wsBaseUrl,
          providerKind,
        },
        origin: endpointOrigin(input.target.httpBaseUrl),
      },
    })
    .pipe(Effect.mapError(machineApiError("Could not obtain machine link proof.")));
  const link = yield* relayClient
    .linkMachine({
      clerkToken: input.clerkToken,
      payload: {
        proof,
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled,
      },
    })
    .pipe(
      Effect.mapError(
        decodedRelayClientError(`${configuredRelayUrl}/v1/client/machine-links failed`),
      ),
    );
  yield* ensureLinkedMachineMatches({
    expectedMachineId: input.target.machineId,
    expectedProviderKind: providerKind,
    link,
  });

  yield* machineClient.connect
    .relayConfig({
      headers: {},
      payload: {
        relayUrl: configuredRelayUrl,
        relayIssuer: link.relayIssuer,
        cloudUserId: link.cloudUserId,
        machineCredential: link.machineCredential,
        cloudMintPublicKey: link.cloudMintPublicKey,
        endpointRuntime: link.endpointRuntime,
      },
    })
    .pipe(Effect.mapError(machineApiError("Could not configure machine relay access.")));
}, Effect.provide(PrimaryMachineHttpLayer.layer));
