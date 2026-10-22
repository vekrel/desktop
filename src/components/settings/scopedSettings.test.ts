import {
  DEFAULT_SERVER_SETTINGS,
  MachineAuthorizationError,
  MachineId,
  ProjectId,
  ProviderInstanceId,
  type ServerSettings,
} from "@vekrel/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { applyServerSettingsPatch } from "@vekrel/shared/serverSettings";
import * as Cause from "effect/Cause";
import { resolveWorktreeCleanup } from "@vekrel/shared/projectSettings";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import {
  persistScopedSettingsPatch,
  planProjectOverridesClear,
  planScopedSettingsClear,
  planScopedSettingsPatch,
  scopedIdleCompaction,
  resolveScopedSettingsTargets,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  selectScopedSettingsMachines,
} from "./scopedSettings";
import { resolveSettingsScope } from "./settingsScope";

function machine(
  id: string,
  options: {
    connected?: boolean;
    loaded?: boolean;
    settings?: Partial<ServerSettings>;
    projectOverrides?: boolean;
  } = {},
) {
  return {
    machineId: MachineId.make(id),
    label: id,
    connection: {
      phase: options.connected === false ? ("offline" as const) : ("connected" as const),
    },
    serverConfig:
      options.loaded === false
        ? null
        : {
            settings: { ...DEFAULT_SERVER_SETTINGS, ...options.settings },
            machine: {
              capabilities: { projectSettingsOverrides: options.projectOverrides !== false },
            },
          },
  };
}

const laptop = machine("Laptop");
const server = machine("Server");
const offline = machine("Offline", { connected: false });
const loading = machine("Loading", { loaded: false });
const machines = [laptop, server, offline, loading];
const all = resolveSettingsScope({}, [], machines);
const named = resolveSettingsScope({ machine: server.machineId }, [], machines);

const projectId = ProjectId.make("project");
const laptopProjectId = ProjectId.make("laptop-project");
const member = {
  id: projectId,
  machineId: server.machineId,
  title: "Project",
  workspaceRoot: "/repo",
  physicalProjectKey: `${server.machineId}:/repo`,
  machineLabel: server.label,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};
const laptopMember = {
  ...member,
  id: laptopProjectId,
  machineId: laptop.machineId,
  physicalProjectKey: `${laptop.machineId}:/repo`,
  machineLabel: laptop.label,
};
const group: SidebarProjectSnapshot = {
  ...member,
  projectKey: "project-group",
  displayName: "Project",
  memberProjects: [member, laptopMember],
  memberProjectRefs: [
    { machineId: server.machineId, projectId },
    { machineId: laptop.machineId, projectId: laptopProjectId },
  ],
  groupedProjectCount: 2,
  machinePresence: "remote-only",
  allRemoteMembersAreDesktopLocal: false,
  allRemoteMembersAreWsl: false,
  remoteMachineLabels: [server.label, laptop.label],
};
const project = resolveSettingsScope({ project: group.projectKey }, [group], machines);
const checkout = resolveSettingsScope(
  { project: group.projectKey, machine: server.machineId, checkout: member.physicalProjectKey },
  [group],
  machines,
);

describe("scoped settings targets", () => {
  it("uses the named machine even when a different primary is available", () => {
    const selected = selectScopedSettingsMachines(named, machines, laptop.machineId);
    expect(selected.machines).toEqual([server]);
    expect(selected.machine).toBe(server);
  });

  it("keeps an offline named machine selected without falling back to primary", () => {
    const scope = resolveSettingsScope({ machine: offline.machineId }, [], machines);
    const selected = selectScopedSettingsMachines(scope, machines, laptop.machineId);
    expect(selected.machines).toEqual([offline]);
    expect(selected.connectedMachines).toEqual([]);
    expect(selected.machine).toBeNull();
    expect(
      planScopedSettingsPatch(scope, machines, { enableProviderUpdateChecks: false }),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: "Connect Offline to save this setting.",
    });
  });

  it("resolves each member's effective settings and source at project scope", () => {
    const overridden = machine("Server", {
      settings: {
        defaultAutoPull: false,
        projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
      },
    });
    const targets = resolveScopedSettingsTargets(project, [laptop, overridden]);
    expect(targets.map((target) => [target.projectId, target.settings.defaultAutoPull])).toEqual([
      [projectId, true],
      [laptopProjectId, false],
    ]);
    expect(scopedSettingsSource(targets, ["defaultAutoPull"])).toBe("mixed");
    expect(scopedSettingsSource([targets[0]!], ["defaultAutoPull"])).toBe("project");
    expect(scopedSettingsSource(targets, ["enableProviderUpdateChecks"])).toBe("environment");
    expect(scopedSettingsAreMixed(targets, ["defaultAutoPull"])).toBe(true);
  });
});

describe("scoped settings writes", () => {
  it("edits the effective machine policy without changing other machines' rules", () => {
    const custom = machine("Laptop", {
      settings: {
        worktreeCleanup: {
          mode: "custom",
          rules: {
            worktreeAfterDays: 12,
            worktreeSettledAfterDays: null,
            worktreeOnDelete: true,
            worktreeOnMerge: true,
            worktreeUnchanged: false,
            worktreeKeepWhen: "uncommitted-changes",
          },
        },
      },
    });
    const disabled = machine("Server", {
      settings: { worktreeCleanup: { mode: "off" } },
    });
    const targets = [custom, disabled];
    const plan = planScopedSettingsPatch(all, targets, {
      storageCleanup: { worktreeOnDelete: false },
    });
    const policies = plan.serverWrites.map((write, index) =>
      resolveWorktreeCleanup(
        applyServerSettingsPatch(targets[index]!.serverConfig!.settings, write.patch),
        null,
      ),
    );
    expect(policies).toEqual([
      {
        worktreeAfterDays: 12,
        worktreeSettledAfterDays: null,
        worktreeOnDelete: false,
        worktreeOnMerge: true,
        worktreeUnchanged: false,
        worktreeKeepWhen: "uncommitted-changes",
      },
      {
        worktreeAfterDays: null,
        worktreeSettledAfterDays: null,
        worktreeOnDelete: false,
        worktreeOnMerge: false,
        worktreeUnchanged: false,
        worktreeKeepWhen: "uncommitted-changes",
      },
    ]);
  });

  it("compares idle compaction by mode, and offers Never only where every server stores it", () => {
    const fixed = {
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        compactIdleThreads: false,
        idleCompaction: "onReturn" as const,
      },
    };
    const modes = {
      settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: "onReturn" as const },
    };
    const legacy = { settings: { ...DEFAULT_SERVER_SETTINGS, compactIdleThreads: false } };
    expect(scopedIdleCompaction([fixed, modes])).toEqual({ mixed: false, neverAvailable: true });
    expect(scopedIdleCompaction([fixed, legacy])).toEqual({ mixed: false, neverAvailable: false });
    expect(
      scopedIdleCompaction([fixed, { settings: { ...fixed.settings, idleCompaction: "off" } }])
        .mixed,
    ).toBe(true);
  });

  it("sends an idle compaction mode in the form each machine's server reads", () => {
    const targets = [
      machine("Fixed", { settings: { compactIdleThreads: false, idleCompaction: "onReturn" } }),
      machine("Modes", { settings: { compactIdleThreads: "onReturn" } }),
      machine("Switch", { settings: { compactIdleThreads: false } }),
    ];
    const plan = planScopedSettingsPatch(resolveSettingsScope({}, [], targets), targets, {
      idleCompaction: "beforeCacheExpires",
    });
    expect(plan.serverWrites.map((write) => write.patch)).toEqual([
      { idleCompaction: "beforeCacheExpires" },
      { compactIdleThreads: "beforeCacheExpires" },
      { compactIdleThreads: true },
    ]);
  });

  it("writes an aggregate preference only to connected machines with loaded configuration", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(all, machines, { enableProviderUpdateChecks: false }),
      persistServer,
      persistClient,
    );
    expect(persistServer.mock.calls.map(([input]) => input.machineId)).toEqual([
      laptop.machineId,
      server.machineId,
    ]);
    expect(persistClient).not.toHaveBeenCalled();
  });

  describe("a machine that saves but drops keys it does not know", () => {
    const upgradedLaptop = (saved: Partial<ServerSettings>) =>
      vi.fn(async ({ machineId }: { machineId: MachineId }) => ({
        _tag: "Success" as const,
        value: {
          ...DEFAULT_SERVER_SETTINGS,
          ...(machineId === laptop.machineId ? saved : {}),
        },
      }));
    const outcome = async (
      plan: ReturnType<typeof planScopedSettingsPatch>,
      persistServer: ReturnType<typeof upgradedLaptop>,
    ) => {
      const result = await persistScopedSettingsPatch(plan, persistServer, vi.fn());
      return {
        saved: result.savedMachines.map(({ label }) => label),
        failed: result.failedMachines.map(({ label, message }) => ({ label, message })),
      };
    };
    const unsupported = [
      {
        label: server.label,
        message: "This machine does not support this setting. Update Vekrel on it.",
      },
    ];

    it("reports a dropped toggle", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, machines, { reviewGuidesEnabled: true }),
          upgradedLaptop({ reviewGuidesEnabled: true }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    it("reports dropped text but accepts the server trimming it", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, machines, { reviewGuideInstructions: " Read tests " }),
          upgradedLaptop({ reviewGuideInstructions: "Read tests" }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    // regression: #18334 a machine silently dropped a setting with no warning
    it("reports a dropped key inside a project override", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(project, machines, { defaultAutoPull: true }),
          upgradedLaptop({
            projectSettingsOverrides: { [laptopProjectId]: { defaultAutoPull: true } },
          }),
        ),
      ).toEqual({ saved: [laptop.label], failed: unsupported });
    });

    it("accepts a write that matches what the machine already had", async () => {
      expect(
        await outcome(
          planScopedSettingsPatch(all, machines, { reviewGuidesEnabled: false }),
          upgradedLaptop({}),
        ),
      ).toEqual({ saved: [laptop.label, server.label], failed: [] });
    });
  });

  it("persists client keys locally at any scope alongside server keys", async () => {
    const persistServer = vi.fn().mockResolvedValue({ _tag: "Success" });
    const persistClient = vi.fn();
    await persistScopedSettingsPatch(
      planScopedSettingsPatch(named, machines, {
        diffIgnoreWhitespace: false,
        enableProviderUpdateChecks: false,
      }),
      persistServer,
      persistClient,
    );
    expect(persistClient).toHaveBeenCalledExactlyOnceWith({ diffIgnoreWhitespace: false });
    expect(persistServer).toHaveBeenCalledExactlyOnceWith({
      machineId: server.machineId,
      input: { patch: { enableProviderUpdateChecks: false } },
    });
  });

  it("writes project overrides into each member's entry on its machine", () => {
    const withExisting = machine("Server", {
      settings: {
        projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } },
      },
    });
    const plan = planScopedSettingsPatch(project, [laptop, withExisting], {
      defaultAutoPull: true,
    });
    expect(plan.unavailableReason).toBeNull();
    expect(plan.serverWrites).toEqual([
      {
        machineId: server.machineId,
        label: server.label,
        previous: expect.anything(),
        patch: {
          projectSettingsOverrides: {
            [projectId]: { enableAgentBrowserAccess: false, defaultAutoPull: true },
          },
        },
      },
      {
        machineId: laptop.machineId,
        label: laptop.label,
        previous: expect.anything(),
        patch: { projectSettingsOverrides: { [laptopProjectId]: { defaultAutoPull: true } } },
      },
    ]);
    expect(
      planScopedSettingsPatch(checkout, [laptop, server], { defaultAutoPull: true }),
    ).toMatchObject({
      serverWrites: [{ machineId: server.machineId }],
    });
  });

  it("keeps each project's other cleanup rules when changing one rule across machines", () => {
    const laptop = machine("Laptop", {
      settings: {
        storageCleanup: { ...DEFAULT_SERVER_SETTINGS.storageCleanup, worktreeAfterDays: 30 },
      },
    });
    const customized = machine("Server", {
      settings: {
        projectSettingsOverrides: {
          [projectId]: {
            defaultAutoPull: true,
            worktreeCleanup: {
              mode: "custom",
              rules: {
                worktreeAfterDays: 8,
                worktreeSettledAfterDays: null,
                worktreeOnDelete: false,
                worktreeOnMerge: true,
                worktreeUnchanged: false,
                worktreeKeepWhen: "uncommitted-changes",
              },
            },
          },
        },
      },
    });
    const plan = planScopedSettingsPatch(project, [laptop, customized], {
      worktreeCleanup: { mode: "custom", rules: { worktreeOnDelete: true } },
    });
    const settledPlan = planScopedSettingsPatch(project, [laptop, customized], {
      worktreeCleanup: { mode: "custom", rules: { worktreeSettledAfterDays: 0 } },
    });
    expect(
      settledPlan.serverWrites.map((write) => write.patch.projectSettingsOverrides),
    ).toMatchObject([
      { [projectId]: { worktreeCleanup: { rules: { worktreeSettledAfterDays: 0 } } } },
      { [laptopProjectId]: { worktreeCleanup: { rules: { worktreeSettledAfterDays: 0 } } } },
    ]);
    expect(plan.serverWrites.map((write) => write.patch.projectSettingsOverrides)).toEqual([
      {
        [projectId]: {
          defaultAutoPull: true,
          worktreeCleanup: {
            mode: "custom",
            rules: {
              worktreeAfterDays: 8,
              worktreeSettledAfterDays: null,
              worktreeOnDelete: true,
              worktreeOnMerge: true,
              worktreeUnchanged: false,
              worktreeKeepWhen: "uncommitted-changes",
            },
          },
        },
      },
      {
        [laptopProjectId]: {
          worktreeCleanup: {
            mode: "custom",
            rules: {
              worktreeAfterDays: 30,
              worktreeSettledAfterDays: null,
              worktreeOnDelete: true,
              worktreeOnMerge: false,
              worktreeUnchanged: false,
              worktreeKeepWhen: "uncommitted-changes",
            },
          },
        },
      },
    ]);
    expect(
      planScopedSettingsClear(checkout, [customized], ["worktreeCleanup"]).serverWrites[0]?.patch,
    ).toEqual({
      projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } },
    });
    expect(
      planScopedSettingsPatch(project, [laptop, customized], {
        storageCleanup: { browserArtifactsAfterDays: 8 },
      }).serverWrites,
    ).toEqual([]);
  });

  // regression: #11541 device settings were written to the wrong scope
  it("scopes agent device access to projects while keeping hub and hosts machine-wide", () => {
    const plan = planScopedSettingsPatch(project, [laptop, server], {
      enableAgentDeviceAccess: true,
    });
    expect(plan.serverWrites.map((write) => write.patch)).toEqual([
      { projectSettingsOverrides: { [projectId]: { enableAgentDeviceAccess: true } } },
      { projectSettingsOverrides: { [laptopProjectId]: { enableAgentDeviceAccess: true } } },
    ]);
    for (const patch of [{ enableDeviceSupport: true }, { deviceHosts: [] }]) {
      expect(planScopedSettingsPatch(project, machines, patch).serverWrites).toEqual([]);
    }
  });

  it("refuses machine-wide keys and older servers at project scope", () => {
    expect(
      planScopedSettingsPatch(project, machines, { enableProviderUpdateChecks: false }),
    ).toMatchObject({
      serverWrites: [],
      unavailableReason: "This setting is machine-wide and cannot be overridden by a project.",
    });
    const legacy = machine("Server", { projectOverrides: false });
    expect(
      planScopedSettingsPatch(checkout, [laptop, legacy], { defaultAutoPull: true }),
    ).toMatchObject({ serverWrites: [], unavailableReason: expect.stringContaining("update") });
  });

  it("clears overrides per member and removes an emptied entry", () => {
    const withOverrides = machine("Server", {
      settings: {
        projectSettingsOverrides: {
          [projectId]: { defaultAutoPull: true, enableAgentBrowserAccess: false },
        },
      },
    });
    const plan = planScopedSettingsClear(checkout, [laptop, withOverrides], ["defaultAutoPull"]);
    expect(plan.serverWrites).toEqual([
      {
        machineId: server.machineId,
        label: server.label,
        previous: expect.anything(),
        patch: { projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } } },
      },
    ]);
    expect(
      planScopedSettingsClear(
        checkout,
        [laptop, withOverrides],
        ["defaultAutoPull", "enableAgentBrowserAccess"],
      ).serverWrites[0]?.patch,
    ).toEqual({ projectSettingsOverrides: { [projectId]: null } });
  });

  it("never substitutes a machine-default write for an invalid scope", () => {
    const scope = resolveSettingsScope({ machine: "removed" }, [group], machines);
    const plan = planScopedSettingsPatch(scope, machines, { enableAgentBrowserAccess: false });
    expect(plan.serverWrites).toEqual([]);
    expect(plan.hasClientWrite).toBe(false);
    expect(plan.unavailableReason).not.toBeNull();
  });

  it("waits for every target and identifies both RPC failures and rejected writes", async () => {
    const third = machine("Third");
    const fourth = machine("Fourth");
    const selected = [...machines, third, fourth];
    const scope = resolveSettingsScope({}, [], selected);
    const persistServer = vi
      .fn()
      .mockResolvedValueOnce({ _tag: "Success" })
      .mockResolvedValueOnce({
        _tag: "Failure",
        cause: Cause.fail(
          new MachineAuthorizationError({
            requiredScope: "settings:write",
            message: "This connection lacks permission to change settings.",
          }),
        ),
      })
      .mockRejectedValueOnce(new Error("Disconnected during save"))
      .mockResolvedValueOnce({ _tag: "Success" });
    const result = await persistScopedSettingsPatch(
      planScopedSettingsPatch(scope, selected, { enableAgentBrowserAccess: false }),
      persistServer,
      vi.fn(),
    );
    expect(result.savedMachineCount).toBe(2);
    expect(result.savedMachines.map(({ label }) => label)).toEqual([
      laptop.label,
      fourth.label,
    ]);
    expect(result.failedMachines.map(({ message }) => message)).toEqual([
      "This connection lacks permission to change settings.",
      "Disconnected during save",
    ]);
    expect(result.failedMachines.map(({ label }) => label)).toEqual([
      server.label,
      third.label,
    ]);
    expect(persistServer).toHaveBeenCalledTimes(4);
  });
});

describe("scoped settings mixed values", () => {
  it("treats independently decoded equal nested settings as the same value", () => {
    const style = {
      ...DEFAULT_SERVER_SETTINGS.sourceControlWritingStyle,
      mode: "custom" as const,
      customInstructions: "Use plain language",
    };
    const first = machine("First", { settings: { sourceControlWritingStyle: { ...style } } });
    const second = machine("Second", { settings: { sourceControlWritingStyle: { ...style } } });
    const targets = resolveScopedSettingsTargets(all, [first, second]);
    expect(scopedSettingsAreMixed(targets, ["sourceControlWritingStyle"])).toBe(false);
  });
});

describe("project overrides at machine scope", () => {
  const laptop = MachineId.make("laptop");
  const fleet = ProjectId.make("fleet");
  const t3 = ProjectId.make("t3");
  const machine = (
    machineId: MachineId,
    overrides: ServerSettings["projectSettingsOverrides"],
  ) => ({
    machineId,
    label: machineId,
    connection: { phase: "connected" as const },
    serverConfig: {
      settings: { ...DEFAULT_SERVER_SETTINGS, projectSettingsOverrides: overrides },
      machine: { capabilities: { projectSettingsOverrides: true } },
    },
  });

  it("clears only those keys and drops entries that become empty", () => {
    const plan = planProjectOverridesClear(
      [
        machine(laptop, {
          [fleet]: { defaultAutoPull: true, defaultThreadEnvMode: "local" },
          [t3]: { defaultAutoPull: true },
        }),
      ],
      [
        { machineId: laptop, projectId: fleet },
        { machineId: laptop, projectId: t3 },
      ],
      ["defaultAutoPull"],
    );
    expect(plan.serverWrites).toEqual([
      {
        machineId: laptop,
        label: laptop,
        previous: expect.anything(),
        patch: {
          projectSettingsOverrides: { [fleet]: { defaultThreadEnvMode: "local" }, [t3]: null },
        },
      },
    ]);
  });
});

describe("null patches at project scope", () => {
  it("removes the override for keys that cannot store null and keeps it for keys that can", () => {
    const machineId = MachineId.make("laptop");
    const projectId = ProjectId.make("fleet");
    const scope = {
      kind: "project" as const,
      group: {} as never,
      machineId: null,
      label: "fleet",
      members: [{ id: projectId, machineId } as never],
      machineIds: [machineId],
    };
    const machines = [
      {
        machineId,
        label: "Laptop",
        connection: { phase: "connected" as const },
        serverConfig: {
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            projectSettingsOverrides: {
              [projectId]: { defaultThreadEnvMode: "worktree" as const, defaultAutoPull: true },
            },
          },
          machine: { capabilities: { projectSettingsOverrides: true } },
        },
      },
    ];
    expect(
      planScopedSettingsPatch(scope, machines, { defaultThreadEnvMode: null }).serverWrites[0]
        ?.patch,
    ).toEqual({ projectSettingsOverrides: { [projectId]: { defaultAutoPull: true } } });
    expect(
      planScopedSettingsPatch(scope, machines, { defaultModelSelection: null }).serverWrites[0]
        ?.patch,
    ).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          defaultThreadEnvMode: "worktree",
          defaultAutoPull: true,
          defaultModelSelection: null,
        },
      },
    });
  });
});

describe("partial object patches at project scope", () => {
  it("completes a writing style field patch from the target's effective value", () => {
    const machineId = MachineId.make("laptop");
    const projectId = ProjectId.make("fleet");
    const member = {
      id: projectId,
      machineId,
      physicalProjectKey: "laptop:/repo",
      machineLabel: "Laptop",
      title: "fleet",
      workspaceRoot: "/repo",
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      projectSettingsOverrides: {
        [projectId]: {
          sourceControlWritingStyle: {
            mode: "custom" as const,
            customInstructions: "Keep it short.",
            followChangeRequestTemplates: false,
          },
        },
      },
    };
    const plan = planScopedSettingsPatch(
      {
        kind: "project",
        group: {} as never,
        machineId: null,
        label: "fleet",
        members: [member as never],
        machineIds: [machineId],
      },
      [
        {
          machineId,
          label: "Laptop",
          connection: { phase: "connected" },
          serverConfig: {
            settings,
            machine: { capabilities: { projectSettingsOverrides: true } },
          },
        },
      ],
      { sourceControlWritingStyle: { customInstructions: "Be terse." } },
    );
    expect(plan.serverWrites[0]?.patch).toEqual({
      projectSettingsOverrides: {
        [projectId]: {
          sourceControlWritingStyle: {
            mode: "custom",
            customInstructions: "Be terse.",
            followChangeRequestTemplates: false,
          },
        },
      },
    });
  });
});

it("routes legacy model preference keys exclusively to the selected machine", () => {
  const patch = {
    favorites: [{ provider: ProviderInstanceId.make("codex"), model: "sol" }],
    providerModelPreferences: {},
  };
  const plan = planScopedSettingsPatch(named, machines, patch);
  expect(plan.clientPatch).toEqual({});
  expect(plan.hasClientWrite).toBe(false);
  expect(plan.serverWrites).toEqual([
    {
      machineId: server.machineId,
      label: server.label,
      previous: expect.anything(),
      patch,
    },
  ]);
});

describe("model selection patches at project scope", () => {
  const codex = ProviderInstanceId.make("codex");
  const claude = ProviderInstanceId.make("claudeAgent");
  const saved = {
    instanceId: codex,
    model: "gpt-5.6",
    options: [{ id: "reasoningEffort", value: "high" }],
  };
  const customized = machine("Server", {
    settings: {
      projectSettingsOverrides: {
        [projectId]: {
          defaultModelSelection: saved,
          sourceControlWriterModelSelection: saved,
          reviewGuideModelSelection: saved,
          textGenerationModelSelection: saved,
        },
      },
    },
  });

  // regression: #16581 changing a project's model kept the old model's options
  it("replaces old options when changing model selections", () => {
    const plan = planScopedSettingsPatch(checkout, [customized], {
      defaultModelSelection: { instanceId: claude, model: "claude-opus-4-8" },
      sourceControlWriterModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      reviewGuideModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      textGenerationModelSelection: { instanceId: claude, model: "claude-sonnet-4-6" },
    });
    expect(plan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]).toEqual({
      defaultModelSelection: { instanceId: claude, model: "claude-opus-4-8" },
      sourceControlWriterModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      reviewGuideModelSelection: { instanceId: codex, model: "gpt-5.6-mini" },
      textGenerationModelSelection: { instanceId: claude, model: "claude-sonnet-4-6" },
    });
  });

  it("completes partial text-generation selections without retaining old options", () => {
    const modelPlan = planScopedSettingsPatch(checkout, [customized], {
      textGenerationModelSelection: { model: "gpt-5.6-mini" },
    });
    expect(
      modelPlan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]
        ?.textGenerationModelSelection,
    ).toEqual({ instanceId: codex, model: "gpt-5.6-mini" });

    const options = [{ id: "reasoningEffort", value: "low" }];
    const optionsPlan = planScopedSettingsPatch(checkout, [customized], {
      textGenerationModelSelection: { options },
    });
    expect(
      optionsPlan.serverWrites[0]?.patch.projectSettingsOverrides?.[projectId]
        ?.textGenerationModelSelection,
    ).toEqual({ ...saved, options });
  });
});
