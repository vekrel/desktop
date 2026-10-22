import { useAtomValue } from "@effect/atom-react";
import type { MachineId, ProviderInstanceId } from "@vekrel/contracts";

import { useMachineQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverMachine } from "../../state/server";
import { Button } from "../ui/button";
import { WizardFooter, WizardPanel } from "../ui/wizard";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./settingsLayout";

export function ProviderWizardAuthenticationStep({
  machineId,
  machineLabel,
  instanceId,
  onFinish,
}: {
  readonly machineId: MachineId;
  readonly machineLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly onFinish: () => void;
}) {
  const providers =
    useAtomValue(serverMachine.providersValueAtom(machineId)) ?? EMPTY_SERVER_PROVIDERS;
  const provider = providers.find((candidate) => candidate.instanceId === instanceId);
  const query = useMachineQuery(
    serverMachine.providerAuthState({ machineId, input: { instanceId } }),
  );
  const auth = query.data;
  const active =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const signedIn =
    provider?.auth.status === "authenticated" ||
    (provider?.auth.status === "unknown" && auth?.phase === "succeeded");
  const isDiscovering = !signedIn && !query.error && auth?.methods === undefined;
  const canAuthenticate = (auth?.methods?.length ?? 0) > 0;

  return (
    <>
      <WizardPanel className="min-h-72">
        <SettingsGroup variant="plain">
          {provider && (canAuthenticate || signedIn) ? (
            <ProviderAuthenticationSection
              machineId={machineId}
              machineLabel={machineLabel}
              instanceId={instanceId}
              provider={{
                ...provider,
                setup: {
                  ...provider.setup,
                  canInstall: provider.setup?.canInstall ?? false,
                  canAuthenticate,
                },
              }}
              readOnly={false}
            />
          ) : (
            <SettingsRow
              title="Account"
              description={
                isDiscovering
                  ? "Discovering sign-in methods…"
                  : (query.error ??
                    auth?.message ??
                    "No in-app sign-in advertised. Follow the provider's docs to finish setup.")
              }
              control={
                isDiscovering ? (
                  <Button disabled size="sm" variant="outline">
                    Sign in
                  </Button>
                ) : provider?.setup?.documentationUrl ? (
                  <Button
                    size="sm"
                    variant="outline"
                    render={
                      <a href={provider.setup.documentationUrl} target="_blank" rel="noreferrer" />
                    }
                  >
                    Open docs
                  </Button>
                ) : undefined
              }
            />
          )}
        </SettingsGroup>
      </WizardPanel>
      <WizardFooter>
        <Button
          size="sm"
          variant={signedIn ? "default" : "outline"}
          disabled={active}
          onClick={onFinish}
        >
          {signedIn ? "Done" : "Skip for now"}
        </Button>
      </WizardFooter>
    </>
  );
}
