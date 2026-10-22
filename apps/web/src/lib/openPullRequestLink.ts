import type { MachineId, PullRequestRef, ScopedThreadRef } from "@vekrel/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { type MouseEvent } from "react";

import { sourceControlClients } from "@vekrel/client-runtime/source-control-clients";
import { parseChangeRequestUrl, type ChangeRequestLink } from "@vekrel/shared/changeRequestUrl";
import { sourceControlRepositorySelector } from "@vekrel/shared/sourceControl";

import { useOpenLink } from "../browser/useOpenLink";
import { useClientSettings } from "../hooks/useSettings";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useRightPanelStore } from "../rightPanelStore";
import type { MachineProject } from "@vekrel/client-runtime/state/shell";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, useProjects } from "../state/entities";
import { machineServerConfigsAtom, serverMachine } from "../state/server";
import { usePrimaryMachineId } from "../state/machines";

export {
  parseChangeRequestUrl,
  type ChangeRequestLink,
  gitHubPullRequestBrowserUrl,
  pullRequestCandidateUrlFromReferenceAutolink,
  matchesLinkedPullRequestUrl,
  changeRequestRepositoryUrl,
} from "@vekrel/shared/changeRequestUrl";

export function findProjectForChangeRequest(
  projects: ReadonlyArray<MachineProject>,
  link: ChangeRequestLink,
): MachineProject | undefined {
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).isChangeRequestInRepository(identity, link)
    );
  });
}

export function resolvePullRequestPreviewTarget({
  machineId,
  projects,
  pullRequestsEnabled,
  url,
}: {
  machineId: MachineId | null;
  projects: ReadonlyArray<MachineProject>;
  pullRequestsEnabled: boolean;
  url: string;
}): { machineId: MachineId; input: PullRequestRef } | null {
  if (!pullRequestsEnabled || machineId === null) return null;
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) return null;
  const project = findProjectForChangeRequest(
    projects.filter((candidate) => candidate.machineId === machineId),
    parsed,
  );
  if (project === undefined) return null;
  return {
    machineId,
    input: {
      projectId: project.id,
      host: parsed.authority ?? parsed.host,
      repository: sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository,
      number: parsed.number,
    },
  };
}

export function usePullRequestPreviewTarget(machineId: MachineId | null, url: string) {
  const projects = useProjects();
  const serverConfig = useAtomValue(serverMachine.configValueAtom(machineId));
  return resolvePullRequestPreviewTarget({
    machineId,
    projects,
    pullRequestsEnabled: serverConfig?.machine.capabilities.pullRequests === true,
    url,
  });
}

export function findProjectOnChangeRequestHost(
  projects: ReadonlyArray<MachineProject>,
  link: ChangeRequestLink,
): MachineProject | undefined {
  const own = findProjectForChangeRequest(projects, link);
  if (own !== undefined) return own;
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    return (
      identity?.provider !== undefined &&
      sourceControlClients.get(identity.provider).canReadChangeRequestOnHost(identity, link)
    );
  });
}

export function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey"> &
    Partial<Pick<MouseEvent<HTMLElement>, "button">>,
): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function useOpenChangeRequestLink(
  threadRef?: ScopedThreadRef,
  panelRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  >,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetMachineId?: MachineId,
) => boolean {
  const navigate = useNavigate();
  const primaryMachineId = usePrimaryMachineId();
  const openInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  return (event, targetUrl, targetThreadRef, targetMachineId) => {
    if (!openInApp || shouldOpenPullRequestExternally(event)) return false;
    // Read at click time: every provider status push replaces the config map, and
    // subscribing would hand every rendered link a new handler. Projects likewise, so a
    // link can resolve against a snapshot that arrived after this handler was built.
    const serverConfigs = appAtomRegistry.get(machineServerConfigsAtom);
    const allProjects = readProjects();
    const resolvedThreadRef = targetThreadRef ?? threadRef;
    const resolvedPanelRef = panelRef ?? resolvedThreadRef;
    const parsed = parseChangeRequestUrl(targetUrl);
    if (parsed === null) return false;
    const reads = (machineId: string) =>
      serverConfigs.get(machineId as MachineId)?.machine.capabilities.pullRequests ===
      true;
    // Beside a thread the panel reads on that thread's machine, so a project from another
    // one could not be read there whatever its remote says: two machines can hold the same
    // repository, and handing the panel the wrong one's id opens a surface that never loads.
    const projects = resolvedThreadRef
      ? allProjects.filter((project) => project.machineId === resolvedThreadRef.machineId)
      : targetMachineId
        ? allProjects.filter((project) => project.machineId === targetMachineId)
        : allProjects
            .filter((project) => reads(project.machineId))
            .toSorted(
              (left, right) =>
                Number(right.machineId === primaryMachineId) -
                Number(left.machineId === primaryMachineId),
            );
    const exactProject = findProjectForChangeRequest(projects, parsed);
    const project =
      exactProject ??
      (resolvedPanelRef
        ? findProjectOnChangeRequestHost(
            projects.filter(
              (candidate) =>
                serverConfigs.get(candidate.machineId)?.machine.capabilities
                  .threadPullRequests === true,
            ),
            parsed,
          )
        : undefined);
    if (project === undefined || !reads(project.machineId)) return false;
    const repository =
      serverConfigs.get(project.machineId)?.machine.capabilities.threadPullRequests === true
        ? parsed.repository
        : (sourceControlRepositorySelector(project.repositoryIdentity) ?? parsed.repository);
    event.preventDefault();
    event.stopPropagation();
    if (resolvedPanelRef) {
      useRightPanelStore.getState().openPullRequest(resolvedPanelRef, {
        // The standalone PR panel has a synthetic ref; each tab keeps its real machine.
        ...(resolvedPanelRef.machineId === project.machineId
          ? {}
          : { machineId: project.machineId }),
        projectId: project.id,
        ...(serverConfigs.get(project.machineId)?.machine.capabilities
          .threadPullRequests === true
          ? { host: parsed.authority ?? parsed.host }
          : {}),
        repository,
        url: targetUrl,
        number: parsed.number,
      });
      if (!resolvedThreadRef) {
        void navigate({
          to: "/pull-requests",
          search: (previous) => ({
            ...previous,
            involvement: previous.involvement ?? "all",
            state: previous.state ?? "all",
            repository,
            number: parsed.number,
            selectedHost: parsed.authority ?? parsed.host,
            selectedProjectId: project.id,
            selectedMachineId: project.machineId,
          }),
          replace: true,
        });
      }
      return true;
    }
    void navigate({
      to: "/pull-requests",
      search: {
        involvement: "all",
        state: "all",
        repository,
        number: parsed.number,
        selectedHost: parsed.authority ?? parsed.host,
        selectedProjectId: project.id,
        selectedMachineId: project.machineId,
      },
    });
    return true;
  };
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  const openLink = useOpenLink(threadRef);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    const openInBrowser = shouldOpenPullRequestExternally(event);
    const isAnchor =
      event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
    // A real link already knows how to cmd/ctrl/middle-click. Leave its default
    // action alone so the browser (or Electron's window-open handler) opens
    // the host. Buttons have no href, so they still go through openExternal.
    if (openInBrowser && isAnchor) return false;

    event.preventDefault();
    if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

    void openLink(prUrl, { event, threadRef: targetThreadRef }).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
    return false;
  };
}
