import { useAtomValue } from "@effect/atom-react";
import {
  connectionCatalogDisplayUrl,
  hasRelayRoute,
  type MachinePresentation as BaseMachinePresentation,
} from "@vekrel/client-runtime/connection";
import { Discovery } from "@vekrel/client-runtime/relay";
import type { MachineId } from "@vekrel/contracts";
import * as Option from "effect/Option";

import { machineCatalog } from "../connection/catalog";
import {
  machinePresentations,
  machineSummaries,
  useMachinePresentation,
} from "./presentation";
import { primaryMachineIdAtom } from "./primaryMachine";
import { relayMachineDiscovery } from "./relay";
import { usePreparedConnection } from "./session";

export interface MachinePresentation extends BaseMachinePresentation {
  readonly machineId: MachineId;
  readonly label: string;
  readonly displayUrl: string | null;
  readonly relayManaged: boolean;
}

function projectMachinePresentation(
  machineId: MachineId,
  presentation: BaseMachinePresentation,
): MachinePresentation {
  return {
    ...presentation,
    machineId,
    label: presentation.entry.target.label,
    displayUrl: connectionCatalogDisplayUrl(presentation.entry),
    relayManaged: hasRelayRoute(presentation.entry),
  };
}

export function useMachines() {
  const catalog = useAtomValue(machineCatalog.catalogValueAtom);
  const networkStatus = useAtomValue(machineCatalog.networkStatusValueAtom);
  const presentationById = useAtomValue(machinePresentations.presentationsAtom);

  const machines = [...presentationById.entries()].map(([machineId, presentation]) =>
    projectMachinePresentation(machineId, presentation),
  );

  return {
    isReady: catalog.isReady,
    networkStatus,
    machines,
    presentationById,
  };
}

/** Provider statuses change on every push, so they live apart from the presentations. */
export function useMachineProviders() {
  return useAtomValue(machinePresentations.providersByMachineAtom);
}

export function usePrimaryMachineId(): MachineId | null {
  return useAtomValue(primaryMachineIdAtom);
}

export function useMachine(
  machineId: MachineId | null,
): MachinePresentation | null {
  const { presentation } = useMachinePresentation(machineId);
  return machineId === null || presentation === null
    ? null
    : projectMachinePresentation(machineId, presentation);
}

export function usePrimaryMachine(): MachinePresentation | null {
  return useMachine(usePrimaryMachineId());
}

export function useMachineHttpBaseUrl(machineId: MachineId | null): string | null {
  const prepared = usePreparedConnection(machineId);
  return Option.isSome(prepared) ? prepared.value.httpBaseUrl : null;
}

export function useRelayMachineDiscovery(): Discovery.RelayMachineDiscoveryState {
  return useAtomValue(relayMachineDiscovery.stateValueAtom);
}

export function useMachineIds() {
  return useAtomValue(machineSummaries.machineIdsAtom);
}

export function useMachineIdentities() {
  return useAtomValue(machineSummaries.identitiesAtom);
}

export function usePullRequestsSupported() {
  return useAtomValue(machineSummaries.pullRequestsSupportedAtom);
}

export function useMachineKinds() {
  return useAtomValue(machineSummaries.machineByIdAtom);
}

export function useConnectedMachineIds() {
  return useAtomValue(machineSummaries.connectedMachineIdsAtom);
}
