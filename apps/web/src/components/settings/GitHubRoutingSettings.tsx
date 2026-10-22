import { useAtomValue } from "@effect/atom-react";
import { resolveMachineKind } from "@vekrel/contracts";
import {
  gitHubRoutingConnectionKey,
  gitHubRoutingPermissionFor,
  type GitHubRoutingPermission,
} from "@vekrel/client-runtime/connection";
import { useState } from "react";

import { machineCatalog } from "~/connection/catalog";
import type { MachinePresentation } from "~/state/machines";
import { useAtomCommand } from "~/state/use-atom-command";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { MachineRow, machineTransportLabel } from "./MachineRow";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { searchableSetting } from "./settingsSearch";

const options: ReadonlyArray<{ value: GitHubRoutingPermission; label: string }> = [
  { value: "off", label: "Off" },
  { value: "read", label: "Read PRs" },
  { value: "read-write", label: "Read and act" },
];

const summaryLabels = { "read-write": "read and act", read: "read PRs" } as const;

function summarizeGitHubRouting(
  entries: ReadonlyArray<{ readonly label: string; readonly permission: GitHubRoutingPermission }>,
): string | null {
  const groups = (["read-write", "read"] as const).flatMap((permission) => {
    const labels = entries.filter((entry) => entry.permission === permission);
    return labels.length === 0
      ? []
      : [`${labels.map((entry) => entry.label).join(", ")} ${summaryLabels[permission]}`];
  });
  return groups.length === 0 ? null : groups.join(" · ");
}

export function GitHubRoutingSettings({
  machines,
}: {
  readonly machines: ReadonlyArray<MachinePresentation>;
}) {
  const permissions = useAtomValue(machineCatalog.githubRoutingPermissionsValueAtom);
  const catalog = useAtomValue(machineCatalog.catalogValueAtom);
  const update = useAtomCommand(machineCatalog.setGitHubRoutingPermission);
  const [saving, setSaving] = useState(false);

  if (machines.length < 2) return null;

  const { id, title } = searchableSetting("github-routing");
  return (
    <FoldedSettingsSection
      id={id}
      title={title}
      summary={
        summarizeGitHubRouting(
          machines.map((machine) => ({
            label: machine.label,
            permission: gitHubRoutingPermissionFor(machine.entry, permissions),
          })),
        ) ?? "Off"
      }
    >
      <p className="px-3 py-2.5 text-xs text-muted-foreground sm:px-4">
        Machines you trust here can read PR data through each other's GitHub access. Enable both
        machines. Read and act may use broader permissions than the machine that owns them. This
        applies only to this device.
      </p>
      {machines.map((machine) => (
        <MachineRow
          key={machine.machineId}
          kind={resolveMachineKind(machine.serverConfig)}
          label={machine.label}
          subtitle={machineTransportLabel(machine)}
        >
          <Select
            items={options}
            value={gitHubRoutingPermissionFor(machine.entry, permissions)}
            disabled={
              !catalog.isReady || saving || gitHubRoutingConnectionKey(machine.entry) === null
            }
            onValueChange={(permission) => {
              if (permission === null) return;
              setSaving(true);
              void update({ machineId: machine.machineId, permission }).then(
                (result) => {
                  setSaving(false);
                  if (result._tag === "Failure")
                    toastManager.add({
                      type: "error",
                      title: "Could not save GitHub routing permission",
                    });
                },
              );
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-32"
              aria-label={`${machine.label} GitHub routing`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {options.map(({ value, label }) => (
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
