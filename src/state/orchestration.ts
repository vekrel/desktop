import { createOrchestrationMachineAtoms } from "@vekrel/client-runtime/state/orchestration";

import { connectionAtomRuntime } from "../connection/runtime";

export const orchestrationMachine = createOrchestrationMachineAtoms(connectionAtomRuntime);
