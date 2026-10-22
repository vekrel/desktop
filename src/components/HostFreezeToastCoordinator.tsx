import { useAtomValue } from "@effect/atom-react";
import { hostFreezeNotice } from "@vekrel/client-runtime/connection";
import { useEffect, useRef } from "react";

import { machineSummaries } from "../state/presentation";
import { machineServerConfigsAtom } from "../state/server";
import { toastManager } from "./ui/toast";

/** Tells the user why a host dropped, once per stall, when it reports one on reconnect. */
export function HostFreezeToastCoordinator() {
  const configs = useAtomValue(machineServerConfigsAtom);
  const identities = useAtomValue(machineSummaries.identitiesAtom);
  const shownRef = useRef(new Set<string>());

  useEffect(() => {
    for (const [machineId, config] of configs) {
      const stall = config.lastEventLoopStall;
      if (stall === undefined) continue;
      const key = `${machineId}:${stall.detectedAt}`;
      if (shownRef.current.has(key)) continue;
      shownRef.current.add(key);
      const label =
        identities.find((identity) => identity.machineId === machineId)?.label ??
        config.machine.label;
      const notice = hostFreezeNotice(label, stall);
      if (notice !== null) {
        toastManager.add({ type: "warning", ...notice });
      }
    }
  }, [configs, identities]);

  return null;
}
