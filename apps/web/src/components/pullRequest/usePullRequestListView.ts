import { parsePullRequestQuery } from "@vekrel/client-runtime/pull-request-query";
import {
  pullRequestHostOf,
  type MachineId,
  type ProjectId,
  type PullRequestInvolvement,
  type PullRequestListFilters,
  type PullRequestListResult,
  type PullRequestListState,
  type SourceControlProviderKind,
} from "@vekrel/contracts";
import { useState } from "react";

import { useAllMachineShellsBootstrapped, useProjects } from "~/state/entities";
import { useMachines } from "~/state/machines";
import { useDebouncedValue } from "~/state/queries";
import {
  applyPullRequestOverrides,
  findProjectForRepository,
  findScopedProject,
  matchesPullRequestFilters,
  pullRequestDiffStatKey,
  pullRequestEntryKey,
  pullRequestEntryViewer,
  pullRequestMachineSetKey,
  pullRequestHostActions,
  resolveProjectScope,
  resolveQueryMachineIds,
  resolveSelectedMachineId,
  sortPullRequestGroups,
  withDiffStat,
  type MachinePullRequestEntry,
  type MergedPullRequestList,
  type PullRequestDiffStats,
  type PullRequestGroup,
  type PullRequestListOverride,
} from "./pullRequestList.logic";
import type { PullRequestExpectedHost } from "./PullRequestListFilters";
import type { PullRequestListPreferences, PullRequestListSort } from "./pullRequestListPreferences";
import { assignProjectsToMachines } from "./pullRequestProjectAssignment.logic";
import { pullRequestFilterProjects } from "./pullRequestProjectFilter.logic";
import { pullRequestListEntryId } from "./pullRequestListGroups.logic";

export interface PullRequestsSearch extends PullRequestListPreferences {
  readonly machineId?: MachineId;
  readonly projectId?: ProjectId;
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
  readonly selectedProjectId?: ProjectId;
  readonly selectedHost?: string;
  readonly selectedMachineId?: MachineId;
}

const SEARCH_DEBOUNCE_MS = 250;

/** Which servers and projects the page reads, from the URL and what this client knows. */
export function usePullRequestScope(search: PullRequestsSearch) {
  const { machines } = useMachines();
  const allProjects = useProjects();
  const projectsKnown = useAllMachineShellsBootstrapped();
  const capableMachines = machines
    .filter(
      (machine) => machine.serverConfig?.machine.capabilities.pullRequests === true,
    )
    .toSorted((left, right) => left.machineId.localeCompare(right.machineId));
  const scopedMachineId =
    capableMachines.find((machine) => machine.machineId === search.machineId)
      ?.machineId ?? null;
  const knownMachineIds = new Set(machines.map((machine) => machine.machineId));
  const machineIds = capableMachines
    .filter(
      (machine) =>
        scopedMachineId === null || machine.machineId === scopedMachineId,
    )
    .map((machine) => machine.machineId);
  const machineKey = pullRequestMachineSetKey(machineIds);
  const capabilityKnown = machines.some((machine) => machine.serverConfig !== null);
  const pullRequestsSupported = machineIds.length > 0;
  const projects = allProjects.filter(
    (project) => !project.isScratch && machineIds.includes(project.machineId),
  );
  const machineLabels = new Map(
    machines.map((machine) => [machine.machineId, machine.label] as const),
  );
  const scopedProjectId = resolveProjectScope(search.projectId, projects, projectsKnown);
  const scopedProject = findScopedProject(projects, scopedMachineId, scopedProjectId);
  const scopedProjects = pullRequestFilterProjects(projects, machineLabels, scopedProject);

  const selectedHost = search.selectedHost ?? search.host;
  // A named server still connecting is kept named rather than falling back: falling back while it
  // is merely not ready yet would resolve the project against whatever other server has answered,
  // which can be the wrong one where two servers share a project id.
  const selectedMachineId = resolveSelectedMachineId(
    search.selectedMachineId,
    knownMachineIds,
    scopedMachineId,
  );
  const projectForRepository =
    search.repository === undefined
      ? undefined
      : findProjectForRepository(projects, {
          repository: search.repository,
          host: selectedHost,
          selectedMachineId,
          scopedProjectId,
          scopedMachineId,
        });
  const linkedProjectId = resolveProjectScope(search.selectedProjectId, projects, projectsKnown);
  const selectedProject =
    linkedProjectId === undefined && search.repository !== undefined
      ? projectForRepository
      : findScopedProject(projects, selectedMachineId, linkedProjectId ?? scopedProjectId);
  const queryMachineIds = resolveQueryMachineIds(
    machineIds,
    projects,
    scopedProject,
    scopedProjectId,
    projectsKnown,
  );
  const machineQueries = ((): ReadonlyArray<{
    readonly machineId: MachineId;
    readonly projectIds?: ReadonlyArray<ProjectId>;
  }> => {
    const plain = queryMachineIds.map((machineId) => ({ machineId }));
    if (!projectsKnown || scopedProjectId !== undefined) return plain;
    const assignment = assignProjectsToMachines(
      projects,
      queryMachineIds,
      queryMachineIds[0],
    );
    const totals = new Map<MachineId, number>();
    for (const project of projects) {
      totals.set(project.machineId, (totals.get(project.machineId) ?? 0) + 1);
    }
    return queryMachineIds.flatMap((machineId) => {
      const projectIds = assignment.get(machineId);
      if (projectIds === undefined) return [];
      if (projectIds.length === (totals.get(machineId) ?? 0)) return [{ machineId }];
      return [{ machineId, projectIds }];
    });
  })();
  const assignmentKey = machineQueries
    .map(({ machineId, projectIds }) => `${machineId}#${projectIds?.join("+") ?? "*"}`)
    .join("|");
  const linkedSelection =
    search.repository && search.number && selectedProject
      ? {
          machineId: selectedProject.machineId,
          repository: search.repository,
          number: search.number,
          projectId: selectedProject.id,
          ...(selectedHost ? { host: selectedHost } : {}),
        }
      : null;
  const expectedHosts = (() => {
    const byHost = new Map<string, PullRequestExpectedHost>();
    for (const project of projects) {
      const kind = project.repositoryIdentity?.provider as SourceControlProviderKind | undefined;
      if (kind === undefined) continue;
      const host = pullRequestHostOf(project.repositoryIdentity, kind);
      if (!byHost.has(host)) byHost.set(host, { host, kind });
    }
    return [...byHost.values()];
  })();

  return {
    capableMachines,
    scopedMachineId,
    machineKey,
    capabilityKnown,
    pullRequestsSupported,
    projects,
    machineLabels,
    scopedProjectId,
    scopedProject,
    scopedProjects,
    selectedProject,
    queryMachineIds,
    machineQueries,
    assignmentKey,
    linkedSelection,
    expectedHosts,
    projectsKnown,
  };
}

export function usePullRequestQueryFilters(search: PullRequestsSearch, typedQuery: string) {
  const sentQuery = useDebouncedValue(typedQuery, SEARCH_DEBOUNCE_MS);
  const typedParsed = parsePullRequestQuery(typedQuery);
  const sentParsed = parsePullRequestQuery(sentQuery);

  const menuFilters = {
    ...(search.draft ? { draft: search.draft } : {}),
    ...(search.review ? { review: search.review } : {}),
    ...(search.checks ? { checks: search.checks } : {}),
    ...(search.author ? { author: search.author } : {}),
    ...(search.labels ? { labels: search.labels.map((label) => [label]) } : {}),
  };
  const menuFiltered = Object.keys(menuFilters).length > 0;
  const filters = { ...menuFilters, ...sentParsed.filters };
  const hasFilters = Object.keys(filters).length > 0;
  const localFilters = { ...menuFilters, ...typedParsed.filters };
  const hasLocalFilters = Object.keys(localFilters).length > 0;
  return {
    sentQuery,
    querySettled: typedQuery === sentQuery,
    typedParsed,
    sentParsed,
    menuFilters,
    menuFiltered,
    filters,
    hasFilters,
    localFilters,
    hasLocalFilters,
  };
}

/**
 * The hosts the list has answered for (kept while a host filter narrows the answer), and the
 * groups as shown with measured sizes, optimistic actions, and the reader's sort.
 */
export function usePullRequestDisplayGroups({
  answered,
  host,
  groups,
  statsByRow,
  overrides,
  state,
  localFilters,
  hasLocalFilters,
  viewers,
  sort,
  text,
  involvement,
}: {
  answered: MergedPullRequestList | null;
  host: string | undefined;
  groups: ReadonlyArray<PullRequestGroup<MachinePullRequestEntry>>;
  statsByRow: PullRequestDiffStats;
  overrides: ReadonlyMap<string, PullRequestListOverride>;
  state: PullRequestListState;
  localFilters: PullRequestListFilters;
  hasLocalFilters: boolean;
  viewers: PullRequestListResult["viewers"];
  sort: PullRequestListSort;
  text: string;
  involvement: PullRequestInvolvement;
}) {
  const [hostsState, setHostsState] = useState<{
    readonly source: MergedPullRequestList | null;
    readonly host: string | undefined;
    readonly hosts: PullRequestListResult["providers"];
  }>({ source: null, host: undefined, hosts: [] });
  if (answered !== null && (hostsState.source !== answered || hostsState.host !== host)) {
    setHostsState({
      source: answered,
      host,
      hosts:
        host === undefined || hostsState.hosts.length === 0 ? answered.providers : hostsState.hosts,
    });
  }
  const hosts = hostsState.hosts;
  const displayGroups = (() => {
    const enriched = groups.map((group) => {
      const overridden = applyPullRequestOverrides(
        group.entries.map((entry) => withDiffStat(entry, statsByRow)),
        overrides,
        pullRequestEntryKey,
        state,
      );
      return {
        ...group,
        entries:
          hasLocalFilters && overrides.size > 0
            ? overridden.filter(
                (entry) =>
                  !overrides.has(pullRequestEntryKey(entry)) ||
                  matchesPullRequestFilters(
                    entry,
                    localFilters,
                    pullRequestEntryViewer(entry, viewers),
                  ),
              )
            : overridden,
      };
    });
    return sortPullRequestGroups(
      enriched,
      sort,
      text,
      (entry) =>
        entry.additions + entry.deletions > 0 || statsByRow.has(pullRequestDiffStatKey(entry)),
      involvement,
    );
  })();
  const shownCount = displayGroups.reduce((count, group) => count + group.entries.length, 0);
  const hostActionsOf = pullRequestHostActions(hosts);
  const closeSweepRows = new Map(
    displayGroups.flatMap((group) =>
      group.entries.map(
        (entry) => [pullRequestEntryKey(entry), { entry, groupKey: group.key }] as const,
      ),
    ),
  );
  const listedPullRequestsBySurface = new Map(
    displayGroups.flatMap((group) =>
      group.entries.map((entry) => [pullRequestListEntryId(entry), entry] as const),
    ),
  );

  return {
    hosts,
    displayGroups,
    shownCount,
    hostActionsOf,
    closeSweepRows,
    listedPullRequestsBySurface,
  };
}
