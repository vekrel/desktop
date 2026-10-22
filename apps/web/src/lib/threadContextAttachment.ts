import type { MachineId, OrchestrationV2ThreadTranscript } from "@vekrel/contracts";
import { toKindScopedComposerContextId } from "@vekrel/shared/composerContextReferences";
import { threadTranscriptHeader } from "@vekrel/shared/threadTranscript";
import * as DateTime from "effect/DateTime";

export function threadContextAttachment(
  machineId: MachineId,
  transcript: OrchestrationV2ThreadTranscript,
): File {
  const updatedAt = DateTime.formatIso(transcript.updatedAt);
  const name = toKindScopedComposerContextId(
    "thread",
    `${machineId}:${transcript.threadId}:${updatedAt}`,
  );
  const title = transcript.title.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 64) || "Thread";
  return new File(
    [
      threadTranscriptHeader(machineId, transcript),
      ...transcript.items.map((row) => `${JSON.stringify(row)}\n`),
    ],
    `${title}-${name.slice(-16)}.jsonl`,
    { type: "application/x-ndjson" },
  );
}
