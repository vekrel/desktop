import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import { settlePromise, squashAtomCommandFailure } from "@vekrel/client-runtime/state/runtime";
import type { MachineId, PullRequestRef, ScopedThreadRef, ThreadId } from "@vekrel/contracts";
import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";
import { threadPullRequestLinkMode } from "@vekrel/client-runtime/thread-pull-request-compatibility";
import { usePullRequestLinking } from "~/hooks/usePullRequestLinking";

import { parseChangeRequestUrl } from "~/lib/openPullRequestLink";
import { normalizeThreadPullRequestKey } from "@vekrel/shared/threadPullRequests";
import { useProjects, useServerConfigs, useThreadShell, useThreadShells } from "~/state/entities";
import { pullRequestMachine } from "~/state/pullRequests";
import { useMachineQuery } from "~/state/query";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { openCommandPalette } from "~/commandPaletteBus";
import { Button } from "../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { MenuItem } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";

interface PullRequestThreadLinksProps {
  machineId: MachineId;
  reference: PullRequestRef;
  url: string;
  threadRef: ScopedThreadRef | null;
  display: "count" | "menu-item" | "picker";
  onPickerOpenChange?: (open: boolean) => void;
}

export function PullRequestThreadLinks(props: PullRequestThreadLinksProps) {
  const configs = useServerConfigs();
  if (
    threadPullRequestLinkMode(configs.get(props.machineId)?.machine.capabilities) ===
    "unsupported"
  ) {
    return null;
  }
  return <EnabledPullRequestThreadLinks key={`${props.machineId}:${props.url}`} {...props} />;
}

function EnabledPullRequestThreadLinks({
  machineId,
  reference,
  url,
  threadRef,
  display,
  onPickerOpenChange,
}: PullRequestThreadLinksProps) {
  const parsed = parseChangeRequestUrl(url);
  const thread = useThreadShell(threadRef?.machineId === machineId ? threadRef : null);
  const currentThreadRef = thread === null ? null : threadRef;
  const linking = usePullRequestLinking(machineId);
  const linkedHere = linking.isLinked(thread, url);
  const relations = useMachineQuery(
    linking.mode === "multiple" && display !== "menu-item"
      ? pullRequestMachine.linkedThreads({
          machineId,
          input:
            parsed === null
              ? reference
              : { ...reference, ...normalizeThreadPullRequestKey(parsed) },
        })
      : null,
  );
  // Refreshes can briefly clear the query value. Keep the last response so polling
  // does not hide the linked-thread count between responses.
  const [lastRelations, setLastRelations] = useState(relations.data);
  if (relations.data !== null && relations.data !== lastRelations) {
    setLastRelations(relations.data);
  }
  const [pending, setPending] = useState(false);

  const changeLink = async (threadId: ThreadId, remove: boolean) => {
    if (parsed === null || pending) return;
    setPending(true);
    const result = await settlePromise(() =>
      linking.changeLink(scopeThreadRef(machineId, threadId), url, !remove),
    );
    setPending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: remove ? "Could not unlink the pull request" : "Could not link the pull request",
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (linking.mode === "multiple") {
      appAtomRegistry.refresh(
        pullRequestMachine.linkedThreads({
          machineId,
          input: { ...reference, ...normalizeThreadPullRequestKey(parsed) },
        }),
      );
    }
    onPickerOpenChange?.(false);
  };

  if (parsed === null || (!linkedHere && !linking.canLink(url))) return null;
  const linkedThreads =
    linking.mode === "multiple" ? ((relations.data ?? lastRelations)?.threads ?? []) : [];
  const linkedThreadsLabel =
    linkedThreads.length > 0
      ? `Linked from ${linkedThreads.length} ${linkedThreads.length === 1 ? "thread" : "threads"}`
      : "Linked threads";
  return (
    <>
      {display === "count" && (linkedThreads.length > 0 || relations.error !== null) ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="ghost"
                aria-label={linkedThreadsLabel}
                onClick={() =>
                  openCommandPalette({
                    query: url,
                    ...((relations.data ?? lastRelations) === null
                      ? {}
                      : { linkedThreads: { machineId, threads: linkedThreads } }),
                  })
                }
              >
                <MessageSquareIcon aria-hidden className="size-3.5" />
                <span aria-hidden>{linkedThreads.length || "?"}</span>
              </Button>
            }
          />
          <TooltipPopup>{linkedThreadsLabel}. Search in the command palette.</TooltipPopup>
        </Tooltip>
      ) : null}
      {display === "menu-item" ? (
        <MenuItem
          disabled={pending}
          onClick={() => {
            if (currentThreadRef !== null) {
              void changeLink(currentThreadRef.threadId, linkedHere);
            } else {
              onPickerOpenChange?.(true);
            }
          }}
        >
          {linkedHere ? (
            <PullRequestGlyph.unlink aria-hidden className="size-3.5" />
          ) : (
            <PullRequestGlyph.link aria-hidden className="size-3.5" />
          )}
          {linkedHere
            ? "Unlink from this thread"
            : currentThreadRef
              ? "Link to this thread"
              : "Link to thread"}
        </MenuItem>
      ) : null}
      {display === "picker" ? (
        <Dialog open onOpenChange={onPickerOpenChange}>
          <DialogPopup className="max-w-md" showCloseButton={false}>
            <DialogTitle className="sr-only">Link pull request to a thread</DialogTitle>
            <ThreadPicker
              machineId={machineId}
              url={url}
              pending={pending}
              onSelect={(threadId) => void changeLink(threadId, false)}
            />
          </DialogPopup>
        </Dialog>
      ) : null}
    </>
  );
}

function ThreadPicker({
  machineId,
  url,
  pending,
  onSelect,
}: {
  machineId: MachineId;
  url: string;
  pending: boolean;
  onSelect: (threadId: ThreadId) => void;
}) {
  const threads = useThreadShells();
  const linking = usePullRequestLinking(machineId);
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const projectNames = new Map(
    projects
      .filter((project) => project.machineId === machineId)
      .map((project) => [project.id, project.title]),
  );
  const search = query.trim().toLocaleLowerCase();
  const candidates = threads
    .filter(
      (thread) =>
        thread.machineId === machineId &&
        thread.archivedAt === null &&
        `${thread.title} ${projectNames.get(thread.projectId) ?? ""}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label="Choose a thread">
      <CommandInput placeholder="Search threads or projects..." disabled={pending} />
      <CommandList className="max-h-80 overflow-y-auto">
        {candidates.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No active threads found.
          </div>
        ) : (
          candidates.map((thread) => {
            const linked = linking.isLinked(thread, url);
            return (
              <CommandItem
                key={thread.id}
                value={thread.id}
                disabled={pending || linked}
                onClick={() => onSelect(thread.id)}
              >
                <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{thread.title || "Untitled thread"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {projectNames.get(thread.projectId)}
                  </span>
                </span>
                {linked ? (
                  <>
                    <CheckIcon aria-hidden className="size-3.5" />
                    <span className="text-xs text-muted-foreground">Linked</span>
                  </>
                ) : null}
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </Command>
  );
}
