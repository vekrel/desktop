import { normalizeAccountRelayUrl } from "@vekrel/client-runtime/account-auth";

export interface CloudPublicConfig {
  readonly relayUrl: string | null;
  readonly relayTracing: {
    readonly tracesUrl: string | null;
    readonly tracesDataset: string | null;
    readonly tracesToken: string | null;
  };
}

export function trimNonEmpty(value: string | undefined): string | null {
  return value?.trim() || null;
}

function normalizeSecureUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeRelayUrl(value: string | undefined): string | null {
  try {
    return value?.trim() ? normalizeAccountRelayUrl(value) : null;
  } catch {
    return null;
  }
}

export function resolveCloudPublicConfig(): CloudPublicConfig {
  return {
    relayUrl: normalizeRelayUrl(import.meta.env.VITE_VEKREL_RELAY_URL as string | undefined),
    relayTracing: {
      tracesUrl: normalizeSecureUrl(
        (import.meta.env.VITE_RELAY_OTLP_TRACES_URL as string | undefined) ?? "",
      ),
      tracesDataset: trimNonEmpty(
        import.meta.env.VITE_RELAY_OTLP_TRACES_DATASET as string | undefined,
      ),
      tracesToken: trimNonEmpty(import.meta.env.VITE_RELAY_OTLP_TRACES_TOKEN as string | undefined),
    },
  };
}

export function resolveRelayTracingConfig() {
  // The relay exporter is created during module initialization, so this must be synchronous.
  if (
    typeof window !== "undefined" &&
    window.desktopBridge?.getRelayTelemetryEnabled?.() === false
  ) {
    return null;
  }
  const { relayTracing } = resolveCloudPublicConfig();
  return relayTracing.tracesUrl && relayTracing.tracesDataset && relayTracing.tracesToken
    ? {
        tracesUrl: relayTracing.tracesUrl,
        tracesDataset: relayTracing.tracesDataset,
        tracesToken: relayTracing.tracesToken,
      }
    : null;
}

/**
 * The relay keeps the web refresh token in a SameSite=Lax cookie, so sign-in only works on a page
 * that is same-site with the relay: the relay's own hostname on loopback, otherwise an https page
 * on `<domain>` or a subdomain of it, where the relay is `<label>.<domain>`.
 * shortcut: takes the relay's parent domain as the registrable domain (`relay.<domain>`); use a
 * public-suffix check if the relay ever moves deeper than one label under the app's domain.
 */
export function hasCloudPublicConfig(): boolean {
  const { relayUrl } = resolveCloudPublicConfig();
  if (!relayUrl) {
    return false;
  }
  if (typeof window === "undefined") {
    return true;
  }
  // The desktop shell signs in through `window.desktopAccount` (system browser + deep link, no
  // cookie); a shell without it has no sign-in.
  if (window.desktopAccount !== undefined) {
    return true;
  }
  if (window.desktopBridge !== undefined) {
    return false;
  }

  const relay = new URL(relayUrl);
  const { hostname, protocol, port } = window.location;
  if (relay.protocol === "http:") {
    return hostname === relay.hostname;
  }
  const domain = relay.hostname.replace(/^[^.]+\./u, "");
  return (
    protocol === "https:" &&
    port === "" &&
    domain.includes(".") &&
    (hostname === domain || hostname.endsWith(`.${domain}`))
  );
}
