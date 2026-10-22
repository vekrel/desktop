import type { MachineConnectionPhase } from "@vekrel/client-runtime/connection";
import { MachineId, type KeybindingRule, type ServerConfig } from "@vekrel/contracts";
import { compileResolvedKeybindingsConfig } from "@vekrel/shared/keybindings";
import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { resolveShortcutCommand } from "../keybindings";
import { createShortcutKeybindingsAtom } from "./server";

const PRIMARY = MachineId.make("primary");
const A = MachineId.make("a");
const B = MachineId.make("b");

// The reporter's swap: Cmd+N opens a local thread instead of a regular one.
const SWAPPED: KeybindingRule[] = [{ key: "mod+n", command: "chat.newLocal" }];
const STALE: KeybindingRule[] = [{ key: "mod+n", command: "chat.newWithoutProject" }];

function config(rules: readonly KeybindingRule[]) {
  return {
    keybindings: compileResolvedKeybindingsConfig(rules),
    providers: [],
  } as unknown as ServerConfig;
}

function machine(phase: MachineConnectionPhase, serverConfig: ServerConfig | null) {
  return { connection: { phase, error: null, traceId: null }, serverConfig };
}

type Machine = ReturnType<typeof machine>;

function makeHarness(input: {
  primaryMachineId?: MachineId | null;
  primaryConfig?: ServerConfig | null;
  machines?: ReadonlyArray<readonly [MachineId, Machine]>;
}) {
  const primaryMachineIdAtom = Atom.make(input.primaryMachineId ?? null);
  const primaryConfigAtom = Atom.make(input.primaryConfig ?? null);
  const machinesAtom = Atom.make<ReadonlyMap<MachineId, Machine>>(
    new Map(input.machines ?? []),
  );
  const keybindingsAtom = createShortcutKeybindingsAtom({
    primaryMachineIdAtom,
    primaryConfigAtom,
    machinesAtom,
  });
  const registry = AtomRegistry.make();
  registries.push(registry);
  // Keep the atom mounted, like the shortcut handlers do.
  registry.subscribe(keybindingsAtom, () => {});
  return {
    registry,
    primaryMachineIdAtom,
    primaryConfigAtom,
    machinesAtom,
    keybindings: () => registry.get(keybindingsAtom),
    cmdN: () =>
      resolveShortcutCommand(
        { key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
        registry.get(keybindingsAtom),
        { platform: "MacIntel" },
      ),
  };
}

const registries: AtomRegistry.AtomRegistry[] = [];
afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
});

describe("createShortcutKeybindingsAtom", () => {
  it("updates shortcuts from the first connected, configured machine without a primary", () => {
    const harness = makeHarness({});
    const aConfig = config(STALE);
    const bConfig = config(SWAPPED);
    const edited = config([{ key: "mod+n", command: "sidebar.toggle" }]);
    expect(harness.cmdN()).toBe("chat.new");

    // One mounted consumer follows config loading, edits, disconnects and reconnects.
    for (const [a, b, command] of [
      [machine("offline", aConfig), machine("connected", bConfig), "chat.newLocal"],
      [machine("connected", null), machine("connected", bConfig), "chat.newLocal"],
      [
        machine("connected", aConfig),
        machine("connected", bConfig),
        "chat.newWithoutProject",
      ],
      [machine("connected", edited), machine("connected", bConfig), "sidebar.toggle"],
      [machine("offline", edited), machine("connected", bConfig), "chat.newLocal"],
      [machine("offline", edited), machine("offline", bConfig), "chat.new"],
      [machine("reconnecting", edited), machine("offline", bConfig), "chat.new"],
      [
        machine("connected", aConfig),
        machine("offline", bConfig),
        "chat.newWithoutProject",
      ],
    ] as const) {
      harness.registry.set(
        harness.machinesAtom,
        new Map([
          [A, a],
          [B, b],
        ]),
      );
      expect(harness.cmdN()).toBe(command);
    }
  });

  it("uses the primary config or defaults until the primary is removed", () => {
    const harness = makeHarness({
      machines: [[B, machine("connected", config(SWAPPED))]],
    });
    expect(harness.cmdN()).toBe("chat.newLocal");

    harness.registry.set(harness.primaryMachineIdAtom, PRIMARY);
    expect(harness.cmdN()).toBe("chat.new");

    harness.registry.set(harness.primaryConfigAtom, config(STALE));
    expect(harness.cmdN()).toBe("chat.newWithoutProject");

    harness.registry.set(harness.primaryConfigAtom, null);
    expect(harness.cmdN()).toBe("chat.new");

    harness.registry.set(harness.primaryMachineIdAtom, null);
    expect(harness.cmdN()).toBe("chat.newLocal");
  });
});
