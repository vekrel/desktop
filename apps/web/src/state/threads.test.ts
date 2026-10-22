import {
  EMPTY_MACHINE_THREAD_STATE,
  type MachineThreadState,
} from "@vekrel/client-runtime/state/threads";
import {
  MachineId,
  MessageId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@vekrel/contracts";
import { makeThreadProjectionFixture } from "../test-fixtures";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createRunningThreadKeepAliveAtom } from "./threads";

const LOCAL = MachineId.make("local");
const REMOTE = MachineId.make("remote");

type Status = "running" | "starting" | "preparing" | "queued" | "waiting" | "idle";
function shell(id: string, status: Status | null) {
  return { id: ThreadId.make(id), status: status ?? "idle" } satisfies Pick<
    OrchestrationV2ThreadShell,
    "id" | "status"
  >;
}
function detail(id: string, status: Status, overrides: Partial<MachineThreadState> = {}) {
  const projection = makeThreadProjectionFixture();
  const threadId = ThreadId.make(id);
  const thread = {
    ...projection,
    thread: { ...projection.thread, id: threadId },
    runs:
      status === "idle"
        ? []
        : [
            {
              id: RunId.make(`run-${id}`),
              threadId,
              ordinal: 1,
              providerInstanceId: projection.thread.providerInstanceId,
              modelSelection: projection.thread.modelSelection,
              providerThreadId: null,
              userMessageId: MessageId.make(`message-${id}`),
              rootNodeId: null,
              activeAttemptId: null,
              status,
              requestedAt: projection.updatedAt,
              startedAt: null,
              completedAt: null,
              checkpointId: null,
              contextHandoffId: null,
            },
          ],
  };
  return AsyncResult.success<MachineThreadState>({
    ...EMPTY_MACHINE_THREAD_STATE,
    status: "live",
    data: Option.some(thread),
    ...overrides,
  });
}

function makeHarness() {
  const tasks: Array<() => void> = [];
  const registry = AtomRegistry.make({
    scheduleTask: (task) => {
      tasks.push(task);
      return () => {};
    },
  });
  const flush = () => {
    for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task();
  };
  const machineIds = Atom.make<ReadonlyArray<MachineId>>([LOCAL, REMOTE]).pipe(
    Atom.keepAlive,
  );
  const threads = Atom.family((_machineId: MachineId) =>
    Atom.make<ReadonlyArray<ReturnType<typeof shell>>>([]).pipe(Atom.keepAlive),
  );
  const keys = new Set<string>();
  const states = Atom.family((_key: string) =>
    Atom.make<AsyncResult.AsyncResult<MachineThreadState>>(
      AsyncResult.success(EMPTY_MACHINE_THREAD_STATE),
    ),
  );
  const stateAtom = (machineId: MachineId, threadId: string) => {
    const key = `${machineId}:${threadId}`;
    keys.add(key);
    return states(key);
  };
  const keepAlive = createRunningThreadKeepAliveAtom({
    machineIdsAtom: machineIds,
    threadsAtom: threads,
    stateAtom,
  });
  registry.mount(keepAlive);
  return {
    registry,
    machineIds,
    threads,
    stateAtom,
    keepAlive,
    openStreams: () => {
      flush();
      return [...keys].filter((key) => registry.getNodes().has(states(key))).toSorted();
    },
  };
}

describe("createRunningThreadKeepAliveAtom", () => {
  it("keeps running threads open across shell updates and thread view visits", () => {
    const h = makeHarness();
    h.registry.set(h.threads(LOCAL), [shell("a", "running"), shell("b", "idle"), shell("c", null)]);
    h.registry.set(h.threads(REMOTE), [shell("d", "starting")]);
    expect(h.openStreams()).toEqual(["local:a", "remote:d"]);

    const live = detail("a", "running");
    h.registry.set(h.stateAtom(LOCAL, "a"), live);
    h.registry.mount(h.stateAtom(LOCAL, "a"))();

    const kept = h.registry.get(h.keepAlive);
    h.registry.set(h.threads(LOCAL), [shell("a", "running"), shell("b", "idle")]);
    expect(h.registry.get(h.keepAlive)).toBe(kept);
    expect(h.openStreams()).toEqual(["local:a", "remote:d"]);
    expect(h.registry.get(h.stateAtom(LOCAL, "a"))).toBe(live);
  });

  it("holds a stopped thread until its own stream is live and shows the stop", () => {
    const h = makeHarness();
    h.registry.set(h.threads(LOCAL), [
      shell("a", "running"),
      shell("b", "running"),
      shell("c", "running"),
    ]);
    h.registry.set(h.stateAtom(LOCAL, "a"), detail("a", "running"));
    h.registry.set(
      h.stateAtom(LOCAL, "c"),
      detail("c", "running", { status: "cached", error: Option.some("Could not sync.") }),
    );

    h.registry.set(h.threads(LOCAL), [shell("a", "idle"), shell("b", "idle"), shell("c", "idle")]);
    expect(h.openStreams()).toEqual(["local:a", "local:b"]);

    h.registry.set(h.stateAtom(LOCAL, "a"), detail("a", "idle"));
    h.registry.set(h.stateAtom(LOCAL, "b"), detail("b", "idle", { status: "synchronizing" }));
    expect(h.openStreams()).toEqual(["local:b"]);
    h.registry.set(h.stateAtom(LOCAL, "b"), detail("b", "idle"));
    expect(h.openStreams()).toEqual([]);
  });

  it("follows machines that connect and go away", () => {
    const h = makeHarness();
    h.registry.set(h.machineIds, [LOCAL]);
    h.registry.set(h.threads(REMOTE), [shell("d", "running")]);
    expect(h.openStreams()).toEqual([]);

    h.registry.set(h.machineIds, [LOCAL, REMOTE]);
    expect(h.openStreams()).toEqual(["remote:d"]);

    h.registry.set(h.stateAtom(REMOTE, "d"), detail("d", "running"));
    h.registry.set(h.threads(REMOTE), [shell("d", "idle")]);
    expect(h.openStreams()).toEqual(["remote:d"]);
    h.registry.set(h.machineIds, [LOCAL]);
    expect(h.openStreams()).toEqual([]);
  });
});
