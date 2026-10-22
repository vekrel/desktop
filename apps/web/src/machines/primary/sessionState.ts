import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { isLocalMachineDisabled } from "../../localMachine";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { fetchSessionState } from "./auth";

const primarySessionStateAtom = Atom.make(
  Effect.suspend(() =>
    isLocalMachineDisabled() ? Effect.succeed(null) : Effect.promise(fetchSessionState),
  ),
).pipe(
  Atom.swr({ staleTime: 5_000, revalidateOnMount: true }),
  Atom.setIdleTTL(5 * 60_000),
  Atom.withLabel("primary-machine:session"),
);

function refreshPrimarySessionState(): void {
  appAtomRegistry.refresh(primarySessionStateAtom);
}

export function usePrimarySessionState() {
  const result = useAtomValue(primarySessionStateAtom);
  let error: string | null = null;
  if (result._tag === "Failure") {
    const cause = Cause.squash(result.cause);
    error = cause instanceof Error ? cause.message : "Could not read machine session.";
  }
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error,
    isPending: result.waiting,
    refresh: refreshPrimarySessionState,
  };
}
