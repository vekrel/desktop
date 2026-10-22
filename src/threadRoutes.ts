import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import type { MachineShellStatus } from "@vekrel/client-runtime/state/shell";
import type { MachineThreadState } from "@vekrel/client-runtime/state/threads";
import type { MachineId, ScopedThreadRef, ThreadId } from "@vekrel/contracts";
import * as Option from "effect/Option";
import type { DraftId } from "./composerDraftStore";

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

type DraftThreadRouteState = {
  machineId: MachineId;
  threadId: ThreadId;
  promotedTo?: ScopedThreadRef | null;
};

export type ThreadRouteRenderState = "loading" | "ready" | "missing";

export function isThreadRouteSnapshotAuthoritative(
  status: MachineShellStatus | null | undefined,
): boolean {
  return status === "live";
}

export function resolveThreadRouteRenderState(input: {
  bootstrapComplete: boolean;
  serverThreadExists: boolean;
  serverThreadDeleted: boolean;
  unlistedThreadDetail: MachineThreadState;
  draftThreadExists: boolean;
}): ThreadRouteRenderState {
  if (input.draftThreadExists || (input.serverThreadExists && !input.serverThreadDeleted)) {
    return "ready";
  }
  if (!input.bootstrapComplete) {
    return "loading";
  }
  if (input.serverThreadExists || input.unlistedThreadDetail.status === "deleted") {
    return "missing";
  }
  // Shell membership can lag a new thread; its detail decides.
  const projection = Option.getOrNull(input.unlistedThreadDetail.data);
  if (projection === null) {
    return "loading";
  }
  return projection.thread.deletedAt !== null || projection.thread.archivedAt !== null
    ? "missing"
    : "ready";
}

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  machineId: MachineId;
  threadId: ThreadId;
} {
  return {
    machineId: ref.machineId,
    threadId: ref.threadId,
  };
}

/** Whether a (decoded) location pathname is `ref`'s own thread route, `/$machineId/$threadId`. */
export function isThreadRoutePathname(pathname: string, ref: ScopedThreadRef): boolean {
  const { machineId, threadId } = buildThreadRouteParams(ref);
  return pathname.replace(/\/$/, "") === `/${machineId}/${threadId}`;
}

export function buildDraftThreadRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

export function resolveThreadRouteRef(
  params: Partial<Record<"machineId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (!params.machineId || !params.threadId) {
    return null;
  }

  return scopeThreadRef(params.machineId as MachineId, params.threadId as ThreadId);
}

export function resolveThreadRouteTarget(
  params: Partial<Record<"machineId" | "threadId" | "draftId", string | undefined>>,
): ThreadRouteTarget | null {
  if (params.machineId && params.threadId) {
    return {
      kind: "server",
      threadRef: scopeThreadRef(params.machineId as MachineId, params.threadId as ThreadId),
    };
  }

  if (!params.draftId) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}

export function resolveActiveThreadRouteRef(
  target: ThreadRouteTarget | null,
  draftThread: DraftThreadRouteState | null,
): ScopedThreadRef | null {
  if (target?.kind === "server") {
    return target.threadRef;
  }
  if (target?.kind !== "draft" || !draftThread?.promotedTo) {
    return null;
  }
  return draftThread.promotedTo;
}
