import type { MachineConnectionPhase } from "@vekrel/client-runtime/connection";
import {
  AuthProvidersManageScope,
  type AuthSessionState,
  type MachineId,
  type ProjectId,
  type ProjectSettingsOverrides,
  type ProviderInstanceId,
  sessionGrantsScope,
  type ServerSettings,
  type SessionGrantInput,
} from "@vekrel/contracts";

export interface ProviderMachineOptionLike {
  readonly machineId: MachineId;
  readonly label: string;
}

export function isProviderSettingsMachineAvailable(input: {
  readonly connectionPhase: MachineConnectionPhase;
  readonly hasServerConfig: boolean;
}): boolean {
  return input.connectionPhase === "connected" && input.hasServerConfig;
}

export function buildProviderMachineOptions<T extends ProviderMachineOptionLike>(
  machines: ReadonlyArray<T>,
  primaryMachineId: MachineId | null,
  machineIds?: readonly MachineId[],
): ReadonlyArray<T> {
  const allowed = machineIds ? new Set(machineIds) : null;
  return machines
    .filter((machine) => !allowed || allowed.has(machine.machineId))
    .toSorted((left, right) => {
      const leftIsPrimary = left.machineId === primaryMachineId;
      const rightIsPrimary = right.machineId === primaryMachineId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      return (
        left.label.localeCompare(right.label) ||
        String(left.machineId).localeCompare(String(right.machineId))
      );
    });
}

export function resolveSelectedProviderMachineId(
  machines: ReadonlyArray<ProviderMachineOptionLike>,
  selectedMachineId: MachineId | null,
  primaryMachineId: MachineId | null,
): MachineId | null {
  if (
    selectedMachineId !== null &&
    machines.some((machine) => machine.machineId === selectedMachineId)
  ) {
    return selectedMachineId;
  }
  if (
    primaryMachineId !== null &&
    machines.some((machine) => machine.machineId === primaryMachineId)
  ) {
    return primaryMachineId;
  }
  return machines[0]?.machineId ?? null;
}

export type ProviderMachineAccess =
  | { readonly kind: "editable" }
  | { readonly kind: "loading"; readonly reason: "config" | "permissions" }
  | { readonly kind: "read-only" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

export type ProviderOperateAccess = "granted" | "denied" | "pending";

function resolveSessionOperateAccess(input: {
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  if (input.hasError) return "denied";
  if (input.session === null) return input.isPending ? "pending" : "denied";
  return sessionGrantsScope(input.session, AuthProvidersManageScope) ? "granted" : "denied";
}

export function resolvePrimaryOperateAccess(input: {
  readonly isPrimary: boolean;
  readonly hasDesktopBridge: boolean;
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  return resolveSessionOperateAccess(input);
}

export function resolveRemoteOperateAccess(input: {
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  return resolveSessionOperateAccess(input);
}

/**
 * `providerInstances` is always sent explicitly, even as `{}`, because the
 * server keeps a stored `providerInstances` map when an incoming entry omits
 * the key (so older clients that don't know the field cannot wipe it by editing
 * another setting).
 */

export function buildProviderInstanceOverridePatch(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectIds: readonly ProjectId[],
  instanceId: ProviderInstanceId,
  value: boolean | undefined,
): Record<ProjectId, ProjectSettingsOverrides | null> {
  const patch: Record<ProjectId, ProjectSettingsOverrides | null> = {};
  for (const projectId of projectIds) {
    const current = settings.projectSettingsOverrides[projectId];
    const instances = { ...current?.providerInstances };
    const instance = { ...instances[instanceId] };
    if (value === undefined) delete instance.enabled;
    else instance.enabled = value;
    if (Object.keys(instance).length > 0) instances[instanceId] = instance;
    else delete instances[instanceId];

    const { providerInstances: _omit, ...rest } = current ?? {};
    const nextEntry: ProjectSettingsOverrides = { ...rest, providerInstances: instances };
    patch[projectId] =
      Object.keys(rest).length === 0 && Object.keys(instances).length === 0 ? null : nextEntry;
  }
  return patch;
}

export function classifyProviderMachineAccess(input: {
  readonly connectionPhase: MachineConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}): ProviderMachineAccess {
  if (input.connectionPhase === "error") {
    return { kind: "error" };
  }
  if (input.connectionPhase !== "connected") {
    return { kind: "unavailable" };
  }
  if (!input.hasServerConfig) {
    return { kind: "loading", reason: "config" };
  }
  if (input.operateAccess === "pending") {
    return { kind: "loading", reason: "permissions" };
  }
  if (input.operateAccess === "denied") {
    return { kind: "read-only" };
  }
  return { kind: "editable" };
}
