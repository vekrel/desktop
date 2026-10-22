import { MachineId, ProjectId } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import type {
  SidebarProjectGroupMember,
  SidebarProjectSnapshot,
} from "../../sidebarProjectGrouping";
import { resolveSettingsScope, validateSettingsScopeSearch } from "./settingsScope";

const laptopId = MachineId.make("laptop");
const serverId = MachineId.make("server");
const machines = [
  { machineId: laptopId, label: "Laptop" },
  { machineId: serverId, label: "Server" },
];

function member(id: string, machineId: MachineId): SidebarProjectGroupMember {
  return {
    id: ProjectId.make(id),
    machineId,
    title: "Vekrel",
    workspaceRoot: `/repos/${id}`,
    physicalProjectKey: `${machineId}:/repos/${id}`,
    machineLabel:
      machines.find((machine) => machine.machineId === machineId)?.label ??
      null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

const first = member("first", laptopId);
const second = member("second", laptopId);
const third = member("third", serverId);
const other = member("other", serverId);

function group(
  projectKey: string,
  members: readonly SidebarProjectGroupMember[],
): SidebarProjectSnapshot {
  return {
    ...members[0]!,
    projectKey,
    displayName: projectKey,
    memberProjects: members,
    memberProjectRefs: members.map((project) => ({
      machineId: project.machineId,
      projectId: project.id,
    })),
    groupedProjectCount: members.length,
    machinePresence: "mixed",
    allRemoteMembersAreDesktopLocal: false,
    allRemoteMembersAreWsl: false,
    remoteMachineLabels: [],
  };
}

const groups = [group("t3code", [first, second, third]), group("other", [other])];

describe("settings scope search", () => {
  it("retains an orphan checkout so it cannot turn into all machines", () => {
    const search = validateSettingsScopeSearch({ checkout: first.physicalProjectKey });
    expect(search).toEqual({ checkout: first.physicalProjectKey });
    expect(resolveSettingsScope(search, groups, machines)).toMatchObject({
      kind: "unavailable",
      reason: "project-required",
      members: [],
      machineIds: [],
    });
  });
});

describe("settings scope resolution", () => {
  it("keeps all physical members in a project aggregate, including several on one machine", () => {
    expect(resolveSettingsScope({ project: "t3code" }, groups, machines)).toMatchObject({
      kind: "project",
      machineId: null,
      members: [first, second, third],
      machineIds: [laptopId, serverId],
    });
  });

  it("narrows a checkout target to exactly one member, deriving its machine when omitted", () => {
    expect(
      resolveSettingsScope(
        { project: "t3code", checkout: second.physicalProjectKey },
        groups,
        machines,
      ),
    ).toMatchObject({
      kind: "checkout",
      checkout: second,
      machineId: laptopId,
      label: "t3code / Laptop · /repos/second",
      members: [second],
      machineIds: [laptopId],
    });
  });

  it.each([
    { project: "missing" },
    { machine: "removed" },
    { project: "t3code", machine: "removed" },
    { project: "t3code", checkout: "deleted" },
    { project: "other", machine: laptopId },
    { project: "other", checkout: first.physicalProjectKey },
    { project: "t3code", machine: serverId, checkout: first.physicalProjectKey },
  ])("never widens an invalid or stale target: %j", (search) => {
    expect(resolveSettingsScope(search, groups, machines)).toMatchObject({
      kind: "unavailable",
      members: [],
      machineIds: [],
    });
  });

  it("leaves a removed checkout unavailable while sibling checkouts remain", () => {
    const search = {
      project: "t3code",
      machine: laptopId,
      checkout: first.physicalProjectKey,
    };
    expect(resolveSettingsScope(search, groups, machines)).toMatchObject({
      kind: "checkout",
      members: [first],
    });
    expect(
      resolveSettingsScope(search, [group("t3code", [second, third])], machines),
    ).toMatchObject({ kind: "unavailable", members: [], machineIds: [] });
  });

  it("does not select another machine after removing a project's last local checkout", () => {
    const search = { project: "t3code", machine: laptopId };
    expect(resolveSettingsScope(search, groups, machines)).toMatchObject({
      kind: "project",
      members: [first, second],
    });
    expect(resolveSettingsScope(search, [group("t3code", [third])], machines)).toMatchObject({
      kind: "unavailable",
      members: [],
      machineIds: [],
    });
  });

  it("rejects a cached checkout whose machine was removed", () => {
    expect(
      resolveSettingsScope(
        { project: "t3code", checkout: third.physicalProjectKey },
        groups,
        machines.slice(0, 1),
      ),
    ).toMatchObject({
      kind: "unavailable",
      reason: "machine-missing",
      members: [],
      machineIds: [],
    });
  });
});
