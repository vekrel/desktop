import type { MachineId, MachineKind, ProjectId } from "@vekrel/contracts";

export interface AssignableProject {
  readonly id: ProjectId;
  readonly machineId: MachineId;
  readonly repositoryIdentity?: { readonly canonicalKey?: string | undefined } | null | undefined;
}

function repositoryKey(project: AssignableProject): string | undefined {
  return project.repositoryIdentity?.canonicalKey?.toLowerCase();
}

export function assignProjectsToMachines(
  projects: ReadonlyArray<AssignableProject>,
  machineIds: ReadonlyArray<MachineId>,
  preferredMachineId?: MachineId | null,
): Map<MachineId, ProjectId[]> {
  const rank = new Map(machineIds.map((id, index) => [id, index] as const));
  const owner = new Map<string, MachineId>();
  for (const project of projects) {
    const key = repositoryKey(project);
    if (!key) continue;
    const machineRank = rank.get(project.machineId);
    if (machineRank === undefined) continue;
    const current = owner.get(key);
    if (current === undefined) {
      owner.set(key, project.machineId);
      continue;
    }
    if (current === preferredMachineId) continue;
    if (
      project.machineId === preferredMachineId ||
      machineRank < (rank.get(current) ?? Number.MAX_SAFE_INTEGER)
    ) {
      owner.set(key, project.machineId);
    }
  }
  const assignment = new Map<MachineId, ProjectId[]>();
  for (const project of projects) {
    if (!rank.has(project.machineId)) continue;
    const key = repositoryKey(project);
    if (key && owner.get(key) !== project.machineId) continue;
    const listed = assignment.get(project.machineId);
    if (listed === undefined) assignment.set(project.machineId, [project.id]);
    else listed.push(project.id);
  }
  return assignment;
}

export interface PickableMachine {
  readonly machineId: MachineId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly label: string;
  readonly machine?: MachineKind;
}

export function resolvePickableMachines(
  current: { readonly machineId: MachineId; readonly projectId: ProjectId },
  projects: ReadonlyArray<AssignableProject & { readonly workspaceRoot: string }>,
  machines: ReadonlyArray<{
    readonly machineId: MachineId;
    readonly label: string;
    readonly machine?: MachineKind;
  }>,
): ReadonlyArray<PickableMachine> {
  const own = projects.find(
    (project) =>
      project.machineId === current.machineId && project.id === current.projectId,
  );
  const key = own === undefined ? undefined : repositoryKey(own);
  const ownMachine = machines.find(
    (machine) => machine.machineId === current.machineId,
  );
  if (own === undefined || !key || ownMachine === undefined) return [];
  const others = machines.flatMap((machine) => {
    if (machine.machineId === current.machineId) return [];
    const copy = projects.find(
      (project) =>
        project.machineId === machine.machineId && repositoryKey(project) === key,
    );
    return copy === undefined
      ? []
      : [
          {
            machineId: machine.machineId,
            projectId: copy.id,
            workspaceRoot: copy.workspaceRoot,
            label: machine.label,
            ...(machine.machine === undefined ? {} : { machine: machine.machine }),
          },
        ];
  });
  if (others.length === 0) return [];
  return [
    {
      machineId: current.machineId,
      projectId: own.id,
      workspaceRoot: own.workspaceRoot,
      label: ownMachine.label,
      ...(ownMachine.machine === undefined ? {} : { machine: ownMachine.machine }),
    },
    ...others,
  ];
}
