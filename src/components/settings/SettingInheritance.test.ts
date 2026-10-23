import { DEFAULT_SERVER_SETTINGS, MachineId, ProjectId } from "@vekrel/contracts";
import { resolveProjectSettings } from "@vekrel/shared/projectSettings";
import { describe, expect, it } from "vite-plus/test";

import { settingInheritanceLayers } from "./SettingInheritance";

const machineId = MachineId.make("laptop");
const projectId = ProjectId.make("project");

describe("settingInheritanceLayers", () => {
  it("shows the checkout's vekrel.json as a layer for file-backed keys", () => {
    const file = { defaultThreadEnvMode: "worktree" as const };
    const fromFile = settingInheritanceLayers(
      {
        machineId,
        label: "Laptop",
        projectId,
        ...resolveProjectSettings(DEFAULT_SERVER_SETTINGS, projectId, null, file),
      },
      DEFAULT_SERVER_SETTINGS,
      "defaultThreadEnvMode",
    );
    expect(fromFile.map((layer) => [layer.label, layer.value, layer.effective])).toEqual([
      ["Project", "Inherits", false],
      ["Laptop", "Inherits", false],
      ["vekrel.json", "New worktree", true],
      ["Default", "Current checkout", false],
    ]);
    const settings = { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "local" as const };
    const fromEnvironment = settingInheritanceLayers(
      {
        machineId,
        label: "Laptop",
        projectId,
        ...resolveProjectSettings(settings, projectId, null, file),
      },
      settings,
      "defaultThreadEnvMode",
    );
    expect(fromEnvironment.map((layer) => [layer.value, layer.effective])).toEqual([
      ["Inherits", false],
      ["Current checkout", true],
      ["Inherits", false],
      ["Current checkout", false],
    ]);
  });
});
