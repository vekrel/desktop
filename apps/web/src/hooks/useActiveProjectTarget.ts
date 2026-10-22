import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import type { MachineId, ScopedThreadRef } from "@vekrel/contracts";

import { useProjects } from "~/state/entities";

import { useHandleNewThread } from "./useHandleNewThread";

export interface ActiveProjectTarget {
  readonly machineId: MachineId;
  readonly cwd: string;
  readonly projectName: string;
  readonly threadRef: ScopedThreadRef;
}

export function useActiveProjectTarget(): ActiveProjectTarget | null {
  const { activeDraftThread, activeThread } = useHandleNewThread();
  const projects = useProjects();
  const thread = activeThread ?? activeDraftThread;
  const threadId = activeThread?.id ?? activeDraftThread?.threadId;
  const project = thread
    ? projects.find(
        (candidate) =>
          candidate.machineId === thread.machineId && candidate.id === thread.projectId,
      )
    : null;
  const cwd = thread?.worktreePath ?? project?.workspaceRoot;

  if (!thread || !threadId || !project || !cwd) return null;

  return {
    machineId: project.machineId,
    cwd,
    projectName: project.title,
    threadRef: scopeThreadRef(thread.machineId, threadId),
  };
}
