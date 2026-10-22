import { AuthMachineMaintainScope } from "@vekrel/contracts";

import { usePrimaryCloudLinkState } from "~/cloud/primaryCloudLinkState";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { isLocalMachineDisabled } from "~/localMachine";
import { desktopWslStateAtom } from "~/state/desktopWslState";
import { useMachines, usePrimaryMachineId } from "~/state/machines";
import { useMachineQuery } from "~/state/query";
import { useMachineScope } from "~/state/session";
import { isWslSettingsRowVisible } from "./ConnectionsSettings.logic";
import { isProviderSettingsMachineAvailable } from "./ProviderSettingsPanel.logic";
import type { SettingsScopeSearch } from "./settingsScope";
import {
  filterAvailableSettingsSearchItems,
  getThreadAutoSettlementSearchAvailability,
} from "./settingsSearch";

export function useAvailableSettingsSearchItems(scopeSearch: SettingsScopeSearch = {}) {
  const { machines } = useMachines();
  // The filtered list must be cached on boolean flags so it stays stable for the search and
  // the command palette while machines update. The compiler cannot tell that `.some()`
  // and other plain calls return primitives, so `=== true` marks each flag as one; without
  // it the flags join the filter's cache scope and the list is rebuilt every render.
  const hasMachine =
    machines.some((machine) => machine.serverConfig !== null) === true;
  const hasProviderSettingsMachine =
    machines.some((machine) =>
      isProviderSettingsMachineAvailable({
        connectionPhase: machine.connection.phase,
        hasServerConfig: machine.serverConfig !== null,
      }),
    ) === true;
  const hasMacProviderSettingsMachine =
    machines.some(
      (machine) =>
        (scopeSearch.machine === undefined || machine.machineId === scopeSearch.machine) &&
        machine.serverConfig?.machine.platform.os === "darwin" &&
        isProviderSettingsMachineAvailable({
          connectionPhase: machine.connection.phase,
          hasServerConfig: true,
        }),
    ) === true;
  const hasThreadAutoSettlement =
    getThreadAutoSettlementSearchAvailability(machines).eligibleMachineIds.length > 0;
  const primaryMachineId = usePrimaryMachineId();
  const canMaintain = useMachineScope(primaryMachineId, AuthMachineMaintainScope);
  const cloudLinkState = usePrimaryCloudLinkState().data;
  // Same fallback as the Connections row: older servers imply a tunnel from `linked`.
  const managedTunnelActive =
    cloudLinkState?.linkRevoked !== true &&
    (cloudLinkState?.managedTunnelActive ?? cloudLinkState?.linked ?? false) === true;
  const localMachineDisabled = isLocalMachineDisabled() === true;
  const canManageLocalBackend = !localMachineDisabled && canMaintain;
  const desktopWsl = useMachineQuery(
    isElectron && canManageLocalBackend ? desktopWslStateAtom : null,
  );
  const cloudPublicConfig = hasCloudPublicConfig() === true;
  const wslSettingsRowVisible =
    isWslSettingsRowVisible({ state: desktopWsl.data, error: desktopWsl.error }) === true;

  return filterAvailableSettingsSearchItems({
    localMachineDisabled,
    hasCloudPublicConfig: cloudPublicConfig,
    hasMachine,
    hasProviderSettingsMachine,
    hasMacProviderSettingsMachine,
    canManageLocalBackend,
    isWslSettingsRowVisible: wslSettingsRowVisible,
    hasThreadAutoSettlement,
    managedTunnelActive,
  });
}
