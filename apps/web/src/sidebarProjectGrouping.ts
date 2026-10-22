import type { MachineId, ScopedProjectRef } from "@vekrel/contracts";
import {
  buildProjectGroups,
  derivePhysicalProjectKey,
  type ProjectGroupingSettings,
} from "./logicalProject";
import { resolveScratchProjectScopeKey } from "@vekrel/client-runtime/state/project-grouping";
import type { Project } from "./types";

export type MachinePresence = "local-only" | "remote-only" | "mixed";

export interface SidebarProjectGroupMember extends Project {
  physicalProjectKey: string;
  machineLabel: string | null;
}

export interface SidebarProjectSnapshot extends Project {
  projectKey: string;
  displayName: string;
  groupedProjectCount: number;
  machinePresence: MachinePresence;
  allRemoteMembersAreDesktopLocal: boolean;
  allRemoteMembersAreWsl: boolean;
  memberProjects: readonly SidebarProjectGroupMember[];
  memberProjectRefs: readonly ScopedProjectRef[];
  remoteMachineLabels: readonly string[];
}

export function projectGroupsSpanMachines(
  groups: ReadonlyArray<Pick<SidebarProjectSnapshot, "memberProjects">>,
): boolean {
  const machineIds = new Set<MachineId>();
  for (const group of groups) {
    for (const member of group.memberProjects) {
      machineIds.add(member.machineId);
      if (machineIds.size > 1) return true;
    }
  }
  return false;
}

export interface SidebarProjectPickerEntry {
  group: SidebarProjectSnapshot;
  targetProject: SidebarProjectGroupMember;
  isPreferred: boolean;
}

export function getSidebarProjectSettingsKey(
  group: SidebarProjectSnapshot,
  settings: ProjectGroupingSettings,
  projects: ReadonlyArray<Project>,
  projectRef?: ScopedProjectRef,
): string {
  if (!group.isScratch) return group.projectKey;
  const project =
    group.memberProjects.find(
      (member) =>
        member.machineId === projectRef?.machineId && member.id === projectRef.projectId,
    ) ??
    group.memberProjects.find((member) => member.machineId === projectRef?.machineId) ??
    group;
  return (
    buildPhysicalToLogicalProjectKeyMap({ projects, settings, primaryMachineId: null }).get(
      derivePhysicalProjectKey(project),
    ) ?? group.projectKey
  );
}

export function resolveSidebarProjectScopeKey(input: {
  readonly groups: ReadonlyArray<SidebarProjectSnapshot>;
  readonly key: string | null;
  readonly settings?: ProjectGroupingSettings;
  readonly canClearMissingScope?: boolean;
}): string | null {
  if (input.key === null) return null;
  const group =
    input.groups.find((candidate) => candidate.projectKey === input.key) ??
    input.groups.find(
      (candidate) =>
        candidate.isScratch &&
        resolveScratchProjectScopeKey(input.key, candidate.memberProjects, input.settings) ===
          candidate.projectKey,
    );
  return group?.projectKey ?? (input.canClearMissingScope ? null : input.key);
}

export function buildPhysicalToLogicalProjectKeyMap(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  primaryMachineId: MachineId | null;
}): Map<string, string> {
  const mapping = new Map<string, string>();
  const groups = buildProjectGroups({
    projects: input.projects,
    settings: input.settings,
    preferredMachineId: input.primaryMachineId,
  });
  for (const group of groups) {
    for (const member of group.members) {
      mapping.set(member.physicalProjectKey, group.key);
    }
  }
  return mapping;
}

export function buildSidebarProjectSnapshots(input: {
  projects: ReadonlyArray<Project>;
  settings: ProjectGroupingSettings;
  groupScratchProjects?: boolean;
  primaryMachineId: MachineId | null;
  resolveMachineLabel: (machineId: MachineId) => string | null;
  isDesktopLocalMachine?: (machineId: MachineId) => boolean;
  isWslEnvironment?: (machineId: MachineId) => boolean;
}): SidebarProjectSnapshot[] {
  return buildProjectGroups({
    projects: input.projects,
    groupScratchProjects: input.groupScratchProjects ?? false,
    settings: input.settings,
    preferredMachineId: input.primaryMachineId,
  }).map((group): SidebarProjectSnapshot => {
    const members = group.members.map(
      ({ physicalProjectKey, project }): SidebarProjectGroupMember => ({
        ...project,
        physicalProjectKey,
        machineLabel: input.resolveMachineLabel(project.machineId),
      }),
    );
    const representative =
      members.find(
        (member) =>
          member.machineId === group.representative.machineId &&
          member.id === group.representative.id,
      ) ?? members[0]!;

    const hasLocal =
      input.primaryMachineId !== null &&
      members.some((member) => member.machineId === input.primaryMachineId);
    const hasRemote =
      input.primaryMachineId !== null
        ? members.some((member) => member.machineId !== input.primaryMachineId)
        : false;
    const remoteMembers = members.filter(
      (member) =>
        input.primaryMachineId !== null && member.machineId !== input.primaryMachineId,
    );
    const remoteMachineLabels = remoteMembers
      .flatMap((member) => (member.machineLabel ? [member.machineLabel] : []))
      .filter((label, index, labels) => labels.indexOf(label) === index);
    const isDesktopLocal = input.isDesktopLocalMachine ?? (() => false);
    const isWsl = input.isWslEnvironment ?? (() => false);
    const allRemoteMembersAreDesktopLocal =
      remoteMembers.length > 0 &&
      remoteMembers.every((member) => isDesktopLocal(member.machineId));
    const allRemoteMembersAreWsl =
      remoteMembers.length > 0 && remoteMembers.every((member) => isWsl(member.machineId));

    return {
      ...representative,
      projectKey: group.key,
      displayName: group.label,
      groupedProjectCount: members.length,
      machinePresence:
        hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
      allRemoteMembersAreDesktopLocal,
      allRemoteMembersAreWsl,
      memberProjects: members,
      memberProjectRefs: group.memberProjectRefs,
      remoteMachineLabels,
    };
  });
}

export function buildSidebarProjectPickerEntries(input: {
  groups: ReadonlyArray<SidebarProjectSnapshot>;
  preferredProjectRef: ScopedProjectRef | null;
}) {
  const preferredProjectRef = input.preferredProjectRef;
  const entries = input.groups.flatMap((group): SidebarProjectPickerEntry[] => {
    const isPreferred = preferredProjectRef
      ? group.memberProjectRefs.some(
          (projectRef) =>
            projectRef.machineId === preferredProjectRef.machineId &&
            projectRef.projectId === preferredProjectRef.projectId,
        )
      : false;
    const preferredProject = preferredProjectRef
      ? (group.memberProjects.find(
          (project) =>
            project.machineId === preferredProjectRef.machineId &&
            project.id === preferredProjectRef.projectId,
        ) ??
        group.memberProjects.find(
          (project) => project.machineId === preferredProjectRef.machineId,
        ))
      : null;
    const targetProject =
      preferredProject ??
      group.memberProjects.find(
        (project) => project.machineId === group.machineId && project.id === group.id,
      ) ??
      group.memberProjects[0];
    if (!targetProject) return [];

    return [{ group, targetProject, isPreferred }];
  });
  const preferredIndex = entries.findIndex((entry) => entry.isPreferred);
  if (preferredIndex <= 0) return entries;

  return [
    entries[preferredIndex]!,
    ...entries.slice(0, preferredIndex),
    ...entries.slice(preferredIndex + 1),
  ];
}
