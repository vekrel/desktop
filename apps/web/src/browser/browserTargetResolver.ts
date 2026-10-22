import type {
  BrowserNavigationTarget,
  MachineId,
  PreviewUrlResolution,
} from "@vekrel/contracts";
import { isLoopbackHost, normalizePreviewUrl } from "@vekrel/shared/preview";
import { isLocalLoopbackHost, isPrivateNetworkHost } from "@vekrel/shared/hostClassification";

import type { ConnectionTarget } from "@vekrel/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isElectron } from "~/env";
import { readPreparedConnection } from "~/state/session";

export {
  normalizeHostname,
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
} from "@vekrel/shared/hostClassification";

const readMachineUrl = (machineId: MachineId): URL => {
  const connection = readPreparedConnection(machineId);
  if (!connection) throw new Error(`Machine ${machineId} is not connected.`);
  return new URL(connection.httpBaseUrl);
};

const resolveMachinePortTarget = (
  machineId: MachineId,
  target: Extract<BrowserNavigationTarget, { readonly kind: "machine-port" }>,
  machineUrl: URL,
  requestedUrl?: string,
  sourceUrl?: URL,
): PreviewUrlResolution => {
  if (!isPrivateNetworkHost(machineUrl.hostname)) {
    throw new Error(
      "This machine port needs the planned authenticated preview gateway; its server address is not directly private-network reachable.",
    );
  }
  const protocol = target.protocol ?? "http";
  const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
  const normalizedMachineHost = machineUrl.hostname.replace(/^\[|\]$/g, "");
  // Local loopback machines should advertise `localhost` so Chromium
  // dual-stack lookup can reach a Vite server bound only to ::1 or 127.0.0.1.
  const resolvedHost = isLocalLoopbackHost(normalizedMachineHost)
    ? "localhost"
    : normalizedMachineHost.includes(":")
      ? `[${normalizedMachineHost}]`
      : normalizedMachineHost;
  const resolved = sourceUrl
    ? new URL(sourceUrl)
    : new URL(path, `${protocol}://${resolvedHost}:${target.port}`);
  if (sourceUrl) {
    resolved.hostname = resolvedHost;
    resolved.port = String(target.port);
  }
  return {
    requestedUrl: requestedUrl ?? `${protocol}://localhost:${target.port}${path}`,
    resolvedUrl: resolved.toString(),
    resolutionKind: isLocalLoopbackHost(normalizedMachineHost)
      ? "direct"
      : "direct-private-network",
    machineId,
  };
};

export function resolveBrowserNavigationTarget(
  machineId: MachineId,
  target: BrowserNavigationTarget,
): PreviewUrlResolution {
  if (target.kind === "url") {
    return {
      requestedUrl: target.url,
      resolvedUrl: target.url,
      resolutionKind: "direct",
      machineId,
    };
  }
  return resolveMachinePortTarget(machineId, target, readMachineUrl(machineId));
}

/**
 * The desktop app draws tabs on the machine that runs its primary backend and
 * any desktop-local backend (WSL). Its connection URL can still be a LAN
 * address (WSL NAT mode binds the distro IP), but a dev server bound to
 * loopback only answers on `localhost` there.
 */
const reachesMachineLoopback = (target: ConnectionTarget): boolean =>
  isElectron &&
  (target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target));

export function resolveDiscoveredServerUrl(machineId: MachineId, rawUrl: string): string {
  try {
    const normalizedUrl = normalizePreviewUrl(rawUrl);
    const parsed = new URL(normalizedUrl);
    if (!isLoopbackHost(parsed.hostname)) return normalizedUrl;
    const target = readPreparedConnection(machineId)?.target;
    if (target && reachesMachineLoopback(target)) return normalizedUrl;
    return resolveMachinePortTarget(
      machineId,
      {
        kind: "machine-port",
        port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
        protocol: parsed.protocol === "https:" ? "https" : "http",
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      },
      readMachineUrl(machineId),
      rawUrl,
      parsed,
    ).resolvedUrl;
  } catch {
    return rawUrl;
  }
}
