import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { MachinePresentation } from "../../state/machines";
import type { ResolvedSettingsScope, SettingsScopeSearch } from "./settingsScope";

type ScopeMachine = Pick<MachinePresentation, "machineId" | "label" | "displayUrl">;

export function settingsScopeMachineAddress(machine: ScopeMachine) {
  if (!machine.displayUrl) return machine.machineId;
  try {
    return new URL(machine.displayUrl).host || machine.displayUrl;
  } catch {
    return machine.displayUrl;
  }
}

export function settingsScopeMachineLabels(
  machine: ScopeMachine,
  machines?: readonly ScopeMachine[],
) {
  const duplicates = machines?.filter(
    (other) =>
      other.machineId !== machine.machineId && other.label === machine.label,
  );
  const address = settingsScopeMachineAddress(machine);
  const secondary = duplicates?.some((other) => settingsScopeMachineAddress(other) === address)
    ? machine.displayUrl || machine.machineId
    : address;
  return {
    primary: machine.label,
    secondary: machines === undefined || duplicates?.length ? secondary : "",
  };
}

export function settingsScopeMachineLabel(
  machine: ScopeMachine,
  machines: readonly ScopeMachine[],
) {
  const { primary, secondary } = settingsScopeMachineLabels(machine, machines);
  return secondary ? `${primary} · ${secondary}` : primary;
}

export function settingsScopeProjectMachines(
  group: SidebarProjectSnapshot,
  allMachines: readonly ScopeMachine[],
  includeAddresses = false,
) {
  const machines = group.memberProjects.map((member) => {
    const machine = allMachines.find((entry) => entry.machineId === member.machineId);
    if (!machine) return member.machineLabel ?? member.machineId;
    const { primary, secondary } = settingsScopeMachineLabels(machine, allMachines);
    const address =
      secondary || (includeAddresses ? settingsScopeMachineAddress(machine) : "");
    return includeAddresses || address ? `${primary} · ${address}` : primary;
  });
  return Array.from(new Set(machines));
}

export const ALL_MACHINES_VALUE = "all";
export const ALL_PROJECTS_VALUE = "all";

export function machineAxisValue(
  search: SettingsScopeSearch,
  resolvedMachineId?: string | null,
): string {
  return search.machine ?? resolvedMachineId ?? ALL_MACHINES_VALUE;
}

export function projectAxisValue(search: SettingsScopeSearch): string {
  return search.project ?? ALL_PROJECTS_VALUE;
}

export function projectScopeMenuGroups(
  groups: readonly SidebarProjectSnapshot[],
  search: Pick<SettingsScopeSearch, "machine">,
) {
  const { machine } = search;
  if (machine === undefined) return groups;
  return groups.filter((group) =>
    group.memberProjects.some((member) => member.machineId === machine),
  );
}

export function selectMachineAxis(
  search: SettingsScopeSearch,
  value: string,
): SettingsScopeSearch {
  const next: SettingsScopeSearch = {};
  if (search.project) next.project = search.project;
  if (value !== ALL_MACHINES_VALUE) next.machine = value;
  return next;
}

export function selectProjectAxis(search: SettingsScopeSearch, value: string): SettingsScopeSearch {
  const next: SettingsScopeSearch = {};
  if (value !== ALL_PROJECTS_VALUE) next.project = value;
  if (search.machine) next.machine = search.machine;
  return next;
}

export function selectSingleMachineScope(
  search: SettingsScopeSearch,
  scope: ResolvedSettingsScope,
  machines: readonly {
    readonly machineId: MachinePresentation["machineId"];
    readonly connection: Pick<MachinePresentation["connection"], "phase">;
  }[],
  primaryMachineId: string | null,
): SettingsScopeSearch {
  if (search.machine || scope.kind === "unavailable") return search;
  const selectedIds = new Set(scope.machineIds);
  const candidates = machines.filter((machine) =>
    selectedIds.has(machine.machineId),
  );
  const selected =
    candidates.find((machine) => machine.machineId === primaryMachineId) ??
    candidates.find((machine) => machine.connection.phase === "connected") ??
    candidates[0];
  return selected ? { ...search, machine: selected.machineId } : search;
}
