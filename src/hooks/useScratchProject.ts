import { scopeProjectRef } from "@vekrel/client-runtime/machine";
import { availableScratchWorkspaceRoot } from "@vekrel/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";
import type { MachineId } from "@vekrel/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useMachines } from "~/state/machines";
import { projectMachine } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function useScratchProject() {
  const { machines } = useMachines();
  const openScratch = useAtomCommand(projectMachine.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const scratchWorkspaceRootFor = (machineId: MachineId | null): string | null => {
    const machine = machines.find((entry) => entry.machineId === machineId);
    return availableScratchWorkspaceRoot(machine?.connection.phase, machine?.serverConfig);
  };

  const scratchMachineId = (current: MachineId | null): MachineId | null => {
    if (current !== null) return scratchWorkspaceRootFor(current) !== null ? current : null;
    const offering = machines.filter(
      (entry) => scratchWorkspaceRootFor(entry.machineId) !== null,
    );
    return offering.length === 1 ? (offering[0]?.machineId ?? null) : null;
  };

  const openScratchProject = async (
    machineId: MachineId,
    failureTitle = "Could not start without a project",
  ): Promise<MachineProject | null> => {
    const result = await openScratch({ machineId, input: {} });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const startScratchThread = async (machineId: MachineId) => {
    const project = await openScratchProject(machineId);
    if (project) {
      await handleNewThread(scopeProjectRef(project.machineId, project.id)).catch(
        (error: unknown) => reportScratchFailure("Could not start without a project", error),
      );
    }
  };

  return { scratchWorkspaceRootFor, scratchMachineId, openScratchProject, startScratchThread };
}
