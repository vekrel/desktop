import { type ConnectionCatalogEntry, hasRelayRoute } from "@vekrel/client-runtime/connection";
import type { MachineId } from "@vekrel/contracts";

interface OnboardingMachine {
  readonly machineId: MachineId;
  readonly connection: { readonly phase: string };
  readonly entry: Pick<ConnectionCatalogEntry, "target" | "alternateRoutes">;
}

export function isOnboardingRelayMachine(
  machine: Pick<OnboardingMachine, "entry">,
): boolean {
  return hasRelayRoute(machine.entry);
}

export function resolveOnboardingTargetMachine<TMachine extends OnboardingMachine>({
  mode,
  machines,
  primaryMachine,
  pairedMachineId,
}: {
  readonly mode: "local" | "connect" | "direct";
  readonly machines: ReadonlyArray<TMachine>;
  readonly primaryMachine: TMachine | null;
  readonly pairedMachineId: MachineId | null;
}): TMachine | null {
  if (mode === "direct" && pairedMachineId !== null) {
    const pairedMachine = machines.find(
      (machine) => machine.machineId === pairedMachineId,
    );
    return pairedMachine?.connection.phase === "connected" ? pairedMachine : null;
  }

  const connectedRelayMachines = machines.filter(
    (machine) =>
      machine.connection.phase === "connected" && isOnboardingRelayMachine(machine),
  );

  if (mode === "connect" && connectedRelayMachines.length > 0) {
    return connectedRelayMachines[connectedRelayMachines.length - 1] ?? null;
  }

  if (primaryMachine?.connection.phase === "connected") {
    return primaryMachine;
  }

  return mode === "local" ? null : (connectedRelayMachines[0] ?? null);
}

/**
 * Continue waits only on a first connection attempt, which settles on its own.
 * Selected computers that are switched off, offline, failing, or unsupported
 * are skipped so they can never lock the user out of onboarding.
 */
export function resolveOnboardingSetup(
  machines: ReadonlyArray<Pick<OnboardingMachine, "machineId" | "connection">>,
  selectedIds: ReadonlySet<MachineId>,
): {
  readonly ready: boolean;
  readonly machineIds: ReadonlyArray<MachineId>;
  readonly skippedIds: ReadonlyArray<MachineId>;
} {
  const selected = machines.filter((machine) => selectedIds.has(machine.machineId));
  const idsInPhase = (keep: (phase: string) => boolean) =>
    selected
      .filter((machine) => keep(machine.connection.phase))
      .map((machine) => machine.machineId);
  const machineIds = idsInPhase((phase) => phase === "connected");
  const settling = selected.some((machine) => machine.connection.phase === "connecting");
  return {
    ready: machineIds.length > 0 && !settling,
    machineIds,
    skippedIds: idsInPhase((phase) => phase !== "connected" && phase !== "connecting"),
  };
}
