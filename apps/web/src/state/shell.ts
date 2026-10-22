import {
  AVAILABLE_CONNECTION_STATE,
  connectionProjectionPhase,
} from "@vekrel/client-runtime/connection";
import {
  createMachineShellAtoms,
  createMachineSnapshotAtom,
  createShellMachineAtoms,
  type MachineShellState,
  type MachineShellStatus,
} from "@vekrel/client-runtime/state/shell";
import {
  type MachineCatalogState,
  enabledMachineIds,
} from "@vekrel/client-runtime/state/connections";
import type { MachineId } from "@vekrel/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { machineCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { isHostedStaticApp } from "../hostedPairing";

export const shellMachine = createShellMachineAtoms(connectionAtomRuntime);
export const machineShell = createMachineShellAtoms(connectionAtomRuntime);
export const machineSnapshotAtom = createMachineSnapshotAtom(machineShell.stateAtom);

const NO_SHELL_STATUS_ATOM = Atom.make<MachineShellStatus | null>(null).pipe(
  Atom.withLabel("web-machine-shell-status:none"),
);
const NO_SHELL_SNAPSHOT_ATOM = Atom.make(false).pipe(
  Atom.withLabel("web-machine-shell-has-snapshot:none"),
);

export function useMachineShellStatus(
  machineId: MachineId | null,
): MachineShellStatus | null {
  return useAtomValue(
    machineId === null ? NO_SHELL_STATUS_ATOM : machineShell.statusAtom(machineId),
  );
}

export function useMachineShellHasSnapshot(machineId: MachineId | null): boolean {
  return useAtomValue(
    machineId === null
      ? NO_SHELL_SNAPSHOT_ATOM
      : machineShell.hasSnapshotAtom(machineId),
  );
}

export const allMachineShellsBootstrappedAtom = Atom.make((get) => {
  const catalog = AsyncResult.value(get(machineCatalog.catalogAtom));
  if (Option.isNone(catalog)) {
    return false;
  }
  for (const machineId of enabledMachineIds(catalog.value)) {
    if (Option.isSome(get(machineShell.stateValueAtom(machineId)).snapshot)) {
      continue;
    }
    const connection = Option.getOrElse(
      AsyncResult.value(get(machineCatalog.stateAtom(machineId))),
      () => AVAILABLE_CONNECTION_STATE,
    );
    if (connectionProjectionPhase(connection) !== "disconnected") {
      return false;
    }
    if (connection.phase === "backoff" && connection.desired && connection.attempt <= 2) {
      return false;
    }
  }
  return true;
}).pipe(Atom.withLabel("web-all-machine-shells-bootstrapped"));

/**
 * The persisted catalog can emit before platform discovery registers the primary machine.
 * Neither that gap nor an empty catalog proves a project is absent.
 */
function catalogIsComplete(
  catalog: MachineCatalogState,
  requiresPrimaryMachine: boolean,
): boolean {
  if (!catalog.isReady || catalog.entries.size === 0) return false;
  return (
    !requiresPrimaryMachine ||
    Array.from(catalog.entries.values()).some(
      (entry) => entry.target._tag === "PrimaryConnectionTarget",
    )
  );
}

export function createAllMachineProjectSnapshotsReadyAtom(input: {
  readonly catalogValueAtom: Atom.Atom<MachineCatalogState>;
  readonly shellStateValueAtom: (machineId: MachineId) => Atom.Atom<MachineShellState>;
  readonly requiresPrimaryMachine: boolean;
}) {
  return Atom.make((get) => {
    const catalog = get(input.catalogValueAtom);
    if (!catalogIsComplete(catalog, input.requiresPrimaryMachine)) return false;
    for (const machineId of enabledMachineIds(catalog)) {
      const shell = get(input.shellStateValueAtom(machineId));
      if (shell.status !== "live" || Option.isNone(shell.snapshot)) return false;
    }
    return true;
  }).pipe(Atom.withLabel("web-all-machine-project-snapshots-ready"));
}

export const allMachineProjectSnapshotsReadyAtom =
  createAllMachineProjectSnapshotsReadyAtom({
    catalogValueAtom: machineCatalog.catalogValueAtom,
    shellStateValueAtom: machineShell.stateValueAtom,
    requiresPrimaryMachine: !isHostedStaticApp(),
  });

export const allReachableShellsLiveAtom = Atom.make((get) => {
  const catalog = get(machineCatalog.catalogValueAtom);
  if (!catalogIsComplete(catalog, !isHostedStaticApp())) return false;
  for (const machineId of enabledMachineIds(catalog)) {
    const shell = get(machineShell.stateValueAtom(machineId));
    if (shell.status === "live" && Option.isSome(shell.snapshot)) continue;
    const state = AsyncResult.value(get(machineCatalog.stateAtom(machineId)));
    if (Option.isNone(state)) return false;
    const connection = state.value;
    const settledOffline =
      connection.phase === "offline" ||
      connection.phase === "blocked" ||
      (connection.phase === "backoff" && connection.attempt > 2);
    if (!settledOffline) return false;
  }
  return true;
}).pipe(Atom.withLabel("web-all-reachable-shells-live"));
