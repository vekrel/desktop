import { useAtomValue } from "@effect/atom-react";
import { enabledMachineIds } from "@vekrel/client-runtime/state/connections";
import { arrayElementsEqual } from "@vekrel/client-runtime/state/entities";
import {
  createMachineThreadDetailAtoms,
  createMachineThreadShellAtoms,
  createMachineThreadStateAtoms,
  EMPTY_MACHINE_THREAD_STATE,
  type MachineThreadState,
  createThreadMachineAtoms,
} from "@vekrel/client-runtime/state/threads";
import type { MachineId, OrchestrationV2ThreadShell, ThreadId } from "@vekrel/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { machineCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { machineSnapshotAtom } from "./shell";

export const threadMachine = createThreadMachineAtoms(
  connectionAtomRuntime,
  machineSnapshotAtom,
);
const machineThreads = createMachineThreadStateAtoms(connectionAtomRuntime);
export const machineThreadDetails = createMachineThreadDetailAtoms(
  machineThreads.stateAtom,
);
export const machineThreadShells = createMachineThreadShellAtoms({
  catalogValueAtom: machineCatalog.catalogValueAtom,
  snapshotAtom: threadMachine.snapshotAtom,
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_MACHINE_THREAD_STATE)).pipe(
  Atom.withLabel("web-machine-thread:empty"),
);

export function useMachineThread(
  machineId: MachineId | null,
  threadId: ThreadId | null,
): MachineThreadState {
  const result = useAtomValue(
    machineId !== null && threadId !== null
      ? machineThreads.stateAtom(machineId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  const state = Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_MACHINE_THREAD_STATE,
  ) as MachineThreadState;
  return state;
}

const isRunning = (status: string) =>
  status === "preparing" || status === "queued" || status === "starting" || status === "running";

type KeptThreads = ReadonlyMap<MachineId, ReadonlySet<ThreadId>>;

function isDetailDone<E>(result: AsyncResult.AsyncResult<MachineThreadState, E>): boolean {
  if (!AsyncResult.isSuccess(result)) return true;
  const { status, data, error } = result.value;
  if (status === "deleted" || Option.isSome(error)) return true;
  return (
    status === "live" &&
    !Option.exists(data, (thread) => thread.runs.some((run) => isRunning(run.status)))
  );
}

/**
 * The shell and detail streams are independent, so the shell can report a stop
 * before the detail loads or catches up. A stopped thread stays mounted until
 * its own detail is live and shows the stop too.
 */
export function createRunningThreadKeepAliveAtom<E>(input: {
  readonly machineIdsAtom: Atom.Atom<ReadonlyArray<MachineId>>;
  readonly threadsAtom: (
    machineId: MachineId,
  ) => Atom.Atom<ReadonlyArray<Pick<OrchestrationV2ThreadShell, "id" | "status">>>;
  readonly stateAtom: (
    machineId: MachineId,
    threadId: ThreadId,
  ) => Atom.Atom<AsyncResult.AsyncResult<MachineThreadState, E>>;
}) {
  const runningThreadIdsAtom = Atom.family((machineId: MachineId) => {
    let previous: ReadonlyArray<ThreadId> = [];
    return Atom.make((get) => {
      const running = get(input.threadsAtom(machineId)).flatMap((thread) =>
        isRunning(thread.status) ? [thread.id] : [],
      );
      if (arrayElementsEqual(previous, running)) return previous;
      previous = running;
      return running;
    }).pipe(Atom.withLabel(`web-running-thread-ids:${machineId}`));
  });

  return Atom.make((get): KeptThreads => {
    const previous = Option.getOrUndefined(get.self<KeptThreads>());
    const kept = new Map<MachineId, ReadonlySet<ThreadId>>();
    for (const machineId of get(input.machineIdsAtom)) {
      const threadIds = new Set(get(runningThreadIdsAtom(machineId)));
      for (const threadId of previous?.get(machineId) ?? []) {
        if (threadIds.has(threadId)) continue;
        const stateAtom = input.stateAtom(machineId, threadId);
        // `once`, not `get`: a dependency on a stopped thread would hold its
        // stream open until some other change rebuilds this atom.
        if (isDetailDone(get.once(stateAtom))) continue;
        threadIds.add(threadId);
        get.subscribe(stateAtom, (state) => {
          if (isDetailDone(state)) get.refreshSelf();
        });
      }
      for (const threadId of threadIds) get.mount(input.stateAtom(machineId, threadId));
      kept.set(machineId, threadIds);
    }
    return kept;
  }).pipe(Atom.withLabel("web-running-thread-keep-alive"));
}

export const runningThreadKeepAliveAtom = createRunningThreadKeepAliveAtom({
  machineIdsAtom: Atom.map(machineCatalog.catalogValueAtom, (catalog) => [
    ...enabledMachineIds(catalog),
  ]),
  threadsAtom: machineThreadShells.machineThreadsAtom,
  stateAtom: machineThreads.stateAtom,
});
