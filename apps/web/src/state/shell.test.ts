import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@vekrel/client-runtime/connection";
import type { MachineCatalogState } from "@vekrel/client-runtime/state/connections";
import type { MachineShellState } from "@vekrel/client-runtime/state/shell";
import { MachineId } from "@vekrel/contracts";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createAllMachineProjectSnapshotsReadyAtom } from "./shell";

const LOCAL = MachineId.make("local");
const REMOTE = MachineId.make("remote");

function shellState(status: MachineShellState["status"]): MachineShellState {
  return {
    status,
    snapshot:
      status === "empty"
        ? Option.none()
        : Option.some({
            schemaVersion: 1,
            snapshotSequence: 1,
            projects: [],
            threads: [],
            archivedThreads: [],
          }),
    error: Option.none(),
  };
}

function catalogState(machineIds: readonly MachineId[]): MachineCatalogState {
  return {
    isReady: true,
    entries: new Map(
      machineIds.map((machineId) => [
        machineId,
        {
          target:
            machineId === LOCAL
              ? new PrimaryConnectionTarget({
                  machineId,
                  label: machineId,
                  httpBaseUrl: `https://${machineId}.example.test`,
                  wsBaseUrl: `wss://${machineId}.example.test`,
                })
              : new BearerConnectionTarget({
                  machineId,
                  connectionId: machineId,
                  label: machineId,
                }),
          profile: Option.none(),
          enabled: true,
        },
      ]),
    ),
  };
}

function makeHarness(requiresPrimaryMachine = true) {
  const catalog = Atom.make<MachineCatalogState>({ isReady: false, entries: new Map() });
  const shells = Atom.family((_machineId: MachineId) =>
    Atom.make<MachineShellState>(shellState("empty")),
  );
  const ready = createAllMachineProjectSnapshotsReadyAtom({
    catalogValueAtom: catalog,
    shellStateValueAtom: shells,
    requiresPrimaryMachine,
  });
  const registry = AtomRegistry.make();
  return { catalog, shells, ready, registry };
}

describe("project snapshot readiness", () => {
  it("does not clear a saved scope while the ready catalog is still empty", () => {
    const { catalog, ready, registry } = makeHarness();
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([]));
    expect(registry.get(ready)).toBe(false);
    registry.dispose();
  });

  it("waits for primary discovery even if a persisted remote is already live", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([REMOTE]));
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("allows a hosted client to load projects without a primary machine", () => {
    const { catalog, shells, ready, registry } = makeHarness(false);
    registry.set(catalog, catalogState([REMOTE]));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("waits for live snapshots through offline startup and reconnect", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("synchronizing"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);

    registry.set(shells(REMOTE), shellState("cached"));
    expect(registry.get(ready)).toBe(false);
    registry.set(shells(REMOTE), shellState("live"));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });

  it("stops waiting for a machine only when it leaves the catalog", () => {
    const { catalog, shells, ready, registry } = makeHarness();
    registry.set(catalog, catalogState([LOCAL, REMOTE]));
    registry.set(shells(LOCAL), shellState("live"));
    expect(registry.get(ready)).toBe(false);
    registry.set(catalog, catalogState([LOCAL]));
    expect(registry.get(ready)).toBe(true);
    registry.dispose();
  });
});
