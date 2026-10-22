import {
  createAssetMachineAtoms,
  createProjectFaviconUrlAtomFamily,
} from "@vekrel/client-runtime/state/assets";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { projectFaviconCache } from "../assets/projectFaviconCache";
import { isElectron } from "../env";
import { primaryMachineIdAtom } from "./primaryMachine";
import { machineProjectClonesAtom } from "./projectClones";
import { machineSession } from "./session";

const localMediaMachine = Atom.make((get) => {
  if (!isElectron) return null;
  const machineId = get(primaryMachineIdAtom);
  if (machineId === null) return null;
  const connection = get(machineSession.preparedConnectionValueAtom(machineId));
  const config = get(machineSession.initialConfigValueAtom(machineId));
  return connection._tag === "None" || config === null
    ? null
    : { machineId, httpBaseUrl: connection.value.httpBaseUrl };
});

export const assetMachine = createAssetMachineAtoms(
  connectionAtomRuntime,
  localMediaMachine,
);

export const projectFaviconUrlAtom = createProjectFaviconUrlAtomFamily({
  imageCache: projectFaviconCache,
  createUrl: assetMachine.createUrl,
  preparedConnection: machineSession.preparedConnectionValueAtom,
  projectClones: machineProjectClonesAtom,
});
