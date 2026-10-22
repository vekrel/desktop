import { threadPullRequestLinkMode } from "@vekrel/client-runtime/thread-pull-request-compatibility";
import { visibleThreadPullRequests } from "@vekrel/shared/threadPullRequests";

import { scopeProjectRef, scopeThreadRef } from "@vekrel/client-runtime/machine";
import {
  canCreateProjectInMachine,
  getCloneDestinationBrowsePath,
  getCloneDestinationPath,
  getCloneDirectoryName,
  getDefaultCloneUrl,
  getNewProjectPathPreview,
  getNewProjectPublishTarget,
  getNewProjectPublishTargets,
  getNewProjectRepository,
  normalizePastedCloneUrl,
  addProjectRemoteSourceLabel,
  addProjectRemoteSourcePathHint,
  addProjectRemoteSourceProvider,
  sortAddProjectProviderSources,
  type AddProjectRemoteSource,
  type AddProjectRemoteSourceReadiness,
} from "@vekrel/client-runtime/operations/projects";
import { sourceControlClients } from "@vekrel/client-runtime/source-control-clients";
import { connectionStatusText } from "@vekrel/client-runtime/connection";
import { resolveThreadReferenceCopyTarget } from "@vekrel/shared/threadReference";
import {
  canPreloadBrowsePath,
  createBrowseNavigationCoordinator,
  filterFilesystemBrowseEntries,
  getFilesystemBrowsePath,
} from "@vekrel/client-runtime/state/filesystem";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  AuthFilesystemReadScope,
  type DesktopWslState,
  type MachineId,
  type FilesystemBrowseResult,
  SourceControlProviderKind,
  PRIMARY_LOCAL_MACHINE_ID,
  resolveMachineKind,
} from "@vekrel/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ChartNoAxesColumnIcon,
  CheckIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  FileSearchIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareDashedIcon,
  LinkIcon,
  MessageSquareIcon,
  PaletteIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquarePenIcon,
  TextSearchIcon,
} from "lucide-react";
import { requestThreadFindOpen } from "./chat/threadFindActionBus";
import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { useAtomValue } from "@effect/atom-react";

import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { useDesktopLocalBootstraps } from "../connection/useDesktopLocalBootstraps";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useOpenPanelPullRequestUrl } from "../hooks/useOpenPanelPullRequestUrl";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import {
  composerPromptLink,
  copyPromptLink,
  promptLinkRepositoryOf,
} from "./promptLinks/copyPromptLink";
import { useClientSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { useTheme } from "../hooks/useTheme";
import { readLocalApi } from "../localApi";
import { desktopLocalBackendId } from "../connection/desktopLocal";
import { filesystemMachine, useFilesystemReadAccess } from "../state/filesystem";
import { projectMachine } from "../state/projects";
import { useMachineQuery } from "../state/query";
import { serverMachine } from "../state/server";
import { threadMachine } from "../state/threads";
import { readMachineScope, useMachineScope } from "~/state/session";
import { sourceControlMachine } from "../state/sourceControl";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { useScratchProject } from "../hooks/useScratchProject";
import { useNewProject } from "../hooks/useNewProject";
import { isScratchProject } from "@vekrel/client-runtime/state/projects";
import {
  useMachineProviders,
  useMachines,
  usePrimaryMachineId,
} from "../state/machines";
import { useProjects, useServerConfigs, useThreadShells, waitForProject } from "../state/entities";
import { resolveThreadActionProjectRef, startNewThreadFromContext } from "../lib/chatThreadActions";
import {
  appendBrowsePathSegment,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { onOpenCommandPalette } from "../commandPaletteBus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  PULL_REQUESTS_PANEL_REF,
  selectActiveRightPanel,
  useRightPanelStore,
} from "../rightPanelStore";
import { getLatestThreadForProject, sortThreads } from "../lib/threadSort";
import {
  cn,
  getLocalFileManagerName,
  isMacPlatform,
  isWindowsPlatform,
  newProjectId,
} from "../lib/utils";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { buildThreadRouteParams } from "../threadRoutes";
import { useAvailableSettingsSearchItems } from "./settings/useAvailableSettingsSearchItems";
import {
  applyWslEnvironmentConfiguration,
  parseWslUncPath,
  resolveProjectPickerTarget,
  resolveWslProjectSelection,
} from "../wslPaths";
import {
  ADDON_ICON_CLASS,
  browseInputEndPaddingClass,
  buildBrowseGroups,
  buildRootGroups,
  buildLinkedThreadActionItems,
  buildCommandPaletteRows,
  enumerateCommandPaletteItems,
  findHighlightedCommandPaletteItem,
  type CommandPaletteActionItem,
  type CommandPaletteOpenIntent,
  type CommandPaletteProject,
  type CommandPaletteReturnContext,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  filterPinnedBrowseEntries,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  ITEM_ICON_CLASS,
  RECENT_THREAD_LIMIT,
  reduceCommandPaletteUiState,
  createCommandPaletteSearchState,
  type AddProjectCloneFlow,
  type AddProjectMachineOption,
  buildPaletteRemoteSourceReadiness,
  errorMessage,
  getMachineBrowsePlatform,
  overlayModeForCommand,
  remoteProjectInputPlaceholder,
  reduceCommandPaletteSearchState,
  type SearchOverlayMode,
} from "./CommandPalette.logic";
import { resolveMachineOptionLabel } from "./BranchToolbar.logic";
import { CommandPaletteContent } from "./CommandPaletteContent";
import {
  selectCommandPaletteClientSettings,
  useMachineLookups,
  useProjectLookups,
  useSortedProjectGroups,
} from "./CommandPaletteLookups";
import {
  buildNewThreadInProjectItems,
  buildProjectSearchItems,
} from "./CommandPaletteProjectItems";
import {
  CommandPaletteSubmitButton,
  NewProjectPublishHostPicker,
  NewProjectSummary,
  RemoteRepositorySummary,
  remoteProjectSourceIcon,
  sourceControlHostIcon,
} from "./CommandPaletteAddProject";
import { useCommandPaletteThreadItems } from "./CommandPaletteThreadItems";
import {
  APPEARANCE_OPTIONS,
  notifyThemeSaveFailure,
  useCommandPaletteThemeItems,
} from "./CommandPaletteThemeItems";
import {
  CommandPaletteVirtualizedResults,
  scrollCommandPaletteRowIntoView,
} from "./CommandPaletteResults";
import { MachineIcon } from "./MachineIcon";
import { Checkbox } from "./ui/checkbox";
import { ProjectFilePicker } from "./files/ProjectFilePicker";
import { openLinkPullRequestDialog } from "./pullRequest/LinkPullRequestDialog";
import { ProjectContentSearchDialog } from "./search/ProjectContentSearchDialog";
import { toggleThemeEditorForTheme } from "./settings/themeEditorStore";
import { searchSettings, SETTINGS_SECTION_LABELS } from "./settings/settingsSearch";
import { primaryServerKeybindingsAtom } from "../state/server";
import { resolveShortcutCommand, threadJumpIndexFromCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup, CommandFooterAction } from "./ui/command";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { ComposerHandleContext, useComposerHandleContext } from "../composerHandleContext";
import type { ChatComposerHandle } from "./chat/ChatComposer";
import { buildSidebarProjectPickerEntries } from "../sidebarProjectGrouping";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { readPullRequestListPreferences } from "~/components/pullRequest/pullRequestListPreferences";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];

export function CommandPalette({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const usagePageOpen = useLocation({ select: (location) => location.pathname === "/usage" });
  const [state, dispatch] = useReducer(reduceCommandPaletteUiState, {
    open: false,
    mode: "command",
    openIntent: null,
  });
  const setOpen = (open: boolean) => dispatch({ _tag: "SetOpen", open });
  const toggleMode = (mode: SearchOverlayMode) => dispatch({ _tag: "ToggleMode", mode });
  const openAddProject = () => dispatch({ _tag: "OpenAddProject" });
  const openNewThreadIn = () => dispatch({ _tag: "OpenNewThreadIn" });
  const clearOpenIntent = () => dispatch({ _tag: "ClearOpenIntent" });
  const openChildSearch = (mode: "files" | "content", context: CommandPaletteReturnContext) =>
    dispatch({ _tag: "OpenChildSearch", mode, context });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { theme, themeHalves, resolvedTheme, appearanceMode, setAppearanceMode } = useTheme();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useThreadRouteTarget();
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const previewOpen = useRightPanelStore((state) =>
    routeThreadRef
      ? selectActiveRightPanel(state.byThreadKey, routeThreadRef) === "preview"
      : false,
  );

  useEffect(() => {
    if (!state.open || state.mode === "command") return;
    const onEscapeKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dispatch({ _tag: "BackToCommand" });
    };
    window.addEventListener("keydown", onEscapeKeyDown, true);
    return () => window.removeEventListener("keydown", onEscapeKeyDown, true);
  }, [state.mode, state.open]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          previewFocus: isPreviewFocused(),
          previewOpen,
          modelPickerOpen: composerHandleRef.current?.isModelPickerOpen() ?? false,
          usagePageOpen,
        },
      });
      if (command === "appearance.cycle") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const nextMode =
          appearanceMode === "system" ? "light" : appearanceMode === "light" ? "dark" : "system";
        if (!setAppearanceMode(nextMode)) {
          notifyThemeSaveFailure();
        } else {
          toastManager.add({
            id: "appearance-cycle",
            title: `Appearance: ${APPEARANCE_OPTIONS.find((option) => option.mode === nextMode)?.label}`,
            timeout: 1500,
          });
        }
        return;
      }
      if (command === "theme.select") {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        dispatch({ _tag: "OpenChangeTheme" });
        return;
      }
      if (command === "themeEditor.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleThemeEditorForTheme({
          theme,
          themeHalves,
          initialAppearance: resolvedTheme,
        });
        return;
      }
      if (command === "usage.open") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        void navigate({ to: "/usage" });
        return;
      }
      const mode = overlayModeForCommand(command);
      if (mode === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appearanceMode,
    keybindings,
    navigate,
    previewOpen,
    resolvedTheme,
    setAppearanceMode,
    setOpen,
    terminalOpen,
    theme,
    themeHalves,
    toggleMode,
    usagePageOpen,
  ]);

  useEffect(
    () =>
      onOpenCommandPalette((detail) => {
        if (detail.open === "new-thread-in") {
          openNewThreadIn();
        } else if (detail.open === "add-project") {
          openAddProject();
        } else if (detail.query !== undefined) {
          dispatch({
            _tag: "OpenSearch",
            query: detail.query,
            ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
          });
        } else {
          setOpen(true);
        }
      }),
    [openAddProject, openNewThreadIn, setOpen],
  );

  return (
    <ComposerHandleContext value={composerHandleRef}>
      <CommandDialog
        open={state.open}
        onOpenChange={(open, eventDetails) => {
          if (!open && eventDetails.reason === "escape-key" && state.mode !== "command") {
            eventDetails.cancel();
            dispatch({ _tag: "BackToCommand" });
            return;
          }
          setOpen(open);
        }}
      >
        <div className="contents" inert={state.open}>
          {children}
        </div>
        <CommandPaletteDialog
          mode={state.mode}
          openIntent={state.openIntent}
          setOpen={setOpen}
          openChildSearch={openChildSearch}
          initialContext={state.restoredSearch}
          clearOpenIntent={clearOpenIntent}
        />
      </CommandDialog>
    </ComposerHandleContext>
  );
}

function CommandPaletteDialog(props: {
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openChildSearch: (
    mode: "files" | "content",
    context: CommandPaletteReturnContext,
  ) => void;
  readonly initialContext: CommandPaletteReturnContext | undefined;
  readonly clearOpenIntent: () => void;
}) {
  const composerHandleRef = useComposerHandleContext();

  return (
    <CommandDialogPopup
      aria-label={
        props.mode === "files"
          ? "File picker"
          : props.mode === "content"
            ? "Search project contents"
            : "Command palette"
      }
      className={cn("overflow-hidden", props.mode === "content" && "h-105")}
      data-command-palette="true"
      data-palette-mode={props.mode}
      data-testid="command-palette"
      finalFocus={() => {
        const composer = composerHandleRef?.current;
        if (!composer) return true;
        composer.focusAtEnd();
        return false;
      }}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      {props.mode === "files" ? (
        <ProjectFilePicker setOpen={props.setOpen} />
      ) : props.mode === "content" ? (
        <ProjectContentSearchDialog onOpenChange={props.setOpen} />
      ) : (
        <OpenCommandPaletteDialog
          openIntent={props.openIntent}
          setOpen={props.setOpen}
          openChildSearch={props.openChildSearch}
          initialContext={props.initialContext}
          clearOpenIntent={props.clearOpenIntent}
        />
      )}
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: {
  readonly openIntent: CommandPaletteOpenIntent | null;
  readonly setOpen: (open: boolean) => void;
  readonly openChildSearch: (
    mode: "files" | "content",
    context: CommandPaletteReturnContext,
  ) => void;
  readonly initialContext: CommandPaletteReturnContext | undefined;
  readonly clearOpenIntent: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { clearOpenIntent, openIntent, openChildSearch, setOpen } = props;
  const initialSearch = props.initialContext ?? {
    query: openIntent?.kind === "search" ? openIntent.query : "",
    linkedThreadSearch: openIntent?.kind === "search" ? openIntent : null,
  };
  const [searchState, dispatchSearch] = useReducer(
    reduceCommandPaletteSearchState,
    initialSearch.query,
    createCommandPaletteSearchState,
  );
  const { query, views: viewStack } = searchState;
  const setQuery = (query: string) => dispatchSearch({ type: "query", query });
  const [linkedThreadSearch, setLinkedThreadSearch] = useState(initialSearch.linkedThreadSearch);
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const resultListRef = useRef<LegendListRef | null>(null);
  const highlightClearedRef = useRef(false);
  function clearTypedHighlight(): void {
    highlightClearedRef.current = true;
    setHighlightedItemValue(null);
  }
  const clientSettings = useClientSettings(selectCommandPaletteClientSettings);
  const createProject = useAtomCommand(projectMachine.create, {
    reportFailure: false,
  });
  const { scratchMachineId, scratchWorkspaceRootFor, startScratchThread } = useScratchProject();
  const lookupRepository = useAtomQueryRunner(sourceControlMachine.repository, {
    reportFailure: false,
  });
  const loadBrowsePath = useAtomQueryRunner(filesystemMachine.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const cloneRepository = useAtomCommand(sourceControlMachine.cloneRepository, {
    reportFailure: false,
  });
  const startProjectClone = useAtomCommand(sourceControlMachine.startProjectClone, {
    reportFailure: false,
  });
  const stopThreadSession = useAtomCommand(threadMachine.stopSession, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverMachine.refreshProviders, {
    reportFailure: false,
  });
  const { machines } = useMachines();
  const desktopLocalBootstraps = useDesktopLocalBootstraps();
  const primaryMachineId = usePrimaryMachineId();
  const availableSettingsSearchItems = useAvailableSettingsSearchItems();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const paletteRouteTarget = useThreadRouteTarget();
  const projects = useProjects();
  const referenceThreadRef =
    pathname === "/pull-requests"
      ? machines.some(
          (machine) => machine.serverConfig?.machine.capabilities.pullRequests === true,
        )
        ? PULL_REQUESTS_PANEL_REF
        : null
      : activeThread
        ? scopeThreadRef(activeThread.machineId, activeThread.id)
        : null;
  const openPanelPullRequestUrl = useOpenPanelPullRequestUrl(referenceThreadRef);
  const activeThreadServerConfig = useServerConfigs().get(
    activeThread?.machineId ?? ("" as MachineId),
  );
  const activeThreadReferenceCopyTarget =
    referenceThreadRef === null || (pathname === "/pull-requests" && !openPanelPullRequestUrl)
      ? null
      : resolveThreadReferenceCopyTarget({
          threadId: referenceThreadRef.threadId,
          openPanelPullRequestUrl,
          pullRequests: activeThread?.pullRequests,
          linkedPullRequestUrl:
            activeThread?.linkedPullRequest?.url ?? activeThread?.branchPullRequest?.url ?? null,
        });
  const copyActiveThreadReference = async () => {
    const target = activeThreadReferenceCopyTarget;
    if (target === null) return;
    try {
      const didCopy = await writeTextToClipboard(target.value, target.clipboardTarget);
      if (!didCopy) return;
      toastManager.add({
        type: "success",
        title: target.successTitle,
        description: target.value,
      });
    } catch (error) {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: target.failureTitle,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  };
  const threads = useThreadShells();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const providersByMachine = useMachineProviders();
  const { changeThemeItem, changeAppearanceItem, themeEditorItem } = useCommandPaletteThemeItems();
  const currentView = viewStack.at(-1)?.view ?? null;
  const threadSearchQuery = currentView === null && !isActionsOnly ? deferredQuery : "";
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const [browseNavigation] = useState(createBrowseNavigationCoordinator);
  const [addProjectMachineId, setAddProjectMachineId] = useState<MachineId | null>(
    null,
  );
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const [addProjectCloneFlow, setAddProjectCloneFlow] = useState<AddProjectCloneFlow | null>(null);
  const [newProjectFlow, setNewProjectFlow] = useState<{
    readonly machineId: MachineId;
    readonly sourcesMachineId: MachineId | null;
  } | null>(null);
  const [newProjectPublishes, setNewProjectPublishes] = useState(false);
  const [newProjectPublishKind, setNewProjectPublishKind] =
    useState<SourceControlProviderKind | null>(null);
  const [isCreatingNewProject, setIsCreatingNewProject] = useState(false);
  // State lags a render behind, so a repeated Enter could start a second create.
  const newProjectSubmittingRef = useRef(false);
  const createNewProject = useNewProject();
  const cloneLookupGeneration = useRef(0);
  const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
  const [isRemoteProjectCloning, setIsRemoteProjectCloning] = useState(false);
  const { machineLabelById, projectMachineLocationById } = useMachineLookups();
  const projectGroups = useSortedProjectGroups(machineLabelById);
  const contextualProjectRef = resolveThreadActionProjectRef({
    activeDraftThread,
    activeThread: activeThread ?? undefined,
    defaultProjectRef,
    handleNewThread,
  });
  const projectPickerEntries = buildSidebarProjectPickerEntries({
    groups: projectGroups,
    preferredProjectRef: contextualProjectRef,
  });
  const pickerProjects = projectPickerEntries.map(({ group, targetProject }) => ({
    ...targetProject,
    displayName: group.displayName,
  }));
  const projectGroupByTargetKey = new Map(
    projectPickerEntries.map(({ group, targetProject }) => [
      `${targetProject.machineId}:${targetProject.id}`,
      group,
    ]),
  );

  const addProjectMachineOptions = (() => {
    const options = machines
      .filter((machine) => canCreateProjectInMachine(machine.connection.phase))
      .map((machine): AddProjectMachineOption => {
        const isPrimary = machine.entry.target._tag === "PrimaryConnectionTarget";
        return {
          machineId: machine.machineId,
          label: resolveMachineOptionLabel({
            isPrimary,
            machineId: machine.machineId,
            runtimeLabel: machine.label,
          }),
          isPrimary,
          machine: resolveMachineKind(machine.serverConfig),
          isConnected: canCreateProjectInMachine(machine.connection.phase),
          status: connectionStatusText(machine.connection),
        };
      });

    options.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

    return options;
  })();
  const defaultAddProjectMachineId =
    addProjectMachineOptions.find((option) => option.isConnected)?.machineId ?? null;
  const wslAddProjectMachineOption =
    addProjectMachineOptions.find((option) => {
      if (!option.isConnected) {
        return false;
      }
      const machine = machines.find(
        (candidate) => candidate.machineId === option.machineId,
      );
      return machine
        ? desktopLocalBackendId(machine.entry.target)?.startsWith("wsl:") === true
        : false;
    }) ?? null;
  const browseMachineId = addProjectMachineId ?? defaultAddProjectMachineId;
  const canCreateProject = useMachineScope(browseMachineId, AuthOrchestrationOperateScope);
  const browseMachine =
    machines.find((machine) => machine.machineId === browseMachineId) ?? null;
  const browseMachineIsDesktopLocal =
    browseMachine !== null && isDesktopLocalConnectionTarget(browseMachine.entry.target);
  // Map the browsed desktop-local env to its desktop pool instance id (e.g.
  // "wsl:ubuntu"). The catalog machineId is descriptor-derived and won't
  // route on the desktop side; pickFolder only recognizes the pool id, which
  // the bootstrap list exposes.
  const browseDesktopInstanceId = (() => {
    if (!browseMachineIsDesktopLocal || browseMachine === null) {
      return null;
    }
    const displayUrl = browseMachine.displayUrl;
    if (displayUrl === null) {
      return null;
    }
    return (
      desktopLocalBootstraps.find((bootstrap) => bootstrap.httpBaseUrl === displayUrl)?.id ?? null
    );
  })();
  const sourceControlDiscovery = useMachineQuery(
    browseMachineId === null
      ? null
      : sourceControlMachine.discovery({
          machineId: browseMachineId,
          input: {},
        }),
  );
  const browseMachinePlatform = getMachineBrowsePlatform(
    browseMachine?.serverConfig?.machine.platform.os,
  );
  const isRemoteProjectCloneFlow = addProjectCloneFlow !== null;
  const isRemoteProjectRepositoryStep = addProjectCloneFlow?.step === "repository";
  const pinnedCloneDirectoryName =
    addProjectCloneFlow?.step === "confirm"
      ? getCloneDirectoryName(
          addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.remoteUrl,
        )
      : "";
  const browsePath = getFilesystemBrowsePath(
    query,
    browseMachinePlatform,
    browseMachineId !== null && !isRemoteProjectRepositoryStep && newProjectFlow === null,
  );
  const isBrowsing = browsePath.isBrowsing;
  const browseDirectoryPath = browsePath.directoryPath;
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const getAddProjectInitialQueryForMachine = (machineId: MachineId | null): string => {
    const machine = machines.find((candidate) => candidate.machineId === machineId);
    const machineSettings = machine?.serverConfig?.settings ?? null;
    const baseDirectory = machineSettings?.addProjectBaseDirectory?.trim() ?? "";
    if (baseDirectory.length === 0) {
      return "~/";
    }
    return ensureBrowseDirectoryPath(baseDirectory);
  };

  const { projectCwdById, projectByKey, projectTitleById } = useProjectLookups();

  const activeThreadId = activeThread?.id;
  const supportsThreadFind =
    machines.find((machine) => machine.machineId === activeThread?.machineId)
      ?.serverConfig?.threadFind === true;
  const currentProjectMachineId =
    activeThread?.machineId ?? activeDraftThread?.machineId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const scratchTargetMachineId = scratchMachineId(
    currentProjectMachineId ?? primaryMachineId,
  );
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const currentProjectCwdForBrowse =
    browseMachineId && currentProjectMachineId === browseMachineId
      ? currentProjectCwd
      : null;
  const getBrowseCwdForMachine = (machineId: MachineId | null): string | null =>
    machineId && currentProjectMachineId === machineId ? currentProjectCwd : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseAccess = useFilesystemReadAccess(browseMachineId);
  const hasBrowseTarget =
    isBrowsing &&
    browsePath.directoryPath.length > 0 &&
    browseMachineId !== null &&
    !relativePathNeedsActiveProject;
  const browseQuery = useMachineQuery(
    browseAccess.canReadFiles && hasBrowseTarget
      ? filesystemMachine.browse({
          machineId: browseMachineId,
          input: {
            partialPath: browsePath.directoryPath,
            ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
          },
        })
      : null,
  );
  const browseResult = browseQuery.data;
  const isBrowsePending = hasBrowseTarget && (browseAccess.isPending || browseQuery.isPending);
  const browseAccessError =
    hasBrowseTarget && !browseAccess.isPending && !browseAccess.canReadFiles
      ? (browseAccess.error ?? "This connection cannot browse host folders.")
      : null;
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const { visibleEntries: visibleBrowseEntries, exactEntry: exactBrowseEntry } =
    pinnedCloneDirectoryName
      ? filterPinnedBrowseEntries({
          browseEntries,
          filterQuery: browsePath.filterQuery,
          pinnedDirectoryName: pinnedCloneDirectoryName,
          caseSensitive: !isWindowsPlatform(browseMachinePlatform),
        })
      : filterFilesystemBrowseEntries(browseEntries, browsePath.filterQuery);

  const prefetchBrowsePath = async (
    partialPath: string,
    machineId: MachineId | null = browseMachineId,
    cwd: string | null = currentProjectCwdForBrowse,
  ): Promise<void> => {
    if (!machineId) {
      return;
    }
    const machine = machines.find((candidate) => candidate.machineId === machineId);
    if (
      !readMachineScope(machineId, AuthFilesystemReadScope) ||
      !canPreloadBrowsePath(machine?.connection.phase)
    ) {
      return;
    }

    await loadBrowsePath({
      machineId,
      input: {
        partialPath,
        ...(cwd ? { cwd } : {}),
      },
    });
  };

  useEffect(
    () => () => {
      browseNavigation.invalidate();
    },
    [browseNavigation],
  );

  const openProjectFromSearch = async (project: (typeof projects)[number]) => {
    const group = projectGroupByTargetKey.get(`${project.machineId}:${project.id}`);
    const groupedProjectKeys = group
      ? new Set(
          group.memberProjectRefs.map(
            (projectRef) => `${projectRef.machineId}:${projectRef.projectId}`,
          ),
        )
      : null;
    const latestThread = groupedProjectKeys
      ? (sortThreads(
          threads.filter(
            (thread) =>
              thread.archivedAt === null &&
              groupedProjectKeys.has(`${thread.machineId}:${thread.projectId}`),
          ),
          clientSettings.sidebarThreadSortOrder,
        )[0] ?? null)
      : getLatestThreadForProject(
          threads.filter((thread) => thread.machineId === project.machineId),
          project.id,
          clientSettings.sidebarThreadSortOrder,
        );
    if (latestThread) {
      await navigate({
        to: "/$machineId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latestThread.machineId, latestThread.id)),
      });
      return;
    }

    await handleNewThread(scopeProjectRef(project.machineId, project.id));
  };

  const projectSearchItems = buildProjectSearchItems({
    projects: pickerProjects,
    projectGroupByTargetKey,
    locationByMachineId: projectMachineLocationById,
    runProject: openProjectFromSearch,
  });

  const projectThreadItems = (() => {
    const isScratch = (project: CommandPaletteProject) =>
      isScratchProject(project, scratchWorkspaceRootFor(project.machineId));
    const projectItems = enumerateCommandPaletteItems(
      buildNewThreadInProjectItems({
        projects: pickerProjects.filter((project) => !isScratch(project)),
        projectGroupByTargetKey,
        locationByMachineId: projectMachineLocationById,
        runProject: async (project) => {
          const group = projectGroupByTargetKey.get(`${project.machineId}:${project.id}`);
          const contextualRefBelongsToGroup =
            contextualProjectRef !== null &&
            group?.memberProjectRefs.some(
              (projectRef) =>
                projectRef.machineId === contextualProjectRef.machineId &&
                projectRef.projectId === contextualProjectRef.projectId,
            );
          await handleNewThread(
            contextualRefBelongsToGroup
              ? contextualProjectRef
              : scopeProjectRef(project.machineId, project.id),
          );
        },
      }),
    );
    if (scratchTargetMachineId === null) return projectItems;

    const noProjectIndex = pickerProjects[0] !== undefined && isScratch(pickerProjects[0]) ? 0 : 1;
    return [
      ...projectItems.slice(0, noProjectIndex),
      {
        kind: "action" as const,
        value: "new-thread-in:no-project",
        searchTerms: ["no project", "without project", "none"],
        title: "No project",
        icon: <MessageSquareDashedIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.newWithoutProject" as const,
        run: () => startScratchThread(scratchTargetMachineId),
      },
      ...projectItems.slice(noProjectIndex),
    ];
  })();

  const { threadItems: allThreadItems, isSearchPending: isThreadSearchPending } =
    useCommandPaletteThreadItems({ activeThreadId, threadSearchQuery });
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  // Stable so the item builders that capture it during render never see the
  // highlight ref it writes.
  const pushPaletteView = useStableCallback((view: CommandPaletteView): void => {
    browseNavigation.invalidate();
    dispatchSearch({ type: "push", view });
    highlightClearedRef.current = true;
    setHighlightedItemValue(null);
  });

  function popView(): void {
    browseNavigation.invalidate();
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    if (viewStack.length <= 1) {
      setAddProjectMachineId(null);
    } else if (newProjectFlow?.sourcesMachineId) {
      setAddProjectMachineId(newProjectFlow.sourcesMachineId);
    }
    dispatchSearch({ type: "back" });
    setHighlightedItemValue(null);
  }

  function handleQueryChange(nextQuery: string): void {
    browseNavigation.invalidate();
    clearTypedHighlight();
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = async (machineId: MachineId): Promise<void> => {
    const initialQuery = getAddProjectInitialQueryForMachine(machineId);
    const initialBrowsePath = getBrowseDirectoryPath(initialQuery);
    const browseCwd = getBrowseCwdForMachine(machineId);
    const view: CommandPaletteView = {
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: [],
      initialQuery,
    };

    await browseNavigation.run(
      () =>
        initialBrowsePath.length > 0
          ? prefetchBrowsePath(initialBrowsePath, machineId, browseCwd)
          : Promise.resolve(),
      () => {
        setAddProjectMachineId(machineId);
        setAddProjectCloneFlow(null);
        pushPaletteView(view);
      },
    );
  };

  const startAddProjectClone = (
    machineId: MachineId,
    source: AddProjectRemoteSource,
  ): void => {
    setAddProjectMachineId(machineId);
    setAddProjectCloneFlow({ step: "repository", machineId, source });
    pushPaletteView({
      addonIcon: remoteProjectSourceIcon(source, ADDON_ICON_CLASS),
      groups: [],
      initialQuery: "",
    });
  };

  const newProjectsRootFor = (machineId: MachineId | null): string | null =>
    machines.find((machine) => machine.machineId === machineId)?.serverConfig
      ?.newProjectsRoot ?? null;

  const startNewProject = (
    machineId: MachineId,
    sourcesMachineId: MachineId | null,
  ): void => {
    setAddProjectMachineId(machineId);
    setAddProjectCloneFlow(null);
    setNewProjectFlow({ machineId, sourcesMachineId });
    setNewProjectPublishes(false);
    setNewProjectPublishKind(null);
    pushPaletteView({
      addonIcon: <FolderGit2Icon className={ADDON_ICON_CLASS} />,
      groups: [],
    });
  };

  const openSourceControlSettings = () => {
    setOpen(false);
    void navigate({ to: "/settings/source-control" });
  };

  const buildAddProjectSourceGroups = (
    machineId: MachineId,
    readinessBySource: AddProjectRemoteSourceReadiness,
  ): CommandPaletteView["groups"] => {
    const sourceItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [
      {
        kind: "action",
        value: `action:add-project:${machineId}:local`,
        searchTerms: ["local", "folder", "directory", "browse"],
        title: "Local folder",
        description: "Browse a folder on disk",
        icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
        keepOpen: true,
        run: async () => {
          await startAddProjectBrowse(machineId);
        },
      },
    ];

    if (newProjectsRootFor(machineId) !== null) {
      sourceItems.unshift({
        kind: "action",
        value: `action:add-project:${machineId}:new`,
        searchTerms: ["new project", "create", "empty", "repository", "git init"],
        title: "New project",
        description: "Start a new Git repository from a name",
        icon: <FolderGit2Icon className={ITEM_ICON_CLASS} />,
        keepOpen: true,
        run: async () => {
          startNewProject(machineId, machineId);
        },
      });
    }

    const orderedSources: ReadonlyArray<AddProjectRemoteSource> = [
      "url",
      ...sortAddProjectProviderSources(readinessBySource),
    ];

    for (const source of orderedSources) {
      const label = addProjectRemoteSourceLabel(source);
      const title = source === "url" ? "Git URL" : `${label} repository`;
      const description =
        source === "url"
          ? "Clone from a remote URL"
          : `Clone ${label} ${addProjectRemoteSourcePathHint(source)}`;
      const readiness = readinessBySource(source);
      const disabledHint = readiness.hint;

      const titleTrailingContent = readiness.ready ? undefined : (
        <span className="ml-auto">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="warning-outline"
                  size="micro"
                  onClick={() => {
                    openSourceControlSettings();
                  }}
                >
                  Setup Required
                </Button>
              }
            />
            <TooltipPopup align="end" side="left">
              {disabledHint ?? "Open Settings -> Source Control to configure this provider."}
            </TooltipPopup>
          </Tooltip>
        </span>
      );

      if (!readiness.ready) {
        sourceItems.push({
          kind: "action",
          value: `action:add-project:${machineId}:${source}:not-ready`,
          searchTerms: ["clone", "remote", "repository", "repo", "git", label, "setup required"],
          title,
          description,
          disabled: true,
          icon: remoteProjectSourceIcon(source, ITEM_ICON_CLASS),
          ...(titleTrailingContent ? { titleTrailingContent } : {}),
          run: async () => {},
        });
        continue;
      }

      sourceItems.push({
        kind: "action",
        value: `action:add-project:${machineId}:${source}`,
        searchTerms: ["clone", "remote", "repository", "repo", "git", label],
        title,
        description,
        icon: remoteProjectSourceIcon(source, ITEM_ICON_CLASS),
        ...(titleTrailingContent ? { titleTrailingContent } : {}),
        keepOpen: true,
        run: async () => {
          startAddProjectClone(machineId, source);
        },
      });
    }

    return [{ value: `sources:${machineId}`, label: "Sources", items: sourceItems }];
  };

  const startAddProjectSourceSelection = (machineId: MachineId): void => {
    const machine = machines.find((candidate) => candidate.machineId === machineId);
    if (!canCreateProjectInMachine(machine?.connection.phase)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Machine unavailable",
          description: `${machine?.label ?? "The selected machine"} is not connected.`,
        }),
      );
      return;
    }
    setAddProjectMachineId(machineId);
    setAddProjectCloneFlow(null);
    pushPaletteView({
      addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
      groups: buildAddProjectSourceGroups(
        machineId,
        buildPaletteRemoteSourceReadiness(
          browseMachineId === machineId ? sourceControlDiscovery.data : null,
        ),
      ),
    });
  };

  const buildMachineItem = (
    option: AddProjectMachineOption,
    value: string,
    run: (machineId: MachineId) => void,
  ): CommandPaletteActionItem => ({
    kind: "action",
    value,
    searchTerms: [option.label, option.machineId, option.isPrimary ? "this device" : ""],
    title: option.label,
    description: option.isConnected
      ? option.isPrimary
        ? "This device"
        : option.machineId
      : option.status,
    disabled: !option.isConnected,
    icon: <MachineIcon kind={option.machine} className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: async () => {
      run(option.machineId);
    },
  });
  const addProjectMachineItems = addProjectMachineOptions.map((option) =>
    buildMachineItem(
      option,
      `action:add-project:machine:${option.machineId}`,
      startAddProjectSourceSelection,
    ),
  );
  const newProjectMachineOptions = addProjectMachineOptions.filter(
    (option) => option.isConnected && newProjectsRootFor(option.machineId) !== null,
  );

  const addProjectMachineGroups = [
    {
      value: "machines",
      label: "Machines",
      items: addProjectMachineItems,
    },
  ];

  const openAddProjectFlow = () => {
    if (addProjectMachineOptions.length === 0) {
      setOpen(false);
      void navigate({ to: "/settings/connections" });
      return;
    }

    if (addProjectMachineOptions.length > 1 || defaultAddProjectMachineId === null) {
      pushPaletteView({
        addonIcon: <FolderPlusIcon className={ADDON_ICON_CLASS} />,
        groups: addProjectMachineGroups,
      });
      return;
    }

    void startAddProjectSourceSelection(defaultAddProjectMachineId);
  };

  const openNewProjectFlow = () => {
    const firstOption = newProjectMachineOptions[0];
    if (firstOption) startNewProject(firstOption.machineId, null);
  };

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle =
      projectPickerEntries.find((entry) => entry.isPreferred)?.group.displayName ??
      (currentProjectId ? (projectTitleById.get(currentProjectId) ?? null) : null);

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            New thread in <span className="font-semibold">{activeProjectTitle}</span>
          </>
        ),
        icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
        shortcutCommand: "chat.newLocal",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread: activeThread ?? undefined,
            defaultProjectRef,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <SquarePenIcon className={ITEM_ICON_CLASS} />,
      addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }

  if (scratchTargetMachineId !== null) {
    actionItems.push({
      kind: "action",
      value: "action:new-thread-without-project",
      searchTerms: ["new thread", "no project", "without project", "none", "chat"],
      title: "New thread without a project",
      icon: <MessageSquareDashedIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "chat.newWithoutProject",
      run: () => startScratchThread(scratchTargetMachineId),
    });
  }

  if (activeThreadId && supportsThreadFind) {
    actionItems.push({
      kind: "action",
      value: "find-current-thread",
      title: "Find in current thread",
      searchTerms: ["find", "search", "messages", "plans"],
      icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "chat.find",
      run: async () => {
        requestThreadFindOpen();
      },
    });
  }

  const promptLinkTarget = paletteRouteTarget
    ? paletteRouteTarget.kind === "server"
      ? paletteRouteTarget.threadRef
      : paletteRouteTarget.draftId
    : null;
  const promptLinkProjectRef = activeThread ?? activeDraftThread;
  const promptLinkInput =
    promptLinkTarget === null
      ? null
      : {
          target: promptLinkTarget,
          project: projects.find(
            (project) =>
              project.machineId === promptLinkProjectRef?.machineId &&
              project.id === promptLinkProjectRef.projectId,
          ),
          providers:
            (promptLinkProjectRef
              ? providersByMachine.get(promptLinkProjectRef.machineId)
              : undefined) ?? [],
          threadModelSelection: activeThread?.modelSelection ?? null,
        };
  const plainPromptLink = promptLinkInput
    ? composerPromptLink({ ...promptLinkInput, withContext: false })
    : null;
  if (promptLinkInput !== null && plainPromptLink !== null) {
    actionItems.push({
      kind: "action",
      value: "action:copy-prompt-link",
      searchTerms: ["copy", "share", "prompt", "link"],
      title: "Copy prompt link",
      icon: <LinkIcon className={ITEM_ICON_CLASS} />,
      run: () => copyPromptLink(plainPromptLink),
    });
    if (promptLinkRepositoryOf(promptLinkInput.project) !== null) {
      const contextLink = composerPromptLink({ ...promptLinkInput, withContext: true });
      if (contextLink !== null) {
        actionItems.push({
          kind: "action",
          value: "action:copy-prompt-link-with-context",
          searchTerms: ["copy", "share", "prompt", "link", "repository", "model"],
          title: "Copy prompt link with repo and model",
          icon: <LinkIcon className={ITEM_ICON_CLASS} />,
          run: () => copyPromptLink(contextLink),
        });
      }
    }
  }

  if (activeThreadReferenceCopyTarget !== null) {
    actionItems.push({
      kind: "action",
      value: "action:copy-thread-reference",
      searchTerms: ["copy", "pull request", "pr link", "thread id", "reference"],
      title:
        activeThreadReferenceCopyTarget.kind === "pull-request" ? "Copy PR link" : "Copy thread ID",
      description: activeThreadReferenceCopyTarget.value,
      icon: <LinkIcon className={ITEM_ICON_CLASS} />,
      shortcutCommand: "thread.copyReference",
      run: copyActiveThreadReference,
    });
  }

  if (
    activeThread !== null &&
    threadPullRequestLinkMode(activeThreadServerConfig?.machine.capabilities) !== "unsupported"
  ) {
    const threadRef = scopeThreadRef(activeThread.machineId, activeThread.id);
    actionItems.push({
      kind: "action",
      value: "action:link-pull-request",
      searchTerms: ["link", "pull request", "pr", "attach", "stack"],
      title: "Link pull request to thread",
      icon: <PullRequestGlyph.link className={ITEM_ICON_CLASS} />,
      run: async () => {
        openLinkPullRequestDialog(threadRef);
      },
    });
    if (activeThreadServerConfig?.machine.capabilities.threadPullRequests === true) {
      actionItems.push({
        kind: "action",
        value: "action:open-thread-pull-requests",
        searchTerms: ["pull requests", "linked", "stack", "prs"],
        title: "Show linked pull requests",
        disabled: visibleThreadPullRequests(activeThread.pullRequests).length === 0,
        icon: <PullRequestGlyph.link className={ITEM_ICON_CLASS} />,
        run: async () => {
          useRightPanelStore.getState().open(threadRef, "pull-requests");
        },
      });
    }
  }

  if (activeThread !== null) {
    const thread = activeThread;
    actionItems.push({
      kind: "action",
      value: "action:restart-agent-session",
      searchTerms: ["restart", "reset", "reload", "agent", "session", "skills", "plugins", "mcp"],
      title: "Restart agent session",
      icon: <RotateCcwIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        const { machineId } = thread;
        if (thread.runtime !== null) {
          const stopped = await stopThreadSession({
            machineId,
            input: { threadId: thread.id },
          });
          if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
        }
        toastManager.add({
          type: "success",
          title: "Agent session will restart",
          description: "Your next message starts a fresh session.",
        });
        const project = projectByKey.get(`${machineId}:${thread.projectId}`);
        if (!project) return;
        const refreshed = await refreshProviders({
          machineId,
          input: {
            instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
            cwd: thread.worktreePath ?? project.workspaceRoot,
            fresh: true,
          },
        });
        if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:open-file-picker",
    searchTerms: ["go to file", "open file", "file picker", "find file", "quick open"],
    title: "Go to file",
    icon: <FileSearchIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    shortcutCommand: "filePicker.toggle",
    run: async () => {
      openChildSearch("files", { query, linkedThreadSearch });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:search-project-contents",
    searchTerms: ["search project", "find in files", "grep", "content search", "text search"],
    title: "Search project contents",
    icon: <TextSearchIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    shortcutCommand: "projectSearch.toggle",
    run: async () => {
      openChildSearch("content", { query, linkedThreadSearch });
    },
  });

  if (newProjectMachineOptions.length > 0) {
    actionItems.push({
      kind: "action",
      value: "action:new-project",
      searchTerms: ["new project", "create project", "empty", "repository", "repo", "git init"],
      title: "New project",
      icon: <FolderGit2Icon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        openNewProjectFlow();
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: [
      "add project",
      "folder",
      "directory",
      "browse",
      "clone",
      "remote",
      "repository",
      "repo",
      "git",
      ...sourceControlClients.definitions.flatMap((definition) =>
        definition.pickerLabel
          .toLowerCase()
          .split(/[^a-z0-9]+/u)
          .filter(Boolean),
      ),
      "url",
      "machine",
    ],
    title: "Add project",
    icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
    keepOpen: true,
    run: async () => {
      openAddProjectFlow();
    },
  });

  if (wslAddProjectMachineOption) {
    actionItems.push({
      kind: "action",
      value: "action:add-project:wsl-folder",
      searchTerms: ["add project", "open", "wsl", "linux", "folder", "directory"],
      title: "Open WSL folder",
      description: wslAddProjectMachineOption.label,
      icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
      keepOpen: true,
      run: async () => {
        await startAddProjectBrowse(wslAddProjectMachineOption.machineId);
      },
    });
  }

  actionItems.push(changeThemeItem);
  actionItems.push(changeAppearanceItem);

  // The parent pushes an intent into this mounted dialog; applying it clears the
  // parent's intent and may navigate, so it runs after commit but before paint.
  const projectThreadItemCount = projectThreadItems.length;
  const applyOpenIntent = useEffectEvent((intent: CommandPaletteOpenIntent) => {
    clearOpenIntent();
    browseNavigation.invalidate();
    cloneLookupGeneration.current += 1;
    setIsRemoteProjectLookingUp(false);
    setAddProjectMachineId(null);
    setAddProjectCloneFlow(null);
    setNewProjectFlow(null);
    setLinkedThreadSearch(intent.kind === "search" ? intent : null);
    dispatchSearch({ type: "reset", query: intent.kind === "search" ? intent.query : "" });
    switch (intent.kind) {
      case "search":
        return;
      case "add-project":
        openAddProjectFlow();
        return;
      case "new-thread-in":
        pushPaletteView({
          addonIcon: <SquarePenIcon className={ADDON_ICON_CLASS} />,
          groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
        });
        return;
      case "change-theme":
        pushPaletteView({
          addonIcon: <PaletteIcon className={ADDON_ICON_CLASS} />,
          groups: [{ value: "themes", label: "Change theme", items: [] }],
        });
        return;
    }
  });
  useLayoutEffect(() => {
    if (openIntent === null) return;
    // A new-thread-in intent waits until the project items exist.
    if (openIntent.kind === "new-thread-in" && projectThreadItemCount === 0) return;
    // oxlint-disable-next-line react/set-state-in-effect -- applying the intent dispatches to the parent reducer and can navigate, neither of which may run during render.
    applyOpenIntent(openIntent);
  }, [openIntent, projectThreadItemCount]);

  actionItems.push(themeEditorItem);

  if (
    machines.some(
      (machine) => machine.serverConfig?.machine.capabilities.pullRequests === true,
    )
  ) {
    actionItems.push({
      kind: "action",
      value: "action:pull-requests",
      searchTerms: ["pull requests", "prs", "pr", "github", "review", "merge", "branch"],
      title: "Open pull requests",
      icon: <PullRequestGlyph.pullRequest className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:usage",
    searchTerms: ["usage", "use", "tokens", "cost", "spend", "limits", "stats", "analytics"],
    title: "Open usage",
    icon: <ChartNoAxesColumnIcon className={ITEM_ICON_CLASS} />,
    shortcutCommand: "usage.open",
    run: async () => {
      await navigate({ to: "/usage" });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  const contextualProjectGroup =
    (contextualProjectRef
      ? projectGroupByTargetKey.get(
          `${contextualProjectRef.machineId}:${contextualProjectRef.projectId}`,
        )
      : null) ??
    projectGroups[0] ??
    null;
  if (contextualProjectGroup) {
    actionItems.push({
      kind: "action",
      value: "action:project-settings",
      searchTerms: [
        "project",
        "settings",
        "name",
        "icon",
        "scripts",
        "model",
        "workspace",
        "grouping",
        "checkout",
        "remove",
        "t3.json",
      ],
      title: "Project settings",
      description: contextualProjectGroup.displayName,
      icon: <FolderIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({
          to: "/projects/$projectKey",
          params: { projectKey: contextualProjectGroup.projectKey },
        });
      },
    });
  }

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const settingsSearchItems: CommandPaletteActionItem[] = searchSettings(
    deferredQuery,
    availableSettingsSearchItems,
  ).map((item) => ({
    kind: "action",
    value: `setting:${item.id}`,
    searchTerms: [item.title, SETTINGS_SECTION_LABELS[item.to], ...(item.searchTerms ?? [])],
    title: item.title,
    description: `Settings · ${SETTINGS_SECTION_LABELS[item.to]}`,
    ...(item.secondary ? { secondary: true } : {}),
    icon: <SettingsIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await navigate({
        to: item.to,
        hash: item.targetId ?? item.id,
        replace: pathname === item.to,
        hashScrollIntoView: false,
      });
    },
  }));
  const sourceSelectionViewValue =
    addProjectMachineId === null ? null : `sources:${addProjectMachineId}`;
  const activeGroups =
    addProjectMachineId !== null &&
    currentView !== null &&
    currentView.groups[0]?.value === sourceSelectionViewValue
      ? buildAddProjectSourceGroups(
          addProjectMachineId,
          buildPaletteRemoteSourceReadiness(sourceControlDiscovery.data),
        )
      : currentView?.groups[0]?.value === "themes"
        ? changeThemeItem.groups
        : currentView?.groups[0]?.value === "appearance"
          ? changeAppearanceItem.groups
          : (currentView?.groups ?? rootGroups);

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    settingsSearchItems,
    threadSearchItems:
      linkedThreadSearch?.linkedThreads && deferredQuery === linkedThreadSearch.query
        ? buildLinkedThreadActionItems({
            ...linkedThreadSearch.linkedThreads,
            query: linkedThreadSearch.query,
            icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
            runThread: async (thread) => {
              await navigate({
                to: "/$machineId/$threadId",
                params: buildThreadRouteParams(scopeThreadRef(thread.machineId, thread.id)),
              });
            },
          })
        : allThreadItems,
  });

  const handleAddProjectForMachine = async (input: {
    readonly machineId: MachineId;
    readonly rawCwd: string;
    readonly platform: string;
    readonly currentProjectCwd: string | null;
  }) => {
    const machine = machines.find(
      (candidate) => candidate.machineId === input.machineId,
    );
    if (!canCreateProjectInMachine(machine?.connection.phase)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Machine unavailable",
          description: `${machine?.label ?? "The selected machine"} is not connected.`,
        }),
      );
      return;
    }
    const rawCwd = input.rawCwd;

    if (isUnsupportedWindowsProjectPath(rawCwd.trim(), input.platform)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description: "Windows-style paths are only supported on Windows.",
        }),
      );
      return;
    }

    if (isExplicitRelativeProjectPath(rawCwd.trim()) && !input.currentProjectCwd) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description: "Relative paths require an active project.",
        }),
      );
      return;
    }

    const cwd = resolveProjectPathForDispatch(rawCwd, input.currentProjectCwd);
    if (cwd.length === 0) return;

    const existing = findProjectByPath(
      projects.filter((project) => project.machineId === input.machineId),
      cwd,
    );
    if (existing) {
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.machineId === existing.machineId),
        existing.id,
        clientSettings.sidebarThreadSortOrder,
      );
      if (latestThread && latestThread.settledOverride !== "settled") {
        await navigate({
          to: "/$machineId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.machineId, latestThread.id),
          ),
        });
      } else {
        const navigationResult = await settlePromise(() =>
          handleNewThread(scopeProjectRef(existing.machineId, existing.id)),
        );
        if (navigationResult._tag === "Failure") {
          const error = squashAtomCommandFailure(navigationResult);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to open project",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
      }
      setOpen(false);
      return;
    }

    if (!readMachineScope(input.machineId, AuthOrchestrationOperateScope)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Cannot add project",
          description: "This connection cannot add projects.",
        }),
      );
      return;
    }
    const projectId = newProjectId();
    const createResult = await createProject({
      machineId: input.machineId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(cwd),
        workspaceRoot: cwd,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (createResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(createResult)) {
        const error = squashAtomCommandFailure(createResult);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return;
    }

    const navigationResult = await settlePromise(() =>
      handleNewThread(scopeProjectRef(input.machineId, projectId)),
    );
    if (navigationResult._tag === "Failure") {
      const error = squashAtomCommandFailure(navigationResult);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return;
    }
    setOpen(false);
  };

  const handleAddProject = async (rawCwd: string) => {
    if (!browseMachineId) return;
    await handleAddProjectForMachine({
      machineId: browseMachineId,
      rawCwd,
      platform: browseMachinePlatform,
      currentProjectCwd: currentProjectCwdForBrowse,
    });
  };

  const newProjectPublishTargets =
    newProjectFlow === null ? [] : getNewProjectPublishTargets(sourceControlDiscovery.data ?? null);
  const newProjectPublishTarget = getNewProjectPublishTarget(
    newProjectPublishTargets,
    newProjectPublishKind,
  );
  const newProjectName = query.trim();
  const canSubmitNewProject =
    newProjectFlow !== null &&
    newProjectName.length > 0 &&
    !isCreatingNewProject &&
    canCreateProjectInMachine(browseMachine?.connection.phase);

  async function submitNewProject(): Promise<void> {
    if (newProjectFlow === null || !canSubmitNewProject || newProjectSubmittingRef.current) {
      return;
    }
    newProjectSubmittingRef.current = true;
    setIsCreatingNewProject(true);
    const created = await settlePromise(() =>
      createNewProject({
        machineId: newProjectFlow.machineId,
        name: newProjectName,
        publishTo: newProjectPublishes ? newProjectPublishTarget : null,
      }),
    );
    newProjectSubmittingRef.current = false;
    setIsCreatingNewProject(false);
    // Same outcome as the old try/finally: the rejection still surfaces to the caller.
    if (created._tag === "Failure") throw squashAtomCommandFailure(created);
    if (created.value) setOpen(false);
  }

  function getDefaultCloneParentPath(machineId: MachineId): string {
    return getAddProjectInitialQueryForMachine(machineId);
  }

  async function submitAddProjectCloneFlow(destinationPathInput?: string): Promise<void> {
    if (!addProjectCloneFlow) {
      return;
    }
    if (!canCreateProjectInMachine(browseMachine?.connection.phase)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Machine unavailable",
          description: `${browseMachine?.label ?? "The selected machine"} is not connected.`,
        }),
      );
      return;
    }

    if (addProjectCloneFlow.step === "repository") {
      const rawRepository = query.trim();
      if (rawRepository.length === 0 || isRemoteProjectLookingUp) {
        return;
      }

      const provider = addProjectRemoteSourceProvider(addProjectCloneFlow.source);
      if (!provider) {
        const destinationPath = getCloneDestinationPath(
          getDefaultCloneParentPath(addProjectCloneFlow.machineId),
          getCloneDirectoryName(rawRepository),
        );
        setAddProjectCloneFlow({
          step: "confirm",
          machineId: addProjectCloneFlow.machineId,
          source: addProjectCloneFlow.source,
          repositoryInput: rawRepository,
          repository: null,
          remoteUrl: normalizePastedCloneUrl(rawRepository),
        });
        setHighlightedItemValue(null);
        setQuery(destinationPath);
        setBrowseGeneration((generation) => generation + 1);
        return;
      }

      setIsRemoteProjectLookingUp(true);
      const lookupGeneration = ++cloneLookupGeneration.current;
      const lookupResult = await lookupRepository({
        machineId: addProjectCloneFlow.machineId,
        input: {
          provider,
          repository: rawRepository,
        },
      });
      if (lookupGeneration !== cloneLookupGeneration.current) return;
      setIsRemoteProjectLookingUp(false);
      if (lookupResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(lookupResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Repository lookup failed",
              description: errorMessage(squashAtomCommandFailure(lookupResult)),
            }),
          );
        }
        return;
      }
      const repository = lookupResult.value;
      const destinationPath = getCloneDestinationPath(
        getDefaultCloneParentPath(addProjectCloneFlow.machineId),
        getCloneDirectoryName(repository.nameWithOwner),
      );
      setAddProjectCloneFlow({
        step: "confirm",
        machineId: addProjectCloneFlow.machineId,
        source: addProjectCloneFlow.source,
        repositoryInput: rawRepository,
        repository,
        remoteUrl: getDefaultCloneUrl(repository),
      });
      setHighlightedItemValue(null);
      setQuery(destinationPath);
      setBrowseGeneration((generation) => generation + 1);
      return;
    }

    const rawDestination = (destinationPathInput ?? query).trim();
    if (
      !readMachineScope(addProjectCloneFlow.machineId, AuthSourceControlWriteScope) ||
      !readMachineScope(addProjectCloneFlow.machineId, AuthOrchestrationOperateScope)
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Clone unavailable",
          description: "This connection needs permission to write source control and add projects.",
        }),
      );
      return;
    }
    if (rawDestination.length === 0 || isRemoteProjectCloning) return;

    if (isUnsupportedWindowsProjectPath(rawDestination, browseMachinePlatform)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Clone failed",
          description: "Windows-style paths are only supported on Windows.",
        }),
      );
      return;
    }

    if (isExplicitRelativeProjectPath(rawDestination) && !currentProjectCwdForBrowse) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Clone failed",
          description: "Relative paths require an active project.",
        }),
      );
      return;
    }

    const destinationPath = resolveProjectPathForDispatch(
      rawDestination,
      currentProjectCwdForBrowse,
    );
    if (destinationPath.length === 0) {
      return;
    }

    // Older servers only offer the blocking clone: the palette has to wait
    // for git so it can add the project afterwards.
    if (browseMachine?.serverConfig?.machine.capabilities.projectCloneTracking !== true) {
      setIsRemoteProjectCloning(true);
      const cloneResult = await cloneRepository({
        machineId: addProjectCloneFlow.machineId,
        input: {
          remoteUrl: addProjectCloneFlow.remoteUrl,
          destinationPath,
        },
      });
      setIsRemoteProjectCloning(false);
      if (cloneResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(cloneResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Clone failed",
              description: errorMessage(squashAtomCommandFailure(cloneResult)),
            }),
          );
        }
        return;
      }
      await handleAddProject(cloneResult.value.cwd);
      return;
    }

    const projectId = newProjectId();
    setIsRemoteProjectCloning(true);
    const startResult = await startProjectClone({
      machineId: addProjectCloneFlow.machineId,
      input: {
        projectId,
        title: inferProjectTitleFromPath(destinationPath),
        createdAt: new Date().toISOString(),
        remoteUrl: addProjectCloneFlow.remoteUrl,
        destinationPath,
      },
    });
    setIsRemoteProjectCloning(false);
    if (startResult._tag === "Failure") {
      if (!isAtomCommandInterrupted(startResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Clone failed",
            description: errorMessage(squashAtomCommandFailure(startResult)),
          }),
        );
      }
      return;
    }
    setOpen(false);
    const projectRef = scopeProjectRef(addProjectCloneFlow.machineId, projectId);
    await waitForProject(projectRef, 3_000).catch(() => null);
    const navigationResult = await settlePromise(() => handleNewThread(projectRef));
    if (navigationResult._tag === "Failure") {
      const error = squashAtomCommandFailure(navigationResult);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to open project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    }
  }

  const browseTo = async (name: string): Promise<void> => {
    const nextQuery = pinnedCloneDirectoryName
      ? getCloneDestinationBrowsePath({
          browseDirectoryPath: browsePath.directoryPath,
          selectedDirectoryName: name,
          cloneDirectoryName: pinnedCloneDirectoryName,
          caseSensitive: !isWindowsPlatform(browseMachinePlatform),
        })
      : appendBrowsePathSegment(query, name);
    await browseNavigation.run(
      () => prefetchBrowsePath(getBrowseDirectoryPath(nextQuery)),
      () => {
        setHighlightedItemValue(null);
        setQuery(nextQuery);
        setBrowseGeneration((generation) => generation + 1);
      },
    );
  };

  const browseUp = async (): Promise<void> => {
    const parentPath = browsePath.parentPath;
    if (parentPath === null) {
      return;
    }

    const nextQuery = getCloneDestinationPath(parentPath, pinnedCloneDirectoryName);
    await browseNavigation.run(
      () => prefetchBrowsePath(parentPath),
      () => {
        setHighlightedItemValue(null);
        setQuery(nextQuery);
        setBrowseGeneration((generation) => generation + 1);
      },
    );
  };

  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp = !relativePathNeedsActiveProject && browsePath.canBrowseUp;

  const browseGroups = buildBrowseGroups({
    browseEntries: visibleBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <CornerLeftUpIcon className={ITEM_ICON_CLASS} />,
    directoryIcon: <FolderIcon className={ITEM_ICON_CLASS} />,
    browseUp,
    browseTo,
  });
  const cloneDestinationBrowseGroups = browseGroups.map((group) =>
    group.value === "directories" ? { ...group, label: "Select where to clone" } : group,
  );

  const newProjectsRoot = newProjectFlow ? newProjectsRootFor(newProjectFlow.machineId) : null;
  const newProjectPathPreview =
    newProjectsRoot === null ? null : getNewProjectPathPreview(newProjectsRoot, newProjectName);
  const newProjectPublishToggleValue = "new-project:publish";
  const showExistingProjectSources = (machineId: MachineId) => {
    const sourcesMachineId = newProjectFlow?.sourcesMachineId ?? null;
    if (sourcesMachineId === machineId) {
      popView();
      return;
    }
    if (sourcesMachineId !== null) {
      dispatchSearch({ type: "back" });
    }
    popView();
    startAddProjectSourceSelection(machineId);
  };
  const switchNewProjectMachine = (machineId: MachineId) => {
    setNewProjectFlow((flow) => (flow === null ? flow : { ...flow, machineId }));
    setAddProjectMachineId(machineId);
  };
  const selectedNewProjectMachine =
    newProjectFlow === null
      ? undefined
      : newProjectMachineOptions.find(
          (option) => option.machineId === newProjectFlow.machineId,
        );
  const showNewProjectMachines =
    newProjectFlow !== null &&
    (newProjectMachineOptions.length > 1 ||
      (selectedNewProjectMachine === undefined && newProjectMachineOptions.length > 0));
  const newProjectMachineLabel = showNewProjectMachines
    ? (selectedNewProjectMachine?.label ??
      machineLabelById.get(newProjectFlow.machineId) ??
      null)
    : null;
  const newProjectMachineGroup: CommandPaletteView["groups"][number] | null =
    !showNewProjectMachines || newProjectFlow === null
      ? null
      : {
          value: "new-project-machines",
          label: "Machines",
          items: newProjectMachineOptions.map((option) => ({
            ...buildMachineItem(
              option,
              `new-project:machine:${option.machineId}`,
              switchNewProjectMachine,
            ),
            ...(isCreatingNewProject ? { disabled: true } : {}),
            ...(option.machineId === newProjectFlow.machineId
              ? {
                  titleTrailingContent: (
                    <CheckIcon className="ms-auto size-4 shrink-0 text-muted-foreground/70" />
                  ),
                }
              : {}),
          })),
        };
  const newProjectExistingGroup: CommandPaletteView["groups"][number] | null =
    newProjectFlow === null
      ? null
      : {
          value: "new-project-existing",
          label: "",
          items: [
            {
              kind: "action",
              value: "new-project:existing",
              searchTerms: [],
              title: "Add existing project",
              description: "Open a folder or clone a repository",
              icon: <FolderPlusIcon className={ITEM_ICON_CLASS} />,
              titleTrailingContent: (
                <ChevronRightIcon className="-me-0.5 ms-auto size-4 shrink-0 text-muted-foreground/70" />
              ),
              keepOpen: true,
              run: async () => {
                showExistingProjectSources(newProjectFlow.machineId);
              },
            },
          ],
        };
  const newProjectOptionGroups: CommandPaletteView["groups"] =
    newProjectPublishTarget === null || newProjectPathPreview === null
      ? []
      : [
          {
            value: "new-project-options",
            label: "Options",
            items: [
              {
                kind: "action",
                value: newProjectPublishToggleValue,
                searchTerms: [],
                title:
                  newProjectPublishTargets.length > 1
                    ? "Create private repository"
                    : `Create private repository on ${newProjectPublishTarget.definition.label}`,
                description:
                  newProjectName.length > 0
                    ? getNewProjectRepository(newProjectPublishTarget, newProjectPathPreview)
                    : (newProjectPublishTarget.owner ??
                      `Your ${newProjectPublishTarget.definition.label} account`),
                icon: sourceControlHostIcon(newProjectPublishTarget.definition, ITEM_ICON_CLASS),
                titleTrailingContent: (
                  <span className="ms-auto flex items-center gap-2">
                    {newProjectPublishTargets.length > 1 ? (
                      <NewProjectPublishHostPicker
                        disabled={isCreatingNewProject}
                        targets={newProjectPublishTargets}
                        value={newProjectPublishTarget.definition.kind}
                        onValueChange={setNewProjectPublishKind}
                      />
                    ) : null}
                    <span className="pointer-events-none flex">
                      <Checkbox checked={newProjectPublishes} tabIndex={-1} aria-hidden />
                    </span>
                  </span>
                ),
                ...(isCreatingNewProject ? { disabled: true } : {}),
                keepOpen: true,
                run: async () => {
                  setNewProjectPublishes((publishes) => !publishes);
                },
              },
            ],
          },
        ];

  let displayedGroups: CommandPaletteView["groups"] = filteredGroups;
  if (newProjectFlow !== null) {
    displayedGroups = [
      ...(newProjectMachineGroup ? [newProjectMachineGroup] : []),
      ...newProjectOptionGroups,
      ...(newProjectExistingGroup ? [newProjectExistingGroup] : []),
    ];
  } else if (addProjectCloneFlow?.step === "repository") {
    displayedGroups = [];
  } else if (addProjectCloneFlow?.step === "confirm") {
    displayedGroups = relativePathNeedsActiveProject ? [] : cloneDestinationBrowseGroups;
  } else if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }
  const resultRows = buildCommandPaletteRows(displayedGroups);
  const autoHighlightsFirstRow =
    !isBrowsing && !isRemoteProjectCloneFlow && newProjectFlow === null;

  const inputPlaceholder =
    newProjectFlow !== null
      ? "Project name"
      : (remoteProjectInputPlaceholder(addProjectCloneFlow) ??
        getCommandPaletteInputPlaceholder(paletteMode));
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem = highlightedItemValue?.startsWith("browse:") ?? false;
  const canWriteSourceControl = useMachineScope(
    addProjectCloneFlow?.machineId ?? null,
    AuthSourceControlWriteScope,
  );
  const canCreateClonedProject = useMachineScope(
    addProjectCloneFlow?.machineId ?? null,
    AuthOrchestrationOperateScope,
  );
  const canCloneProject = canWriteSourceControl && canCreateClonedProject;
  const isCloneDestinationStep = addProjectCloneFlow?.step === "confirm";
  const canSubmitBrowsePath =
    isBrowsing &&
    !relativePathNeedsActiveProject &&
    canCreateProject &&
    (!isCloneDestinationStep || canCloneProject) &&
    canCreateProjectInMachine(browseMachine?.connection.phase);
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !isBrowsePending &&
    browseAccessError === null &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const useMetaForMod = isMacPlatform(navigator.platform);
  const submitModifierLabel = useMetaForMod ? "\u2318" : "Ctrl";
  const submitActionLabel = isCloneDestinationStep
    ? willCreateProjectPath
      ? "Create & Clone"
      : "Clone"
    : willCreateProjectPath
      ? "Create & Add"
      : "Add";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const hasHighlightedNewProjectItem = newProjectFlow !== null && highlightedItemValue !== null;
  const createShortcutLabel = hasHighlightedNewProjectItem
    ? `${submitModifierLabel} Enter`
    : "Enter";
  const remoteProjectButtonLabel = addProjectCloneFlow
    ? addProjectCloneFlow.source === "url"
      ? "Continue"
      : "Lookup"
    : null;
  const isRemoteProjectPending = isRemoteProjectLookingUp || isRemoteProjectCloning;
  const canSubmitRemoteProjectFlow =
    addProjectCloneFlow?.step === "repository" &&
    query.trim().length > 0 &&
    canCreateProjectInMachine(browseMachine?.connection.phase) &&
    !isRemoteProjectPending;
  const fileManagerName = getLocalFileManagerName(navigator.platform);
  const canOpenProjectFromFileManager =
    isBrowsing &&
    browseMachineId !== null &&
    (browseMachineId === primaryMachineId ||
      (browseMachineIsDesktopLocal && browseDesktopInstanceId !== null)) &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
  const fileManagerInitialPath = (() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwdForBrowse);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  })();

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: { modelPickerOpen: false, editableFocus: true },
    });
    // Global new-thread handlers ignore shortcuts while the palette is open.
    const isJump = threadJumpIndexFromCommand(command ?? "") !== null;
    const isNewThread =
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229 &&
      (command === "chat.new" ||
        command === "chat.newLocal" ||
        command === "chat.newWithoutProject");
    const matchingItem =
      isJump || isNewThread
        ? displayedGroups
            .flatMap((group) => group.items)
            .find((item) => item.shortcutCommand === command)
        : undefined;
    if (isJump || matchingItem) {
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      event.stopPropagation();
      if (matchingItem) {
        executeItem(matchingItem);
      }
      return;
    }
    if (command === "thread.copyReference") {
      event.preventDefault();
      event.stopPropagation();
      if (activeThreadReferenceCopyTarget === null) return;
      setOpen(false);
      void copyActiveThreadReference();
      return;
    }
    // ChatView ignores shortcuts while the palette is open, so handle find here
    // instead of letting the browser's own Find open.
    if (command === "chat.find" && activeThreadId && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestThreadFindOpen();
      return;
    }

    if (addProjectCloneFlow?.step === "repository" && event.key === "Enter") {
      event.preventDefault();
      void submitAddProjectCloneFlow();
      return;
    }

    if (
      newProjectFlow !== null &&
      event.key === "Enter" &&
      (!hasHighlightedNewProjectItem || isPrimaryModifierPressed(event)) &&
      // Enter that confirms an IME composition is part of typing the name.
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      // Base UI would otherwise also click the highlighted row.
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      void submitNewProject();
      return;
    }

    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      if (isCloneDestinationStep) {
        void submitAddProjectCloneFlow(resolvedAddProjectPath);
      } else {
        void handleAddProject(resolvedAddProjectPath);
      }
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
      return;
    }

    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    const firstItemValue = autoHighlightsFirstRow ? resultRows.itemValues[0] : undefined;
    if (
      event.key === "ArrowDown" &&
      highlightClearedRef.current &&
      firstItemValue &&
      !event.nativeEvent.isComposing
    ) {
      (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
      event.preventDefault();
      highlightClearedRef.current = false;
      setHighlightedItemValue(firstItemValue);
      scrollCommandPaletteRowIntoView(
        resultListRef.current,
        resultRows.rowIndexByItemIndex[0] ?? 0,
      );
      return;
    }

    // Base UI clicks the highlighted row on Enter, which does nothing once the
    // virtualized list has unmounted it, so run the tracked highlight directly.
    if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      const highlightedItem = findHighlightedCommandPaletteItem(
        displayedGroups,
        highlightedItemValue ?? firstItemValue ?? null,
      );
      if (highlightedItem) {
        (event as typeof event & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
        event.preventDefault();
        event.stopPropagation();
        executeItem(highlightedItem);
      }
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.disabled) {
      return;
    }

    if (item.kind === "submenu") {
      pushPaletteView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to run command",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  }

  const handleOpenProjectFromFileManager = async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      return;
    }

    setIsPickingProjectFolder(true);
    let pickedPath: string | null = null;
    let desktopWslState: DesktopWslState | null = null;
    try {
      desktopWslState =
        browseMachineId === primaryMachineId && browseMachinePlatform === "Linux"
          ? ((await window.desktopBridge?.getWslState().catch(() => null)) ?? null)
          : null;
      // A WSL-only primary has no secondary bootstrap, so resolve its instance
      // id from desktop settings. Windows and combo-mode primaries still omit
      // the target to preserve the native primary picker. The desktop converts
      // a WSL UNC selection back to a Linux path before returning.
      const pickerTargetMachineId = resolveProjectPickerTarget({
        browseMachineId,
        primaryMachineId,
        desktopInstanceId: browseDesktopInstanceId,
        wslConfiguration: desktopWslState,
      });
      const pickerOptions = {
        ...(fileManagerInitialPath ? { initialPath: fileManagerInitialPath } : {}),
        ...(pickerTargetMachineId ? { targetMachineId: pickerTargetMachineId } : {}),
      };
      pickedPath = await api.dialogs.pickFolder(
        Object.keys(pickerOptions).length > 0 ? pickerOptions : undefined,
      );
    } catch {
      setIsPickingProjectFolder(false);
      return;
    }
    setIsPickingProjectFolder(false);
    if (!pickedPath) {
      return;
    }
    if (parseWslUncPath(pickedPath)) {
      if (desktopWslState === null) {
        desktopWslState = (await window.desktopBridge?.getWslState().catch(() => null)) ?? null;
      }
      let primaryRunningDistro: string | null = null;
      try {
        primaryRunningDistro =
          window.desktopBridge
            ?.getLocalMachineBootstraps()
            .find((bootstrap) => bootstrap.id === PRIMARY_LOCAL_MACHINE_ID)?.runningDistro ??
          null;
      } catch {}
      const selection = resolveWslProjectSelection(
        pickedPath,
        applyWslEnvironmentConfiguration(
          machines.flatMap((machine) => {
            const backendId = desktopLocalBackendId(machine.entry.target);
            if (!backendId) {
              return [];
            }

            const bootstrap = desktopLocalBootstraps.find(
              (candidate) => candidate.httpBaseUrl === machine.displayUrl,
            );
            const runningDistro = bootstrap?.runningDistro ?? null;
            return [{ machineId: machine.machineId, backendId, runningDistro }];
          }),
          primaryMachineId,
          desktopWslState ?? null,
          primaryRunningDistro,
        ),
      );
      if (!selection) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not add WSL project",
            description: "Start the matching WSL backend, then choose the folder again.",
          }),
        );
        return;
      }
      await handleAddProjectForMachine({
        machineId: selection.machineId,
        rawCwd: selection.linuxPath,
        platform: "Linux",
        currentProjectCwd: null,
      });
      return;
    }
    await handleAddProject(pickedPath);
  };

  const inputAccessory =
    newProjectFlow !== null ? (
      <CommandPaletteSubmitButton
        label={isCreatingNewProject ? "Creating" : "Create"}
        shortcutLabel={createShortcutLabel}
        ariaLabel={`Create (${createShortcutLabel})`}
        tooltip={`Create (${createShortcutLabel})`}
        disabled={!canSubmitNewProject}
        onSubmit={() => {
          void submitNewProject();
        }}
      />
    ) : addProjectCloneFlow?.step === "repository" ? (
      <CommandPaletteSubmitButton
        label={isRemoteProjectPending ? "Working" : remoteProjectButtonLabel}
        shortcutLabel="Enter"
        ariaLabel={`${remoteProjectButtonLabel ?? "Continue"} (Enter)`}
        tooltip={`${remoteProjectButtonLabel ?? "Continue"} (Enter)`}
        disabled={!canSubmitRemoteProjectFlow}
        onSubmit={() => {
          void submitAddProjectCloneFlow();
        }}
      />
    ) : isBrowsing ? (
      <CommandPaletteSubmitButton
        label={isCloneDestinationStep && isRemoteProjectPending ? "Cloning" : submitActionLabel}
        shortcutLabel={addShortcutLabel}
        ariaLabel={`${submitActionLabel} (${addShortcutLabel})`}
        tooltip={
          isCloneDestinationStep && !canCloneProject
            ? "This connection needs permission to write source control and add projects."
            : canCreateProject
              ? `${submitActionLabel} (${addShortcutLabel})`
              : "This connection cannot add projects."
        }
        disabled={
          !canCreateProject ||
          !canCreateProjectInMachine(browseMachine?.connection.phase) ||
          relativePathNeedsActiveProject ||
          (isCloneDestinationStep && (!canCloneProject || isRemoteProjectPending))
        }
        onSubmit={() => {
          if (relativePathNeedsActiveProject) {
            return;
          }
          if (isCloneDestinationStep) {
            void submitAddProjectCloneFlow(resolvedAddProjectPath);
          } else {
            void handleAddProject(resolvedAddProjectPath);
          }
        }}
      />
    ) : null;

  const footerActionLabel =
    newProjectFlow !== null
      ? highlightedItemValue === null
        ? "Create"
        : highlightedItemValue === newProjectPublishToggleValue
          ? "Toggle"
          : "Select"
      : addProjectCloneFlow?.step === "repository"
        ? (remoteProjectButtonLabel ?? "Continue")
        : !canSubmitBrowsePath || hasHighlightedBrowseItem
          ? "Select"
          : undefined;

  const footerTrailing = canOpenProjectFromFileManager ? (
    <CommandFooterAction
      disabled={isPickingProjectFolder}
      onClick={() => {
        void handleOpenProjectFromFileManager();
      }}
    >
      {`Open in ${fileManagerName}`}
    </CommandFooterAction>
  ) : null;

  return (
    <CommandPaletteContent
      key={`${viewStack.length}-${browseGeneration}-${isBrowsing}-${newProjectFlow ? "new-project" : (addProjectCloneFlow?.step ?? "none")}`}
      aria-label="Command palette"
      autoHighlight={autoHighlightsFirstRow ? "always" : false}
      footerActionLabel={footerActionLabel}
      footerTrailing={footerTrailing}
      inputAccessory={inputAccessory}
      inputProps={{
        className: hasHighlightedNewProjectItem
          ? "*:data-[slot=autocomplete-input]:pe-38!"
          : addProjectCloneFlow?.step === "repository" || newProjectFlow !== null
            ? "*:data-[slot=autocomplete-input]:pe-32!"
            : isBrowsing
              ? browseInputEndPaddingClass({
                  willCreateProjectPath,
                  hasHighlightedBrowseItem,
                })
              : undefined,
        placeholder: inputPlaceholder,
        ...(isSubmenu
          ? {
              startAddon: (
                <button
                  type="button"
                  className="flex cursor-pointer items-center"
                  aria-label="Back"
                  onClick={popView}
                >
                  <ArrowLeftIcon />
                </button>
              ),
            }
          : isBrowsing
            ? { startAddon: <FolderPlusIcon /> }
            : {}),
        onKeyDown: handleKeyDown,
      }}
      mode="none"
      items={resultRows.itemValues}
      virtualized
      onItemHighlighted={(value, eventDetails) => {
        if (eventDetails.reason === "none" && highlightClearedRef.current) return;
        highlightClearedRef.current = false;
        setHighlightedItemValue(typeof value === "string" ? value : null);
        const rowIndex = resultRows.rowIndexByItemIndex[eventDetails.index];
        if (eventDetails.reason === "keyboard" && rowIndex !== undefined) {
          scrollCommandPaletteRowIntoView(resultListRef.current, rowIndex);
        }
      }}
      onValueChange={handleQueryChange}
      showBackHint={isSubmenu}
      value={query}
    >
      {newProjectPathPreview !== null ? (
        <NewProjectSummary
          name={newProjectName}
          pathPreview={newProjectPathPreview}
          projectsRoot={newProjectsRoot}
          machineLabel={newProjectMachineLabel}
        />
      ) : null}
      {addProjectCloneFlow?.step === "confirm" ? (
        <RemoteRepositorySummary
          source={addProjectCloneFlow.source}
          title={
            addProjectCloneFlow.repository?.nameWithOwner ?? addProjectCloneFlow.repositoryInput
          }
          description={addProjectCloneFlow.repository?.url ?? addProjectCloneFlow.remoteUrl}
        />
      ) : null}
      {browseAccessError ? (
        <div role="alert" className="px-4 py-3 text-sm text-muted-foreground">
          {browseAccessError}
        </div>
      ) : isBrowsePending && browseResult === null ? (
        <div role="status" className="px-4 py-3 text-sm text-muted-foreground">
          Loading folders...
        </div>
      ) : null}
      <CommandPaletteVirtualizedResults
        rows={resultRows.rows}
        listRef={resultListRef}
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={isActionsOnly}
        keybindings={keybindings}
        onExecuteItem={executeItem}
        {...(addProjectCloneFlow?.step === "repository"
          ? {
              emptyStateMessage:
                addProjectCloneFlow.source === "url"
                  ? "Enter a Git clone URL and press Enter to continue."
                  : "Enter a repository path and press Enter to look it up.",
            }
          : addProjectCloneFlow?.step === "confirm"
            ? { emptyStateMessage: "Choose a destination path and press Enter to clone." }
            : relativePathNeedsActiveProject
              ? { emptyStateMessage: "Relative paths require an active project." }
              : willCreateProjectPath
                ? {
                    emptyStateMessage: "Press Enter to create this folder and add it as a project.",
                  }
                : isThreadSearchPending
                  ? { emptyStateMessage: "Searching thread messages…" }
                  : {})}
      />
    </CommandPaletteContent>
  );
}
