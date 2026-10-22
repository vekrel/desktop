import { useClientSettings } from "../../hooks/useSettings";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import { useMachines, usePrimaryMachineId } from "../../state/machines";
import { useProjects } from "../../state/entities";

export function useSettingsProjectGroups() {
  const projects = useProjects();
  // Read the grouping fields one by one: a selector that builds an object hands back a new
  // identity on every client settings write, which rebuilds every group and, through the
  // settings scope, re-renders every settings row.
  const sidebarProjectGroupingMode = useClientSettings(
    (settings) => settings.sidebarProjectGroupingMode,
  );
  const sidebarProjectGroupingOverrides = useClientSettings(
    (settings) => settings.sidebarProjectGroupingOverrides,
  );
  const primaryMachineId = usePrimaryMachineId();
  const { machines } = useMachines();
  const labels = new Map(machines.map((entry) => [entry.machineId, entry.label]));
  return buildSidebarProjectSnapshots({
    projects,
    settings: { sidebarProjectGroupingMode, sidebarProjectGroupingOverrides },
    primaryMachineId,
    resolveMachineLabel: (id) => labels.get(id) ?? null,
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));
}
