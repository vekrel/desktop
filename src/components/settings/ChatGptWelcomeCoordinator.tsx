import { useAtomValue } from "@effect/atom-react";
import { usesChatGptSharing } from "@vekrel/shared/usageLimits";
import { useState } from "react";
import { machinePresentations } from "../../state/presentation";
import { OpenAI } from "../Icons";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { ChatGptUsageButton } from "./ChatGptUsageButton";

const STORAGE_KEY = "t3:chatgpt-sharing-welcome:v1";
function readAcknowledgedProfiles(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

export function ChatGptWelcomeCoordinator() {
  const presentations = useAtomValue(machinePresentations.presentationsAtom);
  const providersByMachine = useAtomValue(machinePresentations.providersByMachineAtom);
  const [acknowledged, setAcknowledged] = useState(readAcknowledgedProfiles);
  const profiles = [...presentations].flatMap(([machineId, presentation]) =>
    presentation.connection.phase !== "connected"
      ? []
      : (providersByMachine.get(machineId) ?? [])
          .filter(usesChatGptSharing)
          .map((provider) => ({
            key: JSON.stringify([
              machineId,
              provider.instanceId,
              provider.auth.profileId ?? provider.auth.email ?? "default",
            ]),
            machineLabel: presentation.entry.target.label,
            providerName: provider.displayName ?? "Codex",
          })),
  );
  const next = profiles.find((profile) => !acknowledged.includes(profile.key));
  const dismiss = () => {
    if (!next) return;
    const updated = [...acknowledged, next.key];
    setAcknowledged(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  };
  return (
    <Dialog
      open={next !== undefined}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <OpenAI className="mb-2 size-8" aria-hidden="true" />
          <DialogTitle>Your ChatGPT plan is connected</DialogTitle>
          <DialogDescription>
            Eligible usage in Vekrel uses your ChatGPT plan. Manage your shared usage and any
            credit settings in ChatGPT.
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            {next?.providerName} on {next?.machineLabel}
          </p>
        </DialogHeader>
        <DialogFooter>
          <ChatGptUsageButton />
          <Button onClick={dismiss}>Continue</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
