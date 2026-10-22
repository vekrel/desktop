import { createFileRoute } from "@tanstack/react-router";
import { MachineId, ProviderInstanceId } from "@vekrel/contracts";

import { ProviderSettingsPanel } from "../components/settings/ProviderSettingsPanel";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

function SettingsProvidersRoute() {
  const target = Route.useSearch();
  const { machine, scope } = useSettingsScope();
  if (!machine) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "machine"
          ? `Reconnect ${scope.label} to set up its providers.`
          : "Connect a machine to set up its providers."}
      </p>
    );
  }
  return (
    <ProviderSettingsPanel
      machineId={machine.machineId}
      {...(target.instanceId ? { instanceId: target.instanceId } : {})}
      projectIds={
        scope.kind === "project" || scope.kind === "checkout"
          ? scope.members
              .filter((member) => member.machineId === machine.machineId)
              .map((member) => member.id)
          : []
      }
      scoped
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.machineId === "string" && raw.machineId.trim()
      ? { machineId: MachineId.make(raw.machineId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
});
