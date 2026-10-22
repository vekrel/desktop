import { AuthFilesystemWriteScope, type MachineId } from "@vekrel/contracts";
import { createRef, useEffect, useState } from "react";

import { projectMachine } from "~/state/projects";
import { readMachineScope, useMachineScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import {
  confirmProjectFileQueryData,
  getUnsavedProjectFileQueryData,
} from "./projectFilesQueryState";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  machineId: MachineId;
  cwd: string;
  relativePath: string;
  onPendingChange: (relativePath: string, pending: boolean) => void;
}

export function useFileSaveCoordinator({
  machineId,
  cwd,
  relativePath,
  onPendingChange,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change"> {
  const canWriteFiles = useMachineScope(machineId, AuthFilesystemWriteScope);
  const writeFile = useProjectFileWriter();
  // A session owns the pending debounce, so it must outlive rerenders and be
  // replaced only when what it writes to changes.
  const inputs = { machineId, cwd, relativePath, onPendingChange, writeFile };
  const [current, setCurrent] = useState(() => ({
    inputs,
    session: createFileSaveSession(inputs),
  }));
  if (
    current.inputs.machineId !== machineId ||
    current.inputs.cwd !== cwd ||
    current.inputs.relativePath !== relativePath ||
    current.inputs.onPendingChange !== onPendingChange ||
    current.inputs.writeFile !== writeFile
  ) {
    setCurrent({ inputs, session: createFileSaveSession(inputs) });
  }
  const session = current.session;

  // StrictMode replays effect setup. Retired file sessions stay inert, while the
  // replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  useEffect(() => {
    if (!canWriteFiles) return;
    let cancelled = false;
    // Replay must retire the first session before recovery queues a draft to flush.
    queueMicrotask(() => {
      if (cancelled) return;
      const unsaved = getUnsavedProjectFileQueryData(machineId, cwd, relativePath);
      if (unsaved) session.change(unsaved.contents);
    });
    return () => {
      cancelled = true;
    };
  }, [canWriteFiles, cwd, machineId, relativePath, session]);
  return session;
}

function useProjectFileWriter() {
  return useAtomCommand(projectMachine.writeFile);
}

function createFileSaveSession({
  machineId,
  cwd,
  relativePath,
  onPendingChange,
  writeFile,
}: FileSaveOptions & {
  writeFile: ReturnType<typeof useProjectFileWriter>;
}) {
  const coordinatorRef = createRef<FileSaveCoordinator>();
  return {
    change: (contents: string) => coordinatorRef.current?.change(contents),
    setup: () => {
      const coordinator = new FileSaveCoordinator({
        debounceMs: FILE_SAVE_DEBOUNCE_MS,
        canPersist: () => readMachineScope(machineId, AuthFilesystemWriteScope),
        onPendingChange: (pending) => onPendingChange(relativePath, pending),
        persist: (nextContents) =>
          writeFile({
            machineId,
            input: { cwd, relativePath, contents: nextContents },
          }),
        onConfirmed: (confirmedContents) =>
          confirmProjectFileQueryData(machineId, cwd, relativePath, confirmedContents),
      });
      coordinatorRef.current = coordinator;
      return () => {
        coordinatorRef.current = null;
        coordinator.dispose();
      };
    },
  };
}
