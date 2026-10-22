export interface WslUncPath {
  readonly distro: string;
  readonly linuxPath: string;
}

export interface WslEnvironmentCandidate<TMachineId extends string = string> {
  readonly machineId: TMachineId;
  readonly backendId: string;
  readonly runningDistro: string | null;
}

export interface WslEnvironmentConfiguration {
  readonly enabled: boolean;
  readonly wslOnly: boolean;
  readonly distro: string | null;
  readonly distros: ReadonlyArray<{
    readonly name: string;
    readonly isDefault: boolean;
  }>;
}

export interface WslProjectSelection<TMachineId extends string = string> extends WslUncPath {
  readonly machineId: TMachineId;
}

const WSL_UNC_PREFIXES = ["\\\\wsl.localhost\\", "\\\\wsl$\\"] as const;
const WSL_DISTRO_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const WSL_DEFAULT_BACKEND_ID = "wsl:default";

export function parseWslUncPath(input: string): WslUncPath | null {
  const normalized = input.trim().replaceAll("/", "\\");
  const prefix = WSL_UNC_PREFIXES.find((candidate) =>
    normalized.toLowerCase().startsWith(candidate.toLowerCase()),
  );
  if (!prefix) {
    return null;
  }

  const rest = normalized.slice(prefix.length);
  const segments = rest.split("\\").filter((segment) => segment.length > 0);
  const distro = segments.shift();
  if (!distro || !WSL_DISTRO_NAME_PATTERN.test(distro)) {
    return null;
  }

  return {
    distro,
    linuxPath: segments.length === 0 ? "/" : `/${segments.join("/")}`,
  };
}

export function resolveWslProjectSelection<TMachineId extends string>(
  input: string,
  candidates: ReadonlyArray<WslEnvironmentCandidate<TMachineId>>,
): WslProjectSelection<TMachineId> | null {
  const parsed = parseWslUncPath(input);
  if (!parsed) {
    return null;
  }

  const exact = candidates.find((candidate) => {
    if (!candidate.backendId.startsWith("wsl:")) {
      return false;
    }

    const backendDistro = candidate.backendId.slice("wsl:".length);
    const runningDistro =
      candidate.runningDistro ??
      (backendDistro.length > 0 && backendDistro.toLowerCase() !== "default"
        ? backendDistro
        : null);
    return runningDistro?.toLowerCase() === parsed.distro.toLowerCase();
  });
  return exact ? { ...parsed, machineId: exact.machineId } : null;
}

interface ConfiguredWslBackend {
  readonly backendId: string;
  readonly runningDistro: string | null;
}

function resolveConfiguredWslBackend(
  configuration: WslEnvironmentConfiguration | null,
): ConfiguredWslBackend | null {
  if (!configuration) {
    return null;
  }

  if (configuration.distro === null) {
    return { backendId: WSL_DEFAULT_BACKEND_ID, runningDistro: null };
  }

  const configuredDistro = configuration.distro.trim();
  if (configuredDistro.length === 0) {
    return null;
  }

  const installedDistro = configuration.distros.find(
    (distro) => distro.name.toLowerCase() === configuredDistro.toLowerCase(),
  );
  const resolvedDistro = installedDistro?.name ?? configuredDistro;
  return { backendId: `wsl:${resolvedDistro}`, runningDistro: resolvedDistro };
}

export function resolveProjectPickerTarget<TMachineId extends string>(input: {
  readonly browseMachineId: TMachineId | null;
  readonly primaryMachineId: TMachineId | null;
  readonly desktopInstanceId: string | null;
  readonly wslConfiguration: WslEnvironmentConfiguration | null;
}): string | null {
  if (input.desktopInstanceId !== null) {
    return input.desktopInstanceId;
  }

  if (
    input.browseMachineId === null ||
    input.browseMachineId !== input.primaryMachineId ||
    !input.wslConfiguration?.enabled ||
    !input.wslConfiguration.wslOnly
  ) {
    return null;
  }

  return resolveConfiguredWslBackend(input.wslConfiguration)?.backendId ?? null;
}

export function applyWslEnvironmentConfiguration<TMachineId extends string>(
  candidates: ReadonlyArray<WslEnvironmentCandidate<TMachineId>>,
  primaryMachineId: TMachineId | null,
  configuration: WslEnvironmentConfiguration | null,
  primaryRunningDistro: string | null = null,
): ReadonlyArray<WslEnvironmentCandidate<TMachineId>> {
  if (!configuration) {
    return candidates;
  }

  const configuredBackend = resolveConfiguredWslBackend(configuration);
  if (!configuredBackend) {
    return candidates;
  }

  if (
    configuration.enabled &&
    configuration.wslOnly &&
    primaryMachineId !== null &&
    !candidates.some((candidate) => candidate.machineId === primaryMachineId)
  ) {
    return [
      ...candidates,
      {
        machineId: primaryMachineId,
        ...configuredBackend,
        runningDistro: primaryRunningDistro ?? configuredBackend.runningDistro,
      },
    ];
  }

  return candidates;
}
