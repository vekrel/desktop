import { useAtomValue } from "@effect/atom-react";
import { parseScopedProjectKey, scopedProjectKey } from "@vekrel/client-runtime/machine";
import type { MachineId, ProjectCloneSnapshot, ScopedProjectRef } from "@vekrel/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { machineServerConfigsAtom } from "./server";
import { sourceControlMachine } from "./sourceControl";

const EMPTY_CLONES: ReadonlyArray<ProjectCloneSnapshot> = [];
const EMPTY_CLONE_ATOM = Atom.make<ProjectCloneSnapshot | null>(null).pipe(
  Atom.withLabel("web-project-clone:empty"),
);

export const machineProjectClonesAtom = Atom.family((machineId: MachineId) =>
  Atom.make((get): ReadonlyArray<ProjectCloneSnapshot> => {
    const supported =
      get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
        .projectCloneTracking === true;
    if (!supported) return EMPTY_CLONES;
    const result = get(sourceControlMachine.projectClones({ machineId, input: {} }));
    return Option.getOrElse(AsyncResult.value(result), () => EMPTY_CLONES);
  }).pipe(Atom.withLabel(`web-project-clones:${machineId}`)),
);

const projectCloneAtom = Atom.family((key: string) => {
  const ref = parseScopedProjectKey(key);
  return Atom.make((get): ProjectCloneSnapshot | null => {
    if (ref === null) return null;
    const clones = get(machineProjectClonesAtom(ref.machineId));
    return clones.find((clone) => clone.projectId === ref.projectId) ?? null;
  }).pipe(Atom.withLabel(`web-project-clone:${key}`));
});

export function useProjectClone(ref: ScopedProjectRef | null): ProjectCloneSnapshot | null {
  return useAtomValue(ref === null ? EMPTY_CLONE_ATOM : projectCloneAtom(scopedProjectKey(ref)));
}

export function useMachineProjectClones(
  machineId: MachineId,
): ReadonlyArray<ProjectCloneSnapshot> {
  return useAtomValue(machineProjectClonesAtom(machineId));
}

const silencedCloneToasts = new Set<string>();

/**
 * Keeps a clone's progress out of toasts once the user is looking at its
 * project, whose composer shows the same progress. Failures still toast
 * whenever the project is not on screen.
 */
export function silenceProjectCloneToasts(ref: ScopedProjectRef) {
  silencedCloneToasts.add(scopedProjectKey(ref));
}

export function isProjectCloneToastSilenced(ref: ScopedProjectRef): boolean {
  return silencedCloneToasts.has(scopedProjectKey(ref));
}
