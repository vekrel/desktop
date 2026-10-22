import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import type { MachineId, ScopedThreadRef, ThreadId } from "@vekrel/contracts";
import { useState } from "react";

function toThreadRef(
  machineId: MachineId | null,
  threadId: ThreadId | null,
): ScopedThreadRef | null {
  return machineId !== null && threadId !== null
    ? scopeThreadRef(machineId, threadId)
    : null;
}

/**
 * Takes the thread object but keys on its ids: the shell changes identity on every update
 * during a run, and effects keyed on this ref must not re-run for that.
 */
export function useActiveThreadRef(
  thread: { readonly machineId: MachineId; readonly id: ThreadId } | null | undefined,
): ScopedThreadRef | null {
  const machineId = thread?.machineId ?? null;
  const threadId = thread?.id ?? null;
  const [ref, setRef] = useState(() => toThreadRef(machineId, threadId));
  if ((ref?.machineId ?? null) !== machineId || (ref?.threadId ?? null) !== threadId) {
    const next = toThreadRef(machineId, threadId);
    setRef(next);
    return next;
  }
  return ref;
}
