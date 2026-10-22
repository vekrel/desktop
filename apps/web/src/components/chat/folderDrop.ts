import type { MachineId } from "@vekrel/contracts";

export function folderDropTarget(input: {
  localMachineDisabled: boolean;
  machineId: MachineId;
  primaryMachineId: MachineId | null;
}): "local" | "remote" {
  if (
    input.localMachineDisabled ||
    input.primaryMachineId === null ||
    input.machineId !== input.primaryMachineId
  ) {
    return "remote";
  }
  return "local";
}

export function resolveDroppedFolderPath(
  folder: File,
  getPathForFile: ((file: File) => string) | undefined,
): string | null {
  const path = getPathForFile?.(folder);
  return typeof path === "string" && path.length > 0 ? path : null;
}
