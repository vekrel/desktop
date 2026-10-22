import {
  AuthSettingsWriteScope,
  MACHINE_KINDS,
  isMachineKind,
  resolveMachineKind,
  type MachineId,
  type ServerConfig,
} from "@vekrel/contracts";

import { useUpdateMachineSettings } from "../../hooks/useSettings";
import { useMachineScope } from "../../state/session";
import { MACHINE_KIND_LABELS, MachineIcon } from "../MachineIcon";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";

export function resolveMachineIconPickerLock(input: {
  readonly serverConfig: Pick<ServerConfig, "machine"> | null;
  readonly operateAccess: "granted" | "denied" | "pending";
}): string | null {
  if (input.serverConfig === null) {
    return "Connect to this machine to change its icon.";
  }
  if (input.serverConfig.machine.capabilities.machineIcon !== true) {
    return "This machine's server is too old to keep an icon. Update it to choose one.";
  }
  if (input.operateAccess !== "granted") {
    return "Your session on this machine cannot change its settings.";
  }
  return null;
}

export function MachineIconMenu({
  machineId,
  serverConfig,
}: {
  readonly machineId: MachineId;
  readonly serverConfig: Pick<ServerConfig, "machine"> | null;
}) {
  const updateSettings = useUpdateMachineSettings(machineId);
  const operateAccess = useMachineScope(machineId, AuthSettingsWriteScope)
    ? "granted"
    : "denied";
  const lock = resolveMachineIconPickerLock({ serverConfig, operateAccess });
  const detected = serverConfig?.machine.platform.machine ?? "server";
  const resolved = resolveMachineKind(serverConfig);

  return (
    <MenuSub>
      <MenuSubTrigger>
        <MachineIcon kind={resolved} />
        Icon
      </MenuSubTrigger>
      <MenuSubPopup>
        {lock !== null ? (
          <>
            <MenuItem disabled className="whitespace-normal">
              {lock}
            </MenuItem>
            <MenuSeparator />
          </>
        ) : null}
        <MenuRadioGroup
          value={resolved}
          onValueChange={(next) => {
            if (lock !== null || !isMachineKind(next)) return;
            updateSettings({ machineIcon: next === detected ? null : next });
          }}
        >
          {MACHINE_KINDS.map((kind) => (
            <MenuRadioItem key={kind} value={kind} disabled={lock !== null}>
              <span className="flex min-w-0 items-center gap-2">
                <MachineIcon kind={kind} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {MACHINE_KIND_LABELS[kind]}
                </span>
                {kind === detected ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {serverConfig?.machine.platform.machine ? "detected" : "default"}
                  </span>
                ) : null}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
