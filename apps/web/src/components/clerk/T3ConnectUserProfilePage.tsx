import { findErrorTraceId } from "@vekrel/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import type { MachineId } from "@vekrel/contracts";
import type { RelayClientMachineRecord } from "@vekrel/contracts/relay";
import { ServerIcon } from "lucide-react";
import { useRef, useState } from "react";

import {
  deregisterManagedRelayMachineCommand,
  useManagedRelayMachines,
} from "../../cloud/managedRelayState";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toastManager } from "../ui/toast";
import {
  ClerkUserProfilePage,
  ClerkUserProfileRefreshButton,
  ClerkUserProfileRow,
} from "./ClerkUserProfilePage";

const linkedAtFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function linkedAtLabel(value: string): string {
  const linkedAt = new Date(value);
  return Number.isNaN(linkedAt.getTime())
    ? "Link date unavailable"
    : `Linked ${linkedAtFormatter.format(linkedAt)}`;
}

function endpointLabel(machine: RelayClientMachineRecord): string {
  return machine.endpoint.providerKind === "cloudflare_tunnel"
    ? "Managed tunnel"
    : "Activity publishing only";
}

function T3ConnectMachineRow(props: {
  readonly machine: RelayClientMachineRecord;
  readonly confirmationOpen: boolean;
  readonly mutationPending: boolean;
  readonly onConfirmationChange: (open: boolean) => void;
  readonly onDeregister: (machine: RelayClientMachineRecord) => void;
}) {
  const { machine } = props;
  return (
    <ClerkUserProfileRow icon={<ServerIcon className="size-4" />}>
      <Collapsible open={props.confirmationOpen} onOpenChange={props.onConfirmationChange}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm leading-4.5 font-medium text-foreground">
              {machine.label}
            </h3>
            <p className="mt-1 text-xs leading-4.5 text-muted-foreground">
              {linkedAtLabel(machine.linkedAt)} · {endpointLabel(machine)}
            </p>
          </div>
          <CollapsibleTrigger
            render={
              <Button size="sm" variant="destructive-outline" disabled={props.mutationPending}>
                Deregister
              </Button>
            }
          />
        </div>

        <CollapsiblePanel>
          <div className="pt-3">
            <div
              className="rounded-lg border border-input bg-muted/32 px-5 py-4 shadow-xs/5"
              role="group"
              aria-label={`Confirm deregistration of ${machine.label}`}
            >
              <h4 className="text-sm leading-4.5 font-semibold text-foreground">
                Deregister server
              </h4>
              <p className="mt-1 text-xs leading-4.5 text-muted-foreground">
                “{machine.label}” will be removed from this account.
              </p>
              <p className="mt-4 max-w-xl text-xs leading-4.5 text-muted-foreground">
                Vekrel Connect access will be revoked, any managed tunnel will be removed, and a host
                space will become available. Local connections on your devices are not changed.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.mutationPending}
                  onClick={() => props.onConfirmationChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={props.mutationPending}
                  onClick={() => props.onDeregister(machine)}
                >
                  {props.mutationPending ? "Deregistering…" : "Deregister"}
                </Button>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </ClerkUserProfileRow>
  );
}

export function T3ConnectUserProfilePage() {
  const machinesState = useManagedRelayMachines();
  const deregisterMachine = useAtomCommand(deregisterManagedRelayMachineCommand, {
    reportFailure: false,
  });
  const [deregisteringMachineId, setDeregisteringMachineId] =
    useState<MachineId | null>(null);
  const [confirmingMachineId, setConfirmingMachineId] = useState<MachineId | null>(
    null,
  );
  const mutationPendingRef = useRef(false);
  const [removedMachines, setRemovedMachines] = useState<{
    readonly accountId: string | null;
    readonly linkedAtById: ReadonlyMap<MachineId, string>;
  }>({ accountId: null, linkedAtById: new Map() });

  const handleDeregister = async (machine: RelayClientMachineRecord) => {
    const accountId = machinesState.accountId;
    if (!accountId || mutationPendingRef.current) return;

    mutationPendingRef.current = true;
    setDeregisteringMachineId(machine.machineId);
    const result = await deregisterMachine({
      accountId,
      machineId: machine.machineId,
    });
    mutationPendingRef.current = false;
    setDeregisteringMachineId(null);

    if (result._tag === "Success") {
      setConfirmingMachineId(null);
      setRemovedMachines((current) => {
        const linkedAtById = new Map(current.accountId === accountId ? current.linkedAtById : []);
        linkedAtById.set(machine.machineId, machine.linkedAt);
        return { accountId, linkedAtById };
      });
      machinesState.refresh();
      toastManager.add({
        type: "success",
        title: "Server deregistered",
        description: "Vekrel Connect access was revoked and a host space is now available.",
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;

    const cause = squashAtomCommandFailure(result);
    const message = cause instanceof Error ? cause.message : "Could not deregister the server.";
    const traceId = findErrorTraceId(cause);
    console.error("[t3-connect] Could not deregister machine", {
      machineId: machine.machineId,
      message,
      traceId,
      cause,
    });
    toastManager.add({
      type: "error",
      title: "Could not deregister server",
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
  };

  const removedMachineLinkedAt =
    removedMachines.accountId === machinesState.accountId
      ? removedMachines.linkedAtById
      : new Map<MachineId, string>();
  const machines = (machinesState.data ?? []).filter(
    (machine) =>
      removedMachineLinkedAt.get(machine.machineId) !== machine.linkedAt,
  );
  const isInitialLoad =
    !machinesState.accountId || (machinesState.data === null && !machinesState.error);

  return (
    <ClerkUserProfilePage
      title="Vekrel Connect"
      description="Machines registered to your account. Connections on this device are managed in Settings."
      action={
        <ClerkUserProfileRefreshButton
          disabled={deregisteringMachineId !== null}
          isPending={machinesState.isPending}
          onClick={machinesState.refresh}
        />
      }
    >
      <div>
        {machinesState.error ? (
          <div className="mb-4 border-t border-destructive/35 py-3 text-xs" role="alert">
            <p className="font-medium text-destructive-foreground">
              Could not load Vekrel Connect machines
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{machinesState.error}</p>
          </div>
        ) : null}

        {isInitialLoad ? (
          <p className="border-t py-4 text-xs text-muted-foreground" role="status">
            Loading machines…
          </p>
        ) : machines.length > 0 ? (
          <ul className="border-t">
            {machines.map((machine) => (
              <T3ConnectMachineRow
                key={machine.machineId}
                machine={machine}
                confirmationOpen={confirmingMachineId === machine.machineId}
                mutationPending={deregisteringMachineId !== null}
                onConfirmationChange={(open) =>
                  setConfirmingMachineId(open ? machine.machineId : null)
                }
                onDeregister={(selected) => void handleDeregister(selected)}
              />
            ))}
          </ul>
        ) : machinesState.error ? null : (
          <div className="border-t">
            <Empty size="compact">
              <EmptyMedia variant="icon">
                <ServerIcon />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No Vekrel Connect machines</EmptyTitle>
                <EmptyDescription>
                  Link a machine from its local Settings to make it available through T3
                  Connect.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
    </ClerkUserProfilePage>
  );
}
