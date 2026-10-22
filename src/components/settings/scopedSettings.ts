import {
  ClientSettingsSchema,
  type ClientSettingsPatch,
  type MachineId,
  globalIdleCompaction,
  idleCompactionPatch,
  isNullableProjectSettingsOverride,
  readsIdleCompactionModes,
  PROJECT_SCOPED_SERVER_SETTING_KEYS,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  type ProjectSettingsOverrides,
  ServerSettings,
  type T3ProjectFile,
  type ServerSettingsPatch,
} from "@vekrel/contracts";
import type { MachineConnectionPhase } from "@vekrel/client-runtime/connection";
import {
  clearProjectSettingsOverrides,
  resolveProjectSettings,
  resolveWorktreeCleanup,
  type ProjectSettingSource,
} from "@vekrel/shared/projectSettings";
import * as Equal from "effect/Equal";
import * as Cause from "effect/Cause";

import type { ResolvedSettingsScope } from "./settingsScope";

export type ScopedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

interface ScopedSettingsMachine {
  readonly machineId: MachineId;
  readonly label: string;
  readonly connection: { readonly phase: MachineConnectionPhase };
  readonly serverConfig: {
    readonly settings: ServerSettings;
    readonly machine?: {
      readonly capabilities: { readonly projectSettingsOverrides?: boolean | undefined };
    };
  } | null;
}

const SERVER_KEYS = new Set<string>(Object.keys(ServerSettings.fields));
const CLIENT_KEYS = new Set<string>(Object.keys(ClientSettingsSchema.fields));
const PROJECT_SCOPED_KEYS = new Set<string>(PROJECT_SCOPED_SERVER_SETTING_KEYS);

export function isProjectScopedSettingKey(key: string): key is ProjectScopedServerSettingKey {
  return PROJECT_SCOPED_KEYS.has(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConnectedWithConfig(
  machine: Pick<ScopedSettingsMachine, "connection" | "serverConfig">,
) {
  return machine.connection.phase === "connected" && machine.serverConfig !== null;
}

/** The representative supplies display values, never the set of write targets. */
export function selectScopedSettingsMachines<T extends ScopedSettingsMachine>(
  scope: ResolvedSettingsScope,
  available: readonly T[],
  primaryMachineId: MachineId | null,
) {
  const selectedIds = new Set(scope.machineIds);
  const machines = available.filter((machine) =>
    selectedIds.has(machine.machineId),
  );
  const connectedMachines = machines.filter(isConnectedWithConfig);
  const machine =
    connectedMachines.find((candidate) => candidate.machineId === primaryMachineId) ??
    connectedMachines[0] ??
    null;
  return { machines, connectedMachines, machine };
}

export interface ScopedSettingsTarget {
  readonly machineId: MachineId;
  readonly label: string;
  readonly projectId: ProjectId | null;
  readonly settings: ServerSettings;
  readonly sources: Readonly<Record<ProjectScopedServerSettingKey, ProjectSettingSource>>;
}

export function resolveScopedSettingsTargets(
  scope: ResolvedSettingsScope,
  connectedMachines: readonly ScopedSettingsMachine[],
  // A member absent here has no file tier yet; null is a missing or invalid file.
  projectFiles?: ReadonlyMap<string, T3ProjectFile | null>,
): readonly ScopedSettingsTarget[] {
  const byId = new Map(
    connectedMachines.map((machine) => [machine.machineId, machine]),
  );
  if (scope.kind === "project" || scope.kind === "checkout") {
    return scope.members.flatMap((member) => {
      const machine = byId.get(member.machineId);
      if (!machine?.serverConfig) return [];
      const projectFile = projectFiles?.get(member.physicalProjectKey);
      const resolved =
        projectFile === undefined
          ? resolveProjectSettings(machine.serverConfig.settings, member.id)
          : resolveProjectSettings(machine.serverConfig.settings, member.id, null, projectFile);
      return [
        {
          machineId: member.machineId,
          label: machine.label,
          projectId: member.id,
          settings: resolved.settings,
          sources: resolved.sources,
        },
      ];
    });
  }
  return connectedMachines.flatMap((machine) =>
    machine.serverConfig
      ? [
          {
            machineId: machine.machineId,
            label: machine.label,
            projectId: null,
            settings: machine.serverConfig.settings,
            sources: resolveProjectSettings(machine.serverConfig.settings, null).sources,
          },
        ]
      : [],
  );
}

export function scopedSettingsAreMixed(
  targets: readonly Pick<ScopedSettingsTarget, "settings">[],
  keys: readonly (keyof ServerSettings)[],
): boolean {
  const first = targets[0];
  return (
    first !== undefined &&
    targets.some((candidate) =>
      keys.some((key) => !Equal.equals(first.settings[key], candidate.settings[key])),
    )
  );
}

/**
 * Servers store the idle compaction mode differently by version, so selected
 * machines are compared by the mode each resolves to, and "Never" is offered
 * only when every one of them can store it.
 */
export function scopedIdleCompaction(targets: readonly Pick<ScopedSettingsTarget, "settings">[]) {
  const modes = targets.map((candidate) => globalIdleCompaction(candidate.settings));
  return {
    mixed: modes.some((mode) => mode !== modes[0]),
    neverAvailable: targets.every((candidate) => readsIdleCompactionModes(candidate.settings)),
  };
}

export type ScopedSettingSource = ProjectSettingSource | "mixed";

export function scopedSettingsSource(
  targets: readonly Pick<ScopedSettingsTarget, "sources">[],
  keys: readonly (keyof ServerSettings)[],
): ScopedSettingSource {
  const scoped = keys.filter(isProjectScopedSettingKey);
  if (scoped.length === 0 || targets.length === 0) return "environment";
  const sources = new Set(targets.flatMap((target) => scoped.map((key) => target.sources[key])));
  return sources.size > 1
    ? "mixed"
    : sources.has("project")
      ? "project"
      : sources.has("t3.json")
        ? "t3.json"
        : "environment";
}

interface ScopedServerWrite {
  readonly machineId: MachineId;
  readonly label: string;
  readonly patch: ServerSettingsPatch;
  readonly previous: ServerSettings;
}

function projectOverrideWrites(
  scope: Extract<ResolvedSettingsScope, { kind: "project" | "checkout" }>,
  machines: readonly ScopedSettingsMachine[],
  update: (
    current: ProjectSettingsOverrides,
    settings: ServerSettings,
    projectId: ProjectId,
  ) => ProjectSettingsOverrides | null,
): ScopedServerWrite[] {
  const byId = new Map(machines.map((machine) => [machine.machineId, machine]));
  const writes = new Map<MachineId, ScopedServerWrite>();
  for (const member of scope.members) {
    const machine = byId.get(member.machineId);
    if (
      !machine?.serverConfig ||
      machine.connection.phase !== "connected" ||
      machine.serverConfig.machine?.capabilities.projectSettingsOverrides !== true
    ) {
      continue;
    }
    const settings = machine.serverConfig.settings;
    const entry = update(settings.projectSettingsOverrides[member.id] ?? {}, settings, member.id);
    const existing = writes.get(member.machineId);
    writes.set(member.machineId, {
      machineId: member.machineId,
      label: machine.label,
      previous: settings,
      patch: {
        projectSettingsOverrides: {
          ...existing?.patch.projectSettingsOverrides,
          [member.id]: entry,
        },
      },
    });
  }
  return [...writes.values()];
}

/** Puts an idle compaction mode in the form each destination server reads. */
function forDestination(previous: ServerSettings, patch: ServerSettingsPatch): ServerSettingsPatch {
  if (patch.idleCompaction === undefined) return patch;
  const { idleCompaction, compactIdleThreads: _legacy, ...rest } = patch;
  return { ...rest, ...idleCompactionPatch(previous, idleCompaction) };
}

export function planScopedSettingsPatch(
  scope: ResolvedSettingsScope,
  machines: readonly ScopedSettingsMachine[],
  patch: ScopedSettingsPatch,
) {
  const clientPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => CLIENT_KEYS.has(key) && !SERVER_KEYS.has(key)),
  ) as ClientSettingsPatch;
  const serverPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => SERVER_KEYS.has(key)),
  ) as ServerSettingsPatch;
  const serverKeys = Object.keys(serverPatch);
  const { connectedMachines } = selectScopedSettingsMachines(scope, machines, null);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unscopableKeys = isProjectScope
    ? serverKeys.filter((key) => !isProjectScopedSettingKey(key))
    : [];
  const serverWrites: ScopedServerWrite[] =
    serverKeys.length === 0
      ? []
      : isProjectScope
        ? unscopableKeys.length > 0
          ? []
          : projectOverrideWrites(scope, machines, (current, settings, projectId) => {
              // Object-valued keys arrive as partial patches (the writing style
              // rows send one field); an override entry stores the whole value,
              // so complete the patch from the target's effective value.
              const effective = resolveProjectSettings(settings, projectId).settings;
              const next: Record<string, unknown> = { ...current };
              for (const [key, value] of Object.entries<unknown>(serverPatch)) {
                if (key === "worktreeCleanup" && serverPatch.worktreeCleanup?.mode === "custom") {
                  next[key] = {
                    mode: "custom",
                    rules: {
                      ...resolveWorktreeCleanup(settings, projectId),
                      ...serverPatch.worktreeCleanup.rules,
                    },
                  };
                  continue;
                }
                // A picker's "Inherit" sends null; for keys whose override
                // cannot store null that means remove the override.
                if (
                  value === null &&
                  !isNullableProjectSettingsOverride(key as ProjectScopedServerSettingKey)
                ) {
                  delete next[key];
                  continue;
                }
                const base: unknown = effective[key as keyof ServerSettings];
                // A new model must not inherit the previous model's options.
                if (
                  isPlainObject(value) &&
                  isPlainObject(base) &&
                  (key === "defaultModelSelection" ||
                    key === "sourceControlWriterModelSelection" ||
                    key === "reviewGuideModelSelection" ||
                    key === "textGenerationModelSelection") &&
                  (value.instanceId !== undefined || value.model !== undefined)
                ) {
                  next[key] = { instanceId: base.instanceId, model: base.model, ...value };
                  continue;
                }
                next[key] =
                  isPlainObject(value) && isPlainObject(base) ? { ...base, ...value } : value;
              }
              return next as ProjectSettingsOverrides;
            })
        : scope.kind === "all" || scope.kind === "machine"
          ? connectedMachines.flatMap((machine) => {
              const previous = machine.serverConfig?.settings;
              if (!previous) return [];
              return [
                {
                  machineId: machine.machineId,
                  label: machine.label,
                  previous,
                  patch: forDestination(
                    previous,
                    previous.worktreeCleanup != null &&
                      serverPatch.storageCleanup &&
                      Object.keys(serverPatch.storageCleanup).some((key) =>
                        key.startsWith("worktree"),
                      )
                      ? {
                          ...serverPatch,
                          worktreeCleanup: {
                            mode: "custom",
                            rules: {
                              ...resolveWorktreeCleanup(previous, null),
                              ...Object.fromEntries(
                                Object.entries(serverPatch.storageCleanup).filter(([key]) =>
                                  key.startsWith("worktree"),
                                ),
                              ),
                            },
                          },
                        }
                      : serverPatch,
                  ),
                },
              ];
            })
          : [];
  const hasClientWrite = Object.keys(clientPatch).length > 0;
  const hasWrite = hasClientWrite || serverWrites.length > 0;
  const unavailableReason =
    hasWrite || Object.keys(patch).length === 0
      ? null
      : scope.kind === "unavailable"
        ? scope.message
        : unscopableKeys.length > 0
          ? "This setting is machine-wide and cannot be overridden by a project."
          : isProjectScope
            ? "Connect the selected checkouts, or update their machines, to save a project override."
            : `Connect ${scope.kind === "machine" ? scope.label : "a machine"} to save this setting.`;
  return { clientPatch, hasClientWrite, serverWrites, unavailableReason };
}

export function planScopedSettingsClear(
  scope: ResolvedSettingsScope,
  machines: readonly ScopedSettingsMachine[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const serverWrites =
    scope.kind === "project" || scope.kind === "checkout"
      ? projectOverrideWrites(scope, machines, (_current, settings, projectId) =>
          clearProjectSettingsOverrides(settings, projectId, keys),
        )
      : [];
  return {
    clientPatch: {} as ClientSettingsPatch,
    hasClientWrite: false,
    serverWrites,
    unavailableReason:
      serverWrites.length > 0
        ? null
        : "Connect the selected checkouts, or update their machines, to reset this override.",
  };
}

export interface ProjectOverrideEntry {
  readonly machineId: MachineId;
  readonly projectId: ProjectId;
}

export function listProjectOverrides(
  machines: readonly ScopedSettingsMachine[],
  keys: readonly (keyof ServerSettings)[],
): readonly ProjectOverrideEntry[] {
  const scoped = keys.filter(isProjectScopedSettingKey);
  if (scoped.length === 0) return [];
  return machines.flatMap((machine) => {
    const overrides = machine.serverConfig?.settings.projectSettingsOverrides;
    if (!overrides) return [];
    return Object.entries(overrides).flatMap(([projectId, entry]) =>
      scoped.some((key) => Object.hasOwn(entry, key))
        ? [{ machineId: machine.machineId, projectId: projectId as ProjectId }]
        : [],
    );
  });
}

export function planProjectOverridesClear(
  machines: readonly ScopedSettingsMachine[],
  entries: readonly ProjectOverrideEntry[],
  keys: readonly ProjectScopedServerSettingKey[],
) {
  const byId = new Map(machines.map((machine) => [machine.machineId, machine]));
  const writes = new Map<MachineId, ScopedServerWrite>();
  for (const { machineId, projectId } of entries) {
    const machine = byId.get(machineId);
    if (!machine?.serverConfig || machine.connection.phase !== "connected") continue;
    const settings = machine.serverConfig.settings;
    const existing = writes.get(machineId);
    writes.set(machineId, {
      machineId,
      label: machine.label,
      previous: settings,
      patch: {
        projectSettingsOverrides: {
          ...existing?.patch.projectSettingsOverrides,
          [projectId]: clearProjectSettingsOverrides(settings, projectId, keys),
        },
      },
    });
  }
  const serverWrites = [...writes.values()];
  return {
    clientPatch: {} as ClientSettingsPatch,
    hasClientWrite: false,
    serverWrites,
    unavailableReason:
      serverWrites.length > 0 ? null : "Connect the machines to reset these overrides.",
  };
}

function writeWasDropped(value: unknown, before: unknown, saved: unknown): boolean {
  if (value === null) return before != null && Equal.equals(saved, before);
  if (isPlainObject(value) && !Array.isArray(before) && !Array.isArray(saved)) {
    const field = (source: unknown, key: string) =>
      isPlainObject(source) ? source[key] : undefined;
    return Object.entries(value).some(([key, next]) =>
      writeWasDropped(next, field(before, key), field(saved, key)),
    );
  }
  const unchanged =
    typeof value === "string" && typeof before === "string"
      ? value.trim() === before
      : Equal.equals(value, before);
  return !unchanged && Equal.equals(saved, before);
}

/**
 * An older server drops keys it does not know, top-level or nested, and still
 * succeeds. Left unreported, the row stays mixed forever.
 */
function droppedSettingKeys(write: ScopedServerWrite, saved: ServerSettings | undefined) {
  if (saved === undefined) return [];
  return Object.entries(write.patch).flatMap(([key, value]) =>
    writeWasDropped(
      value,
      write.previous[key as keyof ServerSettings],
      saved[key as keyof ServerSettings],
    )
      ? [key]
      : [],
  );
}

export async function persistScopedSettingsPatch(
  plan: ReturnType<typeof planScopedSettingsPatch>,
  persistServer: (input: {
    machineId: MachineId;
    input: { patch: ServerSettingsPatch };
  }) => Promise<{
    readonly _tag: "Success" | "Failure";
    readonly cause?: Cause.Cause<unknown>;
    readonly value?: ServerSettings;
  }>,
  persistClient: (patch: ClientSettingsPatch) => void,
) {
  if (plan.hasClientWrite) persistClient(plan.clientPatch);
  const results = await Promise.allSettled(
    plan.serverWrites.map(({ machineId, patch }) =>
      persistServer({ machineId, input: { patch } }),
    ),
  );
  const saved = (index: number) => {
    const result = results[index];
    return (
      result?.status === "fulfilled" &&
      result.value._tag === "Success" &&
      droppedSettingKeys(plan.serverWrites[index]!, result.value.value).length === 0
    );
  };
  const failedMachines = plan.serverWrites.flatMap((machine, index) => {
    if (saved(index)) return [];
    const result = results[index];
    if (result?.status === "fulfilled" && result.value._tag === "Success") {
      return [
        {
          ...machine,
          message: "This machine does not support this setting. Update Vekrel on it.",
        },
      ];
    }
    const error: unknown =
      result?.status === "rejected"
        ? result.reason
        : result?.status === "fulfilled" && result.value.cause
          ? Cause.squash(result.value.cause)
          : undefined;
    return [
      {
        ...machine,
        message:
          error instanceof Error
            ? error.message
            : "The save failed. Try reconnecting and saving again.",
      },
    ];
  });
  const savedMachines = plan.serverWrites.filter((_, index) => saved(index));
  return {
    failedMachines,
    savedMachines,
    savedMachineCount: savedMachines.length,
  };
}
