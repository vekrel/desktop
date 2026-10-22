import { AuthFilesystemReadScope, type MachineId } from "@vekrel/contracts";
import { resolvePathLinkTarget, splitFilePathPosition } from "@vekrel/shared/fileLinks";
import {
  isAbsolutePath,
  isNetworkPath,
  normalizeProjectPathForComparison,
} from "@vekrel/shared/path";
import { useContext } from "react";

import { useMachineScope } from "../state/session";
import { projectMachine } from "../state/projects";
import { useMachineQuery } from "../state/query";
import { FileMetadataThreadContext } from "./FileMetadataThreadProvider";

export function useFileMetadata(
  machineId: MachineId | null | undefined,
  path: string,
  cwd?: string,
) {
  const canRead = useMachineScope(machineId ?? null, AuthFilesystemReadScope);
  const threadRef = useContext(FileMetadataThreadContext);
  const hostPath = splitFilePathPosition(path).path;
  const targetPath = normalizeProjectPathForComparison(
    hostPath.startsWith("~/") || !cwd ? hostPath : resolvePathLinkTarget(hostPath, cwd),
  );
  const absolute = isAbsolutePath(targetPath) || targetPath.startsWith("~/");
  return useMachineQuery(
    // Servers stat what they are asked about, and a network path leaks the
    // Windows user's NTLM credentials to its host before any chip is clicked.
    machineId && canRead && absolute && !isNetworkPath(targetPath) && targetPath.length <= 512
      ? projectMachine.fileMetadata({
          machineId,
          input: {
            path: targetPath,
            ...(threadRef?.machineId === machineId ? { threadId: threadRef.threadId } : {}),
          },
        })
      : null,
  ).data;
}
