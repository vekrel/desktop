import { useAtomValue } from "@effect/atom-react";
import {
  type ArchivedSnapshotEntry,
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsMachineKey,
} from "@vekrel/client-runtime/state/threads";
import type { MachineId } from "@vekrel/contracts";

import { orchestrationMachine } from "../state/orchestration";
import { appAtomRegistry } from "../rpc/atomRegistry";

function archivedSnapshotAtom(machineId: MachineId) {
  return orchestrationMachine.archivedShellSnapshot({
    machineId,
    input: {},
  });
}

const archivedSnapshotsAtom = createArchivedThreadSnapshotsAtomFamily({
  getSnapshotAtom: archivedSnapshotAtom,
  labelPrefix: "web:archived-thread-snapshots",
});

export function refreshArchivedThreadsForMachine(machineId: MachineId): void {
  appAtomRegistry.refresh(archivedSnapshotAtom(machineId));
}

export function useArchivedThreadSnapshots(machineIds: ReadonlyArray<MachineId>): {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly refresh: () => void;
} {
  const machineKey = makeArchivedThreadsMachineKey(machineIds);
  const result = useAtomValue(archivedSnapshotsAtom(machineKey));
  const refresh = () => {
    for (const machineId of machineIds) {
      appAtomRegistry.refresh(archivedSnapshotAtom(machineId));
    }
  };

  return {
    ...result,
    refresh,
  };
}
