import { DeviceToolVersions } from "../device/DeviceToolVersions";
import { DeviceHostAvailability } from "../device/DeviceHostAvailability";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { AuthSettingsWriteScope } from "@vekrel/contracts";
import { readMachineScope, useMachineScope } from "../../state/session";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { AppleIcon, AndroidIcon } from "../Icons";
import { Spinner } from "../ui/spinner";
import type { MachineId, SshDeviceHostConfig } from "@vekrel/contracts";
import { randomUUID } from "../../lib/utils";
import { useState } from "react";
import { deviceMachine } from "../../state/device";
import { machineAtomList, machineIdsKey } from "../../state/machineAtomList";
import { serverMachine } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  MoreVertical,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Menu, MenuTrigger, MenuPopup, MenuItem } from "../ui/menu";
import { SettingsRow } from "./settingsLayout";

import { useSettingsScope } from "./SettingsScopeContext";
import { toastManager } from "../ui/toast";
import {
  groupDeviceHosts,
  updateDeviceHosts,
  type DeviceHostMachine,
  type DeviceHostGroup,
} from "./deviceHostsSettings.logic";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { DeviceHostEditor } from "./DeviceHostEditor";
import { useHostConnectionChecks } from "./useHostConnectionChecks";
import { deviceHostConnectionKey } from "./deviceHostConnectionChecks";
import { settingsScopeMachineLabel, settingsScopeMachineLabels } from "./settingsScopeAxis";
import { DeviceHostDiagnostics } from "../device/DeviceSetup";

export function DeviceHostsSettings(props: { machineId: MachineId | null }) {
  const { scope, machines, connectedMachines } = useSettingsScope();
  const canConfigure = useMachineScope(props.machineId, AuthSettingsWriteScope);
  const projectScope = scope.kind === "project" || scope.kind === "checkout";
  const update = useAtomCommand(serverMachine.updateSettings, { reportFailure: false });
  const [editing, setEditing] = useState<SshDeviceHostConfig | null>(null);
  const [originalHost, setOriginalHost] = useState<SshDeviceHostConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = machines.map((machine) => ({
    machineId: machine.machineId,
    label: settingsScopeMachineLabel(machine, machines),
    connected: machine.connection.phase === "connected",
  }));
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const hostMachines = connectedMachines.map((machine) => ({
    machineId: machine.machineId,
    label: machine.label,
    labels: settingsScopeMachineLabels(machine, connectedMachines),
    hosts: machine.serverConfig?.settings.deviceHosts ?? [],
  }));
  const groupedHosts = groupDeviceHosts(hostMachines);
  const save = async (host: SshDeviceHostConfig, remove = false, original = host) => {
    if (!props.machineId || projectScope) return;
    setBusy(true);
    const results = await Promise.allSettled(
      machines.map(async (machine) => {
        if (machine.connection.phase !== "connected" || !machine.serverConfig) {
          throw new Error("Machine disconnected");
        }
        if (!readMachineScope(machine.machineId, AuthSettingsWriteScope)) {
          throw new Error("This connection cannot change device settings.");
        }
        return update({
          machineId: machine.machineId,
          input: {
            patch: {
              deviceHosts: updateDeviceHosts(
                machine.serverConfig.settings.deviceHosts,
                host,
                remove,
                original,
              ),
            },
          },
        });
      }),
    );
    setBusy(false);
    const failed = machines.filter((_, index) => {
      const result = results[index];
      return result?.status !== "fulfilled" || result.value._tag === "Failure";
    });
    if (failed.length === 0) {
      setEditing(null);
    } else {
      toastManager.add({
        type: "error",
        title: "Device hosts not saved on all machines",
        description: `Could not update ${failed.map((machine) => machine.label).join(", ")}.`,
      });
    }
  };
  const listActions = {
    busy: !canConfigure || projectScope || busy,
    checks,
    testConnection: async (host: SshDeviceHostConfig) => {
      const results = await testConnection(host);
      if (!results) return;
      const failed = targets.filter((target) => results[target.machineId]?.status === "failed");
      toastManager.add({
        type: failed.length ? "error" : "success",
        title: failed.length
          ? `${host.label}: ${failed.length} of ${targets.length} machines failed`
          : `${host.label}: connection checks passed`,
        description: failed.length
          ? `Could not connect from ${failed.map((target) => target.label).join(", ")}.`
          : "Connected or already available locally on each selected machine.",
      });
      return results;
    },
    onEdit: (host: SshDeviceHostConfig) => {
      setOriginalHost(host);
      setEditing(host);
    },
    onRemove: (host: SshDeviceHostConfig) => void save(host, true),
  };
  return (
    <SettingsRow
      id="device-hosts"
      title="Device hosts"
      serverScoped
      settingKeys={["deviceHosts"]}
      description="Add remote machines with simulator or emulator runtimes installed, and the selected machines will connect over SSH and set up device tools automatically."
      control={
        <Button
          size="sm"
          variant="outline"
          disabled={
            !canConfigure || projectScope || busy || !props.machineId || editing !== null
          }
          onClick={() => {
            setOriginalHost(null);
            setEditing({ kind: "ssh", id: randomUUID(), label: "", target: "" });
          }}
        >
          <PlusIcon className="size-3.5" /> Add host
        </Button>
      }
    >
      <div className="pt-3 pb-2">
        {!props.machineId ? (
          <p className="text-sm text-muted-foreground">
            Connect a selected machine to manage device hosts.
          </p>
        ) : (
          <>
            {hostMachines.length > 1 && groupedHosts === null ? (
              <div className="space-y-2">
                {hostMachines.map((machine) => (
                  <FoldedSettingsSection
                    key={machine.machineId}
                    id={`device-hosts-${machine.machineId}`}
                    title={
                      <>
                        <span className="block max-w-64 truncate">
                          {machine.labels.primary}
                        </span>
                        {machine.labels.secondary ? (
                          <span className="block max-w-64 truncate text-xs font-normal text-muted-foreground">
                            {machine.labels.secondary}
                          </span>
                        ) : null}
                      </>
                    }
                    summary={
                      summarizeLabels(machine.hosts.map((host) => host.label)) ||
                      "No device hosts"
                    }
                  >
                    <div className="px-3 sm:px-4 [&>div:first-child]:border-t-0">
                      <DeviceHostList machines={[machine]} {...listActions} />
                    </div>
                  </FoldedSettingsSection>
                ))}
              </div>
            ) : (
              <DeviceHostList
                machines={hostMachines}
                groups={groupedHosts ?? undefined}
                compact={hostMachines.length > 1}
                {...listActions}
              />
            )}
            {editing ? (
              <DeviceHostEditor
                key={editing.id}
                host={editing}
                isNew={originalHost === null}
                targets={targets}
                busy={busy}
                onSave={(host) => void save(host, false, originalHost ?? host)}
                onClose={() => setEditing(null)}
              />
            ) : null}
          </>
        )}
      </div>
    </SettingsRow>
  );
}

const deviceHostStatesAtom = machineAtomList("web-device-host-states", (machineId) =>
  deviceMachine.state({ machineId, input: {} }),
);

function DeviceHostList({
  machines,
  groups,
  compact = false,
  busy,
  onEdit,
  onRemove,
  checks,
  testConnection,
}: {
  machines: ReadonlyArray<DeviceHostMachine>;
  groups?: ReadonlyArray<DeviceHostGroup> | undefined;
  compact?: boolean;
  busy: boolean;
  onEdit: (host: SshDeviceHostConfig) => void;
  onRemove: (host: SshDeviceHostConfig) => void;
  checks: ReturnType<typeof useHostConnectionChecks>["checks"];
  testConnection: ReturnType<typeof useHostConnectionChecks>["testConnection"];
}) {
  const { machines: scopeMachines } = useSettingsScope();
  const machineLabels = new Map(
    scopeMachines.map((machine) => [
      machine.machineId,
      settingsScopeMachineLabels(machine, scopeMachines),
    ]),
  );
  const machineIds = machines.map(({ machineId }) => machineId);
  const results = useAtomValue(deviceHostStatesAtom(machineIdsKey(machineIds)));
  const states = new Map(
    machineIds.map(
      (machineId, index) =>
        [machineId, Option.getOrUndefined(AsyncResult.value(results[index]!))] as const,
    ),
  );
  const retry = useAtomCommand(deviceMachine.list);
  const [retrying, setRetrying] = useState<string | null>(null);
  const retryHost = (machineId: MachineId, hostId: string, key = hostId) => {
    setRetrying(key);
    void retry({ machineId, input: { retryHostId: hostId } }).finally(() => setRetrying(null));
  };
  const rows =
    groups ??
    machines.flatMap((machine) =>
      machine.hosts.map((host) => ({
        host,
        members: [{ machineId: machine.machineId, label: machine.label, host }],
      })),
    );
  return (
    <>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No device hosts.</p>
      ) : null}
      {rows.map(({ host, members }) => {
        const hostChecks = checks[deviceHostConnectionKey(host)];
        const checkedMembers = scopeMachines.flatMap((machine) =>
          hostChecks?.[machine.machineId] &&
          !members.some((member) => member.machineId === machine.machineId)
            ? [{ machineId: machine.machineId, label: machine.label, host }]
            : [],
        );
        const results = [...members, ...checkedMembers].map((member) => {
          const state = states.get(member.machineId);
          const status = state?.hostStatuses[member.host.id];
          const check = hostChecks?.[member.machineId];
          const summary = state?.hosts.find((value) => value.id === member.host.id);
          const label = machineLabels.get(member.machineId)?.primary ?? member.label;
          const address = machineLabels.get(member.machineId)?.secondary;
          const error =
            check?.status === "failed"
              ? check.error
              : check?.status === "local"
                ? undefined
                : status?.status === "failed"
                  ? status.detail
                  : undefined;
          return {
            ...member,
            label,
            address,
            name: [label, address].filter(Boolean).join(" · "),
            state,
            status,
            check,
            summary,
            error,
            versions: (
              <DeviceToolVersions
                owner={label}
                error={summary?.toolInspectionError}
                tools={summary?.tools ?? (check?.status === "connected" ? check.tools : undefined)}
              />
            ),
          };
        });
        const first = results[0];
        if (!first) return null;
        const { machineId, status, check, summary, error } = first;
        const platforms =
          (check?.status === "connected" ? check.platforms : undefined) ?? summary?.platforms ?? [];
        const progress =
          check?.status === "pending"
            ? "Checking connection…"
            : status?.status === "installing"
              ? "Installing device support…"
              : status?.status === "starting"
                ? "Connecting…"
                : null;
        const failed = results.filter(
          (result) =>
            result.check?.status === "failed" ||
            (result.check?.status !== "local" && result.status?.status === "failed"),
        );
        const pending = results.some(
          (result) =>
            result.check?.status === "pending" ||
            result.status?.status === "installing" ||
            result.status?.status === "starting",
        );
        const ready = results.every(
          (result) =>
            result.check?.status === "connected" ||
            result.check?.status === "local" ||
            result.status?.status === "ready",
        );
        const retryable = results.filter(
          (result) =>
            result.status?.status === "failed" &&
            result.state?.supportsHostRetry &&
            result.state.hostStatus !== "disabled",
        );
        const canRetry = !compact && retryable.includes(first);
        const indicators = compact
          ? [
              {
                key: "connection",
                label: failed.length
                  ? "Connection failed"
                  : pending
                    ? "Checking connections"
                    : ready
                      ? "Connected"
                      : "Connection not checked",
                warning: failed.length > 0,
                icon: failed.length ? (
                  <TriangleAlertIcon className="size-3.5" />
                ) : pending ? (
                  <Spinner size="xs" />
                ) : ready ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <CircleIcon className="size-3.5" />
                ),
                detail: failed.length ? (
                  <div className="space-y-1">
                    {failed.map((result) => (
                      <p key={result.machineId}>
                        {result.name}: {result.error || "Connection failed"}
                      </p>
                    ))}
                  </div>
                ) : pending ? (
                  "Checking connections…"
                ) : ready ? (
                  "Connected or available locally on each listed machine"
                ) : (
                  "Test the connection to check access from each machine"
                ),
              },
            ]
          : platforms
              .filter((platform) => platform.available)
              .map((platform) => ({
                key: platform.platform,
                label: platform.platform === "ios" ? "iOS available" : "Android available",
                warning: false,
                icon:
                  platform.platform === "ios" ? (
                    // The Apple mark is bottom-heavy; lift it so it does not dip under the label.
                    <AppleIcon className="size-3.5 -translate-y-px" />
                  ) : (
                    <AndroidIcon className="size-3.5" />
                  ),
              }));
        return (
          <div key={host.id} className="flex items-center gap-2 border-t border-border/50 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{host.label}</p>
                {indicators.map((indicator) => (
                  <Tooltip key={indicator.key}>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          role="img"
                          aria-label={indicator.label}
                          className={
                            indicator.warning
                              ? "shrink-0 text-warning"
                              : "shrink-0 text-muted-foreground"
                          }
                        />
                      }
                    >
                      {indicator.icon}
                    </TooltipTrigger>
                    <TooltipPopup>
                      {"detail" in indicator ? indicator.detail : indicator.label}
                    </TooltipPopup>
                  </Tooltip>
                ))}
              </div>
              <p className="truncate text-xs text-muted-foreground">{host.target}</p>
              {results
                .filter(
                  (result) =>
                    result.status?.status === "ready" && result.status.androidDiscoveryIncomplete,
                )
                .map((result) => (
                  <p key={result.machineId} role="status" className="mt-1 text-xs text-warning">
                    {compact ? `${result.label}: ` : ""}
                    {result.status?.detail ??
                      "The Android device list may be incomplete. Refresh devices to try again."}
                  </p>
                ))}
              {compact ? (
                <Collapsible>
                  <div className="min-w-0 text-xs [--inline-button-white-space:normal]">
                    <CollapsibleTrigger
                      aria-label={`${host.label} machine details`}
                      render={<InlineButton tone="muted" />}
                    >
                      <span className="line-clamp-1 break-all text-left">
                        {summarizeLabels(results.map((result) => result.name))}
                      </span>
                      <ChevronDownIcon className="size-3 shrink-0" />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsiblePanel>
                    <div className="mt-2 space-y-2">
                      {results.map((result) => (
                        <div key={result.machineId}>
                          <p className="text-xs text-muted-foreground">{result.label}</p>
                          {result.address ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {result.address}
                            </p>
                          ) : null}
                          {result.error ? (
                            <p role="status" className="text-xs text-destructive">
                              {result.error}
                            </p>
                          ) : null}
                          {result.state ? (
                            <DeviceHostDiagnostics
                              hosts={[result.host]}
                              hostStatuses={result.state.hostStatuses}
                            />
                          ) : null}
                          {result.versions}
                          {result.check?.status === "local" ? (
                            <p className="text-xs text-muted-foreground">
                              Already available locally
                            </p>
                          ) : (
                            <DeviceHostAvailability
                              platforms={
                                (result.check?.status === "connected"
                                  ? result.check.platforms
                                  : result.summary?.platforms) ?? []
                              }
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              ) : (
                first.versions
              )}
              {!compact && check?.status === "local" ? (
                <p className="mt-1 text-xs text-muted-foreground">Already available locally</p>
              ) : null}
              {!compact && error ? (
                <div className="mt-1" role="status">
                  <details className="text-xs text-destructive">
                    <summary>Connection failed</summary>
                    <p className="mt-1 whitespace-pre-wrap break-words">{error}</p>
                  </details>
                </div>
              ) : null}
              {!compact
                ? results.map((result) =>
                    result.state ? (
                      <DeviceHostDiagnostics
                        key={result.machineId}
                        className="mt-1"
                        hosts={[result.host]}
                        hostStatuses={result.state.hostStatuses}
                      />
                    ) : null,
                  )
                : null}
            </div>
            {!compact && progress ? (
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <Spinner size="xs" />
                {progress}
              </span>
            ) : null}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    disabled={busy}
                    aria-label={host.label + " options"}
                  />
                }
              >
                <MoreVertical />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => onEdit(host)}>Edit</MenuItem>
                <MenuItem variant="destructive" onClick={() => onRemove(host)}>
                  Remove
                </MenuItem>
                {compact
                  ? retryable.map((result) => (
                      <MenuItem
                        key={result.machineId}
                        disabled={retrying !== null}
                        onClick={() =>
                          retryHost(result.machineId, result.host.id, result.machineId)
                        }
                      >
                        {retrying === result.machineId ? "Retrying" : "Retry"} from{" "}
                        {result.label}
                        {result.address ? ` (${result.address})` : null}
                      </MenuItem>
                    ))
                  : null}
              </MenuPopup>
            </Menu>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || (canRetry ? retrying !== null : compact ? pending : progress !== null)
              }
              onClick={() => {
                if (canRetry) retryHost(machineId, host.id);
                else void testConnection(host);
              }}
            >
              {canRetry ? (retrying === host.id ? "Retrying…" : "Retry") : "Test connection"}
            </Button>
          </div>
        );
      })}
    </>
  );
}

function summarizeLabels(labels: ReadonlyArray<string>) {
  return `${labels.slice(0, 2).join(", ")}${labels.length > 2 ? ` +${labels.length - 2}` : ""}`;
}
