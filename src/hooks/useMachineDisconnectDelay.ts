import type { MachineId } from "@vekrel/contracts";
import { useEffect, useState } from "react";

export function useMachineDisconnectDelay(unavailableMachineId: MachineId | null) {
  const [delay, setDelay] = useState({ machineId: unavailableMachineId, elapsed: false });
  if (delay.machineId !== unavailableMachineId) {
    setDelay({ machineId: unavailableMachineId, elapsed: false });
  }

  useEffect(() => {
    if (unavailableMachineId === null) return;
    const timeout = setTimeout(
      () => setDelay({ machineId: unavailableMachineId, elapsed: true }),
      20_000,
    );
    return () => clearTimeout(timeout);
  }, [unavailableMachineId]);

  return (
    unavailableMachineId !== null &&
    delay.machineId === unavailableMachineId &&
    delay.elapsed
  );
}
