import { createTerminalMachineAtoms } from "@vekrel/client-runtime/state/terminal";

import { connectionAtomRuntime } from "../connection/runtime";

export const terminalMachine = createTerminalMachineAtoms(connectionAtomRuntime);
