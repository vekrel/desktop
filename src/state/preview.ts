import { createPreviewMachineAtoms } from "@vekrel/client-runtime/state/preview";

import { connectionAtomRuntime } from "../connection/runtime";

export const previewMachine = createPreviewMachineAtoms(connectionAtomRuntime);
