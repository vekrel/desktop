import { useAtomValue } from "@effect/atom-react";
import { ThreadPullRequestLink, type MachineId, type PullRequestRef } from "@vekrel/contracts";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import {
  savedPullRequestStack,
  pullRequestStackView,
} from "../components/pullRequest/pullRequestStackSnapshot";
import { pullRequestStackAtom } from "./pullRequests";
import { useMachineQuery } from "./query";
import { machineThreadShells } from "./threads";

const sameLinks = Schema.toEquivalence(Schema.Array(ThreadPullRequestLink));

// A shell update re-sends a thread's links as a new array, so equal links keep
// the previous list and a streaming thread does not re-render the stack.
const machinePullRequestLinksAtom = Atom.family((machineId: MachineId) => {
  let previous: ReadonlyArray<ThreadPullRequestLink> = [];
  return Atom.make((get) => {
    const next = get(machineThreadShells.machineThreadsAtom(machineId)).flatMap(
      (thread) => thread.pullRequests ?? [],
    );
    if (sameLinks(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`web-machine-pull-request-links:${machineId}`));
});

export function usePullRequestStack(
  machineId: MachineId,
  reference: PullRequestRef | null,
) {
  const links = useAtomValue(machinePullRequestLinksAtom(machineId));
  const saved = reference === null ? null : savedPullRequestStack(links, reference);
  const query = useMachineQuery(
    reference === null ? null : pullRequestStackAtom({ machineId, input: reference }),
  );
  return { ...query, ...pullRequestStackView(query, saved) };
}
