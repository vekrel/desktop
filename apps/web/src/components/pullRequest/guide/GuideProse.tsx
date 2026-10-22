import type { MachineId } from "@vekrel/contracts";
import { createContext, useContext } from "react";

import { cn } from "~/lib/utils";

import { PullRequestMarkdown } from "../PullRequestMarkdown";

export const GuideProseContext = createContext<{
  readonly machineId: MachineId;
  readonly cwd: string;
} | null>(null);

export function GuideProse({
  text,
  plain = false,
  className,
}: {
  text: string;
  plain?: boolean;
  className?: string;
}) {
  const context = useContext(GuideProseContext);
  if (plain || context === null) return text;
  return (
    <PullRequestMarkdown
      text={text}
      cwd={context.cwd}
      machineId={context.machineId}
      className={cn("space-y-0 [&_.chat-markdown]:text-inherit", className)}
    />
  );
}
