import {
  createVcsActionManager,
  createVcsMachineAtoms,
} from "@vekrel/client-runtime/state/vcs";

import { connectionAtomRuntime } from "../connection/runtime";

export const vcsMachine = createVcsMachineAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
