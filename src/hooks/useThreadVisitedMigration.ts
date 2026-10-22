import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef, scopedThreadKey } from "@vekrel/client-runtime/machine";
import type { MachineThreadShell } from "@vekrel/client-runtime/state/shell";
import { useContext, useEffect, useEffectEvent } from "react";

import { machineThreadShells, threadMachine } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useUiStateStore } from "../uiStateStore";

const migratedThreadKeys = new Set<string>();

// Subscribes outside render: the migration only acts on threads it has not
// seen, so a shell update must not re-render the layout that mounts it.
export function useThreadVisitedMigration(): void {
  const registry = useContext(RegistryContext);
  const visitThreadMutation = useAtomCommand(threadMachine.visit, { reportFailure: false });
  const migrate = useEffectEvent((threads: ReadonlyArray<MachineThreadShell>) => {
    for (const thread of threads) {
      // Field absent → the machine's server has no visited tracking; keep
      // the local value in play and reconsider if the server upgrades.
      if (thread.lastVisitedAt === undefined) continue;
      const threadKey = scopedThreadKey(scopeThreadRef(thread.machineId, thread.id));
      if (migratedThreadKeys.has(threadKey)) continue;
      migratedThreadKeys.add(threadKey);
      const local = useUiStateStore.getState().threadLastVisitedAtById[threadKey];
      if (!local) continue;
      const localMs = Date.parse(local);
      if (!Number.isFinite(localMs)) continue;
      const serverMs = thread.lastVisitedAt === null ? null : Date.parse(thread.lastVisitedAt);
      if (serverMs !== null && Number.isFinite(serverMs) && serverMs >= localMs) continue;
      void visitThreadMutation({
        machineId: thread.machineId,
        input: { threadId: thread.id, visitedAt: local },
      });
    }
  });
  useEffect(
    () =>
      registry.subscribe(machineThreadShells.threadShellsAtom, migrate, { immediate: true }),
    [registry],
  );
}
