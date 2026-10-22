import type { MachineId, ThreadId, TurnItemId } from "@vekrel/contracts";
import { TERMINAL_PALETTES, terminalOutputSpans } from "@vekrel/shared/terminalOutput";
import { useLayoutEffect, useRef } from "react";

import { useTheme } from "../../hooks/useTheme";
import { useServerConfigs } from "../../state/entities";
import { orchestrationMachine } from "../../state/orchestration";
import { useMachineQuery } from "../../state/query";

// Within this many pixels of the end still counts as following the output.
const FOLLOW_SLACK_PX = 8;

/** True when the machine streams command output; older servers only return final output. */
export function useCommandOutputStreaming(machineId: MachineId): boolean {
  return (
    useServerConfigs().get(machineId)?.machine.capabilities.commandOutputStreaming === true
  );
}

/**
 * Output of one expanded command row: streams while the command runs, then
 * shows its final output. Mount it only when `useCommandOutputStreaming` holds.
 * It subscribes only while mounted, so collapsed rows and other threads receive nothing.
 */
export function CommandOutputPanel(props: {
  readonly machineId: MachineId;
  readonly threadId: ThreadId;
  readonly itemId: TurnItemId;
}) {
  const { data, error } = useMachineQuery(
    orchestrationMachine.v2.commandOutput({
      machineId: props.machineId,
      input: { threadId: props.threadId, itemId: props.itemId },
    }),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new output until the reader scrolls up; scrolling back down resumes.
  const followRef = useRef(true);
  const text = data?.output.text ?? "";
  const { resolvedTheme } = useTheme();

  // This panel only re-renders when its output changes, so keep the end in view after each.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && followRef.current) element.scrollTop = element.scrollHeight;
  });

  if (text.length === 0) {
    if (error) return <div className="text-destructive">Couldn&apos;t load output: {error}</div>;
    if (data === null) return <div className="text-muted-foreground italic">Loading output…</div>;
    return data.running ? null : <div className="text-muted-foreground italic">No output.</div>;
  }
  // Parsed after the layout effect, the last hook, so the compiler caches it on text and theme.
  const spans = terminalOutputSpans(text, TERMINAL_PALETTES[resolvedTheme]);
  return (
    <div>
      {data?.output.truncated ? (
        <div className="text-muted-foreground italic">Earlier output not shown</div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="max-h-80 overflow-auto text-muted-foreground"
      >
        {spans.map((span, index) =>
          span.style === null ? (
            span.text
          ) : (
            // Spans are rebuilt from scratch on every update and never reorder.
            // oxlint-disable-next-line react/no-array-index-key
            <span key={index} style={span.style}>
              {span.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
}
