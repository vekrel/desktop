import { AuthSettingsWriteScope } from "@vekrel/contracts";
import { readMachineScope } from "../../state/session";
import { useRef, useState } from "react";
import * as Cause from "effect/Cause";
import type { SshDeviceHostConfig } from "@vekrel/contracts";
import { deviceMachine } from "../../state/device";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  checkDeviceHostConnections,
  deviceHostConnectionKey,
  type DeviceHostCheck,
  type DeviceHostCheckTarget,
} from "./deviceHostConnectionChecks";

export function useHostConnectionChecks(targets: ReadonlyArray<DeviceHostCheckTarget>) {
  const test = useAtomCommand(deviceMachine.testHost, { reportFailure: false });
  const [checks, setChecks] = useState<Record<string, Record<string, DeviceHostCheck>>>({});
  const running = useRef(new Set<string>());
  const testConnection = async (host: SshDeviceHostConfig) => {
    const key = deviceHostConnectionKey(host);
    if (running.current.has(key)) return;
    running.current.add(key);
    setChecks((current) => ({ ...current, [key]: {} }));
    const results: Record<string, DeviceHostCheck> = {};
    await checkDeviceHostConnections(
      targets,
      host,
      async (machineId, input) => {
        if (!readMachineScope(machineId, AuthSettingsWriteScope)) {
          throw new Error("This connection cannot test device hosts.");
        }
        const result = await test({ machineId, input });
        if (result._tag === "Failure") throw new Error(Cause.pretty(result.cause));
        return result.value;
      },
      (machineId, result) => {
        results[machineId] = result;
        setChecks((current) => ({
          ...current,
          [key]: { ...current[key], [machineId]: result },
        }));
      },
    ).finally(() => running.current.delete(key));
    return results;
  };
  return { checks, testConnection };
}
