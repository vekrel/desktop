import { createMachineCatalogAtoms } from "@vekrel/client-runtime/state/connections";

import { connectionAtomRuntime } from "./runtime";

export const machineCatalog = createMachineCatalogAtoms(connectionAtomRuntime);
