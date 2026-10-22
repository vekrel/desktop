import type { EditorId, MachineId, ResolvedKeybindingsConfig } from "@vekrel/contracts";
import { useEffect } from "react";

import { usePreferredEditor } from "../../editorPreferences";
import { isOpenFavoriteEditorShortcut } from "../../keybindings";
import { useRemoteOpenState } from "../../remoteOpen";
import { shellMachine } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

export function useOpenFavoriteEditorShortcut({
  enabled,
  machineId,
  keybindings,
  availableEditors,
  openInCwd,
}: {
  enabled: boolean;
  machineId: MachineId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
}) {
  const openInEditorMutation = useAtomCommand(shellMachine.openInEditor, "open in editor");
  const [preferredEditor] = usePreferredEditor(availableEditors);
  const remote = useRemoteOpenState(machineId);

  useEffect(() => {
    if (!enabled || remote.mode !== "local-exec") return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !isOpenFavoriteEditorShortcut(event, keybindings)) return;
      if (!openInCwd || !preferredEditor) return;

      event.preventDefault();
      void openInEditorMutation({
        machineId,
        input: {
          cwd: openInCwd,
          editor: preferredEditor,
        },
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    enabled,
    machineId,
    keybindings,
    openInCwd,
    openInEditorMutation,
    preferredEditor,
    remote.mode,
  ]);
}
