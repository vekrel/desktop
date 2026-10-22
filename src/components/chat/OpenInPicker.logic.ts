import type { MachineId } from "@vekrel/contracts";

import type { RemoteOpenMode } from "../../remoteOpen";

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadMachineId: MachineId;
  readonly primaryMachineId: MachineId | null;
  readonly remoteOpenMode: RemoteOpenMode;
}): boolean {
  if (!input.activeProjectName) return false;
  if (
    input.primaryMachineId !== null &&
    input.activeThreadMachineId === input.primaryMachineId
  ) {
    return true;
  }
  return input.remoteOpenMode !== "local-exec";
}
