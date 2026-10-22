import { createSourceControlMachineAtoms } from "@vekrel/client-runtime/state/source-control";

import { connectionAtomRuntime } from "../connection/runtime";

export const sourceControlMachine = createSourceControlMachineAtoms(connectionAtomRuntime);
