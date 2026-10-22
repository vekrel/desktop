import { useAtomValue } from "@effect/atom-react";
import type { MachineId, PreviewRuntime, PreviewSessionSnapshot } from "@vekrel/contracts";

import { isElectron } from "~/env";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { primaryMachineIdAtom } from "~/state/primaryMachine";
import {
  readMachineSupportsServerBrowser,
  useMachineSupportsServerBrowser,
} from "~/state/entities";

export function previewRuntimeFor(machineId: MachineId): PreviewRuntime | undefined {
  if (!readMachineSupportsServerBrowser(machineId)) return undefined;
  if (
    isPreviewSupportedInRuntime() &&
    machineId !== appAtomRegistry.get(primaryMachineIdAtom)
  ) {
    return undefined;
  }
  return "server";
}

export function alternatePreviewRuntime(
  machineId: MachineId,
  primaryMachineId: MachineId | null,
  serverBrowser: boolean,
  snapshot: Pick<PreviewSessionSnapshot, "runtime"> | null | undefined,
): PreviewRuntime | null {
  if (!snapshot || !serverBrowser || !isPreviewSupportedInRuntime()) return null;
  if (machineId === primaryMachineId) return null;
  return snapshot.runtime === "server" ? "desktop" : "server";
}

export function isPreviewAvailableFor(machineId: MachineId): boolean {
  return isPreviewSupportedInRuntime() || readMachineSupportsServerBrowser(machineId);
}

export function usePreviewAvailable(machineId: MachineId | null): boolean {
  const serverBrowser = useMachineSupportsServerBrowser(machineId);
  return isPreviewSupportedInRuntime() || serverBrowser;
}

export function rendersServerTabNatively(
  machineId: MachineId,
  primaryMachineId: MachineId | null,
  snapshot: Pick<PreviewSessionSnapshot, "runtime"> | null | undefined,
): boolean {
  return (
    isElectron &&
    snapshot?.runtime === "server" &&
    primaryMachineId !== null &&
    machineId === primaryMachineId
  );
}

export function useRendersServerTabNatively(
  machineId: MachineId,
  snapshot: Pick<PreviewSessionSnapshot, "runtime"> | null | undefined,
): boolean {
  return rendersServerTabNatively(machineId, useAtomValue(primaryMachineIdAtom), snapshot);
}
