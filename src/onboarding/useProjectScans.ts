import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { MachineId } from "@vekrel/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useContext } from "react";

import { agentSessionScan } from "../state/agentSessions";
import { machineAtomList, machineIdsKey } from "../state/machineAtomList";
import { formatMachineQueryError } from "../state/query";

const scanAtom = (machineId: MachineId) => agentSessionScan({ machineId, input: {} });
const projectScansAtom = machineAtomList("web-project-scans", scanAtom);

export function useProjectScans(machineIds: readonly MachineId[]) {
  const registry = useContext(RegistryContext);
  const results = useAtomValue(projectScansAtom(machineIdsKey(machineIds)));
  return machineIds.map((machineId, index) => {
    const result = results[index]!;
    return {
      machineId,
      data: Option.getOrNull(AsyncResult.value(result)),
      error: result._tag === "Failure" ? formatMachineQueryError(result.cause) : null,
      isPending: result.waiting || result._tag === "Initial",
      refresh: () => registry.refresh(scanAtom(machineId)),
    };
  });
}
