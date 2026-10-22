import {
  AuthOrchestrationOperateScope,
  type EditorId,
  type MachineId,
} from "@vekrel/contracts";
import { squashAtomCommandFailure } from "@vekrel/client-runtime/state/runtime";

import { useOpenInPreferredEditor } from "../editorPreferences";
import { useMachineScope } from "../state/session";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function KeybindingsConfigWarning({
  message,
  machineId,
  configPath,
  availableEditors,
}: {
  message: string;
  machineId: MachineId | null;
  configPath: string | null;
  availableEditors: readonly EditorId[];
}) {
  const canOpenEditor = useMachineScope(machineId, AuthOrchestrationOperateScope);
  const openInEditor = useOpenInPreferredEditor(machineId, availableEditors);

  return (
    <>
      {message}
      <span className="mt-2 flex justify-end">
        <Button
          size="xs"
          variant="outline"
          disabled={!canOpenEditor || !configPath || availableEditors.length === 0}
          onClick={async () => {
            if (!configPath) return;
            const result = await openInEditor(configPath);
            if (result._tag === "Success") return;
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Unable to open keybindings file",
                description: error instanceof Error ? error.message : "Unknown error opening file.",
              }),
            );
          }}
        >
          Open keybindings.json
        </Button>
      </span>
    </>
  );
}
