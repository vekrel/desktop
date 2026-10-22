import { AuthDiagnosticsReadScope } from "@vekrel/contracts";
import { AuthMachineMaintainScope } from "@vekrel/contracts";
import type {
  MachineId,
  ResourceTelemetryHistoryInput,
  ResourceTelemetrySnapshot,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";

import { usePrimaryMachine } from "../state/machines";
import { useMachineQuery } from "../state/query";
import { serverMachine } from "../state/server";
import { readMachineScope, useMachineScope } from "../state/session";
import { useAtomCommand } from "../state/use-atom-command";

export interface ResourceTelemetryState {
  readonly data: ResourceTelemetrySnapshot | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
  readonly retry: () => Promise<ResourceTelemetrySnapshot>;
}

export function useResourceTelemetry(
  targetMachineId?: MachineId | null,
): ResourceTelemetryState {
  const primaryMachine = usePrimaryMachine();
  const machineId =
    targetMachineId === undefined
      ? (primaryMachine?.machineId ?? null)
      : targetMachineId;
  const canReadDiagnostics = useMachineScope(machineId, AuthDiagnosticsReadScope);
  const query = useMachineQuery(
    machineId === null || !canReadDiagnostics
      ? null
      : serverMachine.resourceTelemetry({ machineId, input: {} }),
  );
  const retryCommand = useAtomCommand(serverMachine.retryResourceTelemetry, {
    reportFailure: false,
  });
  const retry = async () => {
    if (machineId === null) {
      throw new Error("No machine is selected.");
    }
    if (
      !readMachineScope(machineId, AuthMachineMaintainScope) ||
      !readMachineScope(machineId, AuthDiagnosticsReadScope)
    ) {
      throw new Error("This connection cannot restart the resource monitor.");
    }
    const result = await retryCommand({ machineId, input: {} });
    if (result._tag === "Failure") {
      throw Cause.squash(result.cause);
    }
    return result.value.snapshot;
  };

  return { ...query, retry };
}

export function useResourceTelemetryHistory(
  input: ResourceTelemetryHistoryInput,
  targetMachineId?: MachineId | null,
) {
  const primaryMachine = usePrimaryMachine();
  const machineId =
    targetMachineId === undefined
      ? (primaryMachine?.machineId ?? null)
      : targetMachineId;
  const canReadDiagnostics = useMachineScope(machineId, AuthDiagnosticsReadScope);
  return useMachineQuery(
    machineId === null || !canReadDiagnostics
      ? null
      : serverMachine.resourceTelemetryHistory({ machineId, input }),
  );
}
