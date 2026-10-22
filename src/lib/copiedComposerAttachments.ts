import type { MachineId } from "@vekrel/contracts";

// Keep the latest copy's files alive after source removal, including preview URL revocation.
// Replacing the copy releases the previous files instead of accumulating draft attachments.
let latestCopy: { machineId: MachineId; files: ReadonlyMap<string, File> } | null = null;

export function rememberCopiedComposerAttachments(
  machineId: MachineId,
  files: ReadonlyMap<string, File>,
): void {
  latestCopy = files.size > 0 ? { machineId, files } : null;
}

export function copiedComposerAttachmentFile(
  machineId: MachineId,
  attachmentId: string,
): File | undefined {
  return latestCopy?.machineId === machineId
    ? latestCopy.files.get(attachmentId)
    : undefined;
}
