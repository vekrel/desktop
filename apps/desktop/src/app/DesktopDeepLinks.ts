import * as NodeURL from "node:url";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { codexAuthDeliveryUrl, readCodexAuthHandoff } from "@vekrel/shared/codexAuthHandoff";
import { receiveCodexAuthCallback, CodexAuthCallbackError } from "./CodexAuthCallback.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import { providerAuthReturnUrl } from "@vekrel/shared/providerAuthReturnUrl";
import { promptLinkAppPath } from "@vekrel/shared/promptLinks";
import * as HostProcess from "@vekrel/shared/HostProcess";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAccount from "./DesktopAccount.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

/**
 * Launch-time and deep-link routing: userData path, the single-instance lock, and the links the
 * OS hands to the app (`open-url`, second-instance argv, `open-file`), including the account
 * sign-in callback.
 */
export class DesktopDeepLinks extends Context.Service<
  DesktopDeepLinks,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      | ElectronApp.ElectronApp
      | ElectronWindow.ElectronWindow
      | DesktopWebLinks.DesktopWebLinks
      | DesktopAccount.DesktopAccount
      | Scope.Scope
    >;
  }
>()("@vekrel/desktop/app/DesktopDeepLinks") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const shell = yield* ElectronShell.ElectronShell;

  // userData must be set before Electron is ready; this layer runs pre-ready and must not yield.
  const userDataPath = yield* DesktopUserData.resolveUserDataPath(environment);
  yield* electronApp.setPath("userData", userDataPath);

  // T3 owns the profile-scoped lock on every platform.
  // Quit is asynchronous, so interrupt before the application runtime is built.
  if (!(yield* electronApp.requestSingleInstanceLock)) {
    yield* electronApp.quit;
    return yield* Effect.interrupt;
  }

  // Retain launch arguments while asynchronous startup builds the application runtime.
  const pendingSecondInstances: Array<readonly string[]> = [];
  let handleSecondInstance = (argv: readonly string[]) => {
    pendingSecondInstances.push(argv);
  };
  yield* electronApp.on("second-instance", (_event: unknown, argv: readonly string[]) => {
    handleSecondInstance(argv);
  });

  return DesktopDeepLinks.of({
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      const account = yield* DesktopAccount.DesktopAccount;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);
      const scheme = ElectronProtocol.getDesktopScheme(environment.isDevelopment);
      // The OS routes <scheme>:// links (the account callback among them) to this app.
      yield* electronApp.setAsDefaultProtocolClient(scheme);

      const revealMainWindow = () =>
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) yield* electronWindow.reveal(mainWindow.value);
          }),
        );
      const receiveAccountCallback = (value: string | undefined) => {
        if (!value || !account.receiveCallback(value)) return false;
        revealMainWindow();
        return true;
      };
      const startProviderAuthHandoff = (value: string | undefined) => {
        if (!value) return false;
        const request = readCodexAuthHandoff(value, environment.isDevelopment);
        if (!request) return false;
        void runPromise(
          Effect.gen(function* () {
            yield* electronApp.whenReady;
            yield* Effect.tryPromise({
              try: () =>
                receiveCodexAuthCallback(
                  request.authorizationUrl,
                  (url) => runPromise(shell.openExternal(url)),
                  (callbackUrl) => codexAuthDeliveryUrl(request, callbackUrl),
                ),
              catch: () =>
                new CodexAuthCallbackError({
                  detail:
                    "Could not receive hosted web ChatGPT sign-in. Retry or use the redirect URL in the web app.",
                }),
            });
          }).pipe(
            Effect.catch(() => Effect.logWarning("Could not complete ChatGPT desktop handoff.")),
          ),
        );
        return true;
      };
      const resumeProviderAuth = (value: string | undefined) => {
        const destination = providerAuthReturnUrl(value);
        const expectedOrigin = `${scheme}://app`;
        if (!destination?.startsWith(`${expectedOrigin}/`)) return false;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isNone(mainWindow)) return;
            yield* Effect.promise(() => mainWindow.value.loadURL(destination));
            yield* electronWindow.reveal(mainWindow.value);
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Could not return to provider setup", cause),
            ),
          ),
        );
        return true;
      };
      const openAppLink = (value: string | undefined) => {
        if (!value || promptLinkAppPath(value) === null) return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const args = yield* HostProcess.Arguments;
      args.some((value) => startProviderAuthHandoff(value) || openAppLink(value));
      const openWebLink = (url: string) => {
        if (!DesktopWebLinks.isWebLink(url)) return false;
        void runPromise(webLinks.receive(url));
        return true;
      };
      yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
        if (
          receiveAccountCallback(url) ||
          startProviderAuthHandoff(url) ||
          resumeProviderAuth(url) ||
          openWebLink(url) ||
          openAppLink(url)
        )
          event.preventDefault();
      });
      yield* electronApp.on("open-file", (event: { preventDefault: () => void }, path: string) => {
        if (!DesktopWebLinks.isWebPageFile(path)) return;
        event.preventDefault();
        void runPromise(webLinks.receive(NodeURL.pathToFileURL(path).href));
      });
      handleSecondInstance = (argv) => {
        if (
          argv?.some(
            (value) =>
              receiveAccountCallback(value) ||
              startProviderAuthHandoff(value) ||
              resumeProviderAuth(value) ||
              openAppLink(value),
          )
        )
          return;
        revealMainWindow();
      };
      for (const argv of pendingSecondInstances.splice(0)) handleSecondInstance(argv);
    }).pipe(Effect.withSpan("desktop.deepLinks.configure")),
  });
});

export const layer = Layer.effect(DesktopDeepLinks, make);
