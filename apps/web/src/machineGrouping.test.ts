import { MachineId, ProjectId, ProviderInstanceId } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveLogicalProjectKeyFromSettings } from "./logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  resolveSidebarProjectScopeKey,
  getSidebarProjectSettingsKey,
} from "./sidebarProjectGrouping";
import type { Project } from "./types";

const primaryMachineId = MachineId.make("env-primary");
const remoteMachineId = MachineId.make("env-remote");
const repositoryIdentity = {
  canonicalKey: "github.com/example/shared-repo",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/example/shared-repo.git",
  },
};
const defaultGroupingSettings = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-1"),
    machineId: primaryMachineId,
    title: "shared-repo",
    workspaceRoot: "/tmp/shared-repo",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  };
}

describe("machine grouping", () => {
  it("opens physical scratch settings from the merged filter, including a remote thread target", () => {
    const local = makeProject({
      title: "No project",
      workspaceRoot: "/local/scratch",
      isScratch: true,
    });
    const remote = makeProject({
      title: "No project",
      id: ProjectId.make("remote-scratch"),
      machineId: remoteMachineId,
      workspaceRoot: "/remote/scratch",
      isScratch: true,
    });
    const input = {
      projects: [local, remote],
      settings: defaultGroupingSettings,
      primaryMachineId,
      resolveMachineLabel: () => null,
    };
    const filters = buildSidebarProjectSnapshots({ ...input, groupScratchProjects: true });
    const settingsGroups = buildSidebarProjectSnapshots(input);
    expect(filters).toHaveLength(1);
    expect(settingsGroups).toHaveLength(2);
    expect(settingsGroups.map((group) => group.memberProjectRefs)).toEqual([
      [{ machineId: local.machineId, projectId: local.id }],
      [{ machineId: remote.machineId, projectId: remote.id }],
    ]);
    expect(getSidebarProjectSettingsKey(filters[0]!, defaultGroupingSettings, input.projects)).toBe(
      settingsGroups[0]?.projectKey,
    );
    expect(
      getSidebarProjectSettingsKey(filters[0]!, defaultGroupingSettings, input.projects, {
        machineId: remote.machineId,
        projectId: remote.id,
      }),
    ).toBe(settingsGroups[1]?.projectKey);
  });

  it.each(["repository", "repository_path"] as const)(
    "migrates a scratch scope selected before config in %s mode",
    (mode) => {
      const project = makeProject({
        workspaceRoot: "/repo/scratch",
        repositoryIdentity: { ...repositoryIdentity, rootPath: "/repo" },
      });
      const settings = { ...defaultGroupingSettings, sidebarProjectGroupingMode: mode };
      const key = deriveLogicalProjectKeyFromSettings(project, settings);
      const groups = buildSidebarProjectSnapshots({
        projects: [{ ...project, isScratch: true }],
        groupScratchProjects: true,
        settings,
        primaryMachineId,
        resolveMachineLabel: () => null,
      });
      expect(
        resolveSidebarProjectScopeKey({ groups, key, settings, canClearMissingScope: true }),
      ).toBe(groups[0]?.projectKey);
    },
  );

  it("prefers an existing ordinary repository scope over a scratch alias", () => {
    const scratch = makeProject({ isScratch: true, repositoryIdentity });
    const ordinary = makeProject({
      id: ProjectId.make("ordinary"),
      workspaceRoot: "/ordinary",
      repositoryIdentity,
    });
    const groups = buildSidebarProjectSnapshots({
      projects: [scratch, ordinary],
      groupScratchProjects: true,
      settings: defaultGroupingSettings,
      primaryMachineId,
      resolveMachineLabel: () => null,
    });
    const key = deriveLogicalProjectKeyFromSettings(ordinary, defaultGroupingSettings);
    expect(resolveSidebarProjectScopeKey({ groups, key, canClearMissingScope: true })).toBe(key);
  });

  it("dedupes stale project rows with the same machine and workspace path", () => {
    const duplicate = makeProject({
      id: ProjectId.make("project-duplicate"),
      workspaceRoot: "/tmp/shared-repo/",
      repositoryIdentity,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const primary = makeProject({
      id: ProjectId.make("project-primary"),
      repositoryIdentity,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const remote = makeProject({
      id: ProjectId.make("project-remote"),
      machineId: remoteMachineId,
      workspaceRoot: "/tmp/shared-repo",
      repositoryIdentity,
    });

    const snapshots = buildSidebarProjectSnapshots({
      projects: [primary, duplicate, remote],
      settings: defaultGroupingSettings,
      primaryMachineId,
      resolveMachineLabel: (machineId) =>
        machineId === remoteMachineId ? "remote" : "primary",
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.groupedProjectCount).toBe(2);
    expect(snapshots[0]?.memberProjects.map((project) => project.id)).toEqual([
      primary.id,
      remote.id,
    ]);
  });

  it("dedupes stale project rows before logical grouping", () => {
    const staleWithoutRepositoryIdentity = makeProject({
      id: ProjectId.make("project-stale"),
      repositoryIdentity: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const canonical = makeProject({
      id: ProjectId.make("project-canonical"),
      repositoryIdentity,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    const remote = makeProject({
      id: ProjectId.make("project-remote"),
      machineId: remoteMachineId,
      repositoryIdentity,
    });

    const snapshots = buildSidebarProjectSnapshots({
      projects: [staleWithoutRepositoryIdentity, canonical, remote],
      settings: defaultGroupingSettings,
      primaryMachineId,
      resolveMachineLabel: (machineId) =>
        machineId === remoteMachineId ? "remote" : "primary",
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.projectKey).toBe(repositoryIdentity.canonicalKey);
    expect(snapshots[0]?.memberProjects.map((project) => project.id)).toEqual([
      canonical.id,
      remote.id,
    ]);
    expect(snapshots[0]?.memberProjectRefs).toEqual([
      {
        machineId: primaryMachineId,
        projectId: staleWithoutRepositoryIdentity.id,
      },
      { machineId: primaryMachineId, projectId: canonical.id },
      { machineId: remoteMachineId, projectId: remote.id },
    ]);

    const [pickerEntry] = buildSidebarProjectPickerEntries({
      groups: snapshots,
      preferredProjectRef: {
        machineId: primaryMachineId,
        projectId: staleWithoutRepositoryIdentity.id,
      },
    });
    expect(pickerEntry?.isPreferred).toBe(true);
    expect(pickerEntry?.targetProject.id).toBe(canonical.id);
  });

  it("keeps the current machine when available and falls back otherwise", () => {
    const currentPrimary = makeProject({ repositoryIdentity });
    const currentRemote = makeProject({
      id: ProjectId.make("current-remote"),
      machineId: remoteMachineId,
      repositoryIdentity,
    });
    const destinationRepositoryIdentity = {
      canonicalKey: "github.com/example/destination",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "https://github.com/example/destination.git",
      },
    };
    const destinationPrimary = makeProject({
      id: ProjectId.make("destination-primary"),
      title: "destination",
      workspaceRoot: "/tmp/destination",
      repositoryIdentity: destinationRepositoryIdentity,
    });
    const destinationRemote = makeProject({
      id: ProjectId.make("destination-remote"),
      machineId: remoteMachineId,
      title: "destination",
      workspaceRoot: "/remote/destination",
      repositoryIdentity: destinationRepositoryIdentity,
    });
    const fallbackPrimary = makeProject({
      id: ProjectId.make("fallback-primary"),
      title: "fallback",
      workspaceRoot: "/tmp/fallback",
    });
    const groups = buildSidebarProjectSnapshots({
      projects: [
        currentPrimary,
        currentRemote,
        destinationPrimary,
        destinationRemote,
        fallbackPrimary,
      ],
      settings: defaultGroupingSettings,
      primaryMachineId,
      resolveMachineLabel: () => null,
    });

    const entries = buildSidebarProjectPickerEntries({
      groups,
      preferredProjectRef: {
        machineId: remoteMachineId,
        projectId: currentRemote.id,
      },
    });
    const destination = entries.find(
      (entry) => entry.group.projectKey === destinationRepositoryIdentity.canonicalKey,
    );
    const fallback = entries.find((entry) => entry.group.displayName === "fallback");

    expect(destination?.targetProject).toMatchObject({
      machineId: remoteMachineId,
      id: destinationRemote.id,
    });
    expect(fallback?.targetProject).toMatchObject({
      machineId: primaryMachineId,
      id: fallbackPrimary.id,
    });
  });
});
