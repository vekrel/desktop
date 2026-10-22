import type { MachineId } from "@vekrel/contracts";
import { ContextChipLabel } from "../ContextChip";
import { WorkspaceEntryIcon } from "./WorkspaceEntryIcon";

export function FileTagChipContent(props: {
  path: string;
  label: string;
  theme: "light" | "dark";
  machineId?: MachineId | null | undefined;
  cwd?: string | undefined;
}) {
  return (
    <>
      <WorkspaceEntryIcon
        path={props.path}
        machineId={props.machineId}
        cwd={props.cwd}
        theme={props.theme}
      />
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </>
  );
}
