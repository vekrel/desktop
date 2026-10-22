import { createReviewMachineAtoms } from "@vekrel/client-runtime/state/review";

import { connectionAtomRuntime } from "../connection/runtime";

export const reviewMachine = createReviewMachineAtoms(connectionAtomRuntime);
