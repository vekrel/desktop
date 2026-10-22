import { AuthSettingsWriteScope, MachineAuthorizationError } from "@vekrel/contracts";
import { readMachineScope } from "../../state/session";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@vekrel/client-runtime/state/runtime";
import {
  type MachineId,
  type ProjectId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ServerSettings,
} from "@vekrel/contracts";
import { resolveProjectScripts } from "@vekrel/shared/projectScripts";
import { clearProjectSettingsOverrides } from "@vekrel/shared/projectSettings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  releaseClaimedRoles,
} from "../../projectScripts";
import { useProjects } from "../../state/entities";
import { serverMachine } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { NewProjectScriptInput } from "../projectScriptEditor";
import { toastManager } from "../ui/toast";

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Failed to save project actions",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return mapAtomCommandResult(result, () => undefined);
}

export function useProjectScriptSettings(
  targets: readonly {
    machineId: MachineId;
    settings: ServerSettings;
    keybindings: ResolvedKeybindingsConfig;
    project?: { id: ProjectId; scripts: readonly ProjectScript[] };
  }[],
) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverMachine.updateSettings, "project actions update");
  const upsertKeybinding = useAtomCommand(
    serverMachine.upsertKeybinding,
    "action shortcut update",
  );
  const removeKeybinding = useAtomCommand(
    serverMachine.removeKeybinding,
    "action shortcut removal",
  );

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId?: string,
    keybinding?: string | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "No available machine, or another action change is saving.";
      toastManager.add({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    if (
      targets.some(
        ({ machineId }) => !readMachineScope(machineId, AuthSettingsWriteScope),
      )
    ) {
      return reportScriptFailure(
        AsyncResult.failure(
          Cause.fail(
            new MachineAuthorizationError({
              requiredScope: AuthSettingsWriteScope,
              message: "This connection cannot change machine settings.",
            }),
          ),
        ),
      );
    }
    savingRef.current = true;
    setSaving(true);
    return writeTargets(transform, scriptId, keybinding).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  }

  async function writeTargets(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId: string | undefined,
    keybinding: string | null | undefined,
  ): Promise<AtomCommandResult<void, unknown>> {
    for (const { machineId, settings, keybindings, project } of targets) {
      const current = project
        ? resolveProjectScripts(settings, project)
        : settings.defaultProjectScripts;
      const nextScripts = transform(current);
      const effectiveScripts = nextScripts ?? settings.defaultProjectScripts;
      const result = await updateSettings({
        machineId,
        input: {
          patch: project
            ? {
                projectSettingsOverrides: {
                  [project.id]:
                    nextScripts === null
                      ? clearProjectSettingsOverrides(settings, project.id, [
                          "defaultProjectScripts",
                        ])
                      : {
                          ...settings.projectSettingsOverrides[project.id],
                          defaultProjectScripts: nextScripts,
                        },
                },
              }
            : { defaultProjectScripts: nextScripts ?? [] },
        },
      });
      if (result._tag === "Failure") return reportScriptFailure(result);
      const changedIds = scriptId
        ? [scriptId]
        : current
            .filter((script) => !effectiveScripts.some((next) => next.id === script.id))
            .map((script) => script.id);
      for (const id of changedIds) {
        if (keybinding === undefined && effectiveScripts.some((script) => script.id === id)) {
          continue;
        }
        const command = commandForProjectScript(id);
        const previousValue = keybindingValueForCommand(keybindings, command);
        const previous = previousValue
          ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command })
          : null;
        const next = decodeProjectScriptKeybindingRule({ keybinding, command });
        const retainedElsewhere =
          !nextScripts?.some((script) => script.id === id) &&
          ((project && settings.defaultProjectScripts.some((script) => script.id === id)) ||
            Object.entries(settings.projectSettingsOverrides).some(
              ([projectId, entry]) =>
                projectId !== project?.id &&
                entry.defaultProjectScripts?.some((script) => script.id === id),
            ) ||
            projects.some(
              (other) =>
                other.machineId === machineId &&
                other.id !== project?.id &&
                (project ? resolveProjectScripts(settings, other) : other.scripts).some(
                  (script) => script.id === id,
                ),
            ));
        const bindingResult = next
          ? await upsertKeybinding({
              machineId,
              input: previous && previous.key !== next.key ? { ...next, replace: previous } : next,
            })
          : previous && !retainedElsewhere
            ? await removeKeybinding({ machineId, input: previous })
            : null;
        if (bindingResult?._tag === "Failure") return reportScriptFailure(bindingResult);
      }
    }
    return AsyncResult.success(undefined);
  }

  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = [
      ...projects.flatMap((project) => project.scripts.map((script) => script.id)),
      ...targets.flatMap(({ settings, project }) =>
        [
          ...settings.defaultProjectScripts,
          ...Object.values(settings.projectSettingsOverrides).flatMap(
            (entry) => entry.defaultProjectScripts ?? [],
          ),
          ...(project?.scripts ?? []),
        ].map((script) => script.id),
      ),
    ];
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    const next = buildProjectScript(id, input);
    return persist(
      (current) => {
        const updated = current.map((script) =>
          script.id === id ? next : releaseClaimedRoles(script, input),
        );
        return scriptId === null ? [...updated, next] : updated;
      },
      id,
      input.keybinding,
    );
  }

  return { saving, persist, submit };
}
