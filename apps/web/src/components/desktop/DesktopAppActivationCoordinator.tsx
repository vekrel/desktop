import { squashAtomCommandFailure } from "@vekrel/client-runtime/state/runtime";
import type { DesktopAppActivationRequest } from "@vekrel/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { handleDesktopAppActivationRequest } from "../../desktopAppActivation";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { findProjectByPath, inferProjectTitleFromPath } from "../../lib/projectPaths";
import { newProjectId } from "../../lib/utils";
import { readProjects, waitForProject } from "../../state/entities";
import { usePrimaryMachine } from "../../state/machines";
import { projectMachine } from "../../state/projects";
import { useMachineShellHasSnapshot } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";

export function DesktopAppActivationCoordinator() {
  const primaryMachine = usePrimaryMachine();
  const createProject = useAtomCommand(projectMachine.create, { reportFailure: false });
  const openThread = useNewThreadHandler();
  const queueRef = useRef(Promise.resolve());
  const activation = window.desktopBridge?.appActivation;
  const shellHasSnapshot = useMachineShellHasSnapshot(
    primaryMachine?.machineId ?? null,
  );
  const ready =
    activation !== undefined &&
    primaryMachine?.connection.phase === "connected" &&
    primaryMachine.serverConfig !== null &&
    shellHasSnapshot;

  const processRequest = useEffectEvent(async (request: DesktopAppActivationRequest) =>
    handleDesktopAppActivationRequest(request, {
      getTarget: () => {
        if (
          primaryMachine?.connection.phase !== "connected" ||
          primaryMachine.serverConfig === null
        ) {
          return null;
        }
        return {
          machineId: primaryMachine.machineId,
          platform: primaryMachine.serverConfig.machine.platform.os,
        };
      },
      findProject: (machineId, workspaceRoot) =>
        findProjectByPath(
          readProjects().filter((project) => project.machineId === machineId),
          workspaceRoot,
        ) ?? null,
      createProject: async (machineId, workspaceRoot) => {
        const projectId = newProjectId();
        const result = await createProject({
          machineId,
          input: {
            projectId,
            title: inferProjectTitleFromPath(workspaceRoot),
            workspaceRoot,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          throw error instanceof Error ? error : new Error("Vekrel could not add the project.");
        }
        return projectId;
      },
      waitForProject: async (projectRef) => {
        await waitForProject(projectRef);
      },
      openThread: (projectRef) => openThread(projectRef),
    }),
  );

  useEffect(() => {
    if (!ready || activation === undefined) return;

    let subscribed = true;
    const unsubscribe = activation.onRequest((request) => {
      queueRef.current = queueRef.current.then(async () => {
        const response = await processRequest(request);
        await activation.complete(response);
      });
      queueRef.current = queueRef.current.catch(() => undefined);
    });
    // Skip readiness if React runs cleanup before this subscription can receive requests.
    queueMicrotask(() => {
      if (subscribed) void activation.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void activation.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [activation, ready]);

  return null;
}
