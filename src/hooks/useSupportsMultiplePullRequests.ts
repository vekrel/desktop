import type { MachineId } from "@vekrel/contracts";
import { useServerConfigs } from "~/state/entities";

export function useSupportsMultiplePullRequests(machineId: MachineId | null): boolean {
  const configs = useServerConfigs();
  return (
    machineId !== null &&
    configs.get(machineId)?.machine.capabilities.threadPullRequests === true
  );
}
