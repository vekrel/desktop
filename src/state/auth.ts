import { createAuthMachineAtoms } from "@vekrel/client-runtime/state/auth";

import { connectionAtomRuntime } from "../connection/runtime";

export const authMachine = createAuthMachineAtoms(connectionAtomRuntime);
