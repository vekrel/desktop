import React from "react";
import ReactDOM from "react-dom/client";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { prepareProviderAuthDelivery } from "./providerAuthDelivery";
import { isElectron } from "./env";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

prepareProviderAuthDelivery();

// The relay's code and state arrive in /auth/callback's query: keep them out of Referer headers
// until the callback takes them out of the address bar.
if (window.location.pathname === "/auth/callback") {
  const referrerPolicy = document.createElement("meta");
  referrerPolicy.name = "referrer";
  referrerPolicy.content = "no-referrer";
  document.head.append(referrerPolicy);
}

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

// A failed split-chunk fetch usually means the hashed assets went stale under
// a deploy; one guarded reload picks up the fresh index.html.
let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

// Cloudless local mode never loads the account runtime.
const managedAuthModule = hasCloudPublicConfig() ? import("./cloud/managedAuth") : null;

export const startup = Promise.all([
  managedAuthModule?.then((module) => module.ManagedRelayAuthProvider) ?? null,
  router.load(),
])
  .then(([ManagedRelayAuthProvider]) => {
    // A route chunk failure still resolves router.load(): the error is parked in
    // the lazy component and surfaces through the route error boundary.
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {ManagedRelayAuthProvider ? (
          <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
        ) : (
          app
        )}
      </React.StrictMode>,
    );
  })
  .catch((error: unknown) => {
    if (reloadScheduled) return;
    throw error;
  });
