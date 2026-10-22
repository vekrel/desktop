import { T3_PROJECT_FILE_NAME, type MachineId, type T3ProjectFile } from "@vekrel/contracts";
import { parseT3ProjectFile } from "@vekrel/shared/t3ProjectFile";
import { executeAtomQuery } from "@vekrel/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readT3ProjectFile(
  machineId: MachineId,
  workspaceRoot: string,
): Promise<T3ProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(machineId, workspaceRoot, T3_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    machineId,
    workspaceRoot,
    T3_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseT3ProjectFile(data.contents);
}
