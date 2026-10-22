import {
  type ClientSettings,
  type MachineId,
  type ProjectId,
  resolveMachineKind,
} from "@vekrel/contracts";

import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useClientSettings } from "../hooks/useSettings";
import { getProjectOrderKey } from "../logicalProject";
import { useProjects, useThreadShells } from "../state/entities";
import { useMachines, usePrimaryMachineId } from "../state/machines";
import { buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { orderItemsByPreferredIds, sortLogicalProjectsForSidebar } from "./Sidebar.logic";

// Each helper reads its own source hook so the compiler caches the derived value on that
// source. Taking the source as an argument instead leaves the helper hook-free, and the
// compiler then treats it as a plain function and caches nothing.
export function useMachineLookups() {
  const { machines } = useMachines();
  const machineLabelById = new Map(
    machines.map((machine) => [machine.machineId, machine.label] as const),
  );
  const projectMachineLocationById = new Map(
    machines.map((machine) => {
      const isPrimary = machine.entry.target._tag === "PrimaryConnectionTarget";
      const isLocal = isPrimary || isDesktopLocalConnectionTarget(machine.entry.target);
      return [
        machine.machineId,
        {
          kind: isLocal ? "local" : "remote",
          label: isPrimary ? "Local" : isLocal ? `${machine.label} (Local)` : machine.label,
          machine: resolveMachineKind(machine.serverConfig),
        },
      ] as const;
    }),
  );
  return { machineLabelById, projectMachineLocationById };
}

export function useProjectLookups() {
  const projects = useProjects();
  const projectCwdById = new Map<ProjectId, string>(
    projects.map((project) => [project.id, project.workspaceRoot]),
  );
  const projectByKey = new Map(
    projects.map((project) => [`${project.machineId}:${project.id}`, project]),
  );
  const projectTitleById = new Map<ProjectId, string>(
    projects.map((project) => [project.id, project.title]),
  );
  return { projectCwdById, projectByKey, projectTitleById };
}

export const selectCommandPaletteClientSettings = (settings: ClientSettings) => ({
  sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
  sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  sidebarProjectSortOrder: settings.sidebarProjectSortOrder,
  sidebarThreadSortOrder: settings.sidebarThreadSortOrder,
});

export function useSortedProjectGroups(machineLabelById: ReadonlyMap<MachineId, string>) {
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const clientSettings = useClientSettings(selectCommandPaletteClientSettings);
  const primaryMachineId = usePrimaryMachineId();
  const projectGroupingSettings = {
    sidebarProjectGroupingMode: clientSettings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: clientSettings.sidebarProjectGroupingOverrides,
  };
  const orderedProjects = orderItemsByPreferredIds({
    items: projects,
    preferredIds: projectOrder,
    getId: getProjectOrderKey,
    getPreferenceIds: (project) => [
      getProjectOrderKey(project),
      legacyProjectCwdPreferenceKey(project.workspaceRoot),
    ],
  });
  const unsortedProjectGroups = buildSidebarProjectSnapshots({
    projects: clientSettings.sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
    settings: projectGroupingSettings,
    primaryMachineId,
    resolveMachineLabel: (machineId) => machineLabelById.get(machineId) ?? null,
  });
  return sortLogicalProjectsForSidebar(
    unsortedProjectGroups,
    threads,
    clientSettings.sidebarProjectSortOrder,
  );
}
