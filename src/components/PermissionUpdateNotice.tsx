import { useAtomValue } from "@effect/atom-react";
import { sessionHasLegacyPermissions, type MachineId } from "@vekrel/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useMachines } from "../state/machines";
import { machineSession } from "../state/session";
import { toastManager } from "./ui/toast";

// Keep an active toast across remounts, including Strict Mode effect replay.
const shown = new Set<MachineId>();

function MachinePermissionNotice({
  machineId,
  label,
}: {
  machineId: MachineId;
  label: string;
}) {
  const session = useAtomValue(machineSession.sessionStateAtom(machineId));
  const navigate = useNavigate();
  useEffect(() => {
    if (
      session._tag !== "Success" ||
      session.waiting ||
      !sessionHasLegacyPermissions(session.value)
    )
      return;
    if (shown.has(machineId)) return;
    const key = `t3code:permission-update:v1:${machineId}`;
    try {
      if (getLocalStorageItem(key, Schema.Boolean)) return;
    } catch {}
    shown.add(machineId);
    const persistDismissal = () => {
      try {
        setLocalStorageItem(key, true, Schema.Boolean);
      } catch {}
    };
    const dismiss = () => {
      persistDismissal();
      toastManager.close(id);
    };
    const id = toastManager.add({
      title: `Permissions have changed for ${label}`,
      description:
        "This connection still uses the old permissions, so some actions may no longer be available. Pair again using a new link with the permissions you need.",
      timeout: 0,
      onClose: persistDismissal,
      actionProps: {
        children: "Open Connections",
        onClick: () => {
          dismiss();
          void navigate({ to: "/settings/connections" });
        },
      },
      data: {
        actionLayout: "stacked-end",
        secondaryActionProps: { children: "Dismiss", onClick: dismiss },
        secondaryActionVariant: "ghost",
      },
    });
  }, [machineId, label, navigate, session]);
  return null;
}

export function PermissionUpdateNotice() {
  const { machines } = useMachines();
  return machines.map(({ machineId, label }) => (
    <MachinePermissionNotice key={machineId} machineId={machineId} label={label} />
  ));
}
