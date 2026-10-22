import type { MachineId } from "@vekrel/contracts";
import { Atom } from "effect/reactivity";

export const machineIdsKey = (machineIds: ReadonlyArray<MachineId>) =>
  machineIds.join("\n");

/**
 * Reads one per-machine atom for a list of machines. The list is keyed by its ids, so
 * renders that rebuild an equal list read the same atom instead of a new one whose fresh
 * snapshot would schedule another render.
 */
export function machineAtomList<A>(
  label: string,
  atom: (machineId: MachineId) => Atom.Atom<A>,
) {
  return Atom.family((key: string) =>
    Atom.make((get) =>
      key === "" ? [] : (key.split("\n") as MachineId[]).map((id) => get(atom(id))),
    ).pipe(Atom.withLabel(`${label}:${key}`)),
  );
}
