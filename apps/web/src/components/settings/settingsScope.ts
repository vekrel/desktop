import type { MachineId } from "@vekrel/contracts";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import type { MachinePresentation } from "../../state/machines";

export interface SettingsScopeSearch {
  project?: string | undefined;
  machine?: string | undefined;
  checkout?: string | undefined;
}

type ScopeTargets = {
  label: string;
  members: readonly SidebarProjectGroupMember[];
  machineIds: readonly MachineId[];
};

export type ResolvedSettingsScope = ScopeTargets &
  (
    | { kind: "all" }
    | { kind: "machine"; machineId: MachineId }
    | {
        kind: "project";
        group: SidebarProjectSnapshot;
        machineId: MachineId | null;
      }
    | {
        kind: "checkout";
        group: SidebarProjectSnapshot;
        checkout: SidebarProjectGroupMember;
        machineId: MachineId;
      }
    | {
        kind: "unavailable";
        reason: "project-required" | "project-missing" | "machine-missing" | "checkout-missing";
        message: string;
      }
  );

/** Stale IDs remain visible to the resolver so a removed target reads as unavailable, not as "all". */
export function validateSettingsScopeSearch(raw: Record<string, unknown>): SettingsScopeSearch {
  const stringValue = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0 ? value : undefined;
  const project = stringValue(raw.project);
  const machine = stringValue(raw.machine);
  const checkout = stringValue(raw.checkout);
  return {
    ...(project === undefined ? {} : { project }),
    ...(machine === undefined ? {} : { machine }),
    ...(checkout === undefined ? {} : { checkout }),
  };
}

/** An unavailable selection never broadens a subsequent write. */
export function resolveSettingsScope(
  search: SettingsScopeSearch,
  groups: readonly SidebarProjectSnapshot[],
  machines: readonly Pick<MachinePresentation, "machineId" | "label">[],
): ResolvedSettingsScope {
  const unavailable = (
    reason: Extract<ResolvedSettingsScope, { kind: "unavailable" }>["reason"],
    message: string,
  ): ResolvedSettingsScope => ({
    kind: "unavailable",
    reason,
    label: "Unavailable selection",
    message,
    members: [],
    machineIds: [],
  });

  if (search.checkout && !search.project) {
    return unavailable("project-required", "Select a project to choose one of its checkouts.");
  }

  const machine = machines.find((candidate) => candidate.machineId === search.machine);
  if (search.machine && !machine) {
    return unavailable("machine-missing", "This machine is no longer available.");
  }

  if (search.project) {
    const group = groups.find((candidate) => candidate.projectKey === search.project);
    if (!group) return unavailable("project-missing", "This project is no longer available.");
    const members = group.memberProjects.filter(
      (member) =>
        (search.machine === undefined || member.machineId === search.machine) &&
        (search.checkout === undefined || member.physicalProjectKey === search.checkout),
    );
    if (members.length === 0) {
      return unavailable(
        "checkout-missing",
        search.checkout
          ? "This checkout is no longer available in the selected project and machine."
          : "This project has no checkout on this machine.",
      );
    }
    if (search.checkout) {
      const checkout = members[0]!;
      const checkoutMachine = machines.find(
        (candidate) => candidate.machineId === checkout.machineId,
      );
      if (!checkoutMachine) {
        return unavailable(
          "machine-missing",
          "This checkout's machine is no longer available.",
        );
      }
      const sharesMachine = group.memberProjects.some(
        (member) =>
          member.machineId === checkout.machineId &&
          member.physicalProjectKey !== checkout.physicalProjectKey,
      );
      return {
        kind: "checkout",
        group,
        checkout,
        machineId: checkout.machineId,
        label: `${group.displayName} / ${checkoutMachine.label}${sharesMachine ? ` · ${checkout.workspaceRoot}` : ""}`,
        members,
        machineIds: [checkout.machineId],
      };
    }
    return {
      kind: "project",
      group,
      machineId: machine?.machineId ?? null,
      label: `${group.displayName} / ${machine?.label ?? "All checkouts"}`,
      members,
      machineIds: [...new Set(members.map((member) => member.machineId))],
    };
  }
  if (machine) {
    return {
      kind: "machine",
      machineId: machine.machineId,
      label: machine.label,
      members: [],
      machineIds: [machine.machineId],
    };
  }
  return {
    kind: "all",
    label: "All machines",
    members: [],
    machineIds: machines.map((candidate) => candidate.machineId),
  };
}
