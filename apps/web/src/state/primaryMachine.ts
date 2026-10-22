import { Atom } from "effect/reactivity";

import { machineCatalog } from "../connection/catalog";

export const primaryMachineIdAtom = Atom.make((get) => {
  for (const [machineId, entry] of get(machineCatalog.catalogValueAtom).entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") {
      return machineId;
    }
  }
  return null;
}).pipe(Atom.withLabel("web-primary-machine-id"));
