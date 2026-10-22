import { MachineRegistry } from "@vekrel/client-runtime/connection";
import { MachineId, WS_METHODS } from "@vekrel/contracts";
import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import {
  layer,
  observeBackgroundActivitySubscription,
  retainedBackgroundScopes,
} from "./backgroundActivityReporter.ts";

describe("wasRecentlyInteracted", () => {
  it.effect("retains an observed subscription until its returned finalizer runs", () =>
    Effect.gen(function* () {
      const machineId = MachineId.make("machine-observation-test");
      const scope = { type: "vcs-status" as const, cwd: "/repo" };
      const releasePassive = yield* observeBackgroundActivitySubscription({
        machineId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd, includeRemote: false },
      });
      expect(retainedBackgroundScopes(machineId)).toEqual([]);
      const release = yield* observeBackgroundActivitySubscription({
        machineId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: scope.cwd },
      });

      expect(retainedBackgroundScopes(machineId)).toEqual([scope]);

      yield* releasePassive;
      expect(retainedBackgroundScopes(machineId)).toEqual([scope]);

      yield* release;
      expect(retainedBackgroundScopes(machineId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing machine and scope values distinct", () =>
    Effect.gen(function* () {
      const firstMachineId = MachineId.make("a");
      const secondMachineId = MachineId.make("a:vcs-status:b");
      const releaseFirst = yield* observeBackgroundActivitySubscription({
        machineId: firstMachineId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeBackgroundActivitySubscription({
        machineId: secondMachineId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedBackgroundScopes(firstMachineId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedBackgroundScopes(secondMachineId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );
});

describe("layer", () => {
  beforeEach(() => {
    const target = new EventTarget();
    const listeners = {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
    vi.stubGlobal("window", {
      ...listeners,
      localStorage: { getItem: () => "client", setItem: () => undefined },
    });
    vi.stubGlobal("document", { ...listeners, visibilityState: "visible", hasFocus: () => true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // As when a machine's connection is torn down while its report is in flight.
  it.effect("keeps reporting after a report is interrupted", () =>
    Effect.gen(function* () {
      const entries = yield* SubscriptionRef.make(
        new Map([[MachineId.make("machine-reporter-test"), {}]]),
      );
      let calls = 0;
      const registry = MachineRegistry.MachineRegistry.of({
        entries,
        run: () => {
          calls += 1;
          return calls === 1 ? Effect.failCause(Cause.interrupt()) : Effect.void;
        },
      } as unknown as MachineRegistry.MachineRegistry["Service"]);

      yield* Layer.build(
        layer.pipe(Layer.provide(Layer.succeed(MachineRegistry.MachineRegistry, registry))),
      );
      yield* TestClock.adjust("1 second");
      expect(calls).toBe(1);

      yield* TestClock.adjust("25 seconds");
      expect(calls).toBe(2);
    }).pipe(Effect.scoped),
  );
});
