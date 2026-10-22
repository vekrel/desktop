import { useEffect, useRef, useState } from "react";
import { pendingProviderAuthDelivery, clearProviderAuthDelivery } from "../../providerAuthDelivery";
import { serverMachine } from "../../state/server";
import { useMachines } from "../../state/machines";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";

/** Hosted web receives only the one-time code; the selected machine verifies and stores tokens. */
export function ProviderAuthCallbackCoordinator() {
  const completeAuth = useAtomCommand(serverMachine.completeProviderAuth, {
    reportFailure: false,
  });
  const { machines } = useMachines();
  const [delivery, setDelivery] = useState(pendingProviderAuthDelivery);
  const started = useRef(false);
  const machineId = delivery?.machineId;
  const connected = machines.some(
    (machine) =>
      machine.machineId === machineId && machine.connection.phase === "connected",
  );
  useEffect(() => {
    const input = delivery;
    if (!input || started.current || !connected) return;
    started.current = true;
    void completeAuth({
      machineId: input.machineId,
      input: { instanceId: input.instanceId, flowId: input.flowId, callbackUrl: input.callbackUrl },
    })
      .then((result) => {
        if (result._tag === "Failure")
          toastManager.add({
            type: "error",
            title: "ChatGPT sign-in couldn't finish",
            description: "Return to the provider and try again.",
          });
      })
      .catch(() =>
        toastManager.add({
          type: "error",
          title: "ChatGPT sign-in couldn't finish",
          description: "Reconnect to the machine and try again.",
        }),
      )
      .finally(() => {
        setDelivery(undefined);
        clearProviderAuthDelivery();
      });
  }, [completeAuth, connected, delivery]);
  return null;
}
