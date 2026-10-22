import { useStableCallback } from "../../hooks/useStableCallback";
import { type MachineId } from "@vekrel/contracts";
import { type MachineConnectionPresentation } from "@vekrel/client-runtime/connection";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import { WifiOffIcon } from "lucide-react";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { machineCatalog } from "../../connection/catalog";
import { ConnectionDiagnosisHeadline } from "../settings/ConnectionDiagnosisDetails";
import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { useMachineDisconnectDelay } from "../../hooks/useMachineDisconnectDelay";
import { serverMachine } from "../../state/server";
import { type MachinePresentation } from "../../state/machines";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  hasMachineReconnectWarningGraceElapsed,
  scheduleMachineReconnectWarning,
} from "../ChatView.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ServerUpdateAction, serverUpdateStageLabel } from "../ServerUpdateAction";
import { useAutoBalanceUpdateBanner } from "./useAutoBalanceUpdateBanner";
import { ComposerServerUpdateIcon } from "./ComposerServerUpdateStatus";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  serverUpdateGuidance,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "../../versionSkew";

export type MachineUnavailableState = {
  readonly machineId: MachineId;
  readonly label: string;
  readonly connection: MachineConnectionPresentation;
};

interface SystemComposerBannersInput {
  readonly activeMachine: MachinePresentation | null;
  readonly activeMachineUnavailable: boolean;
  readonly activeMachineUnavailableState: MachineUnavailableState | null;
  readonly activeThreadMachineId: MachineId | null;
  readonly serverConfig: MachinePresentation["serverConfig"] | null;
  readonly hasMultipleRegisteredMachines: boolean;
  readonly automaticMachine: boolean;
  readonly autoUpdateMachines: ReadonlyArray<MachinePresentation>;
}

/**
 * The composer banners about the machine itself: offline or reconnecting,
 * a server update, and auto-balanced machines that need one.
 */
export function useSystemComposerBanners(input: SystemComposerBannersInput) {
  const {
    activeMachine,
    activeMachineUnavailable,
    activeMachineUnavailableState,
    activeThreadMachineId,
    serverConfig,
    hasMultipleRegisteredMachines,
    automaticMachine,
    autoUpdateMachines,
  } = input;
  const navigate = useNavigate();
  const retryMachine = useAtomCommand(machineCatalog.retryNow, { reportFailure: false });
  const setMachineEnabled = useAtomCommand(machineCatalog.setEnabled, {
    reportFailure: false,
  });
  const activeMachineConnectionPhase = activeMachine?.connection.phase ?? "available";
  const activeReconnectingMachineId =
    activeMachineConnectionPhase === "connecting" ||
    activeMachineConnectionPhase === "reconnecting"
      ? (activeMachine?.machineId ?? null)
      : null;
  const [reconnectWarningGraceElapsedMachineId, setReconnectWarningGraceElapsedMachineId] =
    useState<MachineId | null>(null);
  // Each reconnect attempt gets its own grace period, including a later one to
  // the same machine.
  const [graceReconnectingMachineId, setGraceReconnectingMachineId] = useState(
    activeReconnectingMachineId,
  );
  if (graceReconnectingMachineId !== activeReconnectingMachineId) {
    setGraceReconnectingMachineId(activeReconnectingMachineId);
    setReconnectWarningGraceElapsedMachineId(null);
  }
  const reconnectWarningGraceElapsed = hasMachineReconnectWarningGraceElapsed(
    activeReconnectingMachineId,
    reconnectWarningGraceElapsedMachineId,
  );
  useEffect(() => {
    if (activeReconnectingMachineId === null) return;
    return scheduleMachineReconnectWarning(() =>
      setReconnectWarningGraceElapsedMachineId(activeReconnectingMachineId),
    );
  }, [activeReconnectingMachineId]);
  const handleReconnectActiveMachine = async (machineId: MachineId) => {
    const result = await retryMachine(machineId);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not reconnect machine",
          description: error instanceof Error ? error.message : "Failed to reconnect.",
        }),
      );
    }
  };
  const handleReconnectActiveMachineStable = useStableCallback(
    handleReconnectActiveMachine,
  );
  const disconnectDelayElapsed = useMachineDisconnectDelay(
    activeMachineUnavailable && activeMachine ? activeMachine.machineId : null,
  );
  const canDisconnectActiveMachine =
    disconnectDelayElapsed &&
    activeMachine !== null &&
    activeMachine.entry.target._tag !== "PrimaryConnectionTarget" &&
    !isDesktopLocalConnectionTarget(activeMachine.entry.target);
  const [disconnectingMachine, setDisconnectingMachine] = useState(false);
  const handleDisconnectActiveMachine = async (machineId: MachineId) => {
    setDisconnectingMachine(true);
    const result = await setMachineEnabled({ machineId, enabled: false });
    setDisconnectingMachine(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not disconnect server",
            description: error instanceof Error ? error.message : "Failed to disconnect.",
          }),
        );
      }
      return;
    }
    void navigate({ to: "/", replace: true });
  };
  const handleDisconnectActiveMachineStable = useStableCallback(
    handleDisconnectActiveMachine,
  );
  const autoBalanceUpdateBanner = useAutoBalanceUpdateBanner(autoUpdateMachines);
  const versionMismatch = resolveServerConfigVersionMismatch(serverConfig);
  const versionMismatchDismissKey =
    versionMismatch && activeThreadMachineId !== null
      ? buildVersionMismatchDismissalKey(activeThreadMachineId, versionMismatch)
      : null;
  const [dismissedVersionMismatchKey, setDismissedVersionMismatchKey] = useState<string | null>(
    null,
  );
  const versionMismatchDismissed =
    versionMismatchDismissKey === dismissedVersionMismatchKey ||
    isVersionMismatchDismissed(versionMismatchDismissKey);
  const showVersionMismatchBanner =
    versionMismatch !== null && versionMismatchDismissKey !== null && !versionMismatchDismissed;
  const versionMismatchServerLabel =
    hasMultipleRegisteredMachines && activeThreadMachineId !== null
      ? `${activeMachine?.label ?? serverConfig?.machine.label ?? activeThreadMachineId} server`
      : "server";
  const serverUpdateMachineId = activeThreadMachineId;
  const versionMismatchSelfUpdate = resolveServerSelfUpdateCapability(serverConfig);
  const versionMismatchInstallation = serverConfig?.machine.capabilities.serverInstallation;
  const versionMismatchDesktopAppUpdate = supportsDesktopAppUpdate(serverConfig);
  const versionMismatchThreadContinuation = supportsServerUpdateThreadContinuation(serverConfig);
  const serverUpdateState = useAtomValue(
    serverMachine.updateStateAtom(serverUpdateMachineId),
  );
  const [dismissedServerUpdateState, setDismissedServerUpdateState] = useState<
    typeof serverUpdateState | null
  >(null);
  const serverUpdateFailureDismissed =
    serverUpdateState === dismissedServerUpdateState ||
    isServerUpdateFailureDismissed(serverUpdateState);
  return (() => {
    const items: ComposerBannerStackItem[] = [];
    const updateRunning = serverUpdateState.status === "running";
    const unavailableConnection = activeMachineUnavailableState?.connection ?? null;
    const disconnectAction =
      canDisconnectActiveMachine && activeMachineUnavailableState ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={disconnectingMachine}
          title="Hide this server's threads. Switch it on again in Connections."
          onClick={() =>
            void handleDisconnectActiveMachineStable(
              activeMachineUnavailableState.machineId,
            )
          }
        >
          Disconnect server
        </Button>
      ) : undefined;
    const machineReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner =
      machineReconnecting && (updateRunning || !reconnectWarningGraceElapsed);
    if (activeMachineUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      items.push({
        id: `machine-unavailable:${activeMachineUnavailableState.machineId}`,
        variant: unavailableConnection.phase === "error" ? "error" : "warning",
        icon: <WifiOffIcon />,
        title: `${activeMachineUnavailableState.label} is ${machineReconnecting ? "reconnecting" : "offline"}`,
        description: activeMachine ? (
          <ConnectionDiagnosisHeadline machine={activeMachine} />
        ) : undefined,
        actions: (
          <>
            {!machineReconnecting ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void handleReconnectActiveMachineStable(
                    activeMachineUnavailableState.machineId,
                  )
                }
              >
                Reconnect
              </Button>
            ) : null}
            {disconnectAction}
          </>
        ),
      });
    }
    if (
      !automaticMachine &&
      serverUpdateMachineId &&
      (serverUpdateState.status === "idle"
        ? showVersionMismatchBanner
        : !serverUpdateFailureDismissed)
    ) {
      const updateInProgress = serverUpdateState.status === "running";
      const updateFailed = serverUpdateState.status === "failed";
      items.push({
        id: `server-version:${serverUpdateMachineId}`,
        variant: updateFailed ? "error" : "default",
        priority: updateInProgress ? "urgent" : "notice",
        icon: <ComposerServerUpdateIcon status={serverUpdateState.status} />,
        title:
          updateInProgress || updateFailed ? (
            `${updateFailed ? "Could not update" : "Updating"} ${versionMismatchServerLabel}`
          ) : versionMismatch ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="block max-w-full cursor-help truncate rounded-sm text-left"
                  >
                    Server update available
                  </button>
                }
              />
              <TooltipPopup side="top">
                {versionMismatchServerLabel} {versionMismatch.serverVersion}{" "}
                <span aria-hidden="true">→</span> {versionMismatch.clientVersion}
              </TooltipPopup>
            </Tooltip>
          ) : (
            "Server update available"
          ),
        description:
          serverUpdateState.status === "failed"
            ? serverUpdateState.message
            : serverUpdateState.status === "running"
              ? serverUpdateStageLabel(serverUpdateState.stage)
              : versionMismatchSelfUpdate !== null &&
                  (versionMismatchSelfUpdate !== "desktop-managed" ||
                    !versionMismatchDesktopAppUpdate)
                ? serverUpdateGuidance(versionMismatchSelfUpdate)
                : undefined,
        actions: updateInProgress ? (
          disconnectAction
        ) : !versionMismatch ||
          (versionMismatchSelfUpdate === "desktop-managed" &&
            !versionMismatchDesktopAppUpdate) ? undefined : (
          <ServerUpdateAction
            machineId={serverUpdateMachineId}
            serverLabel={versionMismatchServerLabel}
            selfUpdate={versionMismatchSelfUpdate}
            installation={versionMismatchInstallation}
            desktopAppUpdate={versionMismatchDesktopAppUpdate}
            threadContinuation={versionMismatchThreadContinuation}
            targetVersion={versionMismatch.clientVersion}
            label={updateFailed ? "Retry" : "Update"}
            variant="ghost"
          />
        ),
        ...(updateInProgress || (!updateFailed && !versionMismatchDismissKey)
          ? {}
          : {
              dismissLabel: "Dismiss update notice",
              onDismiss: () => {
                if (updateFailed) {
                  dismissServerUpdateFailure(serverUpdateState);
                  setDismissedServerUpdateState(serverUpdateState);
                }
                dismissVersionMismatch(versionMismatchDismissKey);
                setDismissedVersionMismatchKey(versionMismatchDismissKey);
              },
            }),
      });
    }
    if (autoBalanceUpdateBanner) items.push(autoBalanceUpdateBanner);
    return items;
  })() as ComposerBannerStackItem[];
}
