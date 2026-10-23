import { useScopedSettingsWriteAllowed } from "./useScopedSettings";
import { AuthSettingsWriteScope } from "@vekrel/contracts";
import { MachineId, type T3ProjectFileScript } from "@vekrel/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@vekrel/shared/keybindings";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { useMachines } from "../../state/machines";
import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  editorRequestForScript,
  ProjectScriptEditorDialog,
  ScriptIcon,
  type NewProjectScriptInput,
  type ProjectScriptEditorRequest,
} from "../projectScriptEditor";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ProjectActionsList } from "./ProjectActionsList";
import { useProjectScriptSettings } from "./useProjectScriptSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";

export function ProjectActionsSettings() {
  const { scope, targets, target } = useSettingsScope();
  const { machines } = useMachines();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const representativeConfig = target
    ? machines.find((machine) => machine.machineId === target.machineId)?.serverConfig
    : undefined;
  const scripts = target?.settings.defaultProjectScripts ?? [];
  const keybindings = representativeConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const mixed = targets.some(
    (candidate) =>
      JSON.stringify(candidate.settings.defaultProjectScripts) !== JSON.stringify(scripts),
  );
  const canWriteSettings = useScopedSettingsWriteAllowed();
  const [request, setRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const memberById = new Map(
    isProjectScope ? scope.members.map((member) => [member.id, member]) : [],
  );
  const { saving, persist, submit } = useProjectScriptSettings(
    targets.flatMap((candidate) => {
      const machine = machines.find((entry) => entry.machineId === candidate.machineId);
      if (!machine?.serverConfig) return [];
      const member = candidate.projectId ? memberById.get(candidate.projectId) : undefined;
      // An older server ignores the override record, so a project edit there
      // would report success and vanish; such machines are left out and
      // the legacy per-project map keeps serving them.
      if (member && machine.serverConfig.machine?.capabilities.projectSettingsOverrides !== true) {
        return [];
      }
      return [
        {
          machineId: candidate.machineId,
          settings: machine.serverConfig.settings,
          keybindings: machine.serverConfig.keybindings,
          ...(member ? { project: member } : {}),
        },
      ];
    }),
  );

  const representativeMember = target?.projectId ? memberById.get(target.projectId) : undefined;
  const t3File = useT3ProjectFileState(
    representativeMember?.machineId ?? MachineId.make("none"),
    representativeMember?.workspaceRoot ?? null,
  );
  const importableScripts = t3File.scripts.filter(
    (fileScript) =>
      !scripts.some(
        (script) =>
          script.command === fileScript.command ||
          script.name.toLowerCase() === fileScript.name.toLowerCase(),
      ),
  );
  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      waitForSetup: fileScript.runOnWorktreeCreate === true && fileScript.async === false,
      runOnSettle: fileScript.runOnSettle ?? false,
      keybinding: null,
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await submit(null, payload);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setRequest({
        scriptId: null,
        initial: payload,
        error: error instanceof Error ? error.message : "Failed to import action.",
      });
    }
  };

  return (
    <SettingsSection id="project-actions" title="Actions">
      <SettingsRow
        serverScoped
        settingKeys={["defaultProjectScripts"]}
        mixed={mixed}
        title="Actions"
        description="Commands that run in this project's checkout or its worktree, with optional shortcuts."
        onResetOverride={() => void persist(() => null)}
        control={
          <div className="flex flex-wrap items-center gap-1.5">
            {importableScripts.length > 0 ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      id="import-scripts"
                      size="xs"
                      variant="ghost"
                      disabled={saving || !canWriteSettings}
                      type="button"
                    />
                  }
                >
                  Import scripts
                  <ChevronDownIcon className="size-3.5" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuGroup>
                    <MenuGroupLabel>Import from vekrel.json</MenuGroupLabel>
                    <p className="px-2 pb-2 text-pretty text-sm text-muted-foreground">
                      Add actions declared by this checkout without editing them first.
                    </p>
                  </MenuGroup>
                  <MenuSeparator />
                  {importableScripts.map((fileScript) => (
                    <MenuItem
                      key={`${fileScript.name} ${fileScript.command}`}
                      onClick={() => void importFileScript(fileScript)}
                    >
                      <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{fileScript.name}</div>
                        <div className="truncate font-mono text-muted-foreground">
                          {fileScript.command}
                        </div>
                      </div>
                    </MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            ) : null}
            <Button
              size="xs"
              variant="outline"
              disabled={saving || !canWriteSettings || targets.length === 0}
              onClick={() => setRequest({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT })}
            >
              <PlusIcon className="size-3.5" />
              Add action
            </Button>
          </div>
        }
      />
      {mixed ? (
        <SettingsRow
          title="Different actions across machines"
          description="Choose one machine to edit its list. Adding an action here adds it on every selected machine."
        />
      ) : (
        <ProjectActionsList
          scripts={scripts}
          keybindings={keybindings}
          disabled={saving || !canWriteSettings}
          onEdit={(script) => setRequest(editorRequestForScript(script, keybindings))}
        />
      )}
      {t3File.status === "invalid" ? (
        <SettingsRow
          title="vekrel.json is invalid"
          description="A vekrel.json exists in this checkout but fails to parse, so every action and icon it declares is ignored. Check the JSON syntax and icon values."
          className="text-warning"
        />
      ) : null}
      {target && (
        <ProjectScriptEditorDialog
          machineId={target.machineId}
          editScope={AuthSettingsWriteScope}
          request={request}
          scripts={scripts}
          onSubmit={submit}
          onDelete={(id) =>
            void persist((current) => current.filter((script) => script.id !== id), id, null)
          }
          onClose={() => setRequest(null)}
        />
      )}
    </SettingsSection>
  );
}
