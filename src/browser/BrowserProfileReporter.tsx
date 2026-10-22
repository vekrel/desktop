import { AuthPreviewOperateScope, type BrowserProfile } from "@vekrel/contracts";
import { useEffect } from "react";

import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";
import { useServerConfigs } from "~/state/entities";
import { useMachines } from "~/state/machines";
import { previewMachine } from "~/state/preview";
import { useMachinesWithScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

const selectProfiles = (settings: { readonly browserProfiles: ReadonlyArray<BrowserProfile> }) =>
  settings.browserProfiles;
const selectDefaultProfileId = (settings: { readonly browserDefaultProfileId: string }) =>
  settings.browserDefaultProfileId;

export function BrowserProfileReporter() {
  const hydrated = useClientSettingsHydrated();
  const profiles = useClientSettings(selectProfiles);
  const defaultProfileId = useClientSettings(selectDefaultProfileId);
  const { machines } = useMachines();
  const serverConfigs = useServerConfigs();
  const operable = useMachinesWithScope(machines, AuthPreviewOperateScope);
  const report = useAtomCommand(previewMachine.reportProfiles, { reportFailure: false });

  useEffect(() => {
    if (!hydrated) return;
    for (const [machineId, config] of serverConfigs) {
      if (!config.machine.capabilities.serverBrowser || !operable.has(machineId)) continue;
      void report({ machineId, input: { profiles, defaultProfileId } });
    }
  }, [defaultProfileId, hydrated, operable, profiles, report, serverConfigs]);

  return null;
}
