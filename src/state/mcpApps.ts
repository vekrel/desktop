import { createMcpAppMachineAtoms } from "@vekrel/client-runtime/state/mcp-apps";

import { connectionAtomRuntime } from "../connection/runtime";

export const mcpAppMachine = createMcpAppMachineAtoms(connectionAtomRuntime);
