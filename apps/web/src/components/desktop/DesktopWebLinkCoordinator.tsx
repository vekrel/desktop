import { scopeProjectRef, scopeThreadRef } from "@vekrel/client-runtime/machine";
import { squashAtomCommandFailure } from "@vekrel/client-runtime/state/runtime";
import type { MachineId, ScopedThreadRef } from "@vekrel/contracts";
import { parseChangeRequestUrl } from "@vekrel/shared/changeRequestUrl";
import { promptLinkAppPath } from "@vekrel/shared/promptLinks";
import { useRouter } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { useEffect, useEffectEvent, useRef } from "react";

import { openFileInPreview, openUrlInPreview } from "../../browser/openFileInPreview";
import { isPreviewAvailableFor } from "../../browser/previewRuntime";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useScratchProject } from "../../hooks/useScratchProject";
import { useClientSettings } from "../../hooks/useSettings";
import { useOpenChangeRequestLink } from "../../lib/openPullRequestLink";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { assetMachine } from "../../state/assets";
import { useMachineHttpBaseUrl, usePrimaryMachine } from "../../state/machines";
import { previewMachine } from "../../state/preview";
import { allReachableShellsLiveAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** A link handed over by the OS is a plain click: nothing about it asks for the browser. */
const externalClick = {
  preventDefault() {},
  stopPropagation() {},
  metaKey: false,
  ctrlKey: false,
};

/** Resolves once every reachable machine has reported its projects or settled offline. */
const projectsSettled = (): Promise<void> =>
  Effect.runPromise(
    AtomRegistry.toStream(appAtomRegistry, allReachableShellsLiveAtom).pipe(
      Stream.filter((settled) => settled),
      Stream.runHead,
      Effect.asVoid,
    ),
  );

/**
 * HTML files are served by this machine, so only its threads can
 * take them.
 */
function threadShowingBrowser(
  routeParams: Record<string, string | undefined>,
  fileMachineId: MachineId | null,
): ScopedThreadRef | null {
  const target = resolveThreadRouteTarget(routeParams);
  if (target === null) return null;
  let threadRef = target.kind === "server" ? target.threadRef : null;
  if (target.kind === "draft") {
    const session = useComposerDraftStore.getState().getDraftSession(target.draftId);
    if (!session || session.promotedTo) return null;
    threadRef = scopeThreadRef(session.machineId, session.threadId);
  }
  if (threadRef === null || !isPreviewAvailableFor(threadRef.machineId)) return null;
  if (fileMachineId !== null && threadRef.machineId !== fileMachineId) return null;
  const surface = selectActiveRightPanelSurface(
    useRightPanelStore.getState().byThreadKey,
    threadRef,
  );
  return surface?.kind === "preview" ? threadRef : null;
}

export function DesktopWebLinkCoordinator() {
  const router = useRouter();
  const primaryMachine = usePrimaryMachine();
  const openPullRequestsInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const openChangeRequest = useOpenChangeRequestLink();
  const { scratchMachineId, openScratchProject } = useScratchProject();
  const openThread = useNewThreadHandler();
  const openPreview = useAtomCommand(previewMachine.open, { reportFailure: false });
  const createAssetUrl = useAtomQueryRunner(assetMachine.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const httpBaseUrl = useMachineHttpBaseUrl(primaryMachine?.machineId ?? null);
  const queueRef = useRef(Promise.resolve());
  const webLinks = window.desktopBridge?.webLinks;
  const ready =
    webLinks !== undefined &&
    primaryMachine?.connection.phase === "connected" &&
    primaryMachine.serverConfig !== null;

  const reportFailure = (url: string, description = url) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not open the link", description }),
    );

  const startThread = async (url: string): Promise<ScopedThreadRef | null> => {
    const machineId = scratchMachineId(primaryMachine?.machineId ?? null);
    if (machineId === null) {
      reportFailure(url);
      return null;
    }
    const project = await openScratchProject(machineId, "Could not open the link");
    if (!project) return null;
    const opened = await openThread(scopeProjectRef(project.machineId, project.id));
    if (!opened) {
      reportFailure(url);
      return null;
    }
    const threadRef = scopeThreadRef(project.machineId, opened.threadId);
    useRightPanelStore.getState().requestMaximize(threadRef);
    return threadRef;
  };

  const openLink = useEffectEvent(async (url: string) => {
    const appPath = promptLinkAppPath(url);
    if (appPath !== null) {
      await router.navigate({ href: appPath });
      return;
    }
    if (openChangeRequest(externalClick, url)) return;
    const isFile = url.startsWith("file:");
    const routeParams = router.state.matches.at(-1)?.params ?? {};
    const threadRef =
      threadShowingBrowser(
        routeParams,
        isFile ? (primaryMachine?.machineId ?? null) : null,
      ) ?? (await startThread(url));
    if (threadRef === null) return;
    const result = isFile
      ? httpBaseUrl === null
        ? null
        : await openFileInPreview({
            threadRef,
            filePath: decodeURIComponent(new URL(url).pathname),
            workspaceRoot: undefined,
            httpBaseUrl,
            createAssetUrl,
            openPreview,
          })
      : await openUrlInPreview({ threadRef, url, openPreview });
    if (result === null) {
      reportFailure(url);
      return;
    }
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      reportFailure(url, error instanceof Error ? error.message : url);
    }
  });

  const receiveLink = useEffectEvent((url: string) => {
    // A connected server publishes its config before its project snapshot, so a PR link
    // delivered at launch would miss its project and fall through to the browser. Hold PR
    // links, and only those, until discovery settles; an ordinary link never waits for it.
    const hold =
      openPullRequestsInApp && parseChangeRequestUrl(url) !== null
        ? projectsSettled()
        : Promise.resolve();
    void hold.then(() => {
      queueRef.current = queueRef.current.then(() => openLink(url)).catch(() => undefined);
    });
  });

  useEffect(() => {
    if (!ready || webLinks === undefined) return;
    let subscribed = true;
    const unsubscribe = webLinks.onOpen(receiveLink);
    queueMicrotask(() => {
      if (subscribed) void webLinks.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void webLinks.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [ready, webLinks]);

  return null;
}
