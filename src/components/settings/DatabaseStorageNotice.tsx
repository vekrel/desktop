import { useAtomValue } from "@effect/atom-react";
import type { MachineId } from "@vekrel/contracts";
import * as Schema from "effect/Schema";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { serverMachine } from "../../state/server";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const DismissedMachineIds = Schema.Array(Schema.String);

/** Suggests `t3 doctor` on every machine whose database still holds at least 1 GiB of freed pages. */
export function DatabaseStorageNotice({
  machines,
}: {
  machines: ReadonlyArray<{ readonly machineId: MachineId; readonly label: string }>;
}) {
  const recommendations = useAtomValue(
    serverMachine.databaseCompactionRecommendations(
      JSON.stringify(machines.map((machine) => machine.machineId)),
    ),
  );
  const [dismissed, setDismissed] = useLocalStorage(
    "database-storage-notice-dismissed",
    [],
    DismissedMachineIds,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  const visible = recommendations.filter(
    (recommendation) => !dismissed.includes(recommendation.machineId),
  );
  if (visible.length === 0) return null;
  return (
    <SettingsSection id="storage-database" title="Database">
      <SettingsRow
        title="Reclaim freed database space"
        description="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the machine."
      />
      {visible.map(({ machineId, status }) => (
        <SettingsRow
          key={machineId}
          title={`${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${
            machines.find((machine) => machine.machineId === machineId)
              ?.label ?? machineId
          }`}
          description={<code className="select-text break-all">{status.compactCommand}</code>}
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() => copyToClipboard(status.compactCommand, undefined)}
              >
                Copy command
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDismissed((current) => [...current, machineId])}
              >
                Dismiss
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}
