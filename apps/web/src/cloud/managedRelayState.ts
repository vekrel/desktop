import { useAtomValue } from "@effect/atom-react";
import {
  createManagedRelayQueryManager,
  deregisterManagedRelayMachine,
  ManagedRelay,
  managedRelaySessionAtom,
  readManagedRelaySnapshotState,
} from "@vekrel/client-runtime/relay";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@vekrel/client-runtime/state/runtime";
import type {
  RelayClientDeviceRecord,
  RelayClientMachineRecord,
} from "@vekrel/contracts/relay";
import type { MachineId } from "@vekrel/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { runtime } from "../lib/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const managedRelayAtomRuntime = Atom.runtime(
  Layer.effect(
    ManagedRelay.ManagedRelayClient,
    runtime.contextEffect.pipe(
      Effect.map((context) => Context.get(context, ManagedRelay.ManagedRelayClient)),
    ),
  ),
);

const managedRelayQueryManager = createManagedRelayQueryManager(managedRelayAtomRuntime);

const managedRelayMutationScheduler = createAtomCommandScheduler();

export const deregisterManagedRelayMachineCommand = createRuntimeCommand(
  managedRelayAtomRuntime,
  {
    label: "web:managed-relay:deregister-machine",
    scheduler: managedRelayMutationScheduler,
    concurrency: {
      mode: "serial",
      key: (input: { readonly accountId: string; readonly machineId: MachineId }) =>
        input.accountId,
    },
    execute: (input, registry) => deregisterManagedRelayMachine(registry, input),
  },
);

const EMPTY_MACHINES_ATOM = Atom.make(
  AsyncResult.success<ReadonlyArray<RelayClientMachineRecord>>([]),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:web:machines:null"));

const EMPTY_DEVICES_ATOM = Atom.make(
  AsyncResult.success<ReadonlyArray<RelayClientDeviceRecord>>([]),
).pipe(Atom.keepAlive, Atom.withLabel("managed-relay:web:devices:null"));

export function useManagedRelayMachines() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId
    ? managedRelayQueryManager.machinesAtom(accountId)
    : EMPTY_MACHINES_ATOM;
  const result = useAtomValue(atom);
  const snapshot = readManagedRelaySnapshotState(result);
  useEffect(() => {
    if (snapshot.error) {
      console.error("[t3-cloud] Relay machine listing failed", {
        message: snapshot.error,
        traceId: snapshot.errorTraceId,
      });
    }
  }, [snapshot.error, snapshot.errorTraceId]);
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshMachines(appAtomRegistry, accountId);
    }
  };

  return {
    ...snapshot,
    accountId,
    refresh,
  };
}

export function useManagedRelayDevices() {
  const session = useAtomValue(managedRelaySessionAtom);
  const accountId = session?.accountId ?? null;
  const atom = accountId ? managedRelayQueryManager.devicesAtom(accountId) : EMPTY_DEVICES_ATOM;
  const result = useAtomValue(atom);
  const snapshot = readManagedRelaySnapshotState(result);
  useEffect(() => {
    if (snapshot.error) {
      console.error("[t3-cloud] Relay device listing failed", {
        message: snapshot.error,
        traceId: snapshot.errorTraceId,
      });
    }
  }, [snapshot.error, snapshot.errorTraceId]);
  const refresh = () => {
    if (accountId) {
      managedRelayQueryManager.refreshDevices(appAtomRegistry, accountId);
    }
  };

  return {
    ...snapshot,
    accountId,
    refresh,
  };
}
