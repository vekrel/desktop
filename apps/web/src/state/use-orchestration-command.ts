import type {
  AtomCommand,
  AtomCommandOptions,
  AtomCommandResult,
} from "@vekrel/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  MachineAuthorizationError,
  type MachineId,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { readMachineScope } from "./session";
import { useAtomCommand } from "./use-atom-command";

export const ORCHESTRATION_OPERATE_DENIED_MESSAGE =
  "This connection cannot change threads or projects.";

export function useOrchestrationCommand<W extends { readonly machineId: MachineId }, A, E>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E | MachineAuthorizationError>> {
  const run = useAtomCommand(command, options);
  return async (value: W): Promise<AtomCommandResult<A, E | MachineAuthorizationError>> => {
    if (!readMachineScope(value.machineId, AuthOrchestrationOperateScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new MachineAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: ORCHESTRATION_OPERATE_DENIED_MESSAGE,
          }),
        ),
      );
    }
    return run(value);
  };
}
