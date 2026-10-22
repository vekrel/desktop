import { findErrorTraceId } from "@vekrel/client-runtime/errors";
import {
  type MachineConnectionPresentation,
  RelayConnectionRegistration,
  RelayConnectionTarget,
  orchestrationProtocolCompatibilityError,
} from "@vekrel/client-runtime/connection";
import { relayOfflineReasonMessage } from "@vekrel/client-runtime/relay";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import {
  type MachineId,
  resolveMachineKind,
  type ServerConfig,
} from "@vekrel/contracts";
import type {
  RelayClientMachineRecord,
  RelayMachineStatusResponse,
} from "@vekrel/contracts/relay";
import * as Option from "effect/Option";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { machineCatalog } from "~/connection/catalog";
import { cn } from "~/lib/utils";
import { relayMachineDiscovery } from "~/state/relay";
import { useRelayMachineDiscovery } from "~/state/machines";
import { useAtomCommand } from "~/state/use-atom-command";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { MachineIcon } from "../MachineIcon";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "../settings/itemRows";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { presentSavedCloudMachineConnection } from "./cloudMachineConnectionPresentation";

const EMPTY_DISCOVERY_REFRESH_INTERVAL_MS = 5_000;

function discoveredCompatibilityError(
  status: Option.Option<RelayMachineStatusResponse> | undefined,
) {
  const descriptor = status === undefined ? undefined : Option.getOrNull(status)?.descriptor;
  return descriptor === undefined ? null : orchestrationProtocolCompatibilityError(descriptor);
}

export interface SavedCloudMachineConnection {
  readonly machineId: MachineId;
  readonly connection: MachineConnectionPresentation;
  readonly relayManaged: boolean;
  readonly serverConfig?: Pick<ServerConfig, "machine"> | null;
}

function RemoteMachineRowsSkeleton() {
  return (
    <div className={ITEM_ROW_CLASSNAME}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton shape="pill" className="h-4 w-32" />
          <Skeleton shape="pill" className="h-3 w-20" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>
    </div>
  );
}

export function CloudMachineConnectRows({
  primaryMachineId,
  savedMachines,
  showSavedMachines = false,
  refreshWhileEmpty = false,
  empty = null,
  selection,
  onDiscoveryReady,
}: {
  readonly primaryMachineId: MachineId | null;
  readonly savedMachines: ReadonlyArray<SavedCloudMachineConnection>;
  readonly showSavedMachines?: boolean;
  readonly refreshWhileEmpty?: boolean;
  readonly empty?: ReactNode;
  readonly onDiscoveryReady?: () => void;
  readonly selection?: {
    readonly autoSelectedComputers?: Set<MachineId>;
    readonly selectedIds: ReadonlySet<MachineId>;
    readonly onChange: (machineId: MachineId, selected: boolean) => void;
  };
}) {
  const machinesState = useRelayMachineDiscovery();
  const registerMachine = useAtomCommand(machineCatalog.register, {
    reportFailure: false,
  });
  const refreshRelayMachines = useAtomCommand(relayMachineDiscovery.refresh, {
    reportFailure: false,
  });
  const refreshDiscoveryWhenIdle = useEffectEvent(async () => {
    if (machinesState.refreshing || machinesState.offline) return;
    await refreshRelayMachines();
  });
  const connectRelayMachine = (machine: RelayClientMachineRecord) =>
    registerMachine(
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget({
          machineId: machine.machineId,
          label: machine.label,
        }),
      }),
    );
  const [connectingMachineIds, setConnectingMachineIds] = useState<
    ReadonlySet<MachineId>
  >(new Set());
  const savedById = new Map(
    savedMachines
      .filter((machine) => machine.relayManaged)
      .map((machine) => [machine.machineId, machine]),
  );
  const savedWithoutRelay = new Set(
    savedMachines
      .filter((machine) => !machine.relayManaged)
      .map((machine) => machine.machineId),
  );

  useEffect(() => {
    let active = true;
    if (onDiscoveryReady || !refreshWhileEmpty || document.visibilityState === "visible") {
      void refreshRelayMachines().then(() => {
        if (active) onDiscoveryReady?.();
      });
    }
    return () => {
      active = false;
    };
  }, [refreshRelayMachines, refreshWhileEmpty, onDiscoveryReady]);

  const connectMachine = async (machine: RelayClientMachineRecord) => {
    if (
      discoveredCompatibilityError(
        machinesState.machines.get(machine.machineId)?.status,
      ) !== null
    )
      return false;
    setConnectingMachineIds((current) => new Set([...current, machine.machineId]));
    const result = await connectRelayMachine(machine);
    setConnectingMachineIds((current) => {
      const next = new Set(current);
      next.delete(machine.machineId);
      return next;
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: savedWithoutRelay.has(machine.machineId)
          ? "T3 Connect route added"
          : "Machine added",
        description: savedWithoutRelay.has(machine.machineId)
          ? `${machine.label} falls back to T3 Connect when its other routes are unreachable.`
          : `Connecting to ${machine.label} through T3 Connect.`,
      });
      return true;
    }
    if (isAtomCommandInterrupted(result)) {
      return false;
    }
    const cause = squashAtomCommandFailure(result);
    const message =
      cause instanceof Error ? cause.message : "Could not connect the T3 Connect machine.";
    const traceId = findErrorTraceId(cause);
    console.error("[t3-connect] Could not connect machine", { message, traceId, cause });
    toastManager.add({
      type: "error",
      title: "Could not connect machine",
      description: message,
      data: traceId
        ? {
            secondaryActionProps: {
              children: "Copy trace ID",
              onClick: () => void navigator.clipboard?.writeText(traceId),
            },
          }
        : undefined,
    });
    return false;
  };

  // During onboarding selection a machine saved over another route already
  // has its own row elsewhere, and selecting it must not add a T3 Connect
  // route as a side effect, so it is left out here.
  const isVisibleMachine = (machineId: MachineId) =>
    machineId !== primaryMachineId &&
    (showSavedMachines || !savedById.has(machineId)) &&
    !(selection && savedWithoutRelay.has(machineId));
  const visibleMachines = [...machinesState.machines.values()].filter(
    ({ machine }) => isVisibleMachine(machine.machineId),
  );
  const selectNewComputers = useEffectEvent(
    (machines: typeof machinesState.machines) => {
      const seen = selection?.autoSelectedComputers;
      if (!selection || !seen) return;
      for (const { machine, status, availability } of machines.values()) {
        if (!isVisibleMachine(machine.machineId)) continue;
        const id = machine.machineId;
        if (availability === "checking") continue;
        if (
          discoveredCompatibilityError(status) !== null ||
          savedById.get(id)?.connection.phase === "unsupported"
        ) {
          seen.add(id);
          if (selection.selectedIds.has(id)) selection.onChange(id, false);
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        selection.onChange(id, true);
        if (!savedById.has(id)) {
          void connectMachine(machine).then((connected) => {
            if (!connected) selection.onChange(id, false);
          });
        }
      }
    },
  );
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Discovery results arrive from an external store and auto-selection starts relay connections, which mark themselves connecting.
    selectNewComputers(machinesState.machines);
  }, [machinesState.machines]);

  // Discovery clears its list on refresh, so poll only until a machine appears.
  const shouldRefreshWhileEmpty =
    refreshWhileEmpty && visibleMachines.length === 0 && !machinesState.offline;

  useEffect(() => {
    if (!shouldRefreshWhileEmpty) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let pending = false;
    const visible = () => document.visibilityState === "visible";
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && visible()) {
        timer = setTimeout(() => void refresh(), EMPTY_DISCOVERY_REFRESH_INTERVAL_MS);
      }
    };
    const refresh = async () => {
      if (disposed || pending || !visible()) return;
      clearTimeout(timer);
      pending = true;
      await settlePromise(() => refreshDiscoveryWhenIdle());
      pending = false;
      schedule();
    };
    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (visible()) void refresh();
    };

    schedule();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [shouldRefreshWhileEmpty]);

  const standalone = showSavedMachines || savedMachines.length === 0;

  if (
    !refreshWhileEmpty &&
    standalone &&
    visibleMachines.length === 0 &&
    machinesState.refreshing &&
    machinesState.machines.size === 0
  ) {
    return <RemoteMachineRowsSkeleton />;
  }

  if (standalone && visibleMachines.length === 0) {
    const discoveryProblem = machinesState.offline
      ? "You appear to be offline."
      : (Option.getOrNull(machinesState.error)?.message ?? null);
    if (discoveryProblem !== null && !machinesState.refreshing) {
      return (
        <div className={ITEM_ROW_CLASSNAME}>
          <p className="text-sm font-medium text-destructive">
            Could not load T3 Connect machines
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{discoveryProblem}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => void refreshRelayMachines()}
          >
            Try again
          </Button>
        </div>
      );
    }
    return empty;
  }

  return visibleMachines.map(({ machine, availability, error, status }) => {
    const savedMachine = savedById.get(machine.machineId);
    const compatibilityError = discoveredCompatibilityError(status);
    const unsupported =
      compatibilityError !== null || savedMachine?.connection.phase === "unsupported";
    const unsupportedDetail =
      compatibilityError?.message ?? savedMachine?.connection.error ?? null;
    const savedConnection = unsupported
      ? presentSavedCloudMachineConnection({
          phase: "unsupported",
          error: unsupportedDetail,
          traceId: null,
        })
      : savedMachine
        ? presentSavedCloudMachineConnection(savedMachine.connection)
        : null;
    const relayStatus = status === undefined ? null : Option.getOrNull(status);
    const descriptor = relayStatus?.descriptor;
    const offlineReason =
      availability === "offline" && relayStatus !== null
        ? relayOfflineReasonMessage(relayStatus)
        : null;
    const machineKind = resolveMachineKind(
      savedMachine?.serverConfig ??
        (descriptor === undefined ? null : { machine: descriptor }),
    );
    const dotClassName = savedConnection
      ? savedConnection.tone === "connected"
        ? "bg-success"
        : savedConnection.tone === "connecting"
          ? "bg-warning"
          : savedConnection.tone === "error"
            ? "bg-destructive"
            : "bg-muted-foreground/35"
      : availability === "online"
        ? "bg-success"
        : availability === "error"
          ? "bg-destructive"
          : availability === "checking"
            ? "bg-warning"
            : "bg-muted-foreground/35";
    const notAdded = savedWithoutRelay.has(machine.machineId)
      ? "Saved without T3 Connect"
      : "Not added";
    const statusText =
      unsupported && !savedMachine
        ? `T3 Connect · ${notAdded} · Client not supported`
        : offlineReason !== null
          ? offlineReason
          : savedConnection
            ? savedConnection.statusText
            : availability === "online"
              ? `T3 Connect · ${notAdded} · Relay online`
              : availability === "offline"
                ? `T3 Connect · ${notAdded} · Relay offline`
                : availability === "checking"
                  ? `T3 Connect · ${notAdded} · Checking relay status…`
                  : (Option.getOrNull(error)?.message ??
                    `T3 Connect · ${notAdded} · Relay status unavailable`);
    if (selection) {
      return (
        <label
          key={machine.machineId}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 has-disabled:cursor-default"
        >
          <Checkbox
            checked={!unsupported && selection.selectedIds.has(machine.machineId)}
            disabled={unsupported || connectingMachineIds.has(machine.machineId)}
            onCheckedChange={async (checked) => {
              if (unsupported) return;
              selection.onChange(machine.machineId, checked);
              if (checked && !savedMachine) {
                const connected = await connectMachine(machine);
                if (!connected) selection.onChange(machine.machineId, false);
              }
            }}
          />
          <MachineIcon
            aria-hidden
            kind={machineKind}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{machine.label}</span>
            {unsupportedDetail !== null ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {unsupportedDetail}
              </span>
            ) : null}
          </span>
          <Tooltip>
            <TooltipTrigger
              render={<span tabIndex={0} />}
              className={cn(
                "max-w-[45%] shrink-0 truncate text-xs",
                savedConnection?.tone === "error" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {connectingMachineIds.has(machine.machineId)
                ? "Connecting…"
                : (savedConnection?.buttonLabel ??
                  (availability === "online"
                    ? "Available"
                    : availability === "offline"
                      ? "Offline"
                      : availability === "error"
                        ? "Unavailable"
                        : "Checking…"))}
            </TooltipTrigger>
            <TooltipPopup>{unsupportedDetail ?? statusText}</TooltipPopup>
          </Tooltip>
        </label>
      );
    }
    return (
      <div key={machine.machineId} className={ITEM_ROW_CLASSNAME}>
        <div className={ITEM_ROW_INNER_CLASSNAME}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ConnectionStatusDot
                dotClassName={dotClassName}
                pingClassName={
                  savedConnection?.tone === "connecting" ||
                  (savedConnection === null && availability === "checking")
                    ? "bg-warning/60 duration-2000"
                    : null
                }
                tooltipText={
                  unsupportedDetail !== null
                    ? unsupportedDetail
                    : offlineReason !== null
                      ? offlineReason
                      : savedConnection
                        ? savedConnection.statusText
                        : availability === "online"
                          ? "Relay online"
                          : availability === "offline"
                            ? "Relay offline"
                            : availability === "checking"
                              ? "Checking relay status"
                              : (Option.getOrNull(error)?.message ?? "Relay status unavailable")
                }
              />
              <MachineIcon
                aria-hidden
                kind={machineKind}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <p className="truncate text-sm font-medium">{machine.label}</p>
            </div>
            <p
              className={cn(
                "mt-1 truncate text-xs",
                savedConnection?.tone === "error" ||
                  (savedConnection?.tone === "connecting" && savedMachine?.connection.error) ||
                  (savedConnection === null && availability === "error")
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {statusText}
            </p>
          </div>
          {unsupported && !savedMachine ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
                <Button size="sm" disabled>
                  Add
                </Button>
              </TooltipTrigger>
              <TooltipPopup>{unsupportedDetail ?? "Client not supported"}</TooltipPopup>
            </Tooltip>
          ) : savedConnection ? (
            <Button size="sm" variant="outline" disabled>
              {savedConnection.buttonLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={connectingMachineIds.size > 0}
              onClick={() => void connectMachine(machine)}
            >
              {connectingMachineIds.has(machine.machineId)
                ? "Adding…"
                : savedWithoutRelay.has(machine.machineId)
                  ? "Add route"
                  : "Add"}
            </Button>
          )}
        </div>
      </div>
    );
  });
}
