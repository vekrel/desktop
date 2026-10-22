import { availableScratchWorkspaceRoot } from "@vekrel/client-runtime/operations/projects";
import { isScratchProject } from "@vekrel/client-runtime/state/projects";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";
import {
  type MachineId,
  type ProjectId,
  resolveMachineKind,
} from "@vekrel/contracts";

import type { MachineOption } from "../components/BranchToolbar.logic";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useProjects } from "../state/entities";
import { useMachines, usePrimaryMachineId } from "../state/machines";
import { useClientSettings } from "./useSettings";

/**
 * The machines a project (or a scratch draft) can move between. It reads only the
 * machine, project and grouping inputs, so the list keeps its identity while the thread
 * streams and the chat chrome it feeds can skip those renders.
 */
export function useLogicalProjectMachines(
  activeProject: MachineProject | null,
  scratchDraft: boolean,
): readonly MachineOption[] {
  const { machines } = useMachines();
  const allProjects = useProjects();
  const primaryMachineId = usePrimaryMachineId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  if (!activeProject) return [];
  const machineById = new Map(
    machines.map((machine) => [machine.machineId, machine]),
  );
  const envs: MachineOption[] = [];
  const pushMachine = (machineId: MachineId, projectId: ProjectId | null) => {
    const machine = machineById.get(machineId) ?? null;
    envs.push({
      machineId,
      projectId,
      label: machine?.label ?? machineId,
      isPrimary: machineId === primaryMachineId,
      machine: resolveMachineKind(machine?.serverConfig ?? null),
    });
  };
  if (scratchDraft) {
    for (const machine of machines) {
      const scratchRoot = availableScratchWorkspaceRoot(
        machine.connection.phase,
        machine.serverConfig,
      );
      if (scratchRoot === null && machine.machineId !== activeProject.machineId)
        continue;
      const scratchProject =
        machine.machineId === activeProject.machineId
          ? activeProject
          : allProjects.find(
              (p) =>
                p.machineId === machine.machineId && isScratchProject(p, scratchRoot),
            );
      pushMachine(machine.machineId, scratchProject?.id ?? null);
    }
  } else {
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const seen = new Set<string>();
    for (const p of allProjects) {
      if (seen.has(p.machineId)) continue;
      if (deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) !== logicalKey) continue;
      seen.add(p.machineId);
      pushMachine(p.machineId, p.id);
    }
  }
  envs.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return envs;
}
