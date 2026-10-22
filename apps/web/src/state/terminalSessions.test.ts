import { describe, expect, it, vi } from "vite-plus/test";
import { MachineId, ThreadId, type TerminalSummary } from "@vekrel/contracts";
import { selectRunningSubprocessTerminalIds } from "@vekrel/client-runtime/state/terminal";

import { selectKnownTerminalSessions } from "./terminalSessions";

vi.mock("./terminal", () => ({ terminalMachine: {} }));

const machineA = MachineId.make("machine-a");
const threadA = ThreadId.make("thread-a");
const threadB = ThreadId.make("thread-b");

function summary(
  threadId: string,
  terminalId: string,
  changes: Partial<TerminalSummary> = {},
): TerminalSummary {
  return {
    threadId,
    terminalId,
    cwd: "/repo",
    worktreePath: null,
    status: "running",
    pid: 123,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: true,
    label: "Terminal",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...changes,
  };
}

describe("selectKnownTerminalSessions", () => {
  it("changes only the affected group and preserves earlier snapshots", () => {
    const first = summary(threadA, "terminal-1");
    const second = summary(threadA, "terminal-2");
    const other = summary(threadB, "terminal-1");
    const metadata = [first, second, other];
    const beforeA = selectKnownTerminalSessions(metadata, machineA, threadA);
    const beforeB = selectKnownTerminalSessions(metadata, machineA, threadB);
    Object.freeze(beforeA);
    Object.freeze(beforeB);
    const exited = {
      ...second,
      status: "exited" as const,
      pid: null,
      exitCode: 0,
      hasRunningSubprocess: false,
      label: "Finished",
      updatedAt: "2026-09-04T00:00:01.000Z",
    };
    const next = [first, other, exited];
    const afterA = selectKnownTerminalSessions(next, machineA, threadA);
    expect(selectKnownTerminalSessions(next, machineA, threadB)).toBe(beforeB);
    expect(afterA).not.toBe(beforeA);
    expect(afterA[0]).toBe(beforeA[0]);
    expect(afterA[1]?.state).toMatchObject({
      status: "exited",
      hasRunningSubprocess: false,
      summary: { label: "Finished", pid: null, exitCode: 0 },
    });
    expect(selectRunningSubprocessTerminalIds(afterA)).toEqual(["terminal-1"]);
    expect(beforeA[1]?.state).toMatchObject({
      status: "running",
      hasRunningSubprocess: true,
      summary: { label: "Terminal", pid: 123 },
    });
    expect(selectKnownTerminalSessions(metadata, machineA, threadA)).toBe(beforeA);

    const renamed = [first, exited, { ...other, label: "Renamed" }];
    expect(selectKnownTerminalSessions(renamed, machineA, threadA)).toBe(afterA);
    expect(
      selectKnownTerminalSessions(renamed, machineA, threadB)[0]?.state.summary?.label,
    ).toBe("Renamed");
    expect(selectKnownTerminalSessions([other], machineA, threadA)).toEqual([]);
    expect(selectKnownTerminalSessions([other], machineA, threadB)).toBe(beforeB);
  });
});
