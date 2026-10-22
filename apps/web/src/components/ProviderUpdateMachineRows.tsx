import { CheckIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  AuthProvidersManageScope,
  type MachineId,
  type ServerProvider,
} from "@vekrel/contracts";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@vekrel/client-runtime/state/runtime";

import { cn } from "~/lib/utils";
import { serverMachine } from "~/state/server";
import { readMachineScope, useMachineScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLocalMachineUpdateGroups } from "./ProviderUpdateLaunchNotification.machines";
import {
  collectProviderUpdateOutcomeSnapshots,
  firstRejectedProviderUpdateMessage,
  getProviderUpdateProgressToastView,
  getProviderUpdateSidebarPillView,
  isTerminalProviderUpdatePhase,
  resolveMachineUpdateRowStatus,
  type LocalMachineUpdateGroup,
  type LocalProviderUpdateOutcome,
  type ProviderUpdateRowStatus,
  type ProviderUpdateRowStatusKind,
  type ProviderUpdateToastView,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

type ProviderUpdateCommandResult = AtomCommandResult<
  { readonly providers: ReadonlyArray<ServerProvider> },
  unknown
>;

function toProviderUpdateOutcome(input: {
  readonly machineId: MachineId;
  readonly isPrimary: boolean;
  readonly target: {
    readonly driver: ServerProvider["driver"];
    readonly instanceId: ServerProvider["instanceId"];
  };
  readonly result: ProviderUpdateCommandResult;
}): PromiseSettledResult<LocalProviderUpdateOutcome> {
  if (input.result._tag === "Failure") {
    if (isAtomCommandInterrupted(input.result)) {
      return {
        status: "fulfilled",
        value: {
          machineId: input.machineId,
          isPrimary: input.isPrimary,
          driver: input.target.driver,
          instanceId: input.target.instanceId,
          provider: null,
        },
      };
    }
    const error = squashAtomCommandFailure(input.result);
    return {
      status: "rejected",
      reason: error instanceof Error ? error : new Error("Provider update failed."),
    };
  }

  const provider =
    input.result.value.providers.find(
      (candidate) => candidate.instanceId === input.target.instanceId,
    ) ?? null;
  return {
    status: "fulfilled",
    value: {
      machineId: input.machineId,
      isPrimary: input.isPrimary,
      driver: input.target.driver,
      instanceId: input.target.instanceId,
      provider,
    },
  };
}

// Keep it well beyond the server's own update timeout (5 min) so a legitimately
// slow update (npm installs routinely run tens of seconds) is never cut off and
// left showing a dead, unresponsive Update button.
const PENDING_EXPIRY_MS = 6 * 60_000;

function rowToneClass(kind: ProviderUpdateRowStatusKind): string {
  switch (kind) {
    case "failed":
      return "text-destructive";
    case "unchanged":
      return "text-warning";
    case "success":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

function MachineUpdateRow({
  group,
  status,
  onUpdate,
}: {
  readonly group: LocalMachineUpdateGroup;
  readonly status: ProviderUpdateRowStatus;
  readonly onUpdate: () => void;
}) {
  const canManageProviders = useMachineScope(group.machineId, AuthProvidersManageScope);
  let trailing: ReactNode;
  switch (status.kind) {
    case "loading":
      trailing = <Spinner size="md" tone="muted" />;
      break;
    case "success":
      trailing = <CheckIcon aria-hidden="true" className="size-4 text-success" />;
      break;
    case "failed":
    case "unchanged":
      trailing = (
        <Button size="xs" variant="outline" disabled={!canManageProviders} onClick={onUpdate}>
          Retry
        </Button>
      );
      break;
    default:
      trailing = (
        <Button size="xs" variant="outline" disabled={!canManageProviders} onClick={onUpdate}>
          Update
        </Button>
      );
      break;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{group.label}</span>
        <span className={cn("truncate text-xs", rowToneClass(status.kind))}>{status.text}</span>
        {!canManageProviders ? (
          <span className="text-xs text-muted-foreground">
            This connection cannot manage provider accounts.
          </span>
        ) : null}
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

export function ProviderUpdateMachineRows({
  onInteract,
}: {
  readonly onInteract?: () => void;
}) {
  const { groups } = useLocalMachineUpdateGroups();
  const updateProvider = useAtomCommand(serverMachine.updateProvider, {
    reportFailure: false,
  });
  const groupByMachine = new Map(groups.map((group) => [group.machineId, group] as const));

  const [visibleAfterIso] = useState(() => new Date().toISOString());

  // setPendingMachines is an async state update, and PENDING_EXPIRY_MS can
  // clear the spinner while a request is still in flight, so a rapid
  // double-click (or a click after the expiry fires mid- request) would
  // otherwise dispatch a second full round of updates. A ref updates
  // synchronously, so we can bail before doing any work.
  const inFlightMachinesRef = useRef<Set<MachineId>>(new Set());

  // Bumped on each dispatch and captured locally, so an attempt that was
  // superseded -- e.g. one that already tripped the expiry safety net and was
  // retried -- detects it is no longer current and skips every state write when
  // it finally resolves, instead of clobbering the newer attempt's
  // spinner/result/error or its in-flight guard.
  const requestVersionRef = useRef<Map<MachineId, number>>(new Map());

  const [pendingMachines, setPendingMachines] = useState<ReadonlySet<MachineId>>(
    () => new Set(),
  );
  const [errorByMachine, setErrorByMachine] = useState<ReadonlyMap<MachineId, string>>(
    () => new Map(),
  );
  const [resultByMachine, setResultByMachine] = useState<
    ReadonlyMap<MachineId, ProviderUpdateToastView>
  >(() => new Map());

  const clearPending = (machineId: MachineId) => {
    setPendingMachines((previous) => {
      if (!previous.has(machineId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(machineId);
      return next;
    });
  };

  const handleUpdate = async (machineId: MachineId) => {
    if (!readMachineScope(machineId, AuthProvidersManageScope)) return;
    const group = groupByMachine.get(machineId);
    if (!group || group.candidates.length === 0) {
      return;
    }
    if (inFlightMachinesRef.current.has(machineId)) {
      return;
    }
    inFlightMachinesRef.current.add(machineId);
    const requestVersion = (requestVersionRef.current.get(machineId) ?? 0) + 1;
    requestVersionRef.current.set(machineId, requestVersion);
    const isCurrentRequest = () => requestVersionRef.current.get(machineId) === requestVersion;
    onInteract?.();
    const providerCount = group.candidates.length;
    const targets = group.candidates.map((candidate) => ({
      driver: candidate.driver,
      instanceId: candidate.instanceId,
    }));

    setPendingMachines((previous) => new Set(previous).add(machineId));
    setErrorByMachine((previous) => {
      if (!previous.has(machineId)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(machineId);
      return next;
    });
    setResultByMachine((previous) => {
      if (!previous.has(machineId)) {
        return previous;
      }
      const next = new Map(previous);
      next.delete(machineId);
      return next;
    });

    const expiry = setTimeout(() => {
      if (!isCurrentRequest()) {
        return;
      }
      inFlightMachinesRef.current.delete(machineId);
      clearPending(machineId);
      setErrorByMachine((previous) =>
        new Map(previous).set(machineId, "Update timed out — try again."),
      );
    }, PENDING_EXPIRY_MS);
    const settled = await settlePromise(async () => {
      const results = await Promise.all(
        targets.map(async (target): Promise<PromiseSettledResult<LocalProviderUpdateOutcome>> => {
          try {
            const result = await updateProvider({
              machineId,
              input: { provider: target.driver, instanceId: target.instanceId },
            });
            return toProviderUpdateOutcome({
              machineId,
              isPrimary: group.isPrimary,
              target,
              result,
            });
          } catch (error) {
            return {
              status: "rejected",
              reason: error instanceof Error ? error : new Error("Provider update failed."),
            };
          }
        }),
      );
      if (!isCurrentRequest()) {
        return;
      }
      setErrorByMachine((previous) => {
        if (!previous.has(machineId)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(machineId);
        return next;
      });
      if (results.length === 0) {
        setErrorByMachine((previous) =>
          new Map(previous).set(
            machineId,
            "This machine isn’t connected — try again once it reconnects.",
          ),
        );
        return;
      }
      const rejectedMessage = firstRejectedProviderUpdateMessage(results);
      if (rejectedMessage) {
        setErrorByMachine((previous) => new Map(previous).set(machineId, rejectedMessage));
        return;
      }
      const view = getProviderUpdateProgressToastView({
        providers: collectProviderUpdateOutcomeSnapshots(results),
        providerCount,
      });
      // A stored view never re-polls, so persisting it would pin the row's
      // spinner forever once the pending flag expires. Drop it and let the
      // live per-machine provider state (pill) plus the pending expiry
      // drive the row, so it self-heals to whatever the backend actually did.
      if (isTerminalProviderUpdatePhase(view.phase)) {
        setResultByMachine((previous) => new Map(previous).set(machineId, view));
      }
    });
    clearTimeout(expiry);
    if (!isCurrentRequest()) return;
    if (settled._tag === "Failure") {
      const error = squashAtomCommandFailure(settled);
      setErrorByMachine((previous) =>
        new Map(previous).set(
          machineId,
          error instanceof Error ? error.message : "Provider update failed.",
        ),
      );
    }
    clearPending(machineId);
    inFlightMachinesRef.current.delete(machineId);
  };

  const rows = groups
    .map((group) => ({
      group,
      status: resolveMachineUpdateRowStatus({
        group,
        error: errorByMachine.get(group.machineId),
        result: resultByMachine.get(group.machineId),
        pill: getProviderUpdateSidebarPillView(group.candidates, {
          visibleAfterIso,
        }),
        isPending: pendingMachines.has(group.machineId),
      }),
    }))
    .filter(({ group, status }) => group.candidates.length > 0 || status.kind !== "idle");

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 flex flex-col gap-1">
      {rows.map(({ group, status }) => (
        <MachineUpdateRow
          key={group.machineId}
          group={group}
          status={status}
          onUpdate={() => handleUpdate(group.machineId)}
        />
      ))}
    </div>
  );
}
