import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import { threadSearchMatchKey } from "@vekrel/client-runtime/state/thread-search";
import type { MachineId, ThreadId } from "@vekrel/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquareIcon } from "lucide-react";

import { useClientSettings } from "../hooks/useSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useThreadShells } from "../state/entities";
import {
  useMachineProviders,
  useMachines,
  usePrimaryMachineId,
} from "../state/machines";
import { useThreadSearch } from "../state/queries";
import { primaryServerProvidersAtom } from "../state/server";
import { buildThreadRouteParams } from "../threadRoutes";
import { buildThreadActionItems, ITEM_ICON_CLASS } from "./CommandPalette.logic";
import { useMachineLookups, useProjectLookups } from "./CommandPaletteLookups";
import { ThreadCommandSubtitle } from "./ThreadCommandSubtitle";
import {
  ThreadRowLeadingStatus,
  ThreadRowTrailingStatus,
  ThreadSearchPullRequestNumber,
} from "./ThreadStatusIndicators";

function useProviderEntryByMachineAndInstanceId() {
  const { machines } = useMachines();
  const primaryMachineId = usePrimaryMachineId();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const providersByMachine = useMachineProviders();
  return new Map<string, ProviderInstanceEntry>(
    machines.flatMap((machine) => {
      const serverConfig = machine.serverConfig;
      const derived = deriveProviderInstanceEntries(
        providersByMachine.get(machine.machineId) ??
          (machine.machineId === primaryMachineId ? providers : []),
      );
      const entries = serverConfig
        ? applyProviderInstanceSettings(derived, serverConfig.settings, null)
        : derived;
      return entries.map(
        (entry) => [`${machine.machineId}:${entry.instanceId}`, entry] as const,
      );
    }),
  );
}

function useThreadSearchWithContentMatches(query: string) {
  const { machines } = useMachines();
  const machineIds: ReadonlyArray<MachineId> = machines
    .filter((machine) => machine.connection.phase === "connected")
    .map((machine) => machine.machineId);
  const threadSearch = useThreadSearch(machineIds, query);
  const contentMatchByKey = new Map(
    threadSearch.matches.flatMap((match) =>
      match.source === "user" || match.source === "assistant"
        ? [[threadSearchMatchKey(match), match] as const]
        : [],
    ),
  );
  return { threadSearch, contentMatchByKey };
}

/** Every thread as a palette item, with message matches for a non-empty `threadSearchQuery`. */
export function useCommandPaletteThreadItems(input: {
  readonly activeThreadId: ThreadId | undefined;
  readonly threadSearchQuery: string;
}) {
  const { activeThreadId, threadSearchQuery } = input;
  const navigate = useNavigate();
  const threads = useThreadShells();
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const { projectMachineLocationById } = useMachineLookups();
  const providerEntryByMachineAndInstanceId = useProviderEntryByMachineAndInstanceId();
  const { threadSearch, contentMatchByKey } = useThreadSearchWithContentMatches(threadSearchQuery);
  const { projectByKey, projectTitleById } = useProjectLookups();

  const threadItems = buildThreadActionItems({
    threads,
    ...(activeThreadId ? { activeThreadId } : {}),
    projectTitleById,
    sortOrder: sidebarThreadSortOrder,
    icon: <MessageSquareIcon className={ITEM_ICON_CLASS} />,
    renderLeadingContent: (thread) => <ThreadRowLeadingStatus thread={thread} />,
    renderTrailingContent: (thread) => (
      <>
        <ThreadSearchPullRequestNumber
          thread={thread}
          query={threadSearchQuery}
          settled={thread.settledOverride === "settled"}
        />
        <ThreadRowTrailingStatus thread={thread} />
      </>
    ),
    renderDescription: (thread, { projectTitle }) => {
      const modelInstanceId =
        thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId;
      const providerEntry =
        providerEntryByMachineAndInstanceId.get(`${thread.machineId}:${modelInstanceId}`) ??
        null;
      return (
        <ThreadCommandSubtitle
          project={projectByKey.get(`${thread.machineId}:${thread.projectId}`) ?? null}
          projectTitle={projectTitle ?? null}
          machineLabel={
            projectMachineLocationById.get(thread.machineId)?.label ?? "Remote"
          }
          branch={thread.branch}
          worktreePath={thread.worktreePath}
          isCurrent={thread.id === activeThreadId}
          driverKind={providerEntry?.driverKind ?? null}
          providerDisplayName={
            thread.runtime?.providerName ?? providerEntry?.displayName ?? modelInstanceId
          }
          acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
          acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl}
        />
      );
    },
    getContentMatch: (thread) => {
      const match = contentMatchByKey.get(
        threadSearchMatchKey({
          machineId: thread.machineId,
          threadId: thread.id,
        }),
      );
      return match && (match.source === "user" || match.source === "assistant")
        ? {
            source: match.source,
            snippet: match.snippet,
            query: threadSearch.query,
          }
        : undefined;
    },
    runThread: async (thread) => {
      await navigate({
        to: "/$machineId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.machineId, thread.id)),
      });
    },
  });

  return { threadItems, isSearchPending: threadSearch.isPending };
}
