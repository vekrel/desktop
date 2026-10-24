import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopAccount from "../../app/DesktopAccount.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronProtocol from "../../electron/ElectronProtocol.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

class AccountIpcUnauthorizedSenderError extends Schema.TaggedError<AccountIpcUnauthorizedSenderError>()(
  "AccountIpcUnauthorizedSenderError",
  {},
) {
  override get message(): string {
    return "Account request was rejected.";
  }
}

/**
 * Account tokens go only to the app itself: the main window's top frame on `<scheme>://app`.
 * Previews, webviews, subframes and pages the window navigated to are refused.
 */
export const ensureTrustedAccountSender = Effect.fn("desktop.ipc.account.ensureTrustedSender")(
  function* (event: DesktopIpc.DesktopIpcInvokeEvent | undefined) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const main = yield* (yield* ElectronWindow.ElectronWindow).main;
    const appOrigin = `${ElectronProtocol.getDesktopScheme(environment.isDevelopment)}://app`;
    const frame = event?.senderFrame;
    if (
      event === undefined ||
      Option.isNone(main) ||
      main.value.isDestroyed() ||
      main.value.webContents.id !== event.sender.id ||
      !frame ||
      frame !== main.value.webContents.mainFrame ||
      !isAppUrl(frame.url, appOrigin)
    ) {
      return yield* new AccountIpcUnauthorizedSenderError();
    }
  },
);

function isAppUrl(value: string, appOrigin: string): boolean {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}` === appOrigin;
  } catch {
    return false;
  }
}

export const startSignIn = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_START_SIGN_IN_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.account.startSignIn")(function* (_input, event) {
    yield* ensureTrustedAccountSender(event);
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.startSignIn;
  }),
});

export const getAccessToken = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_GET_ACCESS_TOKEN_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.account.getAccessToken")(function* (_input, event) {
    yield* ensureTrustedAccountSender(event);
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.getAccessToken;
  }),
});

export const signOut = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_SIGN_OUT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.account.signOut")(function* (_input, event) {
    yield* ensureTrustedAccountSender(event);
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.signOut;
  }),
});
