import type {
  KeybindingCommand,
  ProjectId,
  ProjectScript,
  MachineId,
} from "@vekrel/contracts";
import { AuthSettingsWriteScope, MachineAuthorizationError } from "@vekrel/contracts";
import type { UnifiedSettings } from "@vekrel/contracts/settings";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@vekrel/client-runtime/state/runtime";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";
import { resolveProjectScripts } from "@vekrel/shared/projectScripts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
  releaseClaimedRoles,
} from "../../projectScripts";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { serverMachine } from "../../state/server";
import { readMachineScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjects } from "../../state/entities";
import { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * Adds, edits, and deletes the active project's scripts. A script's keyboard
 * shortcut lives in the machine's keybindings, so each change writes the
 * script settings first and then reconciles the shortcut.
 */
export function useProjectScriptEditing(input: {
  readonly machineId: MachineId;
  readonly project: MachineProject | null;
  readonly scripts: ReadonlyArray<ProjectScript>;
  readonly settings: UnifiedSettings;
}) {
  const { machineId, project, scripts, settings } = input;
  const allProjects = useProjects();
  const updateProjectScriptSettings = useAtomCommand(serverMachine.updateSettings, {
    reportFailure: false,
  });
  const upsertKeybinding = useAtomCommand(serverMachine.upsertKeybinding, {
    reportFailure: false,
  });
  const removeKeybinding = useAtomCommand(serverMachine.removeKeybinding, {
    reportFailure: false,
  });
  const persistProjectScripts = async (input: {
    projectId: ProjectId;
    projectCwd: string;
    previousScripts: ReadonlyArray<ProjectScript>;
    nextScripts: ReadonlyArray<ProjectScript>;
    keybinding: NewProjectScriptInput["keybinding"];
    keybindingCommand: KeybindingCommand | null;
  }): Promise<AtomCommandResult<void, unknown>> => {
    const serverConfig = appAtomRegistry.get(serverMachine.configValueAtom(machineId));
    const previousKeybinding = keybindingValueForCommand(
      serverConfig?.keybindings ?? [],
      input.keybindingCommand,
    );
    const isDeletingScript = !input.nextScripts.some(
      (script) => commandForProjectScript(script.id) === input.keybindingCommand,
    );
    const changesKeybinding =
      input.keybinding !== undefined &&
      (input.keybinding?.trim() || null) !== previousKeybinding &&
      (!isDeletingScript || readMachineScope(machineId, AuthSettingsWriteScope));
    if (changesKeybinding && !readMachineScope(machineId, AuthSettingsWriteScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new MachineAuthorizationError({
            requiredScope: AuthSettingsWriteScope,
            message: "This connection cannot change keyboard shortcuts.",
          }),
        ),
      );
    }
    const keybindingRule = changesKeybinding
      ? decodeProjectScriptKeybindingRule({
          keybinding: input.keybinding,
          command: input.keybindingCommand,
        })
      : null;
    const updateResult = mapAtomCommandResult(
      await updateProjectScriptSettings({
        machineId,
        input: {
          patch:
            serverConfig?.machine.capabilities.projectSettingsOverrides === true
              ? {
                  projectSettingsOverrides: {
                    [input.projectId]: {
                      ...settings.projectSettingsOverrides[input.projectId],
                      defaultProjectScripts: input.nextScripts,
                    },
                  },
                }
              : {
                  projectScriptOverrides: {
                    [input.projectId]: input.nextScripts,
                  },
                },
        },
      }),
      () => undefined,
    );
    if (updateResult._tag === "Failure") {
      return updateResult;
    }

    if (!changesKeybinding) return updateResult;
    if (!readMachineScope(machineId, AuthSettingsWriteScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new MachineAuthorizationError({
            requiredScope: AuthSettingsWriteScope,
            message: isDeletingScript
              ? "The script was deleted, but its keyboard shortcut could not be removed because permission changed."
              : "The script was saved, but this connection can no longer change keyboard shortcuts.",
          }),
        ),
      );
    }

    const scriptId = input.keybindingCommand
      ? projectScriptIdFromCommand(input.keybindingCommand)
      : null;
    if (!keybindingRule && !input.previousScripts.some((script) => script.id === scriptId)) {
      return updateResult;
    }
    const retainedElsewhere =
      !input.nextScripts.some((script) => script.id === scriptId) &&
      (settings.defaultProjectScripts.some((script) => script.id === scriptId) ||
        Object.entries(settings.projectSettingsOverrides).some(
          ([projectId, entry]) =>
            projectId !== input.projectId &&
            entry.defaultProjectScripts?.some((script) => script.id === scriptId),
        ) ||
        allProjects.some(
          (other) =>
            other.machineId === machineId &&
            other.id !== input.projectId &&
            resolveProjectScripts(settings, other).some((script) => script.id === scriptId),
        ));
    if (!keybindingRule && retainedElsewhere) return updateResult;

    const previousRules = (serverConfig?.keybindings ?? []).flatMap((binding) => {
      if (binding.command !== input.keybindingCommand || binding.whenAst) return [];
      const previous = decodeProjectScriptKeybindingRule({
        keybinding: keybindingValueForCommand([binding], input.keybindingCommand),
        command: input.keybindingCommand,
      });
      return previous ? [previous] : [];
    });
    const previous = previousRules.at(-1);
    for (const rule of keybindingRule ? previousRules.slice(0, -1) : previousRules) {
      const result = await removeKeybinding({ machineId, input: rule });
      if (result._tag === "Failure") return mapAtomCommandResult(result, () => undefined);
    }
    return keybindingRule
      ? mapAtomCommandResult(
          await upsertKeybinding({
            machineId,
            input:
              previous && previous.key !== keybindingRule.key
                ? { ...keybindingRule, replace: previous }
                : keybindingRule,
          }),
          () => undefined,
        )
      : updateResult;
  };
  const saveProjectScript = async (
    input: NewProjectScriptInput,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!project) {
      return AsyncResult.success(undefined);
    }
    const nextId = nextProjectScriptId(
      input.name,
      scripts.map((script) => script.id),
    );
    const nextScript = buildProjectScript(nextId, input);
    const nextScripts = [
      ...scripts.map((script) => releaseClaimedRoles(script, input)),
      nextScript,
    ];

    return persistProjectScripts({
      projectId: project.id,
      projectCwd: project.workspaceRoot,
      previousScripts: scripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(nextId),
    });
  };
  const updateProjectScript = async (
    scriptId: string,
    input: NewProjectScriptInput,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!project) {
      return AsyncResult.success(undefined);
    }
    const existingScript = scripts.find((script) => script.id === scriptId);
    if (!existingScript) {
      return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
    }

    const updatedScript = buildProjectScript(existingScript.id, input);
    const nextScripts = scripts.map((script) =>
      script.id === scriptId ? updatedScript : releaseClaimedRoles(script, input),
    );

    return persistProjectScripts({
      projectId: project.id,
      projectCwd: project.workspaceRoot,
      previousScripts: scripts,
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(scriptId),
    });
  };
  const deleteProjectScript = async (
    scriptId: string,
  ): Promise<AtomCommandResult<void, unknown>> => {
    if (!project) {
      return AsyncResult.success(undefined);
    }
    const nextScripts = scripts.filter((script) => script.id !== scriptId);

    const deletedName = scripts.find((s) => s.id === scriptId)?.name;

    const result = await persistProjectScripts({
      projectId: project.id,
      projectCwd: project.workspaceRoot,
      previousScripts: scripts,
      nextScripts,
      keybinding: null,
      keybindingCommand: commandForProjectScript(scriptId),
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Deleted action "${deletedName ?? "Unknown"}"`,
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
    return result;
  };
  return {
    saveProjectScript: useStableCallback(saveProjectScript),
    updateProjectScript: useStableCallback(updateProjectScript),
    deleteProjectScript: useStableCallback(deleteProjectScript),
  };
}
