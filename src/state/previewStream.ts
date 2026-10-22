import { useAtomValue } from "@effect/atom-react";
import { PREVIEW_STREAM_BASE_PATH } from "@vekrel/client-runtime/preview/server-browser-stream";
import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
} from "@vekrel/client-runtime/state/deviceHubAccess";
import type { MachineId } from "@vekrel/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machineSession } from "./session";

const previewStreamAccessAtom = Atom.family((machineId: MachineId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(machineSession.preparedConnectionValueAtom(machineId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`preview-stream-access:${machineId}`)),
);

export function usePreviewStreamAccess(machineId: MachineId): DeviceHubAccess | null {
  const result = useAtomValue(previewStreamAccessAtom(machineId));
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function refreshPreviewStreamAccess(machineId: MachineId): void {
  appAtomRegistry.refresh(previewStreamAccessAtom(machineId));
}

export function readPreviewStreamAccess(
  machineId: MachineId,
  refresh: boolean,
): Promise<DeviceHubAccess | null> {
  const atom = previewStreamAccessAtom(machineId);
  if (refresh) appAtomRegistry.refresh(atom);
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}
