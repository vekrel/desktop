/// <reference types="vite-plus/client" />

import type { DesktopBridge } from "@vekrel/contracts";

interface ImportMetaEnv {
  readonly VITE_HTTP_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_HOSTED_APP_URL: string;
  readonly VITE_HOSTED_APP_CHANNEL: string;
  readonly VITE_RELAY_OTLP_TRACES_URL: string;
  readonly VITE_RELAY_OTLP_TRACES_DATASET: string;
  readonly VITE_RELAY_OTLP_TRACES_TOKEN: string;
  readonly VEKREL_DESKTOP_UPDATE_REPOSITORY: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  /** Same as Desktop's `apps/desktop/src/preload.ts`: the account lives in Electron main. */
  interface DesktopAccountBridge {
    /** Opens the relay sign-in in the system browser; resolves once signed in. */
    readonly startSignIn: () => Promise<void>;
    /** A current access token, or null when signed out. */
    readonly getAccessToken: () => Promise<string | null>;
    /** Revokes the session at the relay, then forgets it on this computer. */
    readonly signOut: () => Promise<void>;
  }

  interface Window {
    desktopBridge?: DesktopBridge;
    desktopAccount?: DesktopAccountBridge;
  }
}
