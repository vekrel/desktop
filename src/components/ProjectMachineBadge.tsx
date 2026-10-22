import type { MachineId, MachineKind } from "@vekrel/contracts";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { MachineIcon } from "./MachineIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function ProjectMachineBadge(props: {
  readonly group: Pick<SidebarProjectSnapshot, "memberProjects">;
  readonly primaryMachineId: MachineId | null;
  readonly machineByMachineId: ReadonlyMap<MachineId, MachineKind>;
}) {
  const remoteMembers = props.group.memberProjects
    .filter((member) => member.machineId !== props.primaryMachineId)
    .map((member) => ({ ...member, machineLabel: member.machineLabel ?? "Remote" }))
    .sort((a, b) => a.machineLabel.localeCompare(b.machineLabel));
  const first = remoteMembers[0];
  if (!first) return null;
  const labels = remoteMembers
    .map((member) => member.machineLabel)
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(", ");
  const alsoHere = remoteMembers.length < props.group.memberProjects.length;
  const description = `${alsoHere ? "Also on" : "On"} ${labels}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={description}
            className="ml-auto inline-flex shrink-0 items-center text-muted-foreground"
          />
        }
      >
        <MachineIcon
          aria-hidden
          kind={props.machineByMachineId.get(first.machineId) ?? "server"}
          className="size-3.5"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{description}</TooltipPopup>
    </Tooltip>
  );
}
