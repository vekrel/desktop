import { useAtomValue } from "@effect/atom-react";
import { createDeviceMachineAtoms } from "@vekrel/client-runtime/state/device";
import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
} from "@vekrel/client-runtime/state/deviceHubAccess";
import type { DeviceServiceState, MachineId } from "@vekrel/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { machineSession } from "./session";
import { useMachineQuery } from "./query";

export const deviceMachine = createDeviceMachineAtoms(connectionAtomRuntime);

const EMPTY_DEVICE_STATE: DeviceServiceState = {
  hosts: [],
  hostStatus: "disabled",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
};

export function useDeviceState(machineId: MachineId | null): {
  readonly state: DeviceServiceState;
  readonly loaded: boolean;
} {
  const query = useMachineQuery(
    machineId === null ? null : deviceMachine.state({ machineId, input: {} }),
  );
  return { state: query.data ?? EMPTY_DEVICE_STATE, loaded: query.data !== undefined };
}

const deviceHubAccessAtom = Atom.family((machineId: MachineId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(machineSession.preparedConnectionValueAtom(machineId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: EMPTY_DEVICE_STATE.hubBasePath });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`device-hub-access:${machineId}`)),
);

export function useDeviceHubAccess(
  machineId: MachineId | null,
  hostId = "local",
): DeviceHubAccess | null {
  const result = useAtomValue(
    machineId === null ? EMPTY_ACCESS_ATOM : deviceHubAccessAtom(machineId),
  );
  return AsyncResult.isSuccess(result)
    ? { ...result.value, query: { ...result.value.query, hostId } }
    : null;
}

const EMPTY_ACCESS_ATOM = Atom.make(AsyncResult.initial<DeviceHubAccess, never>()).pipe(
  Atom.withLabel("device-hub-access:empty"),
);

export function refreshDeviceHubAccess(machineId: MachineId): void {
  appAtomRegistry.refresh(deviceHubAccessAtom(machineId));
}

/** Mints a fresh hub ticket for a one-off request that failed with 401. Resolves null on failure. */
export function renewDeviceHubAccess(
  machineId: MachineId,
  hostId = "local",
): Promise<DeviceHubAccess | null> {
  const atom = deviceHubAccessAtom(machineId);
  appAtomRegistry.refresh(atom);
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.map((access) => ({ ...access, query: { ...access.query, hostId } })),
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}
