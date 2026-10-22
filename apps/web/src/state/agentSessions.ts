import { WS_METHODS } from "@vekrel/contracts";
import {
  createMachineRpcCommand,
  createMachineRpcQueryAtomFamily,
} from "@vekrel/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const agentSessionScan = createMachineRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "machine-data:agent-sessions:scan",
  tag: WS_METHODS.agentSessionsScan,
  staleTimeMs: 30_000,
  idleTtlMs: 5 * 60_000,
});

export const agentSessionImport = createMachineRpcCommand(connectionAtomRuntime, {
  label: "machine-data:agent-sessions:import",
  tag: WS_METHODS.agentSessionsImport,
});
