import { PROVIDER_DISPLAY_NAMES } from "@vekrel/contracts";
import { settlePromise } from "@vekrel/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { useMachineProviders, useMachines } from "~/state/machines";
import { serverMachine } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function useProviderUpdates() {
  const { machines: allMachines } = useMachines();
  const providersByMachine = useMachineProviders();
  const updateProvider = useAtomCommand(serverMachine.updateProvider, {
    reportFailure: false,
  });
  const machines = allMachines.flatMap((machine) => {
    const providers = providersByMachine.get(machine.machineId) ?? [];
    if (machine.connection.phase !== "connected") {
      return [];
    }
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
      canOneClickUpdateProviderCandidate(candidate, providers),
    );
    return candidates.length > 0
      ? [{ machineId: machine.machineId, label: machine.label, candidates }]
      : [];
  });

  const updateAll = async ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    const runs = await Promise.all(
      machines.flatMap(({ machineId, label, candidates }) =>
        candidates.map(async (candidate): Promise<ProviderUpdateRun> => ({
          machineId,
          machineLabel: label,
          driver: candidate.driver,
          instanceId: candidate.instanceId,
          result: await updateProvider({
            machineId,
            input: { provider: candidate.driver, instanceId: candidate.instanceId },
          }),
        })),
      ),
    );
    const view = quiet ? null : getProviderUpdateRunToastView(runs);
    if (view) {
      toastManager.add(
        stackedThreadToast({
          ...view,
          description: <span className="whitespace-pre-line">{view.description}</span>,
        }),
      );
    }
    return runs;
  };

  return { machines, updateAll };
}

export function ProviderUpdatesAction() {
  const { machines, updateAll } = useProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  if (machines.length === 0 && !isPending) {
    return null;
  }

  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    await settlePromise(() => updateAll());
    pending.current = false;
    setIsPending(false);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={() => void handleUpdate()}
          >
            {isPending ? "Updating…" : "Update all"}
          </Button>
        }
      />
      <TooltipPopup side="top">
        {machines.map((machine) => (
          <div key={machine.machineId}>
            {machine.label}:{" "}
            {machine.candidates
              .map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver)
              .join(", ")}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
