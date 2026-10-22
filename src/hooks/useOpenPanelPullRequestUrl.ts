import { scopeProjectRef } from "@vekrel/client-runtime/machine";
import { MachineId, ProjectId, type ScopedThreadRef } from "@vekrel/contracts";

import {
  readPullRequestDetailSnapshot,
  resolvePullRequestReferenceHost,
} from "../components/pullRequest/pullRequestDetail.logic";
import { gitHubPullRequestBrowserUrl } from "../lib/openPullRequestLink";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { useProject } from "../state/entities";
import { pullRequestMachine } from "../state/pullRequests";
import { useMachineQuery } from "../state/query";
import { useSupportsMultiplePullRequests } from "./useSupportsMultiplePullRequests";

type PanelPullRequestSurface = Extract<
  NonNullable<ReturnType<typeof selectActiveRightPanelSurface>>,
  { kind: "pull-request" }
>;

function panelPullRequestReference(
  requestedReference: PanelPullRequestSurface | null,
  supportsMultiplePullRequests: boolean,
  repositoryIdentity: Parameters<typeof resolvePullRequestReferenceHost>[1],
) {
  if (requestedReference === null) return null;
  const input = {
    projectId: ProjectId.make(requestedReference.projectId),
    repository: requestedReference.repository,
    number: requestedReference.number,
  };
  return supportsMultiplePullRequests
    ? resolvePullRequestReferenceHost(
        {
          ...input,
          ...(requestedReference.host === undefined ? {} : { host: requestedReference.host }),
        },
        repositoryIdentity,
      )
    : input;
}

export function useOpenPanelPullRequestUrl(threadRef: ScopedThreadRef | null) {
  const surface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, threadRef),
  );
  const requestedReference = surface?.kind === "pull-request" ? surface : null;
  const machineId = requestedReference?.machineId
    ? MachineId.make(requestedReference.machineId)
    : threadRef?.machineId;
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(machineId ?? null);
  const project = useProject(
    requestedReference && machineId
      ? scopeProjectRef(machineId, ProjectId.make(requestedReference.projectId))
      : null,
  );
  const reference = panelPullRequestReference(
    requestedReference,
    supportsMultiplePullRequests,
    project?.repositoryIdentity,
  );
  // Everything that reads reference or the project runs before the query hook; a plain
  // call on either after it would leave reference, and the detail atom it keys, uncached.
  // The snapshot is already checked against reference, so live detail just wins below.
  const cachedDetail =
    reference && machineId
      ? readPullRequestDetailSnapshot(
          typeof window === "undefined" ? undefined : window.localStorage,
          machineId,
          reference,
        )
      : null;
  const fallbackUrl = reference
    ? (requestedReference?.url ??
      gitHubPullRequestBrowserUrl(
        project?.repositoryIdentity,
        reference.repository,
        reference.number,
      ))
    : undefined;
  const detail = useMachineQuery(
    reference && machineId
      ? pullRequestMachine.detail({
          machineId,
          input: reference,
        })
      : null,
  ).data;
  return reference ? ((detail ?? cachedDetail)?.url ?? fallbackUrl) : undefined;
}
