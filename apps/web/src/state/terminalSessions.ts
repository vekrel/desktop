import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  selectRunningSubprocessTerminalIds,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@vekrel/client-runtime/state/terminal";
import {
  ThreadId,
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  type MachineId,
  type TerminalAttachInput,
  type TerminalSummary,
} from "@vekrel/contracts";

import { useMachineQuery } from "./query";
import { terminalMachine } from "./terminal";
import { useMachineScope } from "./session";

const EMPTY_KNOWN_TERMINAL_SESSIONS = Object.freeze<ReadonlyArray<KnownTerminalSession>>([]);

interface TerminalMetadataIndex {
  readonly all: ReadonlyArray<TerminalSummary>;
  readonly byThreadId: ReadonlyMap<string, ReadonlyArray<TerminalSummary>>;
  readonly views: Map<MachineId, Map<ThreadId | null, ReadonlyArray<KnownTerminalSession>>>;
}

const metadataIndexes = new WeakMap<ReadonlyArray<TerminalSummary>, TerminalMetadataIndex>();
const sessionsBySummary = new WeakMap<TerminalSummary, Map<MachineId, KnownTerminalSession>>();
// Reuse groups a consumer still holds without keeping old group members alive
// merely because their first summary remains in a newer metadata snapshot.
const groupsByAnchor = new WeakMap<
  TerminalSummary,
  Map<
    MachineId,
    {
      readonly all?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
      readonly thread?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
    }
  >
>();

function knownSession(
  summary: TerminalSummary,
  machineId: MachineId,
): KnownTerminalSession {
  let byMachine = sessionsBySummary.get(summary);
  const previous = byMachine?.get(machineId);
  if (previous) return previous;
  const session = {
    target: {
      machineId,
      threadId: ThreadId.make(summary.threadId),
      terminalId: summary.terminalId,
    },
    state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
  };
  if (!byMachine) {
    byMachine = new Map();
    sessionsBySummary.set(summary, byMachine);
  }
  byMachine.set(machineId, session);
  return session;
}

function terminalMetadataIndex(metadata: ReadonlyArray<TerminalSummary>): TerminalMetadataIndex {
  let index = metadataIndexes.get(metadata);
  if (!index) {
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    const all = metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
    const byThreadId = new Map<string, TerminalSummary[]>();
    for (const summary of all) {
      const group = byThreadId.get(summary.threadId);
      if (group) group.push(summary);
      else byThreadId.set(summary.threadId, [summary]);
    }
    index = { all, byThreadId, views: new Map() };
    metadataIndexes.set(metadata, index);
  }
  return index;
}

export function selectKnownTerminalSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  machineId: MachineId | null,
  threadId: ThreadId | null,
): ReadonlyArray<KnownTerminalSession> {
  if (machineId === null || metadata === null || metadata.length === 0) {
    return EMPTY_KNOWN_TERMINAL_SESSIONS;
  }
  const index = terminalMetadataIndex(metadata);
  let views = index.views.get(machineId);
  const cached = views?.get(threadId);
  if (cached) return cached;
  const summaries = threadId === null ? index.all : index.byThreadId.get(threadId);
  if (!summaries || summaries.length === 0) return EMPTY_KNOWN_TERMINAL_SESSIONS;

  const anchor = summaries[0]!;
  const kind = threadId === null ? "all" : "thread";
  let groups = groupsByAnchor.get(anchor);
  const previousGroups = groups?.get(machineId);
  const previous = previousGroups?.[kind]?.deref();
  const sessions =
    previous?.length === summaries.length &&
    previous.every((session, index) => session.state.summary === summaries[index])
      ? previous
      : summaries.map((summary) => knownSession(summary, machineId));
  if (!groups) {
    groups = new Map();
    groupsByAnchor.set(anchor, groups);
  }
  if (sessions !== previous) {
    groups.set(machineId, { ...previousGroups, [kind]: new WeakRef(sessions) });
  }
  if (!views) {
    views = new Map();
    index.views.set(machineId, views);
  }
  views.set(threadId, sessions);
  return sessions;
}

export function useAttachedTerminalSession(input: {
  readonly machineId: MachineId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const canRead = useMachineScope(input.machineId, AuthTerminalReadScope);
  const canOperate = useMachineScope(input.machineId, AuthTerminalOperateScope);
  const attach = useMachineQuery(
    input.machineId !== null && input.terminal !== null
      ? canOperate
        ? terminalMachine.attach({
            machineId: input.machineId,
            input: input.terminal,
          })
        : canRead
          ? terminalMachine.observe({
              machineId: input.machineId,
              input: { threadId: input.terminal.threadId, terminalId: input.terminal.terminalId },
            })
          : null
      : null,
  );
  const metadata = useMachineQuery(
    input.machineId === null || !canRead
      ? null
      : terminalMachine.metadata({
          machineId: input.machineId,
          input: null,
        }),
  );

  if (input.machineId === null || input.terminal === null) {
    return EMPTY_TERMINAL_SESSION_STATE;
  }
  const summary =
    (metadata.data === null
      ? null
      : terminalMetadataIndex(metadata.data)
          .byThreadId.get(input.terminal.threadId)
          ?.find((terminal) => terminal.terminalId === input.terminal?.terminalId)) ?? null;
  const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
  return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
}

export function useKnownTerminalSessions(input: {
  readonly machineId: MachineId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> | null {
  const canRead = useMachineScope(input.machineId, AuthTerminalReadScope);
  const metadata = useMachineQuery(
    input.machineId === null || !canRead
      ? null
      : terminalMachine.metadata({
          machineId: input.machineId,
          input: null,
        }),
  );
  return metadata.data === null || metadata.error !== null
    ? null
    : selectKnownTerminalSessions(metadata.data, input.machineId, input.threadId);
}

export function useThreadRunningTerminalIds(input: {
  readonly machineId: MachineId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<string> {
  const sessions = useKnownTerminalSessions(input);
  return selectRunningSubprocessTerminalIds(sessions ?? []);
}
