import { useAtomValue } from "@effect/atom-react";
import type {
  AtomCommandFailure,
  AtomCommandResult,
  AtomCommandSuccess,
} from "@vekrel/client-runtime/state/runtime";
import {
  VcsActionUnavailableError,
  type VcsActionOperation,
  type RunVcsStackedActionInput,
} from "@vekrel/client-runtime/state/vcs";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  MachineAuthorizationError,
  type MachineId,
  type GitResolvePullRequestResult,
  type SourceControlCloneProtocol,
  type SourceControlProviderKind,
  type SourceControlRepositoryVisibility,
  type ThreadId,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { gitMachine } from "./git";
import { useMachineQuery } from "./query";
import { readMachineScope, useMachineScope } from "./session";
import { sourceControlMachine } from "./sourceControl";
import { useAtomCommand } from "./use-atom-command";
import { vcsActionManager, vcsMachine } from "./vcs";

export type SourceControlActionKind =
  | "init"
  | "pull"
  | "publishRepository"
  | "runStackedAction"
  | "preparePullRequestThread";

export interface SourceControlActionScope {
  readonly machineId: MachineId | null;
  readonly cwd: string | null;
}

interface SourceControlActionState<
  TArgs extends ReadonlyArray<unknown>,
  R extends AtomCommandResult<unknown, unknown>,
> {
  readonly isPending: boolean;
  readonly isAllowed: boolean;
  readonly error: unknown;
  readonly run: (
    ...args: TArgs
  ) => Promise<
    AtomCommandResult<
      AtomCommandSuccess<R>,
      AtomCommandFailure<R> | VcsActionUnavailableError | MachineAuthorizationError
    >
  >;
  readonly resetError: () => void;
}

const ACTION_OPERATION = {
  init: "init",
  pull: "pull",
  publishRepository: "publish_repository",
  runStackedAction: "run_change_request",
  preparePullRequestThread: "prepare_pull_request_thread",
} as const satisfies Record<SourceControlActionKind, VcsActionOperation>;

function useAction<
  TArgs extends ReadonlyArray<unknown>,
  R extends AtomCommandResult<unknown, unknown>,
>(input: {
  readonly kind: SourceControlActionKind;
  readonly label: string;
  readonly scope: SourceControlActionScope;
  readonly action: (...args: TArgs) => Promise<R>;
  readonly onSuccess?: () => void;
  readonly managedExternally?: boolean;
}): SourceControlActionState<TArgs, R> {
  const isAllowed = useMachineScope(input.scope.machineId, AuthSourceControlWriteScope);
  const operation = ACTION_OPERATION[input.kind];
  const state = useAtomValue(vcsActionManager.stateAtom(input.scope));
  const ownsState = state.operation === operation;

  const resetError = () => {
    vcsActionManager.resetError(appAtomRegistry, input.scope, operation);
  };

  const run = async (...args: TArgs) => {
    if (
      input.scope.machineId === null ||
      !readMachineScope(input.scope.machineId, AuthSourceControlWriteScope)
    ) {
      return AsyncResult.failure<never, MachineAuthorizationError>(
        Cause.fail(
          new MachineAuthorizationError({
            requiredScope: AuthSourceControlWriteScope,
            message: "This connection cannot change source control.",
          }),
        ),
      );
    }
    const execute = async (): Promise<
      AtomCommandResult<AtomCommandSuccess<R>, AtomCommandFailure<R>>
    > => {
      const result = await input.action(...args);
      if (AsyncResult.isSuccess(result)) {
        input.onSuccess?.();
      }
      return result as AtomCommandResult<AtomCommandSuccess<R>, AtomCommandFailure<R>>;
    };
    return input.managedExternally === true
      ? execute()
      : vcsActionManager.track(
          appAtomRegistry,
          input.scope,
          {
            operation,
            label: input.label,
          },
          execute,
        );
  };

  return {
    isAllowed,
    error: ownsState ? state.error : null,
    isPending: ownsState && state.isRunning,
    resetError,
    run,
  };
}

function resolveScope(scope: SourceControlActionScope) {
  if (scope.machineId === null || scope.cwd === null) {
    return null;
  }
  return {
    machineId: scope.machineId,
    cwd: scope.cwd,
  };
}

export function useSourceControlActionRunning(
  scope: SourceControlActionScope,
  kinds: ReadonlyArray<SourceControlActionKind>,
): boolean {
  const state = useAtomValue(vcsActionManager.stateAtom(scope));
  return (
    state.isRunning &&
    state.operation !== null &&
    kinds.some((kind) => ACTION_OPERATION[kind] === state.operation)
  );
}

export function useVcsInitAction(scope: SourceControlActionScope) {
  const init = useAtomCommand(vcsMachine.init, { reportFailure: false });
  const action = async () => {
    const target = resolveScope(scope);
    if (target === null) {
      return AsyncResult.failure<never, VcsActionUnavailableError>(
        Cause.fail(
          new VcsActionUnavailableError({
            operation: "init",
            machineId: scope.machineId,
            cwd: scope.cwd,
          }),
        ),
      );
    }
    return init({
      machineId: target.machineId,
      input: { cwd: target.cwd },
    });
  };
  return useAction({ kind: "init", label: "Initializing repository", scope, action });
}

export function useVcsPullAction(scope: SourceControlActionScope) {
  const pull = useAtomCommand(vcsMachine.pull, { reportFailure: false });
  const status = useMachineQuery(
    scope.machineId !== null && scope.cwd !== null
      ? vcsMachine.status({
          machineId: scope.machineId,
          input: { cwd: scope.cwd },
        })
      : null,
  );
  const action = async () => {
    const target = resolveScope(scope);
    if (target === null) {
      return AsyncResult.failure<never, VcsActionUnavailableError>(
        Cause.fail(
          new VcsActionUnavailableError({
            operation: "pull",
            machineId: scope.machineId,
            cwd: scope.cwd,
          }),
        ),
      );
    }
    return pull({
      machineId: target.machineId,
      input: { cwd: target.cwd },
    });
  };
  return useAction({
    kind: "pull",
    label: "Pulling latest changes...",
    scope,
    action,
    onSuccess: status.refresh,
  });
}

export function useGitStackedAction(scope: SourceControlActionScope) {
  const runStackedAction = useAtomCommand(vcsActionManager.runStackedAction(scope), {
    reportFailure: false,
  });
  const status = useMachineQuery(
    scope.machineId !== null && scope.cwd !== null
      ? vcsMachine.status({
          machineId: scope.machineId,
          input: { cwd: scope.cwd },
        })
      : null,
  );

  const action = async (input: RunVcsStackedActionInput) => {
    if (resolveScope(scope) === null) {
      return AsyncResult.failure<never, VcsActionUnavailableError>(
        Cause.fail(
          new VcsActionUnavailableError({
            operation: "run_change_request",
            machineId: scope.machineId,
            cwd: scope.cwd,
          }),
        ),
      );
    }
    return runStackedAction(input);
  };

  return useAction({
    kind: "runStackedAction",
    label: "Running source control action",
    scope,
    action,
    onSuccess: status.refresh,
    managedExternally: true,
  });
}

export function useSourceControlPublishRepositoryAction(scope: SourceControlActionScope) {
  const publishRepository = useAtomCommand(sourceControlMachine.publishRepository, {
    reportFailure: false,
  });
  const status = useMachineQuery(
    scope.machineId !== null && scope.cwd !== null
      ? vcsMachine.status({
          machineId: scope.machineId,
          input: { cwd: scope.cwd },
        })
      : null,
  );
  const action = async (input: {
    provider: SourceControlProviderKind;
    repository: string;
    visibility: SourceControlRepositoryVisibility;
    remoteName: string;
    protocol: SourceControlCloneProtocol;
  }) => {
    const target = resolveScope(scope);
    if (target === null) {
      return AsyncResult.failure<never, VcsActionUnavailableError>(
        Cause.fail(
          new VcsActionUnavailableError({
            operation: "publish_repository",
            machineId: scope.machineId,
            cwd: scope.cwd,
          }),
        ),
      );
    }
    return publishRepository({
      machineId: target.machineId,
      input: {
        cwd: target.cwd,
        ...input,
      },
    });
  };
  return useAction({
    kind: "publishRepository",
    label: "Publishing repository",
    scope,
    action,
    onSuccess: status.refresh,
  });
}

export function usePreparePullRequestThreadAction(scope: SourceControlActionScope) {
  const preparePullRequestThread = useAtomCommand(gitMachine.preparePullRequestThread, {
    reportFailure: false,
  });
  const action = async (input: {
    reference: string;
    mode: "local" | "worktree";
    threadId?: ThreadId;
  }) => {
    const target = resolveScope(scope);
    if (target === null) {
      return AsyncResult.failure<never, VcsActionUnavailableError>(
        Cause.fail(
          new VcsActionUnavailableError({
            operation: "prepare_pull_request_thread",
            machineId: scope.machineId,
            cwd: scope.cwd,
          }),
        ),
      );
    }
    if (
      input.mode === "worktree" &&
      input.threadId !== undefined &&
      !readMachineScope(target.machineId, AuthOrchestrationOperateScope)
    ) {
      return AsyncResult.failure<never, MachineAuthorizationError>(
        Cause.fail(
          new MachineAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: "This connection cannot change threads.",
          }),
        ),
      );
    }
    return preparePullRequestThread({
      machineId: target.machineId,
      input: {
        cwd: target.cwd,
        reference: input.reference,
        mode: input.mode,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      },
    });
  };
  return useAction({
    kind: "preparePullRequestThread",
    label: "Preparing pull request thread",
    scope,
    action,
  });
}

export interface PullRequestResolutionTarget {
  readonly machineId: MachineId | null;
  readonly cwd: string | null;
  readonly reference: string | null;
}

export function readCachedPullRequestResolution(
  target: PullRequestResolutionTarget,
): GitResolvePullRequestResult | null {
  if (target.machineId === null || target.cwd === null || target.reference === null) {
    return null;
  }
  return Option.getOrNull(
    AsyncResult.value(
      appAtomRegistry.get(
        gitMachine.pullRequestResolution({
          machineId: target.machineId,
          input: { cwd: target.cwd, reference: target.reference },
        }),
      ),
    ),
  );
}

export function usePullRequestResolutionState(target: PullRequestResolutionTarget) {
  const query = useMachineQuery(
    target.machineId !== null && target.cwd !== null && target.reference !== null
      ? gitMachine.pullRequestResolution({
          machineId: target.machineId,
          input: {
            cwd: target.cwd,
            reference: target.reference,
          },
        })
      : null,
  );
  const cached = readCachedPullRequestResolution(target);

  return {
    data: query.data ?? cached,
    error: query.error,
    isPending: query.isPending && cached === null,
    isFetching: query.isPending,
    refresh: query.refresh,
  };
}
