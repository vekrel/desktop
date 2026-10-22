import { useAtomValue } from "@effect/atom-react";
import {
  type CheckpointDiffTarget,
  type ComposerPathSearchTarget,
} from "@vekrel/client-runtime/state/threads";
import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  type MachineThreadSearchMatch,
} from "@vekrel/client-runtime/state/thread-search";
import { type VcsRefTarget } from "@vekrel/client-runtime/state/vcs";
import type {
  MachineId,
  ProjectContentMatch,
  ProjectEntry,
  ProjectEntryKind,
  ThreadId,
  TurnItemId,
  VcsListRefsResult,
  VcsRef,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useFilesystemReadAccess } from "./filesystem";
import { orchestrationMachine } from "./orchestration";
import { isPaginatedBranchesNextPagePending } from "./paginatedBranches";
import { projectContentSearch, projectMachine } from "./projects";
import { useMachineQuery } from "./query";
import { vcsMachine } from "./vcs";

const PROJECT_PATH_SEARCH_DEBOUNCE_MS = 120;
const COMPOSER_PATH_SEARCH_LIMIT = 80;
const PROJECT_CONTENT_SEARCH_DEBOUNCE_MS = 120;
const PROJECT_CONTENT_SEARCH_LIMIT = 500;
const THREAD_SEARCH_DEBOUNCE_MS = 200;
const VCS_REF_LIST_LIMIT = 100;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<ProjectEntry> = [];
const EMPTY_CONTENT_MATCHES: ReadonlyArray<ProjectContentMatch> = [];
const INITIAL_BRANCH_CURSORS = [undefined] as const;
const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<MachineThreadSearchMatch> = Object.freeze([]);
const EMPTY_THREAD_SEARCH_ATOM = Atom.make({
  matches: EMPTY_THREAD_SEARCH_MATCHES,
  isLoading: false,
}).pipe(Atom.withLabel("web:thread-search:empty"));

const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
  getSearchAtom: (machineId, query) =>
    orchestrationMachine.threadSearch({
      machineId,
      input: { query },
    }),
  labelPrefix: "web:thread-search",
});

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
}

export function useThreadSearch(
  machineIds: ReadonlyArray<MachineId>,
  query: string,
): {
  readonly matches: ReadonlyArray<MachineThreadSearchMatch>;
  readonly query: string;
  readonly isPending: boolean;
} {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = machineIds.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const searchKey =
    settledQuery === null ? null : makeThreadSearchKey(machineIds, settledQuery);
  const result = useAtomValue(
    searchKey === null ? EMPTY_THREAD_SEARCH_ATOM : threadSearchResultsAtom(searchKey),
  );
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  return {
    matches: isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    query: settledQuery ?? "",
    isPending: canSearch && (isDebouncing || result.isLoading),
  };
}

function vcsRefPageAtom(targetKey: string, cursor: number | undefined) {
  const [machineId, cwd, query] = JSON.parse(targetKey) as [MachineId, string, string];
  return vcsMachine.listRefs({
    machineId,
    input: {
      cwd,
      ...(query.length > 0 ? { query } : {}),
      ...(cursor === undefined ? {} : { cursor }),
      limit: VCS_REF_LIST_LIMIT,
    },
  });
}

const EMPTY_VCS_REF_PAGES_ATOM = Atom.make<
  ReadonlyArray<Atom.Type<ReturnType<typeof vcsRefPageAtom>>>
>([]).pipe(Atom.withLabel("web:vcs-ref-pages:empty"));

// Keyed by target and cursors so every render of the same pages reads the same atom.
const vcsRefPagesAtom = Atom.family((pagesKey: string) => {
  const [targetKey, cursors] = JSON.parse(pagesKey) as [string, Array<number | null>];
  const pageAtoms = cursors.map((cursor) => vcsRefPageAtom(targetKey, cursor ?? undefined));
  return Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
    Atom.withLabel(`web:vcs-ref-pages:${pagesKey}`),
  );
});

export function usePaginatedBranches(target: VcsRefTarget) {
  // Starts unkeyed: a key mismatch already resolves to the initial cursors, and seeding
  // the key here would make every derivation below straddle this hook call.
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({
    targetKey: null,
    cursors: INITIAL_BRANCH_CURSORS,
  });
  const { machineId, cwd } = target;
  const query = target.query?.trim() ?? "";
  const targetKey =
    machineId !== null && cwd !== null ? JSON.stringify([machineId, cwd, query]) : null;
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pagesKey = targetKey === null ? null : JSON.stringify([targetKey, cursors]);
  const results = useAtomValue(
    pagesKey === null ? EMPTY_VCS_REF_PAGES_ATOM : vcsRefPagesAtom(pagesKey),
  );
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const failed = results.find((result) => result._tag === "Failure");
  const isFetchingNextPage = isPaginatedBranchesNextPagePending(results);
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to load refs.";
        })()
      : null;
  const refresh = () => {
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (targetKey !== null) {
      appAtomRegistry.refresh(vcsRefPageAtom(targetKey, undefined));
    }
  };
  const nextCursor = data?.nextCursor;
  const loadNext = () => {
    if (targetKey === null || nextCursor === null || nextCursor === undefined) {
      return;
    }
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(nextCursor)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, nextCursor] };
    });
  };

  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage,
    refresh,
    loadNext,
  };
}

type ProjectPathSearchTarget = ComposerPathSearchTarget & {
  readonly kind?: ProjectEntryKind | undefined;
  readonly imageOnly?: boolean | undefined;
};

function areProjectPathSearchTargetsEqual(
  left: ProjectPathSearchTarget,
  right: ProjectPathSearchTarget,
): boolean {
  return (
    left.machineId === right.machineId &&
    left.cwd === right.cwd &&
    left.query === right.query &&
    left.kind === right.kind &&
    left.imageOnly === right.imageOnly
  );
}

export function useProjectPathSearch(
  target: ProjectPathSearchTarget,
  limit: number,
  options?: { readonly allowEmptyQuery?: boolean },
) {
  const allowEmptyQuery = options?.allowEmptyQuery === true;
  const normalizedTarget = {
    machineId: target.machineId,
    cwd: target.cwd,
    query: target.query == null ? null : target.query.trim(),
    kind: target.kind,
    imageOnly: target.imageOnly,
  };
  const debouncedTarget = useDebouncedValue(normalizedTarget, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
  const fileAccess = useFilesystemReadAccess(debouncedTarget.machineId);
  const { canReadFiles } = fileAccess;
  const searchTarget =
    debouncedTarget.machineId !== null &&
    debouncedTarget.cwd !== null &&
    debouncedTarget.query !== null &&
    (allowEmptyQuery || debouncedTarget.query.length > 0)
      ? {
          machineId: debouncedTarget.machineId,
          input: {
            cwd: debouncedTarget.cwd,
            query: debouncedTarget.query,
            limit,
            ...(debouncedTarget.kind ? { kind: debouncedTarget.kind } : {}),
            ...(debouncedTarget.imageOnly ? { imageOnly: true } : {}),
          },
        }
      : null;
  const result = useMachineQuery(
    canReadFiles && searchTarget !== null ? projectMachine.searchEntries(searchTarget) : null,
  );
  const hasTarget = searchTarget !== null;

  return {
    entries: result.data?.entries ?? EMPTY_PROJECT_ENTRIES,
    error:
      !hasTarget || fileAccess.isPending
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending:
      !areProjectPathSearchTargetsEqual(normalizedTarget, debouncedTarget) ||
      (hasTarget && (fileAccess.isPending || result.isPending)),
    searchedTarget: debouncedTarget,
    searchedQuery: debouncedTarget.query ?? "",
    truncated: result.data?.truncated ?? false,
    refresh: result.refresh,
  };
}

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  return useProjectPathSearch(target, COMPOSER_PATH_SEARCH_LIMIT);
}

interface ProjectContentSearchTarget {
  readonly machineId: MachineId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}

export function useProjectContentSearch(target: ProjectContentSearchTarget) {
  const hasTarget = target.machineId !== null && target.cwd !== null;
  const fileAccess = useFilesystemReadAccess(target.machineId);
  const canReadFiles = hasTarget && fileAccess.canReadFiles;
  const isCheckingAccess = hasTarget && fileAccess.isPending;
  // Whitespace is significant in content queries; trimming is only used to
  // decide whether the input is blank.
  const query = target.query;
  const hasQuery = query.trim().length > 0;
  const debouncedQuery = useDebouncedValue(query, PROJECT_CONTENT_SEARCH_DEBOUNCE_MS);
  const result = useMachineQuery(
    canReadFiles &&
      target.machineId !== null &&
      target.cwd !== null &&
      hasQuery &&
      debouncedQuery.trim().length > 0
      ? projectContentSearch({
          machineId: target.machineId,
          input: {
            cwd: target.cwd,
            query: debouncedQuery,
            limit: PROJECT_CONTENT_SEARCH_LIMIT,
            caseSensitive: target.caseSensitive,
            wholeWord: target.wholeWord,
            useRegex: target.useRegex,
          },
        })
      : null,
  );

  return {
    canReadFiles,
    isCheckingAccess,
    matches: result.data?.matches ?? EMPTY_CONTENT_MATCHES,
    error:
      !hasTarget || isCheckingAccess
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending:
      isCheckingAccess ||
      (canReadFiles && hasQuery && (query !== debouncedQuery || result.isPending)),
    hasQuery,
    truncated: result.data?.truncated ?? false,
    invalidRegex: target.useRegex && result.data?.regexFallbackError !== undefined,
  };
}

export function useCheckpointDiff(
  target: CheckpointDiffTarget,
  options?: { readonly enabled?: boolean },
) {
  const enabled =
    options?.enabled !== false &&
    target.machineId !== null &&
    target.threadId !== null &&
    target.fromTurnCount !== null &&
    target.toTurnCount !== null;
  const fullThreadTarget =
    enabled && target.fromTurnCount === 0
      ? {
          machineId: target.machineId!,
          input: {
            threadId: target.threadId!,
            toTurnCount: target.toTurnCount!,
            ignoreWhitespace: target.ignoreWhitespace,
          },
        }
      : null;
  const turnTarget =
    enabled && target.fromTurnCount !== 0
      ? {
          machineId: target.machineId!,
          input: {
            threadId: target.threadId!,
            fromTurnCount: target.fromTurnCount!,
            toTurnCount: target.toTurnCount!,
            ignoreWhitespace: target.ignoreWhitespace,
          },
        }
      : null;
  const fullThread = useMachineQuery(
    fullThreadTarget === null ? null : orchestrationMachine.fullThreadDiff(fullThreadTarget),
  );
  const turn = useMachineQuery(
    turnTarget === null ? null : orchestrationMachine.turnDiff(turnTarget),
  );
  return fullThreadTarget === null ? turn : fullThread;
}

export function useTurnItemDetail(
  target: {
    readonly machineId: MachineId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
    readonly revision: string;
  } | null,
) {
  return useMachineQuery(
    target === null
      ? null
      : orchestrationMachine.turnItem({
          machineId: target.machineId,
          input: { threadId: target.threadId, itemId: target.itemId, revision: target.revision },
        }),
  );
}
