import type { ServerConfig } from "@vekrel/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveMachineIconPickerLock } from "./MachineIconPicker";

const config = (machineIcon: boolean | undefined) =>
  ({
    machine: { capabilities: machineIcon === undefined ? {} : { machineIcon } },
  }) as unknown as ServerConfig;

describe("resolveMachineIconPickerLock", () => {
  it("waits for a settings grant before allowing changes", () => {
    expect(
      resolveMachineIconPickerLock({ serverConfig: config(true), operateAccess: "pending" }),
    ).toMatch(/cannot change/);
    expect(
      resolveMachineIconPickerLock({ serverConfig: config(true), operateAccess: "granted" }),
    ).toBeNull();
  });
});
