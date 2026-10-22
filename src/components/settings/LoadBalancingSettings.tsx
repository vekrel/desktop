import { resolveMachineKind } from "@vekrel/contracts";

import {
  useClientSettings,
  useClientSettingsHydrated,
  updateClientSettings,
} from "~/hooks/useSettings";
import type { MachinePresentation } from "~/state/machines";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { MachineRow, machineTransportLabel } from "./MachineRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const preferences = [
  { value: 100, label: "Prefer" },
  { value: 50, label: "Normal" },
  { value: 25, label: "Less often" },
  { value: 0, label: "Manual only" },
] as const;

type LoadPreference = (typeof preferences)[number]["value"];

function loadPreferenceForWeight(weight: number | undefined): LoadPreference {
  if (weight === undefined || weight === 50) return 50;
  if (weight === 0) return 0;
  return weight < 50 ? 25 : 100;
}

function preferenceLabel(preference: LoadPreference): string {
  return preferences.find((entry) => entry.value === preference)!.label;
}

function summarizeLoadPreferences(
  machines: ReadonlyArray<Pick<MachinePresentation, "machineId" | "label">>,
  weights: Readonly<Record<string, number>>,
): string | null {
  const parts = machines.flatMap((machine) => {
    const preference = loadPreferenceForWeight(weights[machine.machineId]);
    return preference === 50
      ? []
      : [`${machine.label} ${preferenceLabel(preference).toLowerCase()}`];
  });
  return parts.length === 0 ? null : parts.join(" · ");
}

export function LoadBalancingSettings({
  machines,
}: {
  machines: ReadonlyArray<MachinePresentation>;
}) {
  const settings = useClientSettings((current) => ({
    loadBalancingEnabled: current.loadBalancingEnabled,
    loadBalancingWeights: current.loadBalancingWeights,
  }));
  const settingsHydrated = useClientSettingsHydrated();

  if (machines.length < 2) return null;

  const { id, title } = searchableSetting("load-balancing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        settings.loadBalancingEnabled
          ? summarizeLoadPreferences(machines, settings.loadBalancingWeights)
          : "Off"
      }
      control={
        <Switch
          aria-label="Automatically balance load"
          checked={settings.loadBalancingEnabled}
          disabled={!settingsHydrated}
          onCheckedChange={(loadBalancingEnabled) => updateClientSettings({ loadBalancingEnabled })}
        />
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        New threads in shared projects start on the machine with the most free CPU and memory,
        weighted by each machine's preference.
      </p>
      {machines.map((machine) => (
        <MachineRow
          key={machine.machineId}
          kind={resolveMachineKind(machine.serverConfig)}
          label={machine.label}
          subtitle={machineTransportLabel(machine)}
        >
          <Select
            items={preferences}
            value={loadPreferenceForWeight(
              settings.loadBalancingWeights[machine.machineId],
            )}
            disabled={!settingsHydrated || !settings.loadBalancingEnabled}
            onValueChange={(value) => {
              if (value === null) return;
              updateClientSettings({
                loadBalancingWeights: {
                  ...settings.loadBalancingWeights,
                  [machine.machineId]: value,
                },
              });
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-32"
              aria-label={`${machine.label} load preference`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {preferences.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </MachineRow>
      ))}
    </FoldedSettingsSection>
  );
}
