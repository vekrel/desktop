import { scopeProjectRef } from "@vekrel/client-runtime/machine";
import type { ThreadContextRecord } from "@vekrel/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import { useProject, useThreadShell } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { ProjectFavicon } from "./ProjectFavicon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "machineId" | "threadId" | "title">;
  copyMarkdown?: string;
  unreadable?: boolean;
}) {
  const { machineId, threadId } = props.record;
  const shell = useThreadShell({ machineId, threadId });
  const project = useProject(shell ? scopeProjectRef(machineId, shell.projectId) : null);
  const title = shell?.title?.trim() || props.record.title;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="thread"
            {...(props.unreadable ? { state: "invalid" as const } : {})}
            render={<Link to="/$machineId/$threadId" params={{ machineId, threadId }} />}
            aria-label={`Thread, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
          >
            {project ? (
              <ProjectFavicon project={project} className="size-[1.17em] self-center" />
            ) : (
              <MessagesSquareIcon />
            )}
            <ContextChipLabel>{title}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        {props.unreadable
          ? "On another machine, so this machine's agent can't read it. Remove it or switch back to send."
          : shell
            ? "Open thread"
            : "Thread no longer available"}
      </TooltipPopup>
    </Tooltip>
  );
}
