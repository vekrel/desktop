import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@vekrel/client-runtime/source-control-clients";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestMachineAtoms,
  createPullRequestStackAtomFamily,
} from "@vekrel/client-runtime/state/pull-requests";
import type {
  MachineId,
  ProjectId,
  PullRequestListInput,
  PullRequestListStatsInput,
  PullRequestListEntry,
  PullRequestRef,
  PullRequestSummary,
  ThreadPullRequestLink,
} from "@vekrel/contracts";
import {
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@vekrel/shared/threadPullRequests";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useLayoutEffect } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  mergePullRequestLists,
  type MachinePullRequestStat,
  type MergedPullRequestList,
} from "../components/pullRequest/pullRequestList.logic";
import { formatMachineQueryError } from "./query";
import { machineThreadShells } from "./threads";

export const pullRequestMachine = createPullRequestMachineAtoms(connectionAtomRuntime);
export const linkedPullRequestDetailAtom = createLinkedPullRequestSummaryAtomFamily(
  connectionAtomRuntime,
  pullRequestMachine.refreshes,
);

export interface ObservedPullRequestSummary {
  readonly summary: PullRequestSummary;
  /** Client arrival time, the only ordering older servers leave us for same-dated snapshots. */
  readonly observedAt: number;
}

const observedPullRequestSummaryAtom = Atom.family((key: string) =>
  Atom.make<ObservedPullRequestSummary | null>(null).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`web-pull-requests:observed-summary:${key}`),
  ),
);

function compareSummaries(current: PullRequestSummary, incoming: PullRequestSummary): number {
  const merged = Number(incoming.state === "merged") - Number(current.state === "merged");
  if (merged !== 0) return merged;
  const updated = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt);
  if (updated !== 0) return updated;
  if (current.observedAt === undefined && incoming.observedAt === undefined) return 0;
  return (incoming.observedAt ?? -Infinity) - (current.observedAt ?? -Infinity);
}

export function newestPullRequestSummary(
  current: PullRequestSummary | null,
  observed: PullRequestSummary | null,
): PullRequestSummary | null {
  if (current === null) return observed;
  if (observed === null) return current;
  return compareSummaries(current, observed) >= 0 ? observed : current;
}

export function pullRequestListEntryToSummary(entry: PullRequestListEntry): PullRequestSummary {
  return {
    provider: entry.provider,
    projectId: entry.projectId,
    repository: entry.repository,
    number: entry.number,
    title: entry.title,
    url: entry.url,
    state: entry.state,
    isDraft: entry.isDraft,
    headBranch: entry.headBranch,
    baseBranch: entry.baseBranch,
    updatedAt: entry.updatedAt,
    ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
    author: entry.author,
    ...(entry.reviewDecision === undefined ? {} : { reviewDecision: entry.reviewDecision }),
    ...(entry.checksState === undefined ? {} : { checksState: entry.checksState }),
    mergeability: entry.mergeability,
  };
}

// A project has one remote, so its id already pins the host. Leaving the host out lets a list
// row, a hostless legacy reference and a URL-derived thread reference share one entry.
function pullRequestSummaryKey(machineId: MachineId, reference: PullRequestRef): string {
  return JSON.stringify([
    machineId,
    reference.projectId,
    reference.repository.toLowerCase(),
    reference.number,
  ]);
}

export function newestPullRequestObservation(
  current: ObservedPullRequestSummary | null,
  incoming: ObservedPullRequestSummary | null,
): ObservedPullRequestSummary | null {
  if (current === null) return incoming;
  if (incoming === null) return current;
  let order = compareSummaries(current.summary, incoming.summary);
  if (
    order === 0 &&
    current.summary.observedAt === undefined &&
    incoming.summary.observedAt === undefined
  ) {
    order = incoming.observedAt - current.observedAt;
  }
  if (!(order > 0)) return current;
  // A sparse summary must not erase known status, or carry old detail stats into a new list read.
  return {
    ...incoming,
    summary: {
      ...incoming.summary,
      isDraft: incoming.summary.isDraft ?? current.summary.isDraft,
      mergeability: incoming.summary.mergeability ?? current.summary.mergeability,
      reviewDecision:
        incoming.summary.reviewDecision === undefined
          ? current.summary.reviewDecision
          : incoming.summary.reviewDecision,
      checksState:
        incoming.summary.checksState === undefined
          ? current.summary.checksState
          : incoming.summary.checksState,
    },
  };
}

function observePullRequestSummary(
  key: string,
  summary: PullRequestSummary,
  observedAt: number,
): void {
  const atom = observedPullRequestSummaryAtom(key);
  appAtomRegistry.modify(atom, (previous) => {
    const next = newestPullRequestObservation(previous, { summary, observedAt });
    return next === previous ? [false, previous] : [true, next];
  });
}

export function threadPullRequestLinkToSummary(
  link: ThreadPullRequestLink,
  projectId: ProjectId,
): PullRequestSummary | null {
  const updatedAt = link.snapshot?.updatedAt;
  if (link.snapshot === null || updatedAt == null) return null;
  return {
    ...link.snapshot,
    provider: (
      sourceControlClients.findByChangeRequestUrl(link.url) ?? sourceControlClients.get(undefined)
    ).kind,
    projectId,
    repository: link.repository,
    number: link.number,
    url: link.url,
    updatedAt,
  };
}

function savedPullRequestKey(
  machineId: MachineId,
  reference: Pick<PullRequestRef, "host" | "repository" | "number">,
): string {
  return reference.host === undefined
    ? ""
    : `${machineId}:${threadPullRequestKeyOf({ ...reference, host: reference.host })}`;
}

const savedPullRequestSummariesAtom = Atom.make((get) => {
  const summaries = new Map<string, PullRequestSummary>();
  for (const thread of get(machineThreadShells.threadShellsAtom)) {
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      const summary = threadPullRequestLinkToSummary(link, thread.projectId);
      if (summary === null) continue;
      const key = savedPullRequestKey(thread.machineId, link);
      summaries.set(key, newestPullRequestSummary(summaries.get(key) ?? null, summary) ?? summary);
    }
  }
  return summaries;
});

const savedPullRequestSummaryAtom = Atom.family((key: string) =>
  Atom.make((get) => get(savedPullRequestSummariesAtom).get(key) ?? null).pipe(
    Atom.withEquality((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
    Atom.setIdleTTL(5 * 60_000),
  ),
);

export function useSharedPullRequestSummary(
  machineId: MachineId | null,
  reference: PullRequestRef | null,
  current: PullRequestSummary | null,
  observedAt: number | null = null,
): PullRequestSummary | null {
  const key =
    machineId === null || reference === null
      ? "none"
      : pullRequestSummaryKey(machineId, reference);
  const atom = observedPullRequestSummaryAtom(key);
  const observed = useAtomValue(atom);
  const saved = useAtomValue(
    savedPullRequestSummaryAtom(
      machineId === null || reference === null
        ? ""
        : savedPullRequestKey(machineId, reference),
    ),
  );
  // Keyed structurally so a fresh reference object for the same pull request is a no-op.
  useLayoutEffect(() => {
    if (key === "none" || current === null || observedAt === null) return;
    observePullRequestSummary(key, current, observedAt);
  }, [current, key, observedAt]);
  const summary =
    newestPullRequestObservation(
      observed,
      current === null || observedAt === null ? null : { summary: current, observedAt },
    )?.summary ?? current;
  return newestPullRequestSummary(summary, saved);
}
export const pullRequestStackAtom = createPullRequestStackAtomFamily(
  connectionAtomRuntime,
  pullRequestMachine.refreshes,
);

export interface MachineQueryTarget<Input> {
  readonly machineId: MachineId;
  readonly input: Input;
}

interface MergedMachineQueryView<A> {
  readonly values: ReadonlyArray<readonly [MachineId, A]>;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly observations: ReadonlyArray<readonly [MachineId, A, number]>;
}

/**
 * React cannot subscribe to a list of atoms whose length changes, so the fan-out happens inside
 * one derived atom keyed by the targets — the same shape the cross-machine thread search uses.
 * A machine that fails contributes nothing rather than blanking the page: the pull request
 * list is a union, and one unreachable machine should not hide the others' rows.
 */
function createMergedMachineQuery<Input, A>(
  label: string,
  atomFor: (
    target: MachineQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedMachineQueryView<A> => {
      const targets = JSON.parse(key) as ReadonlyArray<MachineQueryTarget<Input>>;
      const values: Array<readonly [MachineId, A]> = [];
      const observations: Array<readonly [MachineId, A, number]> = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(atomFor(target));
        isPending ||= result.waiting;
        if (result._tag === "Failure" && error === null) {
          error = formatMachineQueryError(result.cause);
        }
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) values.push([target.machineId, value]);
        if (result._tag === "Success") {
          observations.push([target.machineId, result.value, result.timestamp]);
        }
      }
      return { values, error, isPending, observations };
    }).pipe(Atom.withLabel(`${label}:${key}`)),
  );
  const empty = Atom.make<MergedMachineQueryView<A>>({
    values: [],
    observations: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel(`${label}:empty`));
  return function useMergedQuery(targets: ReadonlyArray<MachineQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = (override?: ReadonlyArray<MachineQueryTarget<Input>>) => {
      const refreshTargets =
        override ?? (JSON.parse(key) as ReadonlyArray<MachineQueryTarget<Input>>);
      for (const atom of new Set(refreshTargets.map(atomFor))) {
        appAtomRegistry.refresh(atom);
      }
    };
    return { ...view, refresh };
  };
}

const usePullRequestListsQuery = createMergedMachineQuery(
  "web-pull-requests:list",
  pullRequestMachine.list,
);

const usePullRequestStatsQuery = createMergedMachineQuery(
  "web-pull-requests:list-stats",
  pullRequestMachine.listStats,
);

const usePullRequestTurnRefreshQuery = createMergedMachineQuery(
  "web-pull-requests:turn-refreshes",
  ({ machineId }: MachineQueryTarget<Readonly<Record<string, never>>>) =>
    pullRequestMachine.refreshes({ machineId, input: {} }),
);

export function usePullRequestTurnRefreshes(
  machineIds: ReadonlyArray<MachineId>,
): ReadonlyArray<readonly [MachineId, number]> {
  return usePullRequestTurnRefreshQuery(
    machineIds.map((machineId) => ({ machineId, input: {} })),
  ).values;
}

export function usePullRequestTurnRefresh(machineId: MachineId): number | null {
  const result = useAtomValue(pullRequestMachine.refreshes({ machineId, input: {} }));
  return Option.getOrNull(AsyncResult.value(result));
}

export interface MergedPullRequestListView {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: (targets?: ReadonlyArray<MachineQueryTarget<PullRequestListInput>>) => void;
}

export function usePullRequestList(
  targets: ReadonlyArray<MachineQueryTarget<PullRequestListInput>>,
): MergedPullRequestListView {
  const query = usePullRequestListsQuery(targets);
  useLayoutEffect(() => {
    for (const [machineId, answer, observedAt] of query.observations) {
      for (const entry of answer.entries) {
        observePullRequestSummary(
          pullRequestSummaryKey(machineId, {
            projectId: entry.projectId,
            host: entry.host,
            repository: entry.repository,
            number: entry.number,
          }),
          pullRequestListEntryToSummary(entry),
          observedAt,
        );
      }
    }
  }, [query.observations]);
  const data = mergePullRequestLists(query.values);
  return { data, error: query.error, isPending: query.isPending, refresh: query.refresh };
}

export function usePullRequestListStats(
  targets: ReadonlyArray<MachineQueryTarget<PullRequestListStatsInput>>,
): {
  readonly stats: ReadonlyArray<MachinePullRequestStat> | null;
  readonly isPending: boolean;
  readonly refresh: (
    targets?: ReadonlyArray<MachineQueryTarget<PullRequestListStatsInput>>,
  ) => void;
} {
  const query = usePullRequestStatsQuery(targets);
  const stats =
    query.values.length === 0
      ? null
      : query.values.flatMap(([machineId, result]) =>
          result.stats.map((stat) => ({ ...stat, machineId })),
        );
  return { stats, isPending: query.isPending, refresh: query.refresh };
}
