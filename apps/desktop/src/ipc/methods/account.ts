import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAccount from "../../app/DesktopAccount.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const startSignIn = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_START_SIGN_IN_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.account.startSignIn")(function* () {
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.startSignIn;
  }),
});

export const getAccessToken = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_GET_ACCESS_TOKEN_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.account.getAccessToken")(function* () {
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.getAccessToken;
  }),
});

export const signOut = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACCOUNT_SIGN_OUT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.account.signOut")(function* () {
    const account = yield* DesktopAccount.DesktopAccount;
    return yield* account.signOut;
  }),
});
