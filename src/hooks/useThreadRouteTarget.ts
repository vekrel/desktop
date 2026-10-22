import type { ScopedThreadRef } from "@vekrel/contracts";
import { useParams } from "@tanstack/react-router";

import {
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
  type ThreadRouteTarget,
} from "../threadRoutes";

// The router re-runs selectors on every store update (preloads, location state,
// same-route navigations) and compares with ===. Selecting the string params keeps
// those updates from reaching consumers; the target is then built once per id change.
function useThreadRouteIds() {
  const machineId = useParams({ strict: false, select: (params) => params.machineId });
  const threadId = useParams({ strict: false, select: (params) => params.threadId });
  return { machineId, threadId };
}

export function useThreadRouteTarget(): ThreadRouteTarget | null {
  const { machineId, threadId } = useThreadRouteIds();
  const draftId = useParams({ strict: false, select: (params) => params.draftId });
  return resolveThreadRouteTarget({ machineId, threadId, draftId });
}

export function useThreadRouteRef(): ScopedThreadRef | null {
  return resolveThreadRouteRef(useThreadRouteIds());
}
