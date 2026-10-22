import type { MachineId, MachineKind } from "@vekrel/contracts";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { Project } from "../types";
import {
  buildCommandPaletteProjectMetadata,
  buildProjectActionItems,
  type CommandPaletteProject,
  ITEM_ICON_CLASS,
} from "./CommandPalette.logic";
import { MachineIcon } from "./MachineIcon";
import { ProjectFavicon } from "./ProjectFavicon";
import { COMMAND_PALETTE_META_ICON_CLASS, CommandPaletteMetaDot } from "./ThreadCommandSubtitle";

export interface CommandPaletteProjectLocation {
  readonly kind: "local" | "remote";
  readonly label: string;
  readonly machine: MachineKind;
}

const UNKNOWN_PROJECT_LOCATION: CommandPaletteProjectLocation = {
  kind: "remote",
  label: "Remote",
  machine: "server",
};

interface ProjectItemsInput {
  readonly projects: ReadonlyArray<CommandPaletteProject>;
  readonly projectGroupByTargetKey: ReadonlyMap<string, SidebarProjectSnapshot>;
  readonly locationByMachineId: ReadonlyMap<MachineId, CommandPaletteProjectLocation>;
  readonly runProject: (project: CommandPaletteProject) => Promise<void>;
}

function projectFaviconIcon(project: Project) {
  return <ProjectFavicon project={project} className={ITEM_ICON_CLASS} />;
}

/** Projects as root search results; a grouped project matches on every member. */
export function buildProjectSearchItems(input: ProjectItemsInput) {
  const membersOf = (project: CommandPaletteProject) =>
    input.projectGroupByTargetKey.get(`${project.machineId}:${project.id}`)?.memberProjects ?? [
      project,
    ];
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "project",
    searchTerms: (project) =>
      buildCommandPaletteProjectMetadata({
        projects: membersOf(project),
        locationByMachineId: input.locationByMachineId,
      }).searchTerms,
    renderDescription: (project) => {
      const members = membersOf(project);
      const metadata = buildCommandPaletteProjectMetadata({
        projects: members,
        locationByMachineId: input.locationByMachineId,
      });
      return members.length > 1 ? (
        <span className="truncate">{metadata.machineLabels.join(" · ")}</span>
      ) : (
        <ProjectLocationDescription
          location={input.locationByMachineId.get(project.machineId)}
          workspaceRoot={project.workspaceRoot}
        />
      );
    },
    icon: projectFaviconIcon,
    runProject: input.runProject,
  });
}

/** Projects as targets of the "New thread in..." submenu. */
export function buildNewThreadInProjectItems(input: ProjectItemsInput) {
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "new-thread-in",
    searchTerms: (project) => {
      const group = input.projectGroupByTargetKey.get(`${project.machineId}:${project.id}`);
      const location = input.locationByMachineId.get(project.machineId);
      return [
        ...(group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ?? []),
        ...(location ? [location.label] : []),
      ];
    },
    renderDescription: (project) => (
      <ProjectLocationDescription
        location={input.locationByMachineId.get(project.machineId)}
        workspaceRoot={project.workspaceRoot}
      />
    ),
    icon: projectFaviconIcon,
    runProject: input.runProject,
  });
}

function ProjectLocationDescription(props: {
  readonly location: CommandPaletteProjectLocation | undefined;
  readonly workspaceRoot: string;
}) {
  const location = props.location ?? UNKNOWN_PROJECT_LOCATION;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="inline-flex min-w-0 items-center gap-1">
        {location.kind === "remote" ? (
          <MachineIcon
            aria-hidden
            kind={location.machine}
            className={COMMAND_PALETTE_META_ICON_CLASS}
          />
        ) : null}
        <span className="truncate">{location.label}</span>
      </span>
      <CommandPaletteMetaDot />
      <span className="truncate">{props.workspaceRoot}</span>
    </span>
  );
}
