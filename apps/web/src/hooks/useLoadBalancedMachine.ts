import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { chooseLoadBalancedMachine } from "@vekrel/client-runtime/load-balancing";
import type { MachineId } from "@vekrel/contracts";
import { Atom } from "effect/reactivity";
import { useContext } from "react";

import { serverMachine } from "../state/server";

// Mirrors the freshness window in chooseLoadBalancedMachine.
const HOST_RESOURCES_FRESH_MS = 15_000;

// Keyed by content: callers derive the list every render.
const hostResourcesAtom = Atom.family((machineIdsKey: string) =>
  Atom.make((get) => {
    // Staleness is judged when a snapshot is read, which keeps render pure.
    const evaluatedAt = Date.now();
    const resources = (
      machineIdsKey === "" ? [] : (machineIdsKey.split("\n") as MachineId[])
    ).map((machineId) => {
      const result = get(serverMachine.hostResources({ machineId, input: {} }));
      return {
        machineId,
        resources: result._tag === "Success" ? result.value : null,
        receivedAt: result._tag === "Success" ? result.timestamp : 0,
        pending: result._tag === "Initial" || result.waiting,
        failed: result._tag === "Failure",
      };
    });
    // Re-read when the next fresh snapshot ages out, so a frozen evaluatedAt never selects it.
    const nextExpiry = Math.min(
      ...resources
        .map((resource) => resource.receivedAt + HOST_RESOURCES_FRESH_MS)
        .filter((expiresAt) => expiresAt >= evaluatedAt),
    );
    if (Number.isFinite(nextExpiry)) {
      const timer = setTimeout(() => get.refreshSelf(), nextExpiry - evaluatedAt + 1);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return { evaluatedAt, resources };
  }),
);

/** Only mounted for unresolved automatic drafts, so idle clients do not poll hosts. */
export function useLoadBalancedMachine(
  machineIds: readonly MachineId[],
  weights: Readonly<Record<string, number>>,
) {
  const registry = useContext(RegistryContext);
  const refresh = (ids: readonly MachineId[]) => {
    for (const machineId of ids) {
      registry.refresh(serverMachine.hostResources({ machineId, input: {} }));
    }
  };
  const { evaluatedAt, resources } = useAtomValue(hostResourcesAtom(machineIds.join("\n")));
  const pending = resources.some((resource) => resource.pending);
  const machineId = chooseLoadBalancedMachine(
    resources.map((resource) => ({
      ...resource,
      weight: weights[resource.machineId] ?? 50,
    })),
    evaluatedAt,
  ) as MachineId | null;
  return {
    refresh,
    pending,
    machineId,
    failed: !pending && machineId === null && resources.some((resource) => resource.failed),
  };
}
