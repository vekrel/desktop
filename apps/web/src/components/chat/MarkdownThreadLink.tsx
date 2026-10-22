import { scopeThreadRef } from "@vekrel/client-runtime/machine";
import type { MachineId, ThreadId } from "@vekrel/contracts";
import {
  formatThreadLink,
  percentDecodedThreadLinkId,
  resolveThreadLinkRef,
} from "@vekrel/shared/threadLinks";

import { useThreadRefs, useThreadShell } from "../../state/entities";
import { ThreadContextChip } from "../ThreadContextChip";

export function MarkdownThreadLink(props: {
  readonly machineId: MachineId;
  readonly threadId: ThreadId;
  readonly label: string;
}) {
  const decodedId = percentDecodedThreadLinkId(props.threadId);
  const written = useThreadShell(scopeThreadRef(props.machineId, props.threadId));
  const decoded = useThreadShell(
    written === null && decodedId !== null ? scopeThreadRef(props.machineId, decodedId) : null,
  );
  const local = written ?? decoded;
  const refs = useThreadRefs(local === null);
  const remote = useThreadShell(
    local === null
      ? resolveThreadLinkRef(scopeThreadRef(props.machineId, props.threadId), refs)
      : null,
  );
  const thread = local ?? remote;
  const machineId = thread?.machineId ?? props.machineId;
  const threadId = thread?.id ?? props.threadId;
  const title = thread?.title.trim() || props.label;
  return (
    <ThreadContextChip
      record={{ machineId, threadId, title: props.label }}
      copyMarkdown={formatThreadLink(threadId, title)}
    />
  );
}
