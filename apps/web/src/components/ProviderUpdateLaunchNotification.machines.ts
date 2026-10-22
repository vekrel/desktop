import type { ConnectionCatalogEntry } from "@vekrel/client-runtime/connection";

import {
  useMachineProviders,
  useMachines,
  usePrimaryMachineId,
} from "~/state/machines";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import {
  buildLocalMachineUpdateGroups,
  deriveMachineDisplayLabel,
  type MachineUpdateConnectionState,
  type LocalMachineProvidersInput,
  type LocalMachineUpdateGroup,
} from "./ProviderUpdateLaunchNotification.logic";

function isLocalConnectionTarget(target: ConnectionCatalogEntry["target"]): boolean {
  return target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target);
}

function normalizeConnectionState(phase: string | undefined): MachineUpdateConnectionState {
  switch (phase) {
    case "connected":
      return "ready";
    case "connecting":
    case "reconnecting":
      return "connecting";
    case "unsupported":
    case "error":
      return "error";
    case "offline":
      return "disconnected";
    default:
      return "connecting";
  }
}

export function useLocalMachineUpdateGroups(): {
  readonly groups: LocalMachineUpdateGroup[];
  readonly isAnySettling: boolean;
} {
  const { machines } = useMachines();
  const providersByMachine = useMachineProviders();
  const primaryMachineId = usePrimaryMachineId();

  const inputs: LocalMachineProvidersInput[] = [];

  for (const machine of machines) {
    if (!isLocalConnectionTarget(machine.entry.target)) {
      continue;
    }

    const isPrimary = machine.machineId === primaryMachineId;
    const serverConfig = machine.serverConfig;

    inputs.push({
      machineId: machine.machineId,
      label: isPrimary
        ? deriveMachineDisplayLabel({
            isWsl: false,
            wslDistro: null,
            platformOs: serverConfig?.machine.platform.os,
            fallbackLabel: machine.label,
          })
        : machine.label,
      isPrimary,
      connectionState: isPrimary ? "ready" : normalizeConnectionState(machine.connection.phase),
      providers: providersByMachine.get(machine.machineId) ?? [],
    });
  }

  inputs.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));

  return buildLocalMachineUpdateGroups(inputs);
}
