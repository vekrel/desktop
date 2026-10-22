import type {
  EditorId,
  MachineId,
  ProjectId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@vekrel/contracts";

import type { DraftId } from "../../composerDraftStore";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import { type EnvMode, type MachineOption } from "../BranchToolbar.logic";
import { BranchToolbar } from "../BranchToolbar";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { memo, type ComponentProps } from "react";
import { ThreadDetailsCard } from "./ThreadDetailsCard";
import { OpenInPicker } from "./OpenInPicker";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";
import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

const GitActionsControl = memo(BaseGitActionsControl);

export interface ThreadDetailsPanelProps extends Pick<
  ComponentProps<typeof ThreadDetailsCard>,
  "anchor" | "handle" | "onPresentationChange"
> {
  forceNewWorktree?: boolean;
  machineId: MachineId;
  threadId: ThreadId;
  projectId: ProjectId;
  worktreePath: string | null;
  isServerThread: boolean;
  draftId?: DraftId;
  activeProjectName: string | undefined;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  showOpenInPicker: boolean;
  openInShortcutEnabled: boolean;
  gitCwd: string | null;
  isGitRepo: boolean;
  envLocked: boolean;
  availableMachines: readonly MachineOption[];
  autoMachineLabel?: string | undefined;
  onAutoMachine?: (() => void) | undefined;
  onMachineChange?: (machineId: MachineId) => void;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  onActiveThreadBranchOverrideChange?: (branch: string | null) => void;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest: () => void;
  onOpenChanges?: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function ThreadDetailsPanel(props: ThreadDetailsPanelProps) {
  const fileScripts = useT3ProjectFileScripts(
    props.machineId,
    props.activeProjectScripts ? props.gitCwd : null,
  );
  const activeThreadRef = { machineId: props.machineId, threadId: props.threadId };
  const branchToolbarProps = {
    showGitControls: props.isGitRepo,
    machineId: props.machineId,
    threadId: props.threadId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    isServerThread: props.isServerThread,
    ...(props.draftId ? { draftId: props.draftId } : {}),
    onEnvModeChange: props.onEnvModeChange,
    startFromOrigin: props.startFromOrigin,
    onStartFromOriginChange: props.onStartFromOriginChange,
    envMode: props.envMode,
    ...(props.activeThreadBranchOverride !== undefined
      ? { activeThreadBranchOverride: props.activeThreadBranchOverride }
      : {}),
    ...(props.onActiveThreadBranchOverrideChange
      ? { onActiveThreadBranchOverrideChange: props.onActiveThreadBranchOverrideChange }
      : {}),
    envLocked: props.envLocked,
    forceNewWorktree: props.forceNewWorktree ?? false,
    onComposerFocusRequest: props.onComposerFocusRequest,
    ...(props.onCheckoutPullRequestRequest
      ? { onCheckoutPullRequestRequest: props.onCheckoutPullRequestRequest }
      : {}),
  };

  return (
    <ThreadDetailsCard
      threadRef={{ machineId: props.machineId, threadId: props.threadId }}
      anchor={props.anchor}
      handle={props.handle}
      onPresentationChange={props.onPresentationChange}
    >
      {(density) => (
        <>
          <ThreadDetailsSection
            headingId="thread-details-workspace-heading"
            title="Workspace"
            separated={false}
            showHeading={false}
          >
            <div className="flex flex-col">
              {density === "full" ? (
                <BranchToolbar
                  layout="panel"
                  panelSection="workspace"
                  availableMachines={props.availableMachines}
                  {...(props.onMachineChange
                    ? { onMachineChange: props.onMachineChange }
                    : {})}
                  autoMachineLabel={props.autoMachineLabel}
                  onAutoMachine={props.onAutoMachine}
                  {...branchToolbarProps}
                />
              ) : null}

              {density !== "essential" && props.showOpenInPicker ? (
                <OpenInPicker
                  keybindings={props.keybindings}
                  machineId={props.machineId}
                  availableEditors={props.availableEditors}
                  openInCwd={props.gitCwd}
                  enableShortcut={props.openInShortcutEnabled}
                  displayMode="panel"
                />
              ) : null}

              {props.activeProjectScripts ? (
                <ProjectScriptsControl
                  machineId={props.machineId}
                  displayMode="panel"
                  scripts={props.activeProjectScripts}
                  fileScripts={fileScripts}
                  preferredScriptId={props.preferredScriptId}
                  onRunScript={props.onRunProjectScript}
                  onAddScript={props.onAddProjectScript}
                  onUpdateScript={props.onUpdateProjectScript}
                  onDeleteScript={props.onDeleteProjectScript}
                />
              ) : null}
            </div>
          </ThreadDetailsSection>

          {props.gitCwd ? (
            <ThreadDetailsSection
              headingId="thread-details-version-control-heading"
              title="Version Control"
              showHeading={false}
              separated={density === "full"}
            >
              <div className="flex flex-col">
                {props.isGitRepo ? (
                  <BranchToolbar layout="panel" panelSection="branch" {...branchToolbarProps} />
                ) : null}
                {props.activeProjectName ? (
                  <GitActionsControl
                    displayMode="panel"
                    compact={density !== "full"}
                    gitCwd={props.gitCwd}
                    activeThreadRef={activeThreadRef}
                    {...(props.draftId ? { draftId: props.draftId } : {})}
                    {...(props.onOpenChanges ? { onOpenChanges: props.onOpenChanges } : {})}
                  />
                ) : null}
              </div>
            </ThreadDetailsSection>
          ) : null}

          {density === "full" && !props.draftId ? (
            <ThreadAutomationsPanel machineId={props.machineId} threadId={props.threadId} />
          ) : null}

          {density === "full" && !props.draftId ? (
            <ThreadRelationshipsPanel
              machineId={props.machineId}
              threadId={props.threadId}
            />
          ) : null}
        </>
      )}
    </ThreadDetailsCard>
  );
}
