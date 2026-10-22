import type { AtomCommand } from "@vekrel/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  MachineAuthorizationError,
  MachineId,
} from "@vekrel/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  readScope: vi.fn(),
  run: vi.fn(),
}));

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./session", () => ({ readMachineScope: state.readScope }));
vi.mock("./use-atom-command", () => ({ useAtomCommand: () => state.run }));

import { useOrchestrationCommand } from "./use-orchestration-command";

const first = MachineId.make("primary");
const second = MachineId.make("secondary");
type Target = { machineId: MachineId; input: { threadId: string } };
const command: AtomCommand<Target, string, Error> = { label: "thread mutation", run: state.run };
const target = (machineId: MachineId): Target => ({
  machineId,
  input: { threadId: "thread-1" },
});

beforeEach(() => {
  state.allowed.clear();
  state.run.mockReset().mockResolvedValue(AsyncResult.success("receipt"));
  state.readScope
    .mockReset()
    .mockImplementation(
      (machineId, scope) =>
        scope === AuthOrchestrationOperateScope && state.allowed.has(machineId),
    );
});

it("checks the command's machine instead of borrowing the primary grant", async () => {
  state.allowed.add(first);
  const mutate = useOrchestrationCommand(command, { reportFailure: false });
  const result = await mutate(target(second));
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(MachineAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.run).not.toHaveBeenCalled();

  expect(await mutate(target(first))).toMatchObject({ _tag: "Success", value: "receipt" });
  expect(state.run).toHaveBeenCalledWith(target(first));
});

it("does not dispatch a later mutation after access changes while awaiting a receipt", async () => {
  state.allowed.add(second);
  let finish: (() => void) | undefined;
  state.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(AsyncResult.success("first receipt"));
      }),
  );
  const mutate = useOrchestrationCommand(command);
  const pending = mutate(target(second));
  state.allowed.delete(second);
  finish!();
  expect((await pending)._tag).toBe("Success");
  expect((await mutate(target(second)))._tag).toBe("Failure");
  expect(state.run).toHaveBeenCalledTimes(1);
});
