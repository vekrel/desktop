import { useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@vekrel/client-runtime/machine";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@vekrel/client-runtime/state/runtime";
import {
  projectCloneDisplayName,
  projectCloneProgressSummary,
  type MachineId,
  type ProjectCloneSnapshot,
  type ProjectId,
} from "@vekrel/contracts";
import { useEffect, useRef } from "react";

import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useRemoveClonedProject } from "../hooks/useRemoveClonedProject";
import { useMachines } from "../state/machines";
import {
  isProjectCloneToastSilenced,
  silenceProjectCloneToasts,
  useMachineProjectClones,
} from "../state/projectClones";
import { sourceControlMachine } from "../state/sourceControl";
import { useAtomCommand } from "../state/use-atom-command";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { toastManager } from "./ui/toast";
import { stackedThreadToast } from "./ui/toastHelpers";

export function ProjectCloneToastCoordinator() {
  const { machines } = useMachines();
  return machines.map((machine) => (
    <MachineCloneToasts
      key={machine.machineId}
      machineId={machine.machineId}
    />
  ));
}

interface TrackedToast {
  readonly toastId: ReturnType<typeof toastManager.add>;
  readonly renderedKey: string;
  readonly phase: ProjectCloneSnapshot["phase"];
}

function renderKey(clone: ProjectCloneSnapshot): string {
  return `${clone.phase}:${clone.stage}:${clone.percent ?? ""}:${clone.detail ?? ""}:${clone.stalled === true}:${clone.error ?? ""}`;
}

async function runCloneAction(
  title: string,
  action: () => Promise<AtomCommandResult<unknown, unknown>>,
) {
  const result = await action();
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}

function MachineCloneToasts({ machineId }: { machineId: MachineId }) {
  const clones = useMachineProjectClones(machineId);
  const handleNewThread = useNewThreadHandler();
  const { draftId: routeDraftId } = useParams({ strict: false });
  const cancelClone = useAtomCommand(sourceControlMachine.cancelProjectClone, {
    reportFailure: false,
  });
  const retryClone = useAtomCommand(sourceControlMachine.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  const toasts = useRef(new Map<ProjectId, TrackedToast>());

  const isViewingProjectDraft = (projectId: ProjectId) => {
    if (!routeDraftId) return false;
    const draft = useComposerDraftStore.getState().getDraftSession(routeDraftId as DraftId);
    return draft?.machineId === machineId && draft.projectId === projectId;
  };

  const openProject = (projectId: ProjectId) => {
    void handleNewThread(scopeProjectRef(machineId, projectId));
  };

  useEffect(() => {
    const seen = new Set<ProjectId>();
    for (const clone of clones) {
      seen.add(clone.projectId);
      const key = renderKey(clone);
      const tracked = toasts.current.get(clone.projectId);
      const name = projectCloneDisplayName(clone);
      const closeToast = () => {
        const current = toasts.current.get(clone.projectId);
        if (!current) return;
        toastManager.close(current.toastId);
        toasts.current.delete(clone.projectId);
      };
      const ref = { machineId, projectId: clone.projectId };
      if (isViewingProjectDraft(clone.projectId)) {
        silenceProjectCloneToasts(ref);
        closeToast();
        continue;
      }
      if (tracked?.renderedKey === key) continue;
      if (
        isProjectCloneToastSilenced(ref) &&
        (clone.phase === "running" || clone.phase === "done")
      ) {
        closeToast();
        continue;
      }

      if (clone.phase === "running") {
        const options = stackedThreadToast({
          type: "loading",
          title: `Cloning ${name}`,
          description: projectCloneProgressSummary(clone),
          timeout: 0,
          actionProps: {
            children: "Cancel",
            onClick: () => {
              void runCloneAction("Failed to cancel clone", () =>
                cancelClone({ machineId, input: { projectId: clone.projectId } }),
              );
            },
          },
          data: { hideCopyButton: true },
        });
        if (tracked) {
          toastManager.update(tracked.toastId, options);
          toasts.current.set(clone.projectId, { ...tracked, renderedKey: key, phase: "running" });
        } else {
          const toastId = toastManager.add(options);
          toasts.current.set(clone.projectId, { toastId, renderedKey: key, phase: "running" });
        }
        continue;
      }

      if (clone.phase === "done") {
        const options = stackedThreadToast({
          type: "success",
          title: `Cloned ${name}`,
          description: clone.destinationPath,
          timeout: 8_000,
          actionProps: {
            children: "Open project",
            onClick: () => {
              closeToast();
              openProject(clone.projectId);
            },
          },
          data: { hideCopyButton: true },
        });
        if (tracked) {
          toastManager.update(tracked.toastId, options);
          toasts.current.set(clone.projectId, { ...tracked, renderedKey: key, phase: "done" });
        } else {
          const toastId = toastManager.add(options);
          toasts.current.set(clone.projectId, { toastId, renderedKey: key, phase: "done" });
        }
        continue;
      }

      const cancelled = clone.phase === "cancelled";
      const options = stackedThreadToast({
        type: cancelled ? "info" : "error",
        title: cancelled ? `Cancelled cloning ${name}` : `Failed to clone ${name}`,
        description: cancelled ? clone.destinationPath : (clone.error ?? "The clone failed."),
        timeout: 0,
        actionProps: {
          children: "Retry",
          onClick: () => {
            void runCloneAction("Failed to retry clone", () =>
              retryClone({ machineId, input: { projectId: clone.projectId } }),
            );
          },
        },
        data: {
          ...(cancelled ? { hideCopyButton: true } : {}),
          secondaryActionProps: {
            children: "Remove project",
            onClick: () => {
              void removeClonedProject({ machineId, projectId: clone.projectId });
            },
          },
        },
      });
      if (tracked) {
        toastManager.update(tracked.toastId, options);
        toasts.current.set(clone.projectId, { ...tracked, renderedKey: key, phase: clone.phase });
      } else {
        const toastId = toastManager.add(options);
        toasts.current.set(clone.projectId, { toastId, renderedKey: key, phase: clone.phase });
      }
    }

    for (const [projectId, tracked] of toasts.current) {
      if (seen.has(projectId)) continue;
      if (tracked.phase !== "done") toastManager.close(tracked.toastId);
      toasts.current.delete(projectId);
    }
  }, [
    cancelClone,
    clones,
    machineId,
    isViewingProjectDraft,
    openProject,
    removeClonedProject,
    retryClone,
  ]);

  useEffect(
    () => () => {
      for (const tracked of toasts.current.values()) toastManager.close(tracked.toastId);
      toasts.current.clear();
    },
    [],
  );

  return null;
}
