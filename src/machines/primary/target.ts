import { PRIMARY_LOCAL_MACHINE_ID, type DesktopMachineBootstrap } from "@vekrel/contracts";
import * as Schema from "effect/Schema";

import { isLocalMachineDisabled } from "../../localMachine";

const PrimaryMachineTargetSource = Schema.Literals([
  "configured",
  "window-origin",
  "desktop-managed",
]);
type PrimaryMachineTargetSource = typeof PrimaryMachineTargetSource.Type;

const PrimaryMachineUrlKind = Schema.Literals([
  "http-base-url",
  "websocket-base-url",
  "development-server-url",
  "window-location-url",
]);
type PrimaryMachineUrlKind = typeof PrimaryMachineUrlKind.Type;

export class PrimaryMachineUrlInvalidError extends Schema.TaggedError<PrimaryMachineUrlInvalidError>()(
  "PrimaryMachineUrlInvalidError",
  {
    source: PrimaryMachineTargetSource,
    urlKind: PrimaryMachineUrlKind,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not parse ${this.urlKind} for the ${this.source} primary machine target.`;
  }
}

export class PrimaryMachineProtocolUnsupportedError extends Schema.TaggedError<PrimaryMachineProtocolUnsupportedError>()(
  "PrimaryMachineProtocolUnsupportedError",
  {
    source: PrimaryMachineTargetSource,
    protocol: Schema.String,
  },
) {
  override get message(): string {
    return `The ${this.source} primary machine target uses unsupported protocol ${this.protocol}.`;
  }
}

export class DesktopMachineBootstrapIncompleteError extends Schema.TaggedError<DesktopMachineBootstrapIncompleteError>()(
  "DesktopMachineBootstrapIncompleteError",
  {
    hasHttpBaseUrl: Schema.Boolean,
    hasWsBaseUrl: Schema.Boolean,
  },
) {
  override get message(): string {
    const missing = [
      ...(this.hasHttpBaseUrl ? [] : ["httpBaseUrl"]),
      ...(this.hasWsBaseUrl ? [] : ["wsBaseUrl"]),
    ];
    return `Desktop bootstrap is missing ${missing.join(" and ")} for the local machine.`;
  }
}

export class PrimaryMachineDisabledError extends Schema.TaggedError<PrimaryMachineDisabledError>()(
  "PrimaryMachineDisabledError",
  {},
) {
  override get message(): string {
    return "The local machine is disabled.";
  }
}

export interface PrimaryMachineTarget {
  readonly source: PrimaryMachineTargetSource;
  readonly target: {
    readonly httpBaseUrl: string;
    readonly wsBaseUrl: string;
  };
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

function getDesktopLocalMachineBootstrap(): DesktopMachineBootstrap | null {
  const bootstraps = window.desktopBridge?.getLocalMachineBootstraps() ?? [];
  return bootstraps.find((entry) => entry.id === PRIMARY_LOCAL_MACHINE_ID) ?? null;
}

function parseTargetUrl(input: {
  readonly rawValue: string;
  readonly baseUrl?: string;
  readonly source: PrimaryMachineTargetSource;
  readonly urlKind: PrimaryMachineUrlKind;
}): URL {
  try {
    return input.baseUrl === undefined
      ? new URL(input.rawValue)
      : new URL(input.rawValue, input.baseUrl);
  } catch (cause) {
    throw new PrimaryMachineUrlInvalidError({
      source: input.source,
      urlKind: input.urlKind,
      cause,
    });
  }
}

function normalizeBaseUrl(
  rawValue: string,
  source: PrimaryMachineTargetSource,
  urlKind: PrimaryMachineUrlKind,
): string {
  return parseTargetUrl({
    rawValue,
    baseUrl: window.location.origin,
    source,
    urlKind,
  }).toString();
}

function swapBaseUrlProtocol(
  rawValue: string,
  nextProtocol: "http:" | "https:" | "ws:" | "wss:",
  urlKind: PrimaryMachineUrlKind,
): string {
  const url = parseTargetUrl({
    rawValue,
    baseUrl: window.location.origin,
    source: "configured",
    urlKind,
  });
  url.protocol = nextProtocol;
  return url.toString();
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function resolveHttpRequestBaseUrl(primaryTarget: PrimaryMachineTarget): string {
  const httpBaseUrl = primaryTarget.target.httpBaseUrl;
  const configuredDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL?.trim();
  if (!configuredDevServerUrl) {
    return httpBaseUrl;
  }

  const currentUrl = parseTargetUrl({
    rawValue: window.location.href,
    source: "window-origin",
    urlKind: "window-location-url",
  });
  const targetUrl = parseTargetUrl({
    rawValue: httpBaseUrl,
    source: primaryTarget.source,
    urlKind: "http-base-url",
  });
  const devServerUrl = parseTargetUrl({
    rawValue: configuredDevServerUrl,
    baseUrl: currentUrl.origin,
    source: "configured",
    urlKind: "development-server-url",
  });

  const isCurrentOriginDevServer =
    (currentUrl.protocol === "http:" || currentUrl.protocol === "https:") &&
    currentUrl.origin === devServerUrl.origin;

  if (
    !isCurrentOriginDevServer ||
    currentUrl.origin === targetUrl.origin ||
    !isLoopbackHostname(currentUrl.hostname) ||
    !isLoopbackHostname(targetUrl.hostname)
  ) {
    return httpBaseUrl;
  }

  return currentUrl.origin;
}

function resolveConfiguredPrimaryTarget(): PrimaryMachineTarget | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim() || undefined;
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim() || undefined;

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null;
  }

  // Scheme checks run on the raw configured string, while the URL parser
  // folds schemes to lowercase ("WSS://host" parses fine). Without the
  // case folding an uppercase scheme would be classified as plaintext and
  // swapped to http/ws, silently downgrading TLS.
  const resolvedHttpBaseUrl =
    configuredHttpBaseUrl ??
    (configuredWsBaseUrl?.toLowerCase().startsWith("wss:")
      ? swapBaseUrlProtocol(configuredWsBaseUrl, "https:", "websocket-base-url")
      : swapBaseUrlProtocol(configuredWsBaseUrl!, "http:", "websocket-base-url"));
  const resolvedWsBaseUrl =
    configuredWsBaseUrl ??
    (configuredHttpBaseUrl?.toLowerCase().startsWith("https:")
      ? swapBaseUrlProtocol(configuredHttpBaseUrl, "wss:", "http-base-url")
      : swapBaseUrlProtocol(configuredHttpBaseUrl!, "ws:", "http-base-url"));

  return {
    source: "configured",
    target: {
      httpBaseUrl: normalizeBaseUrl(resolvedHttpBaseUrl, "configured", "http-base-url"),
      wsBaseUrl: normalizeBaseUrl(resolvedWsBaseUrl, "configured", "websocket-base-url"),
    },
  };
}

function resolveWindowOriginPrimaryTarget(): PrimaryMachineTarget {
  const url = parseTargetUrl({
    rawValue: window.location.origin,
    source: "window-origin",
    urlKind: "http-base-url",
  });
  const httpBaseUrl = url.toString();
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new PrimaryMachineProtocolUnsupportedError({
      source: "window-origin",
      protocol: url.protocol,
    });
  }
  return {
    source: "window-origin",
    target: {
      httpBaseUrl,
      wsBaseUrl: url.toString(),
    },
  };
}

function resolveDesktopPrimaryTarget(): PrimaryMachineTarget | null {
  const desktopBootstrap = getDesktopLocalMachineBootstrap();
  if (!desktopBootstrap) {
    return null;
  }
  if (!desktopBootstrap.httpBaseUrl && !desktopBootstrap.wsBaseUrl) {
    return null;
  }
  if (!desktopBootstrap.httpBaseUrl || !desktopBootstrap.wsBaseUrl) {
    throw new DesktopMachineBootstrapIncompleteError({
      hasHttpBaseUrl: Boolean(desktopBootstrap.httpBaseUrl),
      hasWsBaseUrl: Boolean(desktopBootstrap.wsBaseUrl),
    });
  }

  return {
    source: "desktop-managed",
    target: {
      httpBaseUrl: normalizeBaseUrl(
        desktopBootstrap.httpBaseUrl,
        "desktop-managed",
        "http-base-url",
      ),
      wsBaseUrl: normalizeBaseUrl(
        desktopBootstrap.wsBaseUrl,
        "desktop-managed",
        "websocket-base-url",
      ),
    },
  };
}

export function resolvePrimaryMachineHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryMachineTarget();
  if (!primaryTarget) {
    throw new PrimaryMachineDisabledError();
  }

  const url = parseTargetUrl({
    rawValue: resolveHttpRequestBaseUrl(primaryTarget),
    source: primaryTarget.source,
    urlKind: "http-base-url",
  });
  url.pathname = pathname;
  if (searchParams) {
    url.search = new URLSearchParams(searchParams).toString();
  }
  return url.toString();
}

// Null only when the desktop app runs with its local machine disabled;
// every other host has a primary (falling back to the page origin).
export function readPrimaryMachineTarget(): PrimaryMachineTarget | null {
  if (isLocalMachineDisabled()) {
    return null;
  }
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  );
}
