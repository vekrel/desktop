import {
  type DeviceHostSummary,
  type DevicePlatformAvailability,
  type MachineId,
  SshDeviceHostConfig,
} from "@vekrel/contracts";
import * as Schema from "effect/Schema";

export interface DeviceHostCheckTarget {
  machineId: MachineId;
  label: string;
  connected: boolean;
}
export type DeviceHostCheck =
  | { status: "pending" }
  | { status: "local" }
  | {
      status: "connected";
      platforms: ReadonlyArray<DevicePlatformAvailability>;
      tools?: DeviceHostSummary["tools"];
    }
  | { status: "failed"; error: string };

const decodeDeviceHostDraft = Schema.decodeUnknownOption(SshDeviceHostConfig);

export function parseDeviceHostDraft(host: SshDeviceHostConfig) {
  const { identityFile, ...rest } = host;
  return decodeDeviceHostDraft({
    ...rest,
    ...(identityFile?.trim() ? { identityFile: identityFile.trim() } : {}),
  });
}

export function deviceHostConnectionKey(host: SshDeviceHostConfig) {
  return JSON.stringify([host.target.trim(), host.port, host.identityFile?.trim() || undefined]);
}

export async function checkDeviceHostConnections(
  targets: ReadonlyArray<DeviceHostCheckTarget>,
  host: SshDeviceHostConfig,
  probe: (machineId: MachineId, host: SshDeviceHostConfig) => Promise<DeviceHostSummary>,
  report: (machineId: MachineId, result: DeviceHostCheck) => void,
) {
  await Promise.all(
    targets.map(async (target) => {
      report(target.machineId, { status: "pending" });
      try {
        if (!target.connected) throw new Error("Machine disconnected");
        const result = await probe(target.machineId, host);
        report(
          target.machineId,
          result.kind === "local"
            ? { status: "local" }
            : {
                status: "connected",
                platforms: result.platforms,
                ...(result.tools ? { tools: result.tools } : {}),
              },
        );
      } catch (error) {
        report(target.machineId, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}
