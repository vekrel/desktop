import { sourceControlRepositorySelector } from "@vekrel/shared/sourceControl";
import type {
  MachineId,
  ScopedThreadRef,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
} from "@vekrel/contracts";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import {
  planThreadPullRequestMutation,
  threadPullRequestLinkMode,
} from "@vekrel/client-runtime/thread-pull-request-compatibility";
import {
  threadPullRequestKeysEqual,
  visibleThreadPullRequests,
} from "@vekrel/shared/threadPullRequests";
import {
  findProjectForChangeRequest,
  matchesLinkedPullRequestUrl,
  parseChangeRequestUrl,
  type ChangeRequestLink,
} from "~/lib/openPullRequestLink";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects } from "~/state/entities";
import { machineServerConfigsAtom } from "~/state/server";
import { threadMachine } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

export function canLinkChangeRequest(
  mode: ReturnType<typeof threadPullRequestLinkMode>,
  projects: ReadonlyArray<MachineProject>,
  parsed: ChangeRequestLink,
): boolean {
  if (mode === "unsupported") return false;
  if (mode === "multiple") return true;
  return findProjectForChangeRequest(projects, parsed) !== undefined;
}

// A string, so provider status pushes and snapshots that keep the mode don't
// re-render every link renderer.
const linkModeAtom = Atom.family((machineId: MachineId | null) =>
  Atom.make((get) =>
    threadPullRequestLinkMode(
      machineId === null
        ? undefined
        : get(machineServerConfigsAtom).get(machineId)?.machine.capabilities,
    ),
  ).pipe(Atom.withLabel("pull-request-link-mode")),
);

export function usePullRequestLinking(machineId: MachineId | null | undefined) {
  const projects = useProjects();
  const mode = useAtomValue(linkModeAtom(machineId ?? null));
  const link = useAtomCommand(threadMachine.linkPullRequest, { reportFailure: false });
  const unlink = useAtomCommand(threadMachine.unlinkPullRequest, { reportFailure: false });
  const updateMetadata = useAtomCommand(threadMachine.updateMetadata, { reportFailure: false });
  const machineProjects = projects.filter((project) => project.machineId === machineId);
  const canLink = (url: string) => {
    const parsed = parseChangeRequestUrl(url);
    return parsed !== null && canLinkChangeRequest(mode, machineProjects, parsed);
  };
  const isLinked = (
    thread: {
      readonly pullRequests?: readonly ThreadPullRequestLink[];
      readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
    } | null,
    url: string,
  ) => {
    if (thread === null || mode === "unsupported") return false;
    if (mode !== "multiple")
      return (
        thread.linkedPullRequest != null &&
        matchesLinkedPullRequestUrl(thread.linkedPullRequest, url)
      );
    const parsed = parseChangeRequestUrl(url);
    return (
      parsed !== null &&
      visibleThreadPullRequests(thread.pullRequests ?? []).some((entry) =>
        threadPullRequestKeysEqual(entry, parsed),
      )
    );
  };
  const changeLink = async (threadRef: ScopedThreadRef, url: string, linked: boolean) => {
    const parsed = parseChangeRequestUrl(url);
    if (parsed === null || threadRef.machineId !== machineId || (linked && !canLink(url)))
      throw new Error("The pull request is not available in this machine.");
    const legacyProject = findProjectForChangeRequest(machineProjects, parsed);
    const mutation = planThreadPullRequestMutation({
      capabilities: appAtomRegistry.get(machineServerConfigsAtom).get(threadRef.machineId)
        ?.machine.capabilities,
      threadId: threadRef.threadId,
      reference: { ...parsed, url },
      legacyProjectId: legacyProject?.id ?? null,
      legacyRepository:
        sourceControlRepositorySelector(legacyProject?.repositoryIdentity) ?? undefined,
      linked,
    });
    if (mutation === null)
      throw new Error("This machine does not support linking this pull request.");
    const result = await (mutation.type === "thread.meta.update"
      ? updateMetadata({ machineId: threadRef.machineId, input: mutation.input })
      : mutation.type === "thread.pull-request.link"
        ? link({ machineId: threadRef.machineId, input: mutation.input })
        : unlink({ machineId: threadRef.machineId, input: mutation.input }));
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) throw new Error("Link update interrupted.");
      throw squashAtomCommandFailure(result);
    }
  };
  return { mode, canLink, isLinked, changeLink };
}
