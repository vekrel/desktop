import { AuthSettingsWriteScope } from "@vekrel/contracts";
import { useMachinesWithScope } from "../../state/session";
import {
  requiredScopesForServerSettingsPatch,
  MachineAuthorizationError,
} from "@vekrel/contracts";
import { readMachineScope } from "../../state/session";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import {
  DEFAULT_SERVER_SETTINGS,
  type ProjectScopedServerSettingKey,
  type ServerSettings,
  type UnifiedSettings,
} from "@vekrel/contracts";

import {
  persistClientSettingsPatch,
  useMergedSettings,
  useMigrateModelPreferences,
} from "../../hooks/useSettings";
import { serverMachine } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import {
  persistScopedSettingsPatch,
  planProjectOverridesClear,
  planScopedSettingsClear,
  planScopedSettingsPatch,
  scopedSettingsAreMixed,
  scopedSettingsSource,
  type ProjectOverrideEntry,
  type ScopedSettingsPatch,
} from "./scopedSettings";

export function useScopedSettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  const { target } = useSettingsScope();
  useMigrateModelPreferences(target?.machineId ?? null, target?.settings ?? null);
  return useMergedSettings(target?.settings ?? DEFAULT_SERVER_SETTINGS, selector);
}

export function useScopedSettingsMixed(keys: readonly (keyof ServerSettings)[]): boolean {
  const { targets } = useSettingsScope();
  return scopedSettingsAreMixed(targets, keys);
}

export function useScopedSettingSource(keys: readonly (keyof ServerSettings)[]) {
  const { targets } = useSettingsScope();
  return scopedSettingsSource(targets, keys);
}

function useRunScopedPlan() {
  const persistServer = useAtomCommand(serverMachine.updateSettings, { reportFailure: false });
  return (plan: ReturnType<typeof planScopedSettingsPatch>) => {
    if (plan.unavailableReason) {
      toastManager.add({
        type: "warning",
        title: "Setting not saved",
        description: plan.unavailableReason,
      });
      return;
    }
    void persistScopedSettingsPatch(
      plan,
      async (request) => {
        const missing = requiredScopesForServerSettingsPatch(request.input.patch).find(
          (scope) => !readMachineScope(request.machineId, scope),
        );
        if (missing)
          return AsyncResult.failure(
            Cause.fail(
              new MachineAuthorizationError({
                requiredScope: missing,
                message: "This connection lacks permission to change these settings.",
              }),
            ),
          );
        return persistServer(request);
      },
      persistClientSettingsPatch,
    ).then(({ failedMachines, savedMachines, savedMachineCount }) => {
      if (failedMachines.length === 0) return;
      toastManager.add({
        type: "error",
        title:
          savedMachineCount > 0 ? "Setting saved on some machines" : "Setting not saved",
        description: [
          ...failedMachines.map(
            ({ label, message }) => `Could not save on ${label}: ${message}`,
          ),
          ...(savedMachineCount > 0
            ? [`Saved on ${savedMachines.map(({ label }) => label).join(", ")}.`]
            : []),
        ].join("\n"),
      });
    });
  };
}

export function useUpdateScopedSettings() {
  const { scope, machines } = useSettingsScope();
  const run = useRunScopedPlan();
  return (patch: ScopedSettingsPatch) => run(planScopedSettingsPatch(scope, machines, patch));
}

export function useClearScopedSettings() {
  const context = useOptionalSettingsScope();
  const run = useRunScopedPlan();
  return (keys: readonly ProjectScopedServerSettingKey[]) => {
    if (context === null) return;
    run(planScopedSettingsClear(context.scope, context.machines, keys));
  };
}

export function useClearProjectOverrides() {
  const context = useOptionalSettingsScope();
  const run = useRunScopedPlan();
  return (
    entries: readonly ProjectOverrideEntry[],
    keys: readonly ProjectScopedServerSettingKey[],
  ) => {
    if (context === null) return;
    run(planProjectOverridesClear(context.machines, entries, keys));
  };
}

export function useScopedSettingsWriteAllowed() {
  const { connectedMachines } = useSettingsScope();
  const writable = useMachinesWithScope(connectedMachines, AuthSettingsWriteScope);
  return (
    connectedMachines.length > 0 &&
    connectedMachines.every((target) => writable.has(target.machineId))
  );
}
