import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "@vekrel/client-runtime/connection";
import { MachineId } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveOnboardingSetup,
  resolveOnboardingTargetMachine,
} from "./targetMachine.logic";

const primaryMachine = {
  machineId: MachineId.make("primary"),
  connection: { phase: "connected" },
  entry: {
    target: new PrimaryConnectionTarget({
      machineId: MachineId.make("primary"),
      label: "This computer",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
    }),
  },
  label: "This computer",
} as const;

const olderRelay = {
  machineId: MachineId.make("older-remote"),
  connection: { phase: "connected" },
  entry: {
    target: new RelayConnectionTarget({
      machineId: MachineId.make("older-remote"),
      label: "Older computer",
    }),
  },
  label: "Older computer",
} as const;

const newerRelay = {
  machineId: MachineId.make("newer-relay"),
  connection: { phase: "connected" },
  entry: {
    target: new RelayConnectionTarget({
      machineId: MachineId.make("newer-relay"),
      label: "New computer",
    }),
  },
  label: "New computer",
} as const;

const pairedRemote = {
  machineId: MachineId.make("paired-remote"),
  connection: { phase: "connected" },
  entry: {
    target: new BearerConnectionTarget({
      machineId: MachineId.make("paired-remote"),
      label: "Direct computer",
      connectionId: "paired-remote",
    }),
  },
  label: "Direct computer",
} as const;

const sshMachine = {
  machineId: MachineId.make("ssh-remote"),
  connection: { phase: "connected" },
  entry: {
    target: new SshConnectionTarget({
      machineId: MachineId.make("ssh-remote"),
      label: "SSH computer",
      connectionId: "ssh-remote",
    }),
  },
  label: "SSH computer",
} as const;

const desktopLocalMachine = {
  machineId: MachineId.make("desktop-local-wsl"),
  connection: { phase: "connected" },
  entry: {
    target: new BearerConnectionTarget({
      machineId: MachineId.make("desktop-local-wsl"),
      label: "WSL",
      connectionId: "local:wsl:Ubuntu",
    }),
  },
  label: "WSL",
} as const;

describe("resolveOnboardingTargetMachine", () => {
  it("waits for the exact paired machine instead of using an older connected machine", () => {
    const pendingPairedRemote = { ...pairedRemote, connection: { phase: "connecting" } };

    expect(
      resolveOnboardingTargetMachine({
        mode: "direct",
        machines: [primaryMachine, olderRelay, pendingPairedRemote],
        primaryMachine,
        pairedMachineId: pairedRemote.machineId,
      }),
    ).toBeNull();
  });

  it("uses the exact paired machine once it connects", () => {
    expect(
      resolveOnboardingTargetMachine({
        mode: "direct",
        machines: [primaryMachine, olderRelay, pairedRemote],
        primaryMachine,
        pairedMachineId: pairedRemote.machineId,
      }),
    ).toBe(pairedRemote);
  });

  it("does not substitute a remote machine when the local primary is offline", () => {
    const offlinePrimary = { ...primaryMachine, connection: { phase: "disconnected" } };

    expect(
      resolveOnboardingTargetMachine({
        mode: "local",
        machines: [offlinePrimary, olderRelay],
        primaryMachine: offlinePrimary,
        pairedMachineId: null,
      }),
    ).toBeNull();
  });

  it("uses the newest connected remote when no exact machine was selected", () => {
    expect(
      resolveOnboardingTargetMachine({
        mode: "connect",
        machines: [primaryMachine, olderRelay, newerRelay],
        primaryMachine,
        pairedMachineId: null,
      }),
    ).toBe(newerRelay);
  });

  it("ignores direct, SSH, and desktop-managed connections in Connect mode", () => {
    expect(
      resolveOnboardingTargetMachine({
        mode: "connect",
        machines: [
          primaryMachine,
          olderRelay,
          pairedRemote,
          sshMachine,
          desktopLocalMachine,
        ],
        primaryMachine,
        pairedMachineId: null,
      }),
    ).toBe(olderRelay);
  });

  it("uses the primary computer when no relay connection exists", () => {
    expect(
      resolveOnboardingTargetMachine({
        mode: "connect",
        machines: [primaryMachine, pairedRemote, sshMachine, desktopLocalMachine],
        primaryMachine,
        pairedMachineId: null,
      }),
    ).toBe(primaryMachine);
  });
});

describe("resolveOnboardingSetup", () => {
  const computer = (id: string, phase: string) => ({
    machineId: MachineId.make(id),
    connection: { phase },
  });
  const local = computer("local", "connected");

  it("skips selected computers that will not connect on their own", () => {
    const machines = [
      local,
      computer("switched-off", "available"),
      computer("offline", "offline"),
      computer("failing", "reconnecting"),
      computer("old-client", "unsupported"),
    ];
    expect(
      resolveOnboardingSetup(
        machines,
        new Set(machines.map((machine) => machine.machineId)),
      ),
    ).toEqual({
      ready: true,
      machineIds: [local.machineId],
      skippedIds: machines.slice(1).map((machine) => machine.machineId),
    });
  });

  it("waits for a first connection attempt to settle", () => {
    const connecting = computer("new", "connecting");
    expect(
      resolveOnboardingSetup(
        [local, connecting],
        new Set([local.machineId, connecting.machineId]),
      ).ready,
    ).toBe(false);
  });

  // regression: #16887 onboarding Continue locked up on computers that won't connect
  it("is not ready without a connected selection", () => {
    expect(resolveOnboardingSetup([local], new Set()).ready).toBe(false);
    expect(
      resolveOnboardingSetup([computer("off", "available")], new Set([MachineId.make("off")]))
        .ready,
    ).toBe(false);
  });
});
