import { createGitMachineAtoms } from "@vekrel/client-runtime/state/git";

import { connectionAtomRuntime } from "../connection/runtime";

export const gitMachine = createGitMachineAtoms(connectionAtomRuntime);
