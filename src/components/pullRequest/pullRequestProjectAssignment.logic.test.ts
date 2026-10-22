import type { MachineId, ProjectId } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assignProjectsToMachines,
  resolvePickableMachines,
  type AssignableProject,
} from "./pullRequestProjectAssignment.logic";

const project = (
  id: string,
  machineId: string,
  canonicalKey?: string,
): AssignableProject & { workspaceRoot: string } => ({
  id: id as ProjectId,
  machineId: machineId as MachineId,
  repositoryIdentity: canonicalKey === undefined ? null : { canonicalKey },
  workspaceRoot: `/srv/${machineId}/${id}`,
});

const envs = (...ids: ReadonlyArray<string>) => ids as ReadonlyArray<MachineId>;

const plain = (assignment: Map<MachineId, ProjectId[]>) =>
  Object.fromEntries([...assignment].map(([id, projectIds]) => [id, projectIds]));

describe("one server per repository", () => {
  it("lets the first server list a repository both hold", () => {
    const assignment = assignProjectsToMachines(
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("b1", "env-1", "github.com/acme/tools"),
        project("a2", "env-2", "github.com/acme/app"),
        project("c2", "env-2", "github.com/acme/site"),
      ],
      envs("env-1", "env-2"),
      "env-1" as MachineId,
    );
    expect(plain(assignment)).toEqual({ "env-1": ["a1", "b1"], "env-2": ["c2"] });
  });

  it("prefers the named server over the first one", () => {
    const assignment = assignProjectsToMachines(
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("a2", "env-2", "github.com/acme/app"),
      ],
      envs("env-1", "env-2"),
      "env-2" as MachineId,
    );
    expect(plain(assignment)).toEqual({ "env-2": ["a2"] });
  });

  it("keeps every copy of a project that has no identity to compare", () => {
    const assignment = assignProjectsToMachines(
      [project("p1", "env-1"), project("p2", "env-2")],
      envs("env-1", "env-2"),
      "env-1" as MachineId,
    );
    expect(plain(assignment)).toEqual({ "env-1": ["p1"], "env-2": ["p2"] });
  });

  it("keeps a server's own worktrees of the repository it lists", () => {
    const assignment = assignProjectsToMachines(
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("a1-wt", "env-1", "GitHub.com/acme/app"),
        project("a2", "env-2", "github.com/acme/app"),
      ],
      envs("env-1", "env-2"),
      "env-1" as MachineId,
    );
    expect(plain(assignment)).toEqual({ "env-1": ["a1", "a1-wt"] });
  });

  it("reads two servers' copies of one repository as one however the remote is cased", () => {
    const assignment = assignProjectsToMachines(
      [
        project("a1", "env-1", "git.example.com/Team/App"),
        project("a2", "env-2", "GIT.example.com/team/app"),
      ],
      envs("env-1", "env-2"),
      "env-1" as MachineId,
    );
    expect(plain(assignment)).toEqual({ "env-1": ["a1"] });
  });

  it("answers the same whatever order the projects arrive in", () => {
    const projects = [
      project("a2", "env-2", "github.com/acme/app"),
      project("a1", "env-1", "github.com/acme/app"),
    ];
    const forward = assignProjectsToMachines(projects, envs("env-1", "env-2"), null);
    const backward = assignProjectsToMachines(
      projects.toReversed(),
      envs("env-1", "env-2"),
      null,
    );
    expect(plain(forward)).toEqual({ "env-1": ["a1"] });
    expect(plain(backward)).toEqual(plain(forward));
  });
});

const connected = (...ids: ReadonlyArray<string>) =>
  ids.map((id) => ({ machineId: id as MachineId, label: `Server ${id}` }));

const on = (machineId: string, projectId: string) => ({
  machineId: machineId as MachineId,
  projectId: projectId as ProjectId,
});

describe("where a pull request can be acted on", () => {
  it("offers every server holding the repository, the panel's own first", () => {
    const pickable = resolvePickableMachines(
      on("env-2", "a2"),
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("a2", "env-2", "github.com/acme/app"),
        project("c3", "env-3", "github.com/acme/site"),
      ],
      connected("env-1", "env-2", "env-3"),
    );
    expect(pickable).toEqual([
      {
        machineId: "env-2",
        projectId: "a2",
        workspaceRoot: "/srv/env-2/a2",
        label: "Server env-2",
      },
      {
        machineId: "env-1",
        projectId: "a1",
        workspaceRoot: "/srv/env-1/a1",
        label: "Server env-1",
      },
    ]);
  });

  it("names one copy per server, so two worktrees are one choice", () => {
    const pickable = resolvePickableMachines(
      on("env-1", "a1"),
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("a1-wt", "env-1", "github.com/acme/app"),
        project("a2", "env-2", "github.com/acme/app"),
        project("a2-wt", "env-2", "github.com/acme/app"),
      ],
      connected("env-1", "env-2"),
    );
    expect(pickable.map((entry) => entry.projectId)).toEqual(["a1", "a2"]);
  });

  it("keeps the panel's own worktree rather than the server's first copy", () => {
    const pickable = resolvePickableMachines(
      on("env-1", "a1-wt"),
      [
        project("a1", "env-1", "github.com/acme/app"),
        project("a1-wt", "env-1", "github.com/acme/app"),
        project("a2", "env-2", "github.com/acme/app"),
      ],
      connected("env-1", "env-2"),
    );
    expect(pickable[0]).toEqual({
      machineId: "env-1",
      projectId: "a1-wt",
      workspaceRoot: "/srv/env-1/a1-wt",
      label: "Server env-1",
    });
  });
});
