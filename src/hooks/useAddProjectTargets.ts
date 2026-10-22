import { canCreateProjectInMachine } from "@vekrel/client-runtime/operations/projects";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";
import { AuthSourceControlWriteScope, resolveMachineKind } from "@vekrel/contracts";

import type { MachineOption } from "../components/BranchToolbar.logic";
import { useMachines } from "../state/machines";
import { useMachinesWithScope } from "../state/session";

export type AddProjectTarget = Pick<MachineOption, "machineId" | "label" | "machine">;

/**
 * Connected machines that do not have the project yet and can clone it.
 * `projectMachines` is the project's current machine list, from
 * `useLogicalProjectMachines`. Projects without a git remote get none.
 */
export function useAddProjectTargets(
  project: MachineProject | null,
  projectMachines: readonly Pick<MachineOption, "machineId">[] | undefined,
): readonly AddProjectTarget[] {
  const { machines } = useMachines();
  const canClone = useMachinesWithScope(machines, AuthSourceControlWriteScope);
  if (!project?.repositoryIdentity?.locator.remoteUrl) return [];
  const hasProject = new Set([
    project.machineId,
    ...(projectMachines ?? []).map((env) => env.machineId),
  ]);
  return machines
    .filter(
      (machine) =>
        !hasProject.has(machine.machineId) &&
        canClone.has(machine.machineId) &&
        canCreateProjectInMachine(machine.connection.phase) &&
        machine.serverConfig?.machine.capabilities.projectCloneTracking === true,
    )
    .map((machine) => ({
      machineId: machine.machineId,
      label: machine.label,
      machine: resolveMachineKind(machine.serverConfig),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}
