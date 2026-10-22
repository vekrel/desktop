import type { MachineId } from "@vekrel/contracts";

import type { AssignableProject } from "./pullRequestProjectAssignment.logic";

interface FilterProject extends AssignableProject {
  readonly title: string;
  readonly workspaceRoot: string;
}

function distinguishTitles<Project extends FilterProject>(
  projects: ReadonlyArray<Project>,
  suffix: (project: Project) => string,
) {
  const counts = new Map<string, number>();
  for (const project of projects) {
    counts.set(project.title, (counts.get(project.title) ?? 0) + 1);
  }
  return projects.map((project) =>
    (counts.get(project.title) ?? 0) > 1
      ? { ...project, title: `${project.title} · ${suffix(project)}` }
      : project,
  );
}

export function pullRequestFilterProjects<Project extends FilterProject>(
  projects: ReadonlyArray<Project>,
  machineLabels: ReadonlyMap<MachineId, string>,
  selectedProject?: Pick<AssignableProject, "id" | "machineId">,
) {
  const byRepository = new Map<string, Project>();
  for (const project of projects) {
    const repository = project.repositoryIdentity?.canonicalKey?.toLowerCase();
    const key = JSON.stringify([
      project.machineId,
      repository ? ["repository", repository] : ["project", project.id],
    ]);
    const selected =
      project.id === selectedProject?.id && project.machineId === selectedProject.machineId;
    if (!byRepository.has(key) || selected) byRepository.set(key, project);
  }

  const byServer = distinguishTitles(
    [...byRepository.values()],
    (project) => machineLabels.get(project.machineId) ?? project.machineId,
  );
  const byPath = distinguishTitles(byServer, (project) => project.workspaceRoot);
  const byMachine = distinguishTitles(byPath, (project) => project.machineId);
  return distinguishTitles(byMachine, (project) => project.id).toSorted((left, right) =>
    left.title.localeCompare(right.title),
  );
}
