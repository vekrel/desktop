import type * as DateTime from "effect/DateTime";
import { useAtomValue } from "@effect/atom-react";
import type {
  MachineProject,
  MachineThread,
  MachineThreadShell,
  MachineThreadStructure,
  ThreadStructureVisibleTurnItem,
} from "@vekrel/client-runtime/state/shell";
import {
  EMPTY_THREAD_HISTORY_META,
  type MachineThreadStatus,
  type ThreadHistoryMeta,
} from "@vekrel/client-runtime/state/threads";
import {
  arrayElementsEqual,
  parseThreadKey,
  threadKey,
} from "@vekrel/client-runtime/state/entities";
import type { ScopedProjectRef, ScopedThreadRef } from "@vekrel/contracts";
import type {
  MachineId,
  OrchestrationV2ProjectedTurnItem,
  OrchestrationV2ThreadProjection,
  OrchestrationV2ThreadShell,
  ThreadId,
} from "@vekrel/contracts";
import type { ThreadCheckpointSummary } from "@vekrel/client-runtime/state/thread-checkpoints";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machineProjects } from "./projects";
import { machinePresentations } from "./presentation";
import { machineServerConfigsAtom } from "./server";
import {
  allMachineProjectSnapshotsReadyAtom,
  allMachineShellsBootstrappedAtom,
} from "./shell";
import { machineThreadDetails, machineThreadShells } from "./threads";
import { waitForAtomValue } from "./waitForAtomValue";

const EMPTY_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_VISIBLE_TURN_ITEMS: ReadonlyArray<OrchestrationV2ProjectedTurnItem> = Object.freeze([]);

const EMPTY_PROJECT_ATOM = Atom.make<MachineProject | null>(null).pipe(
  Atom.withLabel("web-project:empty"),
);
const EMPTY_THREAD_REFS_ATOM = Atom.make(EMPTY_THREAD_REFS).pipe(
  Atom.withLabel("web-thread-refs:empty"),
);
const EMPTY_THREAD_SHELLS_ATOM = Atom.make<ReadonlyArray<MachineThreadShell>>(
  Object.freeze([]),
).pipe(Atom.withLabel("web-thread-shells:empty"));
const EMPTY_THREAD_SHELL_ATOM = Atom.make<MachineThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);
const EMPTY_THREAD_PROJECTION_ATOM = Atom.make<MachineThread | null>(null).pipe(
  Atom.withLabel("web-thread-projection:empty"),
);
const EMPTY_THREAD_STATUS_ATOM = Atom.make<MachineThreadStatus>("empty").pipe(
  Atom.withLabel("web-thread-status:empty"),
);
const EMPTY_VISIBLE_TURN_ITEMS_ATOM = Atom.make(EMPTY_VISIBLE_TURN_ITEMS).pipe(
  Atom.withLabel("web-thread-visible-turn-items:empty"),
);
const EMPTY_CHECKPOINT_SUMMARIES_ATOM = Atom.make<ReadonlyArray<ThreadCheckpointSummary>>(
  Object.freeze([]),
).pipe(Atom.withLabel("web-thread-checkpoint-summaries:empty"));
const EMPTY_LAST_VISITED_AT_ATOM = Atom.make<DateTime.Utc | null>(null).pipe(
  Atom.withLabel("web-thread-last-visited:empty"),
);
const EMPTY_UPDATED_AT_ATOM = Atom.make<DateTime.Utc | null>(null).pipe(
  Atom.withLabel("web-thread-updated-at:empty"),
);
const EMPTY_THREAD_HISTORY_ATOM = Atom.make<ThreadHistoryMeta>(EMPTY_THREAD_HISTORY_META).pipe(
  Atom.withLabel("web-thread-history:empty"),
);

const activeMachineIdAtom = Atom.make<MachineId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-active-machine-id"),
);

export function useActiveMachineId(): MachineId | null {
  return useAtomValue(activeMachineIdAtom);
}

export function setActiveMachineId(machineId: MachineId | null): void {
  appAtomRegistry.set(activeMachineIdAtom, machineId);
}

export function useThreadRefs(enabled = true): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(enabled ? machineThreadShells.threadRefsAtom : EMPTY_THREAD_REFS_ATOM);
}

export function useMachineThreadRefs(
  machineId: MachineId | null,
): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(
    machineId === null
      ? EMPTY_THREAD_REFS_ATOM
      : machineThreadShells.machineThreadRefsAtom(machineId),
  );
}

export function useProjects(): ReadonlyArray<MachineProject> {
  return useAtomValue(machineProjects.projectsAtom);
}

/** Providers are left out; read them with `useMachineProviders()`. */
export function useServerConfigs() {
  return useAtomValue(machinePresentations.serverConfigsAtom);
}

export function useThreadShells(enabled = true): ReadonlyArray<MachineThreadShell> {
  return useAtomValue(
    enabled ? machineThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS_ATOM,
  );
}

export function useAllMachineShellsBootstrapped(): boolean {
  return useAtomValue(allMachineShellsBootstrappedAtom);
}

export function useAllMachineProjectSnapshotsReady(): boolean {
  return useAtomValue(allMachineProjectSnapshotsReadyAtom);
}

export function useThreadShellsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<MachineThreadShell> {
  return useAtomValue(machineThreadShells.threadShellsForProjectRefsAtom(refs));
}

export function useProject(ref: ScopedProjectRef | null): MachineProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : machineProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): MachineThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : machineThreadShells.threadShellAtom(ref),
  );
}

/** The shell without its streaming timestamps; see quietThreadShellAtom. */
export function useQuietThreadShell(ref: ScopedThreadRef | null): MachineThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : machineThreadShells.quietThreadShellAtom(ref),
  );
}

/** Every thread shell, held through streaming ticks; see quietThreadShellAtom. */
export function useQuietThreadShells(): ReadonlyArray<MachineThreadShell> {
  return useAtomValue(machineThreadShells.quietThreadShellsAtom);
}

export function useChildThreadInputs(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELLS_ATOM : machineThreadShells.childThreadInputsAtom(ref),
  );
}

export function useThreadProjection(ref: ScopedThreadRef | null): MachineThread | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : machineThreadDetails.threadAtom(ref),
  );
}

/** The thread's structure, held through streamed assistant and reasoning text; see ThreadStructure. */
export function useQuietThreadProjection(
  ref: ScopedThreadRef | null,
): MachineThreadStructure | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : machineThreadDetails.quietThreadAtom(ref),
  );
}

/** The detail's live visit mark, which the thread structure leaves out. */
export function useThreadLastVisitedAt(ref: ScopedThreadRef | null): DateTime.Utc | null {
  return useAtomValue(
    ref === null ? EMPTY_LAST_VISITED_AT_ATOM : machineThreadDetails.lastVisitedAtAtom(ref),
  );
}

/** The detail's live `updatedAt`, which the thread structure leaves out. */
export function useThreadUpdatedAt(ref: ScopedThreadRef | null): DateTime.Utc | null {
  return useAtomValue(
    ref === null ? EMPTY_UPDATED_AT_ATOM : machineThreadDetails.updatedAtAtom(ref),
  );
}

export function useThreadStatus(ref: ScopedThreadRef | null): MachineThreadStatus {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_STATUS_ATOM : machineThreadDetails.statusAtom(ref),
  );
}

export function useThreadHistory(ref: ScopedThreadRef | null): ThreadHistoryMeta {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_HISTORY_ATOM : machineThreadDetails.historyAtom(ref),
  );
}

export function resolveThreadDetailRef(
  ref: ScopedThreadRef | null,
  options: {
    shellExists: boolean;
    waitForShell: boolean;
  },
): ScopedThreadRef | null {
  return ref !== null && (!options.waitForShell || options.shellExists) ? ref : null;
}

export function useThreadVisibleTurnItems(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem> {
  return useAtomValue(
    ref === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : machineThreadDetails.visibleTurnItemsAtom(ref),
  );
}

/** Visible turn items without their streamed text; see ThreadStructure. */
export function useQuietThreadVisibleTurnItems(
  ref: ScopedThreadRef | null,
): ReadonlyArray<ThreadStructureVisibleTurnItem> {
  return useAtomValue(
    ref === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : machineThreadDetails.quietVisibleTurnItemsAtom(ref),
  );
}

export function useThreadCheckpointSummaries(
  ref: ScopedThreadRef | null,
): ReadonlyArray<ThreadCheckpointSummary> {
  return useAtomValue(
    ref === null
      ? EMPTY_CHECKPOINT_SUMMARIES_ATOM
      : machineThreadDetails.checkpointSummariesAtom(ref),
  );
}

export function readProject(ref: ScopedProjectRef): MachineProject | null {
  return appAtomRegistry.get(machineProjects.projectAtom(ref));
}

export function readProjects(): ReadonlyArray<MachineProject> {
  return appAtomRegistry.get(machineProjects.projectsAtom);
}

export function waitForProject(
  ref: ScopedProjectRef,
  timeoutMs = 10_000,
): Promise<MachineProject> {
  const current = readProject(ref);
  if (current !== null) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The project did not appear in the desktop app."));
    }, timeoutMs);
    const finish = (project: MachineProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = appAtomRegistry.subscribe(machineProjects.projectAtom(ref), finish);
    finish(readProject(ref));
  });
}

/**
 * Resolves once a deleted project leaves the live client store. The delete
 * command returns before the shell stream does, so anything that picks a
 * project in between (the index route's draft landing) still sees it.
 */
export function waitForProjectRemoval(ref: ScopedProjectRef, timeoutMs = 5_000): Promise<boolean> {
  return waitForAtomValue({
    registry: appAtomRegistry,
    atom: machineProjects.projectAtom(ref),
    predicate: (project) => project === null,
    timeoutMs,
  });
}

export function readThreadShell(ref: ScopedThreadRef): MachineThreadShell | null {
  return appAtomRegistry.get(machineThreadShells.threadShellAtom(ref));
}

export function waitForThreadShell(ref: ScopedThreadRef, timeoutMs = 5_000): Promise<boolean> {
  return waitForAtomValue({
    registry: appAtomRegistry,
    atom: machineThreadShells.threadShellAtom(ref),
    predicate: (thread) => thread !== null,
    timeoutMs,
  });
}

export function useMachineSupportsServerBrowser(machineId: MachineId | null): boolean {
  const configs = useServerConfigs();
  return (
    machineId !== null &&
    configs.get(machineId)?.machine.capabilities.serverBrowser === true
  );
}

export function readMachineSupportsServerBrowser(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .serverBrowser === true
  );
}

export function readMachineSupportsTitleRegeneration(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadTitleRegeneration === true
  );
}

export function readMachineSupportsPinning(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadPinning === true
  );
}

export function readMachineSupportsPinReorder(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadPinReorder === true
  );
}

export function readMachineSupportsAutoSettleOptOut(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadAutoSettleOptOut === true
  );
}

export function readMachineSupportsActiveReorder(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadActiveReorder === true
  );
}

export function readMachineSupportsSettlement(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadSettlement === true
  );
}

export function readMachineSupportsSnooze(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadSnooze === true
  );
}

export function readMachineSupportsVisitedTracking(machineId: MachineId): boolean {
  return (
    appAtomRegistry.get(machineServerConfigsAtom).get(machineId)?.machine.capabilities
      .threadVisitedTracking === true
  );
}

export function readMachineThreadRefs(
  machineId: MachineId,
): ReadonlyArray<ScopedThreadRef> {
  return appAtomRegistry.get(machineThreadShells.machineThreadRefsAtom(machineId));
}

export function readThreadShells(): ReadonlyArray<MachineThreadShell> {
  return appAtomRegistry.get(machineThreadShells.threadShellsAtom);
}

function shellParentThreadId(
  thread: Pick<OrchestrationV2ThreadShell, "forkedFrom" | "lineage">,
): ThreadId | null {
  return thread.forkedFrom?.type === "run"
    ? thread.forkedFrom.threadId
    : thread.lineage.parentThreadId;
}

/**
 * The live shells the panel's immediate relationships can reach: the thread,
 * its parent, its children, and the threads its subagents, workflow members and
 * context transfers name. Keeps its array while those shells are unchanged, so
 * another thread streaming in the same machine does not re-render the panel.
 */
/** Exported for tests. */
export function selectThreadRelationshipShells(
  threadId: ThreadId,
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "thread" | "subagents" | "contextTransfers"
  > | null,
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  const named = new Set<string>([threadId]);
  if (projection !== null) {
    const parentThreadId = shellParentThreadId(projection.thread);
    if (parentThreadId !== null) named.add(parentThreadId);
    for (const subagent of projection.subagents) {
      if (subagent.childThreadId !== null) named.add(subagent.childThreadId);
      for (const agent of subagent.workflow?.agents ?? []) {
        if (agent.childThreadId !== undefined) named.add(agent.childThreadId);
      }
    }
    for (const transfer of projection.contextTransfers) {
      named.add(transfer.sourceThreadId);
      named.add(transfer.targetThreadId);
    }
  }
  const current = threads.find((thread) => thread.id === threadId);
  const currentParentId = current === undefined ? null : shellParentThreadId(current);
  if (currentParentId !== null) named.add(currentParentId);
  return threads.filter(
    (thread) => named.has(thread.id) || shellParentThreadId(thread) === threadId,
  );
}

const relationshipShellsAtomFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  let previous: ReadonlyArray<OrchestrationV2ThreadShell> = [];
  return Atom.make((get) => {
    const next = selectThreadRelationshipShells(
      ref.threadId,
      get(machineThreadDetails.threadAtom(ref))?.projection ?? null,
      get(machineThreadShells.machineThreadsAtom(ref.machineId)),
    );
    if (arrayElementsEqual(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`web-thread-relationship-shells:${key}`));
});

export function useThreadRelationshipShells(
  ref: ScopedThreadRef,
): ReadonlyArray<OrchestrationV2ThreadShell> {
  return useAtomValue(relationshipShellsAtomFamily(threadKey(ref)));
}
