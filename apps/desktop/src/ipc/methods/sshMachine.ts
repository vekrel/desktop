import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  issueRemoteWebSocketTicket,
  RemoteMachineAuthUndeclaredStatusError,
  type RemoteMachineAuthError,
} from "@vekrel/client-runtime/authorization";
import { fetchRemoteMachineDescriptor } from "@vekrel/client-runtime/machine";
import {
  MachineAuthInvalidError,
  DesktopDiscoveredSshHostSchema,
  DesktopSshBearerBootstrapInputSchema,
  DesktopSshBearerRequestInputSchema,
  DesktopSshMachineEnsureInputSchema,
  DesktopSshMachineEnsureResultSchema,
  DesktopSshMachineTargetSchema,
  DesktopSshHttpBaseUrlInputSchema,
  DesktopSshPasswordPromptCancelledType,
  DesktopSshPasswordPromptResolutionInputSchema,
  ExecutionMachineDescriptor,
  MachineInternalError,
  MachineOperationForbiddenError,
  MachineRequestInvalidError,
  MachineScopeRequiredError,
  AuthAccessTokenResult,
  AuthSessionState,
  AuthWebSocketTicketResult,
} from "@vekrel/contracts";
import { SshHttpBridgeError } from "@vekrel/ssh/errors";
import { resolveLoopbackSshHttpBaseUrl } from "@vekrel/ssh/tunnel";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as DesktopSshMachine from "../../ssh/DesktopSshMachine.ts";
import * as DesktopSshPasswordPrompts from "../../ssh/DesktopSshPasswordPrompts.ts";

type DesktopSshMachineRequestOperation =
  | "fetch-machine-descriptor"
  | "bootstrap-bearer-session"
  | "fetch-session-state"
  | "issue-websocket-ticket";

type DesktopSshMachineRequestCause = RemoteMachineAuthError | SshHttpBridgeError;

const isMachineAuthInvalidError = Schema.is(MachineAuthInvalidError);
const isMachineInternalError = Schema.is(MachineInternalError);
const isMachineOperationForbiddenError = Schema.is(MachineOperationForbiddenError);
const isMachineRequestInvalidError = Schema.is(MachineRequestInvalidError);
const isMachineScopeRequiredError = Schema.is(MachineScopeRequiredError);

function readSshHttpStatus(cause: DesktopSshMachineRequestCause): number | null {
  if (
    cause instanceof RemoteMachineAuthUndeclaredStatusError ||
    cause instanceof SshHttpBridgeError
  ) {
    return cause.status ?? null;
  }
  if (isMachineRequestInvalidError(cause)) {
    return 400;
  }
  if (isMachineAuthInvalidError(cause)) {
    return 401;
  }
  if (isMachineScopeRequiredError(cause)) {
    return 403;
  }
  if (isMachineOperationForbiddenError(cause)) {
    return 403;
  }
  if (isMachineInternalError(cause)) {
    return 500;
  }
  return null;
}

export class DesktopSshMachineRequestError extends Data.TaggedError(
  "DesktopSshMachineRequestError",
)<{
  readonly operation: DesktopSshMachineRequestOperation;
  readonly cause: DesktopSshMachineRequestCause;
  readonly sshHttpStatus: number | null;
}> {
  override get message() {
    const prefix = this.sshHttpStatus === null ? "" : `[ssh_http:${this.sshHttpStatus}] `;
    return `${prefix}SSH remote API request failed during ${this.operation}.`;
  }
}

const withLoopbackSshApi =
  <A, R>(
    operation: DesktopSshMachineRequestOperation,
    use: (httpBaseUrl: string) => Effect.Effect<A, RemoteMachineAuthError, R>,
  ) =>
  (httpBaseUrl: string): Effect.Effect<A, DesktopSshMachineRequestError, R> =>
    resolveLoopbackSshHttpBaseUrl(httpBaseUrl).pipe(
      Effect.flatMap(use),
      Effect.mapError(
        (cause) =>
          new DesktopSshMachineRequestError({
            operation,
            cause,
            sshHttpStatus: readSshHttpStatus(cause),
          }),
      ),
    );

export const discoverSshHosts = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(DesktopDiscoveredSshHostSchema),
  handler: Effect.fn("desktop.ipc.sshMachine.discoverHosts")(function* () {
    const sshMachine = yield* DesktopSshMachine.DesktopSshMachine;
    return yield* sshMachine.discoverHosts();
  }),
});

export const resolveSshHost = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RESOLVE_SSH_HOST_CHANNEL,
  payload: Schema.String,
  result: DesktopSshMachineTargetSchema,
  handler: Effect.fn("desktop.ipc.sshMachine.resolveHost")(function* (alias) {
    const sshMachine = yield* DesktopSshMachine.DesktopSshMachine;
    return yield* sshMachine.resolveHost(alias);
  }),
});

export const ensureSshMachine = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ENSURE_SSH_MACHINE_CHANNEL,
  payload: DesktopSshMachineEnsureInputSchema,
  result: DesktopSshMachineEnsureResultSchema,
  handler: Effect.fn("desktop.ipc.sshMachine.ensureMachine")(function* ({
    target,
    options,
  }) {
    const sshMachine = yield* DesktopSshMachine.DesktopSshMachine;
    return yield* sshMachine.ensureMachine(target, options).pipe(
      Effect.catchIf(DesktopSshMachine.isDesktopSshPasswordPromptCancellation, (error) =>
        Effect.succeed({
          type: DesktopSshPasswordPromptCancelledType,
          message: error.message,
        }),
      ),
    );
  }),
});

export const disconnectSshMachine = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DISCONNECT_SSH_MACHINE_CHANNEL,
  payload: DesktopSshMachineTargetSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.sshMachine.disconnectMachine")(function* (target) {
    const sshMachine = yield* DesktopSshMachine.DesktopSshMachine;
    yield* sshMachine.disconnectMachine(target);
  }),
});

export const fetchSshMachineDescriptor = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FETCH_SSH_MACHINE_DESCRIPTOR_CHANNEL,
  payload: DesktopSshHttpBaseUrlInputSchema,
  result: ExecutionMachineDescriptor,
  handler: Effect.fn("desktop.ipc.sshMachine.fetchDescriptor")(function* ({ httpBaseUrl }) {
    return yield* withLoopbackSshApi("fetch-machine-descriptor", (resolvedHttpBaseUrl) =>
      fetchRemoteMachineDescriptor({ httpBaseUrl: resolvedHttpBaseUrl }),
    )(httpBaseUrl);
  }),
});

export const bootstrapSshBearerSession = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL,
  payload: DesktopSshBearerBootstrapInputSchema,
  result: AuthAccessTokenResult,
  handler: Effect.fn("desktop.ipc.sshMachine.bootstrapBearerSession")(function* ({
    httpBaseUrl,
    credential,
  }) {
    return yield* withLoopbackSshApi("bootstrap-bearer-session", (resolvedHttpBaseUrl) =>
      bootstrapRemoteBearerSession({
        httpBaseUrl: resolvedHttpBaseUrl,
        credential,
      }),
    )(httpBaseUrl);
  }),
});

export const fetchSshSessionState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthSessionState,
  handler: Effect.fn("desktop.ipc.sshMachine.fetchSessionState")(function* ({
    httpBaseUrl,
    bearerToken,
  }) {
    return yield* withLoopbackSshApi("fetch-session-state", (resolvedHttpBaseUrl) =>
      fetchRemoteSessionState({
        httpBaseUrl: resolvedHttpBaseUrl,
        bearerToken,
      }),
    )(httpBaseUrl);
  }),
});

export const issueSshWebSocketTicket = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ISSUE_SSH_WEBSOCKET_TOKEN_CHANNEL,
  payload: DesktopSshBearerRequestInputSchema,
  result: AuthWebSocketTicketResult,
  handler: Effect.fn("desktop.ipc.sshMachine.issueWebSocketTicket")(function* ({
    httpBaseUrl,
    bearerToken,
  }) {
    return yield* withLoopbackSshApi("issue-websocket-ticket", (resolvedHttpBaseUrl) =>
      issueRemoteWebSocketTicket({
        httpBaseUrl: resolvedHttpBaseUrl,
        bearerToken,
      }),
    )(httpBaseUrl);
  }),
});

export const resolveSshPasswordPrompt = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL,
  payload: DesktopSshPasswordPromptResolutionInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.sshMachine.resolvePasswordPrompt")(function* ({
    requestId,
    password,
  }) {
    const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
    yield* prompts.resolve({ requestId, password });
  }),
});
