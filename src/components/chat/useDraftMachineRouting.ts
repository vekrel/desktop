import { useLoadBalancedMachine } from "../../hooks/useLoadBalancedMachine";
import { useLogicalProjectMachines } from "../../hooks/useLogicalProjectMachines";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  type MachineId,
  type ProviderDriverKind,
  ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  type ThreadContextRecord,
} from "@vekrel/contracts";
import { scopeProjectRef } from "@vekrel/client-runtime/machine";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toastManager } from "../ui/toast";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../../logicalProject";
import { useComposerDraftStore, DraftId } from "../../composerDraftStore";
import { type MachinePresentation, useMachineProviders } from "../../state/machines";
import { useProjects } from "../../state/entities";
import type { DraftSessionState } from "../../composerDraftStore";

interface DraftMachineRoutingInput {
  readonly draftId: DraftId | null;
  readonly draftThread: DraftSessionState | null;
  readonly envLocked: boolean;
  readonly automaticMachine: boolean;
  readonly logicalProjectMachines: ReturnType<typeof useLogicalProjectMachines>;
  readonly machineById: ReadonlyMap<MachineId, MachinePresentation>;
  readonly providersByMachine: ReturnType<typeof useMachineProviders>;
  readonly loadBalancingSettings: {
    readonly loadBalancingWeights: Readonly<Record<string, number>>;
  };
  readonly referencedThreadContexts: ReadonlyArray<ThreadContextRecord>;
  readonly activeProviderInstanceId: ProviderInstanceId | null;
  readonly selectedProvider: ProviderDriverKind;
  readonly composerHasAttachments: boolean;
  readonly activeProjectKey: string | null;
  readonly activeProjectIsScratch: boolean;
  readonly projectGroupingSettings: ReturnType<typeof selectProjectGroupingSettings>;
  readonly sendInFlightRef: { readonly current: boolean };
}

/**
 * Which machine an unsent draft runs on: automatic load balancing across the
 * project's machines, or a manual switch, which may first open a scratch
 * project on the target machine.
 */
export function useDraftMachineRouting(input: DraftMachineRoutingInput) {
  const {
    draftId,
    draftThread,
    envLocked,
    automaticMachine,
    logicalProjectMachines,
    machineById,
    providersByMachine,
    loadBalancingSettings,
    referencedThreadContexts,
    activeProviderInstanceId,
    selectedProvider,
    composerHasAttachments,
    activeProjectKey,
    activeProjectIsScratch,
    projectGroupingSettings,
    sendInFlightRef,
  } = input;
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const allProjects = useProjects();
  const { openScratchProject } = useScratchProject();
  const needsLoadBalancing = automaticMachine && !draftThread?.loadBalancedMachineId;
  const loadBalancingCandidates = needsLoadBalancing
    ? logicalProjectMachines
        .filter((candidate) => {
          const machine = machineById.get(candidate.machineId);
          return (
            machine?.connection.phase === "connected" &&
            (loadBalancingSettings.loadBalancingWeights[candidate.machineId] ?? 50) > 0 &&
            referencedThreadContexts.every(
              (record) => record.machineId === candidate.machineId,
            ) &&
            providersByMachine
              .get(candidate.machineId)
              ?.some(
                (provider) =>
                  (activeProviderInstanceId === null ||
                    provider.instanceId === activeProviderInstanceId) &&
                  provider.driver === selectedProvider &&
                  (machine.serverConfig?.settings
                    ? resolveProjectProviderInstanceEnabled(
                        machine.serverConfig.settings,
                        candidate.projectId,
                        provider.instanceId,
                      )
                    : provider.enabled) &&
                  provider.installed &&
                  provider.status !== "error" &&
                  provider.auth.status !== "unauthenticated" &&
                  provider.availability !== "unavailable",
              )
          );
        })
        .map((candidate) => candidate.machineId)
    : [];
  const loadBalancing = useLoadBalancedMachine(
    loadBalancingCandidates,
    loadBalancingSettings.loadBalancingWeights,
  );
  useEffect(() => {
    if (!needsLoadBalancing || loadBalancing.pending || !draftId || sendInFlightRef.current) return;
    const target = logicalProjectMachines.find(
      (machine) => machine.machineId === loadBalancing.machineId,
    );
    if (!target?.projectId) return;
    setDraftThreadContext(draftId, {
      projectRef: scopeProjectRef(target.machineId, target.projectId),
      machineSelection: "auto",
      loadBalancedMachineId: target.machineId,
    });
  }, [
    needsLoadBalancing,
    loadBalancing.pending,
    loadBalancing.machineId,
    draftId,
    logicalProjectMachines,
    sendInFlightRef,
    setDraftThreadContext,
  ]);
  const onAutoMachine = () => {
    if (envLocked || !draftId) return;
    if (composerHasAttachments) {
      toastManager.add({
        type: "warning",
        id: "load-balancing-attachments",
        title: "Keep attachments on this machine",
        description:
          "Remove attachments before choosing automatic routing, then attach them on the selected machine.",
      });
      return;
    }
    loadBalancing.refresh(
      logicalProjectMachines.map((machine) => machine.machineId),
    );
    setDraftThreadContext(draftId, {
      machineSelection: "auto",
      loadBalancedMachineId: null,
      branch: null,
      worktreePath: null,
    });
  };
  const onAutoMachineStable = useStableCallback(onAutoMachine);
  const autoMachineLabel = automaticMachine
    ? draftThread?.loadBalancedMachineId
      ? "Auto balance"
      : loadBalancing.pending
        ? "Checking machines…"
        : loadBalancing.failed
          ? "Auto balance unavailable"
          : "Auto balance"
    : undefined;

  // A change in flight belongs to the draft and project it started on.
  const machineChangeScope = `${draftId ?? ""}:${activeProjectKey ?? ""}`;
  const machineChangeRef = useRef<{
    readonly machineId: MachineId;
    readonly scope: string;
  } | null>(null);
  const machineChangeScopeRef = useRef("");
  useLayoutEffect(() => {
    machineChangeScopeRef.current = machineChangeScope;
  });
  // Leaving the scope, or unmounting, abandons a change still in flight.
  useLayoutEffect(
    () => () => {
      if (machineChangeRef.current?.scope === machineChangeScope) {
        machineChangeRef.current = null;
      }
    },
    [machineChangeScope],
  );
  const readPendingMachineChange = () => {
    const pending = machineChangeRef.current;
    return pending !== null && pending.scope === machineChangeScopeRef.current ? pending : null;
  };
  // The busy state belongs to the request that set it, so an older request settling late
  // (abandoned, or superseded by a newer switch) can never clear a newer one's.
  const [busyMachineChange, setBusyMachineChange] = useState<{
    readonly machineId: MachineId;
    readonly scope: string;
  } | null>(null);
  const isMachineChanging = busyMachineChange?.scope === machineChangeScope;

  const onMachineChange = (nextMachineId: MachineId) => {
    if (envLocked || !draftId || sendInFlightRef.current) return;
    const originalDraft = getDraftSession(draftId);
    if (!originalDraft || originalDraft.promotedTo) return;
    const target = logicalProjectMachines.find(
      (env) => env.machineId === nextMachineId,
    );
    if (!target) return;
    const request = { machineId: target.machineId, scope: machineChangeScope };
    machineChangeRef.current = request;
    setBusyMachineChange(null);
    const retarget = (project: (typeof allProjects)[number]) => {
      const currentDraft = getDraftSession(draftId);
      if (
        machineChangeRef.current !== request ||
        machineChangeScopeRef.current !== request.scope ||
        sendInFlightRef.current ||
        !currentDraft ||
        currentDraft.promotedTo ||
        currentDraft.machineId !== originalDraft.machineId ||
        currentDraft.projectId !== originalDraft.projectId
      )
        return;
      const projectRef = scopeProjectRef(target.machineId, project.id);
      if (activeProjectIsScratch) {
        setLogicalProjectDraftThreadId(
          deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings),
          projectRef,
          draftId,
          { machineSelection: "manual", loadBalancedMachineId: null },
        );
      } else {
        setDraftThreadContext(draftId, {
          projectRef,
          machineSelection: "manual",
          loadBalancedMachineId: null,
        });
      }
    };
    const finish = () => {
      if (machineChangeRef.current === request) machineChangeRef.current = null;
      setBusyMachineChange((busy) => (busy === request ? null : busy));
    };
    if (target.projectId !== null) {
      const project = allProjects.find(
        (project) =>
          project.machineId === target.machineId && project.id === target.projectId,
      );
      if (project) retarget(project);
      finish();
      return;
    }
    setBusyMachineChange(request);
    void openScratchProject(target.machineId, "Could not switch machine")
      .then((project) => {
        if (project) retarget(project);
      })
      .finally(finish);
  };
  const onMachineChangeStable = useStableCallback(onMachineChange);

  return {
    needsLoadBalancing,
    loadBalancing,
    onAutoMachineStable,
    autoMachineLabel,
    isMachineChanging,
    readPendingMachineChange,
    onMachineChangeStable,
  };
}
