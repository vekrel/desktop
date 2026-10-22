import { RegistryContext, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useContext } from "react";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("web-machine-query:empty"),
);

export interface MachineQueryView<A, E = unknown> {
  readonly data: A | null;
  readonly dataUpdatedAt: number;
  readonly error: string | null;
  readonly failure: E | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly refresh: () => void;
}

export function formatMachineQueryError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The machine request failed.";
}

function queryUpdatedAt(result: AsyncResult.AsyncResult<unknown, unknown>): number {
  return result._tag === "Success"
    ? result.timestamp
    : result._tag === "Failure"
      ? (Option.getOrNull(result.previousSuccess)?.timestamp ?? 0)
      : 0;
}

export function useMachineQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): MachineQueryView<A, E> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    dataUpdatedAt: queryUpdatedAt(result),
    error: result._tag === "Failure" ? formatMachineQueryError(result.cause) : null,
    failure:
      result._tag === "Failure" ? Option.getOrNull(Cause.findErrorOption(result.cause)) : null,
    isPending: atom !== null && result.waiting,
    isSuccess: result._tag === "Success",
    refresh,
  };
}

/**
 * Reads one part of a query's result. Every refetch publishes a new result (a
 * new timestamp, `waiting` on and off), and this re-renders only when the
 * selected part changes. `select` must be defined outside the component: a new
 * function per render would rebuild the derived atom every render.
 */
export function useMachineQuerySelector<A, E, B>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
  select: (result: AsyncResult.AsyncResult<A, E>) => B,
): B {
  return useAtomValue(atom ?? EMPTY_ASYNC_RESULT_ATOM, select);
}

type QueryResultAtom = Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>;
// Lives as long as both queries do, so a row keeps the same comparison atom across renders.
const queryIsNewerAtoms = new WeakMap<
  QueryResultAtom,
  WeakMap<QueryResultAtom, Atom.Atom<boolean>>
>();
function queryIsNewerAtom(query: QueryResultAtom, than: QueryResultAtom): Atom.Atom<boolean> {
  let byThan = queryIsNewerAtoms.get(query);
  if (byThan === undefined) {
    byThan = new WeakMap();
    queryIsNewerAtoms.set(query, byThan);
  }
  let atom = byThan.get(than);
  if (atom === undefined) {
    atom = Atom.make((get) => queryUpdatedAt(get(query)) >= queryUpdatedAt(get(than)));
    byThan.set(than, atom);
  }
  return atom;
}

/** Whether `query` last succeeded no earlier than `than`, without re-rendering on every refetch. */
export function useMachineQueryIsNewer(
  query: QueryResultAtom | null,
  than: QueryResultAtom | null,
): boolean {
  return useAtomValue(
    queryIsNewerAtom(query ?? EMPTY_ASYNC_RESULT_ATOM, than ?? EMPTY_ASYNC_RESULT_ATOM),
  );
}

/**
 * The query's refresh, plus its pending state read when called rather than
 * subscribed to, for callers that only gate a refresh on it.
 */
export function useMachineQueryRefresh<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): { readonly refresh: () => void; readonly isPending: () => boolean } {
  const registry = useContext(RegistryContext);
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const refresh = useAtomRefresh(selectedAtom);
  return { refresh, isPending: () => atom !== null && registry.get(selectedAtom).waiting };
}
