import { createMachineProjectAtoms } from "@vekrel/client-runtime/state/projects";
import { createProjectMachineAtoms } from "@vekrel/client-runtime/state/projects";
import { createMachineRpcQueryAtomFamily } from "@vekrel/client-runtime/state/runtime";
import { WS_METHODS } from "@vekrel/contracts";

import { machineCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { machineSnapshotAtom } from "./shell";
import { serverMachine } from "./server";

export const machineProjects = createMachineProjectAtoms({
  catalogValueAtom: machineCatalog.catalogValueAtom,
  snapshotAtom: machineSnapshotAtom,
  serverConfigValueAtom: serverMachine.configValueAtom,
});
export const projectMachine = createProjectMachineAtoms(connectionAtomRuntime, {
  projectAtom: machineProjects.projectAtom,
});
export const projectContentSearch = createMachineRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "machine-data:projects:search-contents",
  tag: WS_METHODS.projectsSearchContents,
  staleTimeMs: 5_000,
  idleTtlMs: 60_000,
});
