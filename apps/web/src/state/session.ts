import { useAtomValue } from "@effect/atom-react";
import { createMachineSessionAtoms } from "@vekrel/client-runtime/state/session";
import {
  type AuthMachineScope,
  type AuthSessionState,
  type MachineId,
  sessionGrantsScope,
} from "@vekrel/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machineAtomList, machineIdsKey } from "./machineAtomList";

export const machineSession = createMachineSessionAtoms(connectionAtomRuntime);
export const machineSessionStatesAtom = machineAtomList(
  "web-machine-session-states",
  machineSession.sessionStateAtom,
);

const EMPTY_SESSION_STATE_ATOM = Atom.make(AsyncResult.initial<AuthSessionState>());

export function useMachineScope(
  machineId: MachineId | null,
  scope: AuthMachineScope,
): boolean {
  const result = useAtomValue(
    machineId === null
      ? EMPTY_SESSION_STATE_ATOM
      : machineSession.sessionStateAtom(machineId),
  );
  return sessionHasScope(result, scope);
}

function sessionHasScope(
  result: AsyncResult.AsyncResult<AuthSessionState, unknown>,
  scope: AuthMachineScope,
): boolean {
  const session = Option.getOrNull(AsyncResult.value(result));
  return result._tag !== "Failure" && session !== null && sessionGrantsScope(session, scope);
}

// Keyed by scope and ids so callers get one Set per session change, not one per render.
const machinesWithScopeAtom = Atom.family((key: string) => {
  const [scope, idsKey = ""] = key.split(/\n(.*)/s) as [AuthMachineScope, string?];
  const ids = idsKey === "" ? [] : (idsKey.split("\n") as MachineId[]);
  const statesAtom = machineSessionStatesAtom(idsKey);
  return Atom.make((get) => {
    const states = get(statesAtom);
    return new Set(ids.filter((_, index) => sessionHasScope(states[index]!, scope)));
  }).pipe(Atom.withLabel(`web-machines-with-scope:${key}`));
});

export function useMachinesWithScope(
  machines: ReadonlyArray<{ readonly machineId: MachineId }>,
  scope: AuthMachineScope,
): ReadonlySet<MachineId> {
  return useAtomValue(
    machinesWithScopeAtom(
      `${scope}\n${machineIdsKey(machines.map(({ machineId }) => machineId))}`,
    ),
  );
}

export function readMachineScope(
  machineId: MachineId,
  scope: AuthMachineScope,
): boolean {
  return sessionHasScope(
    appAtomRegistry.get(machineSession.sessionStateAtom(machineId)),
    scope,
  );
}

const EMPTY_PREPARED_CONNECTION_ATOM = Atom.make(Option.none()).pipe(
  Atom.withLabel("web-prepared-connection:empty"),
);

export function usePreparedConnection(machineId: MachineId | null) {
  return useAtomValue(
    machineId === null
      ? EMPTY_PREPARED_CONNECTION_ATOM
      : machineSession.preparedConnectionValueAtom(machineId),
  );
}

export function readPreparedConnection(machineId: MachineId) {
  return Option.getOrNull(
    appAtomRegistry.get(machineSession.preparedConnectionValueAtom(machineId)),
  );
}

/**
 * `data` stays populated across SWR revalidations; `isPending` is only
 * meaningful before the first resolve.
 */
export function useMachineSessionState(machineId: MachineId) {
  const result = useAtomValue(machineSession.sessionStateAtom(machineId));
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    hasError: result._tag === "Failure",
    isPending: result.waiting,
  };
}
