import { AuthProvidersManageScope } from "@vekrel/contracts";
import { readMachineScope, useMachineScope } from "../../state/session";
import { useAtomValue } from "@effect/atom-react";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type MachineId,
  type ServerProvider,
} from "@vekrel/contracts";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { usesChatGptSharing } from "@vekrel/shared/usageLimits";

import { useMachineSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverMachine } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { SettingsRow } from "./settingsLayout";

export function AddCodexAccountDialog({
  machineId,
  onClose,
  renderSetup,
  onAccountCreated,
}: {
  readonly machineId: MachineId;
  readonly onClose: () => void;
  readonly onAccountCreated?:
    | ((instanceId: ProviderInstanceId, displayName: string) => void)
    | undefined;
  readonly renderSetup: (instanceId: ProviderInstanceId, provider: ServerProvider) => ReactNode;
}) {
  const canManageProviders = useMachineScope(machineId, AuthProvidersManageScope);
  const settings = useMachineSettings(machineId);
  const providers = useAtomValue(serverMachine.providersValueAtom(machineId));
  const update = useAtomCommand(serverMachine.updateSettings, "Add ChatGPT account");
  const [name, setName] = useState("Personal");
  const displayName = `ChatGPT - ${name.trim()}`;
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  const connected = usesChatGptSharing(provider);
  const closeAfterConnection = useEffectEvent(onClose);
  useEffect(() => {
    if (connected) closeAfterConnection();
  }, [connected]);

  const createAccount = async () => {
    if (pending || !name.trim() || !readMachineScope(machineId, AuthProvidersManageScope))
      return;
    setPending(true);
    // The ID is routing identity; the name is editable and need not be unique.
    const id = ProviderInstanceId.make(`codex_${randomUUID()}`);
    const result = await update({
      machineId,
      input: {
        patch: {
          providerInstances: {
            ...settings.providerInstances,
            [id]: {
              driver: ProviderDriverKind.make("codex"),
              displayName,
              enabled: true,
              config: { enabled: true, setupMode: "managed" },
            },
          },
        },
      },
    });
    if (result._tag === "Success") {
      if (onAccountCreated) {
        onAccountCreated(id, displayName);
        onClose();
      } else {
        setInstanceId(id);
      }
    }
    setPending(false);
  };

  return (
    <Dialog
      open={!connected}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={instanceId ? displayName : "Add ChatGPT account"}
          description="Each account has its own Codex instance and sign-in. Choose the other account on the sign-in page."
        />
        <WizardPanel>
          {instanceId ? (
            provider?.setup ? (
              renderSetup(instanceId, provider)
            ) : (
              <SettingsRow title="Codex runtime" description="Preparing managed setup." />
            )
          ) : (
            <form
              id="add-codex-account"
              onSubmit={(event) => {
                event.preventDefault();
                void createAccount();
              }}
            >
              <SettingsRow
                title="Account name"
                description="Shown in the provider list and model picker."
                control={
                  <Input
                    aria-label="Account name"
                    value={name}
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. Personal or Work"
                  />
                }
              />
            </form>
          )}
        </WizardPanel>
        <WizardFooter>
          {instanceId ? (
            <Button variant="outline" onClick={onClose}>
              Finish later
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-codex-account"
                disabled={pending || !name.trim() || !canManageProviders}
              >
                {pending ? "Adding account…" : "Continue"}
              </Button>
            </>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
