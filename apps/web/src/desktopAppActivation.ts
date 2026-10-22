import type {
  DesktopAppActivationFailure,
  DesktopAppActivationRequest,
  DesktopAppActivationResponse,
  MachineId,
  ExecutionMachinePlatformOs,
  ProjectId,
  ScopedProjectRef,
  ThreadId,
} from "@vekrel/contracts";

export interface DesktopAppActivationProject {
  readonly id: ProjectId;
  readonly machineId: MachineId;
  readonly workspaceRoot: string;
}

export interface DesktopAppActivationTarget {
  readonly machineId: MachineId;
  readonly platform: ExecutionMachinePlatformOs;
}

export interface DesktopAppActivationDependencies {
  readonly getTarget: () => DesktopAppActivationTarget | null;
  readonly findProject: (
    machineId: MachineId,
    workspaceRoot: string,
  ) => DesktopAppActivationProject | null;
  readonly createProject: (
    machineId: MachineId,
    workspaceRoot: string,
  ) => Promise<ProjectId>;
  readonly waitForProject: (projectRef: ScopedProjectRef) => Promise<void>;
  readonly openThread: (
    projectRef: ScopedProjectRef,
  ) => Promise<{ readonly threadId: ThreadId } | null>;
}

function failure(
  requestId: string,
  code: DesktopAppActivationFailure["code"],
  message: string,
): DesktopAppActivationFailure {
  return { version: 1, requestId, ok: false, code, message };
}

function desktopPlatformToMachineOs(
  platform: DesktopAppActivationRequest["platform"],
): ExecutionMachinePlatformOs {
  return platform === "win32" ? "windows" : platform;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export async function handleDesktopAppActivationRequest(
  request: DesktopAppActivationRequest,
  dependencies: DesktopAppActivationDependencies,
): Promise<DesktopAppActivationResponse> {
  const target = dependencies.getTarget();
  if (target === null) {
    return failure(
      request.requestId,
      "machine-unavailable",
      "The desktop app's primary local machine is not connected.",
    );
  }

  const requestPlatform = desktopPlatformToMachineOs(request.platform);
  if (requestPlatform !== target.platform) {
    return failure(
      request.requestId,
      "platform-mismatch",
      `The command path is for ${requestPlatform}, but the desktop app's primary machine uses ${target.platform}. Cross-platform path mapping is not supported.`,
    );
  }

  let projectId = dependencies.findProject(target.machineId, request.workspaceRoot)?.id ?? null;
  if (projectId === null) {
    try {
      projectId = await dependencies.createProject(target.machineId, request.workspaceRoot);
      await dependencies.waitForProject({ machineId: target.machineId, projectId });
    } catch (error) {
      return failure(
        request.requestId,
        "project-create-failed",
        errorMessage(error, "Vekrel could not add the project."),
      );
    }
  }

  try {
    const opened = await dependencies.openThread({
      machineId: target.machineId,
      projectId,
    });
    if (opened === null) {
      return failure(
        request.requestId,
        "thread-open-failed",
        "Vekrel could not open a new thread for the project.",
      );
    }
    return {
      version: 1,
      requestId: request.requestId,
      ok: true,
      projectId,
      threadId: opened.threadId,
    };
  } catch (error) {
    return failure(
      request.requestId,
      "thread-open-failed",
      errorMessage(error, "Vekrel could not open a new thread for the project."),
    );
  }
}
