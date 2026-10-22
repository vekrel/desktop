import { useAtomValue } from "@effect/atom-react";
import type { MachinePresentation } from "@vekrel/client-runtime/connection";
import {
  createMachinePresentationAtoms,
  createMachineSummaryAtoms,
} from "@vekrel/client-runtime/state/presentation";
import type { MachineId } from "@vekrel/contracts";
import { Atom } from "effect/reactivity";

import { machineCatalog } from "../connection/catalog";
import { serverMachine } from "./server";

export const machinePresentations = createMachinePresentationAtoms({
  catalogValueAtom: machineCatalog.catalogValueAtom,
  stateAtom: machineCatalog.stateAtom,
  serverConfigValueAtom: serverMachine.configValueAtom,
});

export const machineSummaries = createMachineSummaryAtoms({
  catalogValueAtom: machineCatalog.catalogValueAtom,
  presentationAtom: machinePresentations.presentationAtom,
});

const EMPTY_MACHINE_PRESENTATION_ATOM = Atom.make<MachinePresentation | null>(null).pipe(
  Atom.withLabel("web-machine-presentation:empty"),
);

export function useMachinePresentation(machineId: MachineId | null) {
  const catalog = useAtomValue(machineCatalog.catalogValueAtom);
  const presentation = useAtomValue(
    machineId === null
      ? EMPTY_MACHINE_PRESENTATION_ATOM
      : machinePresentations.presentationAtom(machineId),
  );
  return {
    isReady: catalog.isReady,
    presentation,
  };
}
