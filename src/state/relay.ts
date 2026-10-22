import { createRelayMachineDiscoveryAtoms } from "@vekrel/client-runtime/state/relay";

import { connectionAtomRuntime } from "../connection/runtime";

export const relayMachineDiscovery: ReturnType<typeof createRelayMachineDiscoveryAtoms> =
  createRelayMachineDiscoveryAtoms(connectionAtomRuntime);
