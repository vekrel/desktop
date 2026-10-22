import {
  createFilesystemMachineAtoms,
  resolveFilesystemReadAccess,
} from "@vekrel/client-runtime/state/filesystem";
import type { MachineId } from "@vekrel/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useMachinePresentation } from "./presentation";
import { useMachineQuery } from "./query";
import { machineSession } from "./session";

export const filesystemMachine = createFilesystemMachineAtoms(connectionAtomRuntime);

export function useFilesystemReadAccess(machineId: MachineId | null) {
  const session = useMachineQuery(
    machineId === null ? null : machineSession.sessionStateAtom(machineId),
  );
  const machine = useMachinePresentation(machineId);
  return resolveFilesystemReadAccess({
    isCatalogReady: machine.isReady,
    connection: machine.presentation?.connection ?? null,
    session: session.data,
    sessionError: session.error,
  });
}
